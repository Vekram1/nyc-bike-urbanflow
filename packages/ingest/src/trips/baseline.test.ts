import path from "path";
import { describe, expect, it } from "bun:test";

import { aggregateTripsForTest, ingestTripsBaselineFromManifest, type TripRecord } from "./baseline";
import type { SqlExecutor, SqlQueryResult } from "../db/types";

class FakeDb implements SqlExecutor {
  calls: Array<{ text: string; params: Array<unknown> }> = [];

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text: text.trim(), params });
    return { rows: [] as Row[] };
  }
}

function parseFixtureCsv(text: string): TripRecord[] {
  const lines = text.trim().split("\n");
  const rows = lines.slice(1);
  return rows.map((line) => {
    const cols = line.split(",");
    return {
      trip_id: cols[0] ?? "",
      started_at: cols[1] ?? "",
      ended_at: cols[2] ?? "",
      start_station_id: cols[3] ?? "",
      end_station_id: cols[4] ?? "",
      member_type: cols[5] ?? "",
      duration_s: Number(cols[6] ?? "0"),
    };
  });
}

describe("trips baseline ingest", () => {
  it("aggregates fixture rows deterministically", async () => {
    const fixturePath = path.join(process.cwd(), "fixtures", "trips", "mini_month.csv");
    const csv = await Bun.file(fixturePath).text();
    const records = parseFixtureCsv(csv);

    const aggregate = aggregateTripsForTest(records);
    expect(aggregate.period_month).toBe("2023-11-01");

    const outflow100 = aggregate.outflows.get("2023-11-01::100");
    const inflow200 = aggregate.inflows.get("2023-11-01::200");
    expect(outflow100).toEqual({
      station_key: "100",
      period_month: "2023-11-01",
      trips: 3,
      total_duration_s: 1680,
      member_trips: 1,
      casual_trips: 2,
    });
    expect(inflow200).toEqual({
      station_key: "200",
      period_month: "2023-11-01",
      trips: 2,
      total_duration_s: 1080,
      member_trips: 1,
      casual_trips: 1,
    });
  });

  it("loads manifest fixture and writes deterministic SQL batches", async () => {
    const db = new FakeDb();
    const logs: Array<{ event: string; details: Record<string, unknown> }> = [];

    const result = await ingestTripsBaselineFromManifest({
      db,
      system_id: "nyc_citibike",
      manifest_path: "fixtures/trips/mini_month.manifest.json",
      logger: (event, details) => {
        logs.push({ event, details });
      },
    });

    expect(result).toEqual({
      dataset_id: "trips.2023-11-mini",
      period_month: "2023-11-01",
      row_count: 5,
      station_outflows_rows: 3,
      station_inflows_rows: 3,
    });
    expect(logs.map((entry) => entry.event)).toEqual([
      "trips_baseline_selected",
      "trips_baseline_aggregates_ready",
    ]);

    const byPrefix = (prefix: string) =>
      db.calls.filter((call) => call.text.startsWith(prefix));
    expect(byPrefix("INSERT INTO datasets").length).toBe(1);
    expect(byPrefix("INSERT INTO dataset_watermarks").length).toBe(1);
    expect(byPrefix("INSERT INTO trips_baseline_datasets").length).toBe(1);
    expect(byPrefix("INSERT INTO trips_baseline_rows").length).toBe(5);
    expect(byPrefix("INSERT INTO station_outflows_monthly").length).toBe(3);
    expect(byPrefix("INSERT INTO station_inflows_monthly").length).toBe(3);
  });
});
