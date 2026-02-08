import { describe, expect, it } from "bun:test";

import { buildCompositeTileSql, createCompositeTileStore } from "./composite";
import type { SqlExecutor, SqlQueryResult } from "../db/types";

describe("buildCompositeTileSql", () => {
  it("keeps fixed canonical SQL shape and parameter ordering", () => {
    const plan = buildCompositeTileSql({
      system_id: "citibike-nyc",
      t_bucket_epoch_s: 1738872000,
      severity_version: "sev.v1",
      pressure_source: "live_proxy",
      trips_baseline_id: undefined,
      trips_baseline_sha256: undefined,
      include_inv: true,
      include_sev: true,
      include_press: true,
      include_epi: false,
      include_optional_props: true,
      z: 12,
      x: 1200,
      y: 1530,
      max_features: 1500,
      mvt_extent: 4096,
      mvt_buffer: 64,
    });
    expect(plan.text).toContain("ST_TileEnvelope($1::int, $2::int, $3::int)");
    expect(plan.text).toContain("FROM stations_current s");
    expect(plan.text).toContain("LEFT JOIN station_status_1m");
    expect(plan.text).toContain("LEFT JOIN station_severity_5m");
    expect(plan.text).toContain("LEFT JOIN station_pressure_now_5m");
    expect(plan.text).toContain("LEFT JOIN station_outflows_monthly");
    expect(plan.text).toContain("LEFT JOIN station_inflows_monthly");
    expect(plan.text).toContain("delta_bikes_5m");
    expect(plan.text).toContain("volatility_60m");
    expect(plan.text).toContain("rebalancing_suspected");
    expect(plan.text).toContain("ST_AsMVT(q, 'inv'");
    expect(plan.text).toContain("ST_AsMVT(q, 'sev'");
    expect(plan.text).toContain("ST_AsMVT(q, 'press'");
    expect(plan.text).toContain("ST_AsMVT(q, 'epi'");
    expect(plan.params).toEqual([
      12,
      1200,
      1530,
      "citibike-nyc",
      1500,
      1738872000,
      true,
      4096,
      64,
      "sev.v1",
      true,
      true,
      true,
      false,
      null,
      false,
      null,
    ]);
  });
});

class FakeDb implements SqlExecutor {
  private readonly rowsQueue: Array<{ mvt: Uint8Array; feature_count: number }>;
  calls: number = 0;

  constructor(rowsQueue: Array<{ mvt: Uint8Array; feature_count: number }>) {
    this.rowsQueue = rowsQueue;
  }

  async query<Row extends Record<string, unknown>>(
    _text: string,
    _params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    this.calls += 1;
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

describe("createCompositeTileStore", () => {
  it("returns first tile when within byte cap", async () => {
    const db = new FakeDb([{ mvt: new Uint8Array([1, 2, 3]), feature_count: 2 }]);
    const store = createCompositeTileStore({
      db,
      max_features_per_tile: 1500,
      max_bytes_per_tile: 10,
    });

    const out = await store.fetchCompositeTile({
      system_id: "citibike-nyc",
      view_id: 9,
      view_spec_sha256: "abc",
      pressure_source: "live_proxy",
      z: 12,
      x: 1200,
      y: 1530,
      t_bucket_epoch_s: 1738872000,
      tile_schema: "tile.v1",
      severity_version: "sev.v1",
      layers_set: "inv,sev",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect(out.bytes).toBe(3);
    expect(db.calls).toBe(1);
  });

  it("reruns query without optional props when byte cap is exceeded", async () => {
    const db = new FakeDb([
      { mvt: new Uint8Array(32), feature_count: 8 },
      { mvt: new Uint8Array(6), feature_count: 8 },
    ]);
    const store = createCompositeTileStore({
      db,
      max_features_per_tile: 1500,
      max_bytes_per_tile: 10,
    });

    const out = await store.fetchCompositeTile({
      system_id: "citibike-nyc",
      view_id: 9,
      view_spec_sha256: "abc",
      pressure_source: "live_proxy",
      z: 12,
      x: 1200,
      y: 1530,
      t_bucket_epoch_s: 1738872000,
      tile_schema: "tile.v1",
      severity_version: "sev.v1",
      layers_set: "inv,press,sev",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) {
      return;
    }
    expect(out.bytes).toBe(6);
    expect(out.degrade_level).toBe(1);
    expect(out.dropped_optional_props?.length).toBeGreaterThan(0);
    expect(db.calls).toBe(2);
  });

  it("returns 429 when tile remains above byte cap after fallback", async () => {
    const db = new FakeDb([
      { mvt: new Uint8Array(32), feature_count: 8 },
      { mvt: new Uint8Array(16), feature_count: 8 },
    ]);
    const store = createCompositeTileStore({
      db,
      max_features_per_tile: 1500,
      max_bytes_per_tile: 10,
    });

    const out = await store.fetchCompositeTile({
      system_id: "citibike-nyc",
      view_id: 9,
      view_spec_sha256: "abc",
      pressure_source: "live_proxy",
      z: 12,
      x: 1200,
      y: 1530,
      t_bucket_epoch_s: 1738872000,
      tile_schema: "tile.v1",
      severity_version: "sev.v1",
      layers_set: "inv,press,sev",
    });
    expect(out.ok).toBe(false);
    if (out.ok) {
      return;
    }
    expect(out.status).toBe(429);
    expect(out.code).toBe("tile_overloaded");
    expect(db.calls).toBe(2);
  });

  it("emits timing/degrade logs for baseline performance tracking", async () => {
    const db = new FakeDb([
      { mvt: new Uint8Array(32), feature_count: 8 },
      { mvt: new Uint8Array(16), feature_count: 8 },
    ]);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const store = createCompositeTileStore({
      db,
      max_features_per_tile: 1500,
      max_bytes_per_tile: 10,
      logger: {
        info(event, details) {
          events.push({ event, details });
        },
      },
    });

    const out = await store.fetchCompositeTile({
      system_id: "citibike-nyc",
      view_id: 9,
      view_spec_sha256: "abc",
      pressure_source: "live_proxy",
      z: 12,
      x: 1200,
      y: 1530,
      t_bucket_epoch_s: 1738872000,
      tile_schema: "tile.v1",
      severity_version: "sev.v1",
      layers_set: "inv,press,sev",
    });
    expect(out.ok).toBe(false);
    expect(events.filter((e) => e.event === "composite_tile.query").length).toBe(2);
    expect(events.some((e) => e.event === "composite_tile.degrade")).toBe(true);
  });
});
