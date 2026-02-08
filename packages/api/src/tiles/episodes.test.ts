import { describe, expect, it } from "bun:test";

import type { SqlExecutor, SqlQueryResult } from "../db/types";
import { buildEpisodesTileSql, createEpisodesTileStore } from "./episodes";

describe("buildEpisodesTileSql", () => {
  it("keeps canonical SQL shape and parameter ordering", () => {
    const plan = buildEpisodesTileSql({
      system_id: "citibike-nyc",
      severity_version: "sev.v1",
      t_bucket_epoch_s: 1738872000,
      z: 12,
      x: 1200,
      y: 1530,
      max_features: 400,
      mvt_extent: 4096,
      mvt_buffer: 64,
    });
    expect(plan.text).toContain("ST_TileEnvelope($1::int, $2::int, $3::int)");
    expect(plan.text).toContain("FROM episode_markers_15m em");
    expect(plan.text).toContain("em.severity_version = $5");
    expect(plan.text).toContain("ORDER BY em.duration_minutes DESC, em.station_key ASC");
    expect(plan.params).toEqual([12, 1200, 1530, "citibike-nyc", "sev.v1", 1738872000, 400, 4096, 64]);
  });
});

class FakeDb implements SqlExecutor {
  private readonly rowsQueue: Array<{ mvt: Uint8Array; feature_count: number }>;

  constructor(rowsQueue: Array<{ mvt: Uint8Array; feature_count: number }>) {
    this.rowsQueue = rowsQueue;
  }

  async query<Row extends Record<string, unknown>>(
    _text: string,
    _params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    const next = this.rowsQueue.shift();
    if (!next) {
      return { rows: [] as Row[] };
    }
    return {
      rows: [
        {
          mvt: next.mvt,
          feature_count: next.feature_count,
        } as Row,
      ],
    };
  }
}

describe("createEpisodesTileStore", () => {
  it("returns 200 payload when under byte cap", async () => {
    const store = createEpisodesTileStore({
      db: new FakeDb([{ mvt: new Uint8Array([1, 2, 3]), feature_count: 2 }]),
      max_features_per_tile: 400,
      max_bytes_per_tile: 10,
    });

    const out = await store.fetchEpisodesTile({
      system_id: "citibike-nyc",
      severity_version: "sev.v1",
      t_bucket_epoch_s: 1738872000,
      z: 12,
      x: 1200,
      y: 1530,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect(out.feature_count).toBe(2);
    expect(out.bytes).toBe(3);
  });

  it("returns 429 when tile bytes exceed configured cap", async () => {
    const store = createEpisodesTileStore({
      db: new FakeDb([{ mvt: new Uint8Array(64), feature_count: 9 }]),
      max_features_per_tile: 400,
      max_bytes_per_tile: 10,
    });

    const out = await store.fetchEpisodesTile({
      system_id: "citibike-nyc",
      severity_version: "sev.v1",
      t_bucket_epoch_s: 1738872000,
      z: 12,
      x: 1200,
      y: 1530,
    });
    expect(out.ok).toBe(false);
    if (out.ok) {
      return;
    }
    expect(out.status).toBe(429);
    expect(out.code).toBe("tile_overloaded");
  });
});
