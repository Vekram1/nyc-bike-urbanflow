import { describe, expect, it } from "bun:test";

import { buildPolicyMovesTileSql, createPolicyMovesTileStore } from "./policy_moves";

describe("buildPolicyMovesTileSql", () => {
  it("builds deterministic SQL with expected params", () => {
    const plan = buildPolicyMovesTileSql({
      system_id: "citibike-nyc",
      sv: "sv1.k.payload.sig",
      policy_version: "rebal.greedy.v1",
      t_bucket_epoch_s: 1738872000,
      z: 12,
      x: 1200,
      y: 1530,
      top_n: 50,
      mvt_extent: 4096,
      mvt_buffer: 64,
    });

    expect(plan.text).toContain("FROM policy_runs r");
    expect(plan.text).toContain("ST_AsMVT(lines, 'policy_moves'");
    expect(plan.params).toEqual([
      12,
      1200,
      1530,
      "citibike-nyc",
      "sv1.k.payload.sig",
      "rebal.greedy.v1",
      1738872000,
      50,
      4096,
      64,
    ]);
  });
});

describe("createPolicyMovesTileStore", () => {
  it("returns 200 payload when tile is within byte cap", async () => {
    const store = createPolicyMovesTileStore({
      db: {
        async query() {
          return {
            rows: [{ mvt: new Uint8Array([1, 2, 3]), feature_count: 1 }],
          };
        },
      },
      max_moves_per_tile: 50,
      max_bytes_per_tile: 10_000,
    });

    const out = await store.fetchPolicyMovesTile({
      system_id: "citibike-nyc",
      sv: "sv",
      policy_version: "rebal.greedy.v1",
      t_bucket_epoch_s: 1738872000,
      z: 12,
      x: 1200,
      y: 1530,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.feature_count).toBe(1);
      expect(out.bytes).toBe(3);
    }
  });

  it("returns 429 when tile bytes exceed cap", async () => {
    const store = createPolicyMovesTileStore({
      db: {
        async query() {
          return {
            rows: [{ mvt: new Uint8Array(5000), feature_count: 3 }],
          };
        },
      },
      max_moves_per_tile: 50,
      max_bytes_per_tile: 1000,
    });

    const out = await store.fetchPolicyMovesTile({
      system_id: "citibike-nyc",
      sv: "sv",
      policy_version: "rebal.greedy.v1",
      t_bucket_epoch_s: 1738872000,
      z: 12,
      x: 1200,
      y: 1530,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(429);
      expect(out.code).toBe("tile_overloaded");
    }
  });
});
