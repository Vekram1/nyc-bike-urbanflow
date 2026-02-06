import { describe, expect, it } from "bun:test";

import type { SqlQueryResult } from "../db/types";
import { PgStationsStore } from "./store";

class FakeDb {
  calls: Array<{ text: string; params: Array<unknown> }> = [];
  detailRows: Array<Record<string, unknown>> = [];
  seriesRows: Array<Record<string, unknown>> = [];

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text: text.trim(), params });
    if (text.includes("FROM stations_current")) {
      return { rows: this.detailRows as Row[] };
    }
    return { rows: this.seriesRows as Row[] };
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
      },
      {
        bucket_ts: "2026-02-06T20:05:00Z",
        bikes_available: 11,
        docks_available: 19,
        bucket_quality: "ok",
        severity: null,
        pressure_score: null,
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
    expect(out[1]?.severity).toBeUndefined();
    expect(db.calls[0]?.params).toEqual([
      "citibike-nyc",
      "STA-001",
      300,
      1738872000,
      1738872600,
      288,
    ]);
  });
});
