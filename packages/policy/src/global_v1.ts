import { sha256Hex, stableStringify } from "./stable_json";
import type {
  GreedyPolicyInput,
  GreedyPolicyMove,
  GreedyPolicyOutput,
  PolicyLogger,
} from "./types";

type StationState = {
  station_key: string;
  capacity: number;
  bikes_before: number;
  bikes_after: number;
  L_s: number;
  U_s: number;
  need_before: number;
  excess_before: number;
  eligible: boolean;
};

type CandidateEdge = {
  from_station_key: string;
  to_station_key: string;
  dist_m: number;
  rank: number;
  transferable: number;
  efficiency: number;
};

const defaultLogger: PolicyLogger = {
  info(event, details) {
    console.info(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...details }));
  },
};

function computeBand(capacity: number, alpha: number, beta: number): { L_s: number; U_s: number } {
  const L_s = Math.ceil(alpha * capacity);
  const U_s = Math.floor(beta * capacity);
  return { L_s, U_s };
}

function stationStateFromInput(input: GreedyPolicyInput): Map<string, StationState> {
  const allowedQuality = new Set(input.spec.missing_data.input_bucket_quality_allowed);
  const out = new Map<string, StationState>();
  for (const station of input.stations) {
    const { L_s, U_s } = computeBand(station.capacity, input.spec.targets.alpha, input.spec.targets.beta);
    const need_before = Math.max(0, L_s - station.bikes);
    const excess_before = Math.max(0, station.bikes - U_s);
    const eligible =
      station.capacity >= input.spec.targets.min_capacity_for_policy &&
      allowedQuality.has(station.bucket_quality);
    out.set(station.station_key, {
      station_key: station.station_key,
      capacity: station.capacity,
      bikes_before: station.bikes,
      bikes_after: station.bikes,
      L_s,
      U_s,
      need_before,
      excess_before,
      eligible,
    });
  }
  return out;
}

function remainingNeed(station: StationState): number {
  return Math.max(0, station.L_s - station.bikes_after);
}

function remainingExcess(station: StationState): number {
  return Math.max(0, station.bikes_after - station.U_s);
}

function buildCandidates(input: GreedyPolicyInput, stations: Map<string, StationState>): CandidateEdge[] {
  const candidates: CandidateEdge[] = [];
  for (const edge of input.spec.neighborhood.edges) {
    const from = stations.get(edge.from_station_key);
    const to = stations.get(edge.to_station_key);
    if (!from || !to || !from.eligible || !to.eligible) continue;
    const transferable = Math.min(remainingExcess(from), remainingNeed(to));
    if (transferable <= 0) continue;
    candidates.push({
      from_station_key: from.station_key,
      to_station_key: to.station_key,
      dist_m: edge.dist_m,
      rank: edge.rank,
      transferable,
      efficiency: transferable / Math.max(1, edge.dist_m),
    });
  }
  return candidates;
}

function candidateSort(a: CandidateEdge, b: CandidateEdge): number {
  if (a.efficiency !== b.efficiency) return b.efficiency - a.efficiency;
  if (a.dist_m !== b.dist_m) return a.dist_m - b.dist_m;
  if (a.transferable !== b.transferable) return b.transferable - a.transferable;
  if (a.from_station_key !== b.from_station_key) return a.from_station_key.localeCompare(b.from_station_key);
  return a.to_station_key.localeCompare(b.to_station_key);
}

export function runGlobalPolicyV1(
  input: GreedyPolicyInput,
  opts?: { logger?: PolicyLogger }
): GreedyPolicyOutput {
  if (input.policy_version !== "rebal.global.v1") {
    throw new Error("unsupported_policy_version");
  }
  const logger = opts?.logger ?? defaultLogger;
  const policySpecSha = sha256Hex(stableStringify(input.spec));
  const stations = stationStateFromInput(input);
  const touched = new Set<string>();
  const moves: GreedyPolicyMove[] = [];

  let bikesBudgetRemaining = input.spec.effort.bike_move_budget_per_step;
  let movesRemaining = input.spec.effort.max_moves;
  while (bikesBudgetRemaining > 0 && movesRemaining > 0) {
    const candidates = buildCandidates(input, stations).sort(candidateSort);
    if (candidates.length === 0) break;
    let selected: CandidateEdge | null = null;
    for (const candidate of candidates) {
      const addFrom = touched.has(candidate.from_station_key) ? 0 : 1;
      const addTo = touched.has(candidate.to_station_key) ? 0 : 1;
      if (touched.size + addFrom + addTo > input.spec.effort.max_stations_touched) continue;
      selected = candidate;
      break;
    }
    if (!selected) break;
    const from = stations.get(selected.from_station_key);
    const to = stations.get(selected.to_station_key);
    if (!from || !to) break;
    const transferableNow = Math.min(
      selected.transferable,
      bikesBudgetRemaining,
      remainingExcess(from),
      remainingNeed(to)
    );
    if (transferableNow <= 0) break;
    from.bikes_after -= transferableNow;
    to.bikes_after += transferableNow;
    bikesBudgetRemaining -= transferableNow;
    movesRemaining -= 1;
    touched.add(from.station_key);
    touched.add(to.station_key);
    moves.push({
      from_station_key: from.station_key,
      to_station_key: to.station_key,
      bikes_moved: transferableNow,
      dist_m: selected.dist_m,
      rank: selected.rank,
      reason_codes: ["max_transfer_per_meter"],
    });
  }

  const stationsTouched = Array.from(touched)
    .sort((a, b) => a.localeCompare(b))
    .map((stationKey) => {
      const station = stations.get(stationKey);
      if (!station) throw new Error("station_missing");
      return {
        station_key: station.station_key,
        capacity: station.capacity,
        bikes_before: station.bikes_before,
        bikes_after: station.bikes_after,
        L_s: station.L_s,
        U_s: station.U_s,
        need_before: station.need_before,
        excess_before: station.excess_before,
      };
    });
  const bikesMovedTotal = moves.reduce((acc, move) => acc + move.bikes_moved, 0);
  logger.info("policy_decision_bucket", {
    system_id: input.system_id,
    policy_version: input.policy_version,
    policy_spec_sha256: policySpecSha,
    decision_bucket_ts: input.decision_bucket_ts,
    bikes_moved_total: bikesMovedTotal,
    moves_count: moves.length,
    stations_touched: stationsTouched.length,
  });
  return {
    policy_version: input.policy_version,
    policy_spec_sha256: policySpecSha,
    system_id: input.system_id,
    decision_bucket_ts: input.decision_bucket_ts,
    effort: input.spec.effort,
    moves,
    stations_touched: stationsTouched,
    summary: {
      bikes_moved_total: bikesMovedTotal,
      stations_touched: stationsTouched.length,
      no_op: moves.length === 0,
    },
  };
}
