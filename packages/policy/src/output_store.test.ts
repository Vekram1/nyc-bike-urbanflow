import { describe, expect, it } from "bun:test";

import { PgPolicyOutputStore, type SqlExecutor, type SqlQueryResult } from "./output_store";

class FakeDb implements SqlExecutor {
  calls: Array<{ text: string; params: Array<unknown> }> = [];

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text: text.trim(), params });
    if (text.includes("RETURNING run_id")) {
      return { rows: [{ run_id: 12 } as Row] };
    }
    if (text.includes("refresh_policy_eval_daily")) {
      return { rows: [{ refresh_policy_eval_daily: 3 } as Row] };
    }
    return { rows: [] as Row[] };
  }
}

describe("PgPolicyOutputStore", () => {
  it("upserts run + moves + counterfactual rows", async () => {
    const db = new FakeDb();
    const store = new PgPolicyOutputStore(db, { info() {} });

    const runId = await store.upsertRun({
      system_id: "citibike-nyc",
      policy_version: "rebal.greedy.v1",
      policy_spec_sha256: "abc",
      sv: "sv1.x.y.z",
      decision_bucket_ts: new Date("2026-02-06T21:00:00Z"),
      horizon_steps: 0,
      input_quality: "ok",
      status: "success",
      no_op: false,
    });
    expect(runId).toBe(12);

    const insertedMoves = await store.replaceMoves(runId, [
      {
        from_station_key: "A",
        to_station_key: "B",
        bikes_moved: 2,
        dist_m: 100,
        rank: 1,
        reason_codes: ["min_distance_then_max_transfer"],
      },
    ]);
    expect(insertedMoves).toBe(1);

    const insertedCf = await store.replaceCounterfactualStatus(runId, [
      {
        sim_bucket_ts: new Date("2026-02-06T21:05:00Z"),
        station_key: "A",
        bikes: 4,
        docks: 6,
        bucket_quality: "ok",
      },
    ]);
    expect(insertedCf).toBe(1);

    expect(db.calls.some((call) => call.text.startsWith("INSERT INTO policy_runs"))).toBe(true);
    expect(db.calls.some((call) => call.text.startsWith("INSERT INTO policy_moves"))).toBe(true);
    expect(db.calls.some((call) => call.text.startsWith("INSERT INTO policy_counterfactual_status"))).toBe(true);
  });

  it("refreshes daily eval marts and logs row delta", async () => {
    const db = new FakeDb();
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const store = new PgPolicyOutputStore(db, {
      info(event, details) {
        events.push({ event, details });
      },
    });

    const upserted = await store.refreshEvalDaily({
      system_id: "citibike-nyc",
      from_day: "2026-02-01",
      to_day: "2026-02-06",
    });
    expect(upserted).toBe(3);
    expect(events.length).toBe(1);
    expect(events[0]?.event).toBe("policy_eval_daily_refresh");
    expect(events[0]?.details.upserted_rows).toBe(3);
  });
});
