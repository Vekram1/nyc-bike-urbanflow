import { describe, expect, it } from "bun:test";

import { runGlobalPolicyV1, type GreedyPolicyInput } from "./index";

function baseInput(): GreedyPolicyInput {
  return {
    policy_version: "rebal.global.v1",
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
        max_stations_touched: 4,
        max_moves: 3,
      },
      neighborhood: {
        type: "explicit_neighbors",
        max_neighbors: 5,
        neighbor_radius_m: 1200,
        distance_metric: "haversine",
        edges: [],
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
    stations: [],
  };
}

describe("runGlobalPolicyV1", () => {
  it("generates deterministic global output with expected reason code", () => {
    const input = baseInput();
    input.spec.neighborhood.edges = [
      { from_station_key: "D1", to_station_key: "R1", dist_m: 100, rank: 1 },
      { from_station_key: "D2", to_station_key: "R1", dist_m: 100, rank: 1 },
    ];
    input.stations = [
      { station_key: "D1", capacity: 10, bikes: 10, docks: 0, bucket_quality: "ok" },
      { station_key: "D2", capacity: 10, bikes: 9, docks: 1, bucket_quality: "ok" },
      { station_key: "R1", capacity: 10, bikes: 0, docks: 10, bucket_quality: "ok" },
    ];

    const out = runGlobalPolicyV1(input, { logger: { info() {} } });
    expect(out.policy_version).toBe("rebal.global.v1");
    expect(out.policy_spec_sha256.length).toBe(64);
    expect(out.summary.no_op).toBe(false);
    expect(out.moves.length).toBeGreaterThan(0);
    expect(out.moves[0]?.reason_codes).toEqual(["max_transfer_per_meter"]);
  });

  it("throws for unsupported version", () => {
    const input = baseInput();
    input.policy_version = "rebal.greedy.v1";
    expect(() => runGlobalPolicyV1(input, { logger: { info() {} } })).toThrow("unsupported_policy_version");
  });

  it("satisfies conservation and budget invariants across deterministic random scenarios", () => {
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    for (let scenario = 0; scenario < 25; scenario += 1) {
      const input = baseInput();
      input.spec.effort.bike_move_budget_per_step = 8;
      input.spec.effort.max_moves = 6;
      input.spec.effort.max_stations_touched = 6;

      const stations: GreedyPolicyInput["stations"] = [];
      for (let i = 0; i < 6; i += 1) {
        const capacity = 8 + Math.floor(rand() * 8);
        const bikes = Math.floor(rand() * (capacity + 1));
        stations.push({
          station_key: `S${i + 1}`,
          capacity,
          bikes,
          docks: capacity - bikes,
          bucket_quality: "ok",
        });
      }
      input.stations = stations;
      input.spec.neighborhood.edges = [];
      for (let i = 0; i < stations.length; i += 1) {
        for (let j = 0; j < stations.length; j += 1) {
          if (i === j) continue;
          input.spec.neighborhood.edges.push({
            from_station_key: stations[i].station_key,
            to_station_key: stations[j].station_key,
            dist_m: 100 + Math.floor(rand() * 800),
            rank: j + 1,
          });
        }
      }

      const before = new Map(input.stations.map((s) => [s.station_key, s.bikes]));
      const after = new Map(before);
      const capacityByStation = new Map(input.stations.map((s) => [s.station_key, s.capacity]));
      const totalBefore = input.stations.reduce((acc, s) => acc + s.bikes, 0);

      const out = runGlobalPolicyV1(input, { logger: { info() {} } });

      let movedTotal = 0;
      for (const move of out.moves) {
        movedTotal += move.bikes_moved;
        after.set(move.from_station_key, (after.get(move.from_station_key) ?? 0) - move.bikes_moved);
        after.set(move.to_station_key, (after.get(move.to_station_key) ?? 0) + move.bikes_moved);
      }
      const totalAfter = Array.from(after.values()).reduce((acc, v) => acc + v, 0);

      expect(totalAfter).toBe(totalBefore);
      expect(movedTotal).toBeLessThanOrEqual(input.spec.effort.bike_move_budget_per_step);
      expect(out.moves.length).toBeLessThanOrEqual(input.spec.effort.max_moves);
      expect(out.summary.stations_touched).toBeLessThanOrEqual(input.spec.effort.max_stations_touched);

      for (const [stationKey, bikes] of after.entries()) {
        const capacity = capacityByStation.get(stationKey) ?? 0;
        expect(bikes).toBeGreaterThanOrEqual(0);
        expect(bikes).toBeLessThanOrEqual(capacity);
      }
    }
  });
});
