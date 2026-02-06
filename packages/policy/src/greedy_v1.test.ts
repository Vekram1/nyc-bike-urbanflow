import { describe, expect, it } from "bun:test";

import { runGreedyPolicyV1, type GreedyPolicyInput } from "./index";

describe("runGreedyPolicyV1", () => {
  it("matches greedy_v1 fixture output semantics", async () => {
    const input = (await Bun.file("fixtures/policy/greedy_v1_input.json").json()) as GreedyPolicyInput;
    const expected = (await Bun.file("fixtures/policy/greedy_v1_expected.json").json()) as Record<string, unknown>;

    const out = runGreedyPolicyV1(input, {
      logger: { info() {} },
    });

    expect(out.policy_version).toBe(expected.policy_version);
    expect(out.system_id).toBe(expected.system_id);
    expect(out.decision_bucket_ts).toBe(expected.decision_bucket_ts);
    expect(out.effort).toEqual(expected.effort);
    expect(out.moves).toEqual(expected.moves);
    expect(out.stations_touched).toEqual(expected.stations_touched);
    expect(out.summary).toEqual(expected.summary);
    expect(out.policy_spec_sha256.length).toBe(64);
  });

  it("breaks ties by larger transferable then lexicographic station key", () => {
    const input: GreedyPolicyInput = {
      policy_version: "rebal.greedy.v1",
      system_id: "sys",
      decision_bucket_ts: 1,
      bucket_size_s: 300,
      spec: {
        targets: {
          type: "band_fraction_of_capacity",
          alpha: 0.2,
          beta: 0.8,
          min_capacity_for_policy: 1,
          inactive_station_behavior: "ignore",
        },
        effort: {
          bike_move_budget_per_step: 2,
          max_stations_touched: 4,
          max_moves: 2,
        },
        neighborhood: {
          type: "explicit_neighbors",
          max_neighbors: 3,
          neighbor_radius_m: 1200,
          distance_metric: "haversine",
          edges: [
            { from_station_key: "D2", to_station_key: "R1", dist_m: 100, rank: 1 },
            { from_station_key: "D1", to_station_key: "R1", dist_m: 100, rank: 2 },
          ],
        },
        scoring: { type: "min_distance_then_max_transfer", epsilon_m: 1 },
        constraints: {
          respect_capacity_bounds: true,
          forbid_donating_below_L: true,
          forbid_receiving_above_U: true,
        },
        missing_data: {
          input_bucket_quality_allowed: ["ok"],
          carry_forward_window_s: 600,
          on_missing: "skip_station",
        },
      },
      stations: [
        { station_key: "D1", capacity: 10, bikes: 9, docks: 1, bucket_quality: "ok" },
        { station_key: "D2", capacity: 10, bikes: 10, docks: 0, bucket_quality: "ok" },
        { station_key: "R1", capacity: 10, bikes: 0, docks: 10, bucket_quality: "ok" },
      ],
    };

    const out = runGreedyPolicyV1(input, { logger: { info() {} } });
    expect(out.moves.length).toBe(1);
    expect(out.moves[0]?.from_station_key).toBe("D2");
    expect(out.moves[0]?.bikes_moved).toBe(2);
  });

  it("respects max_stations_touched budget", () => {
    const input: GreedyPolicyInput = {
      policy_version: "rebal.greedy.v1",
      system_id: "sys",
      decision_bucket_ts: 1,
      bucket_size_s: 300,
      spec: {
        targets: {
          type: "band_fraction_of_capacity",
          alpha: 0.2,
          beta: 0.8,
          min_capacity_for_policy: 1,
          inactive_station_behavior: "ignore",
        },
        effort: {
          bike_move_budget_per_step: 4,
          max_stations_touched: 2,
          max_moves: 3,
        },
        neighborhood: {
          type: "explicit_neighbors",
          max_neighbors: 5,
          neighbor_radius_m: 1200,
          distance_metric: "haversine",
          edges: [
            { from_station_key: "D", to_station_key: "R1", dist_m: 100, rank: 1 },
            { from_station_key: "D", to_station_key: "R2", dist_m: 100, rank: 2 },
          ],
        },
        scoring: { type: "min_distance_then_max_transfer", epsilon_m: 1 },
        constraints: {
          respect_capacity_bounds: true,
          forbid_donating_below_L: true,
          forbid_receiving_above_U: true,
        },
        missing_data: {
          input_bucket_quality_allowed: ["ok"],
          carry_forward_window_s: 600,
          on_missing: "skip_station",
        },
      },
      stations: [
        { station_key: "D", capacity: 10, bikes: 10, docks: 0, bucket_quality: "ok" },
        { station_key: "R1", capacity: 10, bikes: 0, docks: 10, bucket_quality: "ok" },
        { station_key: "R2", capacity: 10, bikes: 0, docks: 10, bucket_quality: "ok" },
      ],
    };

    const out = runGreedyPolicyV1(input, { logger: { info() {} } });
    expect(out.summary.stations_touched).toBe(2);
    expect(out.moves.length).toBe(1);
  });
});
