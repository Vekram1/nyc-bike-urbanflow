import { describe, expect, it } from "bun:test";

import type { SqlQueryResult } from "../db/types";
import { PgStationsStore } from "./store";

class FakeDb {
  calls: Array<{ text: string; params: Array<unknown> }> = [];
  detailRows: Array<Record<string, unknown>> = [];
  seriesRows: Array<Record<string, unknown>> = [];
  drawerPointRows: Array<Record<string, unknown>> = [];
  drawerSeriesRows: Array<Record<string, unknown>> = [];
  drawerEpisodeRows: Array<Record<string, unknown>> = [];

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text: text.trim(), params });
    if (text.includes("FROM episode_markers_15m em")) {
      return { rows: this.drawerEpisodeRows as Row[] };
    }
    if (text.includes("sev.severity_components_json AS severity_components")) {
      return { rows: this.drawerPointRows as Row[] };
    }
    if (text.includes("WITH bucketed AS (")) {
      if (text.includes("MAX(b.pressure_delta_bikes_5m)")) {
        return { rows: this.seriesRows as Row[] };
      }
      return { rows: this.drawerSeriesRows as Row[] };
    }
    if (text.includes("FROM stations_current")) {
      return { rows: this.detailRows as Row[] };
    }
    return { rows: [] as Row[] };
  }
}

describe("PgStationsStore", () => {
  it("maps station detail row", async () => {
    const db = new FakeDb();
    db.detailRows = [
      {
        station_key: "STA-001",
        name: "W 52 St",
        capacity: 40,
        bucket_ts: "2026-02-06T21:00:00Z",
        bikes_available: 12,
        docks_available: 28,
        bucket_quality: "ok",
        severity: 0.2,
        pressure_score: 0.4,
        pressure_delta_bikes_5m: 6,
        pressure_delta_docks_5m: -6,
        pressure_volatility_60m: 2.5,
        pressure_rebalancing_suspected: true,
      },
    ];
    const store = new PgStationsStore(db);
    const out = await store.getStationDetail({
      system_id: "citibike-nyc",
      view_id: 1,
      station_key: "STA-001",
    });
    expect(out?.station_key).toBe("STA-001");
    expect(out?.name).toBe("W 52 St");
    expect(out?.pressure_score).toBe(0.4);
    expect(out?.pressure_delta_bikes_5m).toBe(6);
    expect(out?.pressure_rebalancing_suspected).toBe(true);
    expect(db.calls[0]?.params).toEqual(["citibike-nyc", "STA-001"]);
  });

  it("maps station series rows", async () => {
    const db = new FakeDb();
    db.seriesRows = [
      {
        bucket_ts: "2026-02-06T20:00:00Z",
        bikes_available: 10,
        docks_available: 20,
        bucket_quality: "ok",
        severity: 0.1,
        pressure_score: 0.2,
        pressure_delta_bikes_5m: 3,
        pressure_delta_docks_5m: -3,
        pressure_volatility_60m: 1.1,
        pressure_rebalancing_suspected: false,
      },
      {
        bucket_ts: "2026-02-06T20:05:00Z",
        bikes_available: 11,
        docks_available: 19,
        bucket_quality: "ok",
        severity: null,
        pressure_score: null,
        pressure_delta_bikes_5m: null,
        pressure_delta_docks_5m: null,
        pressure_volatility_60m: null,
        pressure_rebalancing_suspected: null,
      },
    ];
    const store = new PgStationsStore(db);
    const out = await store.getStationSeries({
      system_id: "citibike-nyc",
      view_id: 1,
      station_key: "STA-001",
      from_epoch_s: 1738872000,
      to_epoch_s: 1738872600,
      bucket_seconds: 300,
      limit: 288,
    });
    expect(out.length).toBe(2);
    expect(out[0]?.bucket_ts).toBe("2026-02-06T20:00:00Z");
    expect(out[0]?.pressure_delta_bikes_5m).toBe(3);
    expect(out[1]?.severity).toBeUndefined();
    expect(out[1]?.pressure_volatility_60m).toBeUndefined();
    expect(db.calls[0]?.params).toEqual([
      "citibike-nyc",
      "STA-001",
      300,
      1738872000,
      1738872600,
      288,
    ]);
  });

  it("maps drawer bundle rows with truncation flags", async () => {
    const db = new FakeDb();
    db.drawerPointRows = [
      {
        station_key: "STA-001",
        name: "W 52 St",
        capacity: 40,
        bucket_ts: "2026-02-06T21:00:00Z",
        bikes_available: 12,
        docks_available: 28,
        bucket_quality: "ok",
        severity: 0.2,
        pressure_score: 0.4,
        pressure_delta_bikes_5m: 6,
        pressure_delta_docks_5m: -6,
        pressure_volatility_60m: 2.5,
        pressure_rebalancing_suspected: true,
        severity_components: { state: 1 },
      },
    ];
    db.drawerSeriesRows = [
      {
        bucket_ts: "2026-02-06T20:00:00Z",
        bikes_available: 10,
        docks_available: 20,
        bucket_quality: "ok",
        severity: 0.1,
        pressure_score: 0.2,
      },
      {
        bucket_ts: "2026-02-06T20:05:00Z",
        bikes_available: 11,
        docks_available: 19,
        bucket_quality: "ok",
        severity: 0.2,
        pressure_score: 0.3,
      },
    ];
    db.drawerEpisodeRows = [
      {
        bucket_ts: "2026-02-06T20:00:00Z",
        episode_type: "empty",
        duration_minutes: 15,
        bucket_quality: "ok",
        episode_start_ts: "2026-02-06T19:45:00Z",
        episode_end_ts: "2026-02-06T20:00:00Z",
      },
      {
        bucket_ts: "2026-02-06T19:45:00Z",
        episode_type: "full",
        duration_minutes: 30,
        bucket_quality: "ok",
        episode_start_ts: "2026-02-06T19:15:00Z",
        episode_end_ts: "2026-02-06T19:45:00Z",
      },
    ];
    const store = new PgStationsStore(db);

    const out = await store.getStationDrawer({
      system_id: "citibike-nyc",
      view_id: 21,
      station_key: "STA-001",
      t_bucket_epoch_s: 1738872000,
      range_s: 21600,
      bucket_seconds: 300,
      max_series_points: 1,
      max_episodes: 1,
      severity_version: "sev.v1",
    });

    expect(out?.station_key).toBe("STA-001");
    expect(out?.point_in_time.severity_components).toEqual({ state: 1 });
    expect(out?.series.points.length).toBe(1);
    expect(out?.series.truncated).toBe(true);
    expect(out?.episodes.items.length).toBe(1);
    expect(out?.episodes.truncated).toBe(true);
  });
});
