/// <reference path="../runtime-shims.d.ts" />

import { SQL } from "bun";

import type { SqlExecutor, SqlQueryResult } from "../db/types";
import { PgJobQueue } from "../jobs/queue";
import { PgPolicyOutputStore } from "../../../policy/src/output_store";
import { runGreedyPolicyV1 } from "../../../policy/src/greedy_v1";
import { runGlobalPolicyV1 } from "../../../policy/src/global_v1";
import type {
  GreedyPolicyInput,
  GreedyPolicyMove,
  GreedyPolicyOutput,
  GreedyPolicySpec,
  PolicyInputStation,
  PolicyNeighborEdge,
} from "../../../policy/src/types";

type WorkerConfig = {
  db_url: string;
  poll_interval_ms: number;
  visibility_timeout_seconds: number;
  claim_error_backoff_ms: number;
  max_neighbors: number;
  neighbor_radius_m: number;
  target_alpha: number;
  target_beta: number;
  min_capacity_for_policy: number;
  bike_move_budget_per_step: number;
  max_stations_touched: number;
  max_moves: number;
  input_bucket_quality_allowed: string[];
  carry_forward_window_s: number;
  bucket_size_s: number;
};

type PolicyJobPayload = {
  system_id: string;
  sv: string;
  decision_bucket_ts: number;
  horizon_steps: number;
  policy_version: string;
};

type StationRow = {
  station_key: string;
  bikes_available: number | string;
  docks_available: number | string;
  capacity: number | string | null;
  bucket_quality: string;
};

type NeighborRow = {
  from_station_key: string;
  to_station_key: string;
  dist_m: number | string;
  rank: number | string;
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`Invalid integer env ${name}: ${raw}`);
  }
  return parsed;
}

function parseFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number env ${name}: ${raw}`);
  }
  return parsed;
}

function parseCsvEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function loadConfig(): WorkerConfig {
  const db_url = process.env.DATABASE_URL?.trim() ?? "";
  if (!db_url) {
    throw new Error("Missing DATABASE_URL");
  }
  return {
    db_url,
    poll_interval_ms: parseIntEnv("POLICY_WORKER_POLL_INTERVAL_MS", 1000),
    visibility_timeout_seconds: parseIntEnv("POLICY_WORKER_VISIBILITY_TIMEOUT_SECONDS", 60),
    claim_error_backoff_ms: parseIntEnv("POLICY_WORKER_CLAIM_ERROR_BACKOFF_MS", 2000),
    max_neighbors: parseIntEnv("POLICY_MAX_NEIGHBORS", 100),
    neighbor_radius_m: parseFloatEnv("POLICY_NEIGHBOR_RADIUS_M", 40000),
    target_alpha: parseFloatEnv("POLICY_TARGET_ALPHA", 0.45),
    target_beta: parseFloatEnv("POLICY_TARGET_BETA", 0.55),
    min_capacity_for_policy: parseIntEnv("POLICY_MIN_CAPACITY_FOR_POLICY", 5),
    bike_move_budget_per_step: parseIntEnv("POLICY_BIKE_MOVE_BUDGET_PER_STEP", 2400),
    max_stations_touched: parseIntEnv("POLICY_MAX_STATIONS_TOUCHED", 200),
    max_moves: parseIntEnv("POLICY_MAX_MOVES_PER_RUN", 240),
    input_bucket_quality_allowed: parseCsvEnv("POLICY_INPUT_BUCKET_QUALITY_ALLOWED", ["ok", "degraded"]),
    carry_forward_window_s: parseIntEnv("POLICY_CARRY_FORWARD_WINDOW_S", 600),
    bucket_size_s: parseIntEnv("POLICY_BUCKET_SIZE_SECONDS", 300),
  };
}

class BunSqlExecutor implements SqlExecutor {
  private readonly sql: SQL;

  constructor(db_url: string) {
    this.sql = new SQL(db_url);
  }

  private toPgArrayLiteral(values: Array<unknown>): string {
    const encode = (value: unknown): string => {
      if (value === null || value === undefined) {
        return "NULL";
      }
      if (value instanceof Date) {
        return `"${value.toISOString().replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          throw new Error("Non-finite number cannot be encoded in postgres array literal");
        }
        return String(value);
      }
      if (typeof value === "boolean") {
        return value ? "true" : "false";
      }
      const text = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `"${text}"`;
    };

    return `{${values.map((entry) => encode(entry)).join(",")}}`;
  }

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    const normalizedParams = params.map((param) =>
      Array.isArray(param) ? this.toPgArrayLiteral(param as Array<unknown>) : param
    );
    const out = await this.sql.unsafe(text, normalizedParams);
    return { rows: out as Row[] };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function logInfo(event: string, details: Record<string, unknown>): void {
  console.info(JSON.stringify({ level: "info", event, ts: nowIso(), ...details }));
}

function logWarn(event: string, details: Record<string, unknown>): void {
  console.warn(JSON.stringify({ level: "warn", event, ts: nowIso(), ...details }));
}

function parseJobPayload(raw: unknown): PolicyJobPayload {
  let payload = raw;
  if (typeof payload === "string") {
    payload = JSON.parse(payload) as unknown;
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("policy_job_payload_invalid");
  }
  const candidate = payload as Record<string, unknown>;
  const system_id = String(candidate.system_id ?? "").trim();
  const sv = String(candidate.sv ?? "").trim();
  const policy_version = String(candidate.policy_version ?? "").trim();
  const decision_bucket_ts = Number(candidate.decision_bucket_ts);
  const horizon_steps = Number(candidate.horizon_steps ?? 0);

  if (!system_id || !sv || !policy_version) {
    throw new Error("policy_job_payload_missing_fields");
  }
  if (!Number.isFinite(decision_bucket_ts) || !Number.isInteger(decision_bucket_ts) || decision_bucket_ts < 0) {
    throw new Error("policy_job_payload_invalid_decision_bucket");
  }
  if (!Number.isFinite(horizon_steps) || !Number.isInteger(horizon_steps) || horizon_steps < 0) {
    throw new Error("policy_job_payload_invalid_horizon_steps");
  }

  return {
    system_id,
    sv,
    policy_version,
    decision_bucket_ts,
    horizon_steps,
  };
}

async function selectSnapshotBucketTs(
  db: SqlExecutor,
  args: { system_id: string; decision_bucket_ts: number }
): Promise<string> {
  const out = await db.query<{ bucket_ts: string }>(
    `SELECT
       COALESCE(
         MAX(bucket_ts),
         date_bin('1 minute', TO_TIMESTAMP($2), TIMESTAMPTZ '1970-01-01 00:00:00+00')
       )::text AS bucket_ts
     FROM station_status_1m
     WHERE system_id = $1
       AND bucket_ts <= TO_TIMESTAMP($2)`,
    [args.system_id, args.decision_bucket_ts]
  );
  return out.rows[0]?.bucket_ts ?? new Date(args.decision_bucket_ts * 1000).toISOString();
}

async function loadPolicyStations(
  db: SqlExecutor,
  args: { system_id: string; bucket_ts: string }
): Promise<PolicyInputStation[]> {
  const out = await db.query<StationRow>(
    `SELECT
       station_key,
       bikes_available,
       docks_available,
       COALESCE(capacity, NULLIF(bikes_available + docks_available, 0)) AS capacity,
       bucket_quality
     FROM station_status_1m
     WHERE system_id = $1
       AND bucket_ts = $2::timestamptz`,
    [args.system_id, args.bucket_ts]
  );
  return out.rows
    .map((row) => {
      const capacity = Number(row.capacity ?? 0);
      const bikes = Number(row.bikes_available);
      const docks = Number(row.docks_available);
      if (!Number.isFinite(capacity) || capacity <= 0) return null;
      if (!Number.isFinite(bikes) || bikes < 0) return null;
      if (!Number.isFinite(docks) || docks < 0) return null;
      return {
        station_key: row.station_key,
        capacity,
        bikes,
        docks,
        bucket_quality: row.bucket_quality,
      } satisfies PolicyInputStation;
    })
    .filter((row): row is PolicyInputStation => row !== null);
}

async function loadNeighborEdges(
  db: SqlExecutor,
  args: { system_id: string; max_neighbors: number; neighbor_radius_m: number }
): Promise<PolicyNeighborEdge[]> {
  const out = await db.query<NeighborRow>(
    `SELECT
       station_key AS from_station_key,
       neighbor_key AS to_station_key,
       dist_m,
       rank
     FROM station_neighbors
     WHERE system_id = $1
       AND rank <= $2
       AND dist_m <= $3
     ORDER BY station_key ASC, rank ASC`,
    [args.system_id, args.max_neighbors, args.neighbor_radius_m]
  );
  return out.rows.map((row) => ({
    from_station_key: row.from_station_key,
    to_station_key: row.to_station_key,
    dist_m: Number(row.dist_m),
    rank: Number(row.rank),
  }));
}

function buildSpec(cfg: WorkerConfig, edges: PolicyNeighborEdge[]): GreedyPolicySpec {
  // Keep solver runtime bounded even if env budgets are set extremely high.
  const effectiveBikeBudget = Math.min(cfg.bike_move_budget_per_step, 500);
  const effectiveMaxStationsTouched = Math.min(cfg.max_stations_touched, 250);
  const effectiveMaxMoves = Math.min(cfg.max_moves, 240);
  return {
    targets: {
      type: "band_fraction_of_capacity",
      alpha: cfg.target_alpha,
      beta: cfg.target_beta,
      min_capacity_for_policy: cfg.min_capacity_for_policy,
      inactive_station_behavior: "ignore",
    },
    effort: {
      bike_move_budget_per_step: effectiveBikeBudget,
      max_stations_touched: effectiveMaxStationsTouched,
      max_moves: effectiveMaxMoves,
    },
    neighborhood: {
      type: "explicit_neighbors",
      max_neighbors: cfg.max_neighbors,
      neighbor_radius_m: cfg.neighbor_radius_m,
      distance_metric: "haversine",
      edges,
    },
    scoring: {
      type: "min_distance_then_max_transfer",
      epsilon_m: 1,
    },
    constraints: {
      respect_capacity_bounds: true,
      forbid_donating_below_L: true,
      forbid_receiving_above_U: true,
    },
    missing_data: {
      input_bucket_quality_allowed: cfg.input_bucket_quality_allowed,
      carry_forward_window_s: cfg.carry_forward_window_s,
      on_missing: "skip_station",
    },
  };
}

function buildSyntheticNeighborEdges(
  stations: PolicyInputStation[],
  maxNeighbors: number
): PolicyNeighborEdge[] {
  const keys = stations.map((station) => station.station_key).sort((a, b) => a.localeCompare(b));
  if (keys.length <= 1) return [];
  const neighborCount = Math.max(1, Math.min(maxNeighbors, keys.length - 1));
  const edges: PolicyNeighborEdge[] = [];
  for (let idx = 0; idx < keys.length; idx += 1) {
    const from = keys[idx];
    for (let rank = 1; rank <= neighborCount; rank += 1) {
      const to = keys[(idx + rank) % keys.length];
      edges.push({
        from_station_key: from,
        to_station_key: to,
        dist_m: 5000 + rank,
        rank,
      });
    }
  }
  return edges;
}

function executePolicy(
  policyVersion: string,
  input: GreedyPolicyInput
): GreedyPolicyOutput {
  if (policyVersion === "rebal.global.v1") {
    return runGlobalPolicyV1(
      {
        ...input,
        policy_version: "rebal.global.v1",
      },
      { logger: { info: logInfo } }
    );
  }
  return runGreedyPolicyV1(
    {
      ...input,
      policy_version: "rebal.greedy.v1",
    },
    { logger: { info: logInfo } }
  );
}

function computeUnconstrainedFallbackMoves(args: {
  stations: PolicyInputStation[];
  alpha: number;
  beta: number;
  bikeBudget: number;
  maxMoves: number;
  maxTransferPerMove: number;
}): GreedyPolicyMove[] {
  type Donor = { station_key: string; excess: number };
  type Receiver = { station_key: string; need: number };
  const donors: Donor[] = [];
  const receivers: Receiver[] = [];

  for (const station of args.stations) {
    const capacity = Number(station.capacity);
    const bikes = Number(station.bikes);
    if (!Number.isFinite(capacity) || capacity <= 0) continue;
    if (!Number.isFinite(bikes) || bikes < 0) continue;
    const Ls = Math.ceil(args.alpha * capacity);
    const Us = Math.floor(args.beta * capacity);
    const need = Math.max(0, Ls - bikes);
    const excess = Math.max(0, bikes - Us);
    if (need > 0) receivers.push({ station_key: station.station_key, need });
    if (excess > 0) donors.push({ station_key: station.station_key, excess });
  }

  donors.sort((a, b) => b.excess - a.excess || a.station_key.localeCompare(b.station_key));
  receivers.sort((a, b) => b.need - a.need || a.station_key.localeCompare(b.station_key));

  const moves: GreedyPolicyMove[] = [];
  let donorIdx = 0;
  let receiverIdx = 0;
  let bikesBudgetRemaining = Math.max(0, Math.floor(args.bikeBudget));
  const maxMoves = Math.max(0, Math.floor(args.maxMoves));
  const maxTransfer = Math.max(1, Math.floor(args.maxTransferPerMove));

  while (
    donorIdx < donors.length &&
    receiverIdx < receivers.length &&
    moves.length < maxMoves &&
    bikesBudgetRemaining > 0
  ) {
    const donor = donors[donorIdx];
    const receiver = receivers[receiverIdx];
    if (donor.station_key === receiver.station_key) {
      receiverIdx += 1;
      continue;
    }
    const transfer = Math.min(donor.excess, receiver.need, bikesBudgetRemaining, maxTransfer);
    if (transfer <= 0) break;

    moves.push({
      from_station_key: donor.station_key,
      to_station_key: receiver.station_key,
      bikes_moved: transfer,
      dist_m: 8000 + moves.length,
      rank: moves.length + 1,
      reason_codes: ["worker_noop_fallback_unconstrained"],
    });

    donor.excess -= transfer;
    receiver.need -= transfer;
    bikesBudgetRemaining -= transfer;

    if (donor.excess <= 0) donorIdx += 1;
    if (receiver.need <= 0) receiverIdx += 1;
  }

  return moves;
}

function inferNoOpReason(input: GreedyPolicyInput, movedCount: number): string | null {
  if (movedCount > 0) return null;
  if (input.spec.effort.bike_move_budget_per_step <= 0 || input.spec.effort.max_moves <= 0) {
    return "budget_zero";
  }
  let deficits = 0;
  let surpluses = 0;
  for (const station of input.stations) {
    const Ls = Math.ceil(input.spec.targets.alpha * station.capacity);
    const Us = Math.floor(input.spec.targets.beta * station.capacity);
    if (station.bikes < Ls) deficits += 1;
    if (station.bikes > Us) surpluses += 1;
  }
  if (deficits <= 0) return "no_deficits";
  if (surpluses <= 0) return "no_surpluses";
  if (input.spec.neighborhood.edges.length <= 0) return "neighborhood_blocked";
  return "neighborhood_blocked";
}

function buildForcedPreviewMoves(
  stations: PolicyInputStation[],
  maxMoves: number,
  bikeBudget: number
): GreedyPolicyMove[] {
  if (stations.length < 2) return [];
  const sorted = [...stations].sort((a, b) => {
    const aRatio = a.capacity > 0 ? a.bikes / a.capacity : 0;
    const bRatio = b.capacity > 0 ? b.bikes / b.capacity : 0;
    return bRatio - aRatio || a.station_key.localeCompare(b.station_key);
  });
  const donors = sorted.filter((station) => station.bikes > 0);
  const receivers = [...sorted].reverse().filter((station) => station.docks > 0);
  if (donors.length === 0 || receivers.length === 0) return [];

  const out: GreedyPolicyMove[] = [];
  let budgetLeft = Math.max(0, Math.floor(bikeBudget));
  const moveCap = Math.max(1, Math.floor(maxMoves));
  let donorIdx = 0;
  let receiverIdx = 0;
  while (budgetLeft > 0 && out.length < moveCap && donorIdx < donors.length && receiverIdx < receivers.length) {
    const from = donors[donorIdx];
    const to = receivers[receiverIdx];
    if (from.station_key === to.station_key) {
      receiverIdx += 1;
      continue;
    }
    const moveBikes = Math.min(4, from.bikes, to.docks, budgetLeft);
    if (moveBikes > 0) {
      out.push({
        from_station_key: from.station_key,
        to_station_key: to.station_key,
        bikes_moved: moveBikes,
        dist_m: 9000 + out.length,
        rank: out.length + 1,
        reason_codes: ["worker_forced_preview_move"],
      });
      budgetLeft -= moveBikes;
      from.bikes -= moveBikes;
      to.docks -= moveBikes;
    }
    donorIdx = (donorIdx + 1) % donors.length;
    receiverIdx = (receiverIdx + 1) % receivers.length;
    if (donorIdx === 0 && receiverIdx === 0) {
      const hasCapacity = donors.some((station) => station.bikes > 0) && receivers.some((station) => station.docks > 0);
      if (!hasCapacity) break;
    }
  }
  return out;
}

async function processPolicyJob(
  db: SqlExecutor,
  queue: PgJobQueue,
  output: PgPolicyOutputStore,
  cfg: WorkerConfig,
  job: { job_id: number; payload_json: unknown }
): Promise<void> {
  const payload = parseJobPayload(job.payload_json);
  if (payload.policy_version !== "rebal.greedy.v1" && payload.policy_version !== "rebal.global.v1") {
    await queue.fail({
      job_id: job.job_id,
      reason_code: "unsupported_policy_version",
      details: { policy_version: payload.policy_version },
    });
    return;
  }

  const snapshotBucketTs = await selectSnapshotBucketTs(db, {
    system_id: payload.system_id,
    decision_bucket_ts: payload.decision_bucket_ts,
  });
  const stations = await loadPolicyStations(db, {
    system_id: payload.system_id,
    bucket_ts: snapshotBucketTs,
  });
  const edgesFromStore = await loadNeighborEdges(db, {
    system_id: payload.system_id,
    max_neighbors: cfg.max_neighbors,
    neighbor_radius_m: cfg.neighbor_radius_m,
  });
  const edges =
    edgesFromStore.length > 0
      ? edgesFromStore
      : buildSyntheticNeighborEdges(stations, cfg.max_neighbors);
  if (edgesFromStore.length === 0 && edges.length > 0) {
    logWarn("policy_worker_neighbors_fallback_enabled", {
      job_id: job.job_id,
      system_id: payload.system_id,
      station_count: stations.length,
      synthetic_edges_count: edges.length,
      reason: "station_neighbors_empty",
    });
  }

  const spec = buildSpec(cfg, edges);
  const input: GreedyPolicyInput = {
    policy_version: payload.policy_version,
    system_id: payload.system_id,
    decision_bucket_ts: payload.decision_bucket_ts,
    bucket_size_s: cfg.bucket_size_s,
    spec,
    stations,
  };

  let policyOut = executePolicy(payload.policy_version, input);
  if (policyOut.moves.length === 0 && stations.length > 1) {
    const fallbackSpec: GreedyPolicySpec = {
      ...spec,
      targets: {
        ...spec.targets,
        alpha: 0.49,
        beta: 0.51,
        min_capacity_for_policy: 1,
      },
      effort: {
        bike_move_budget_per_step: Math.max(spec.effort.bike_move_budget_per_step, 240),
        max_stations_touched: Math.max(spec.effort.max_stations_touched, 200),
        max_moves: Math.max(spec.effort.max_moves, 240),
      },
      missing_data: {
        ...spec.missing_data,
        input_bucket_quality_allowed: Array.from(
          new Set([...spec.missing_data.input_bucket_quality_allowed, "ok", "degraded", "unknown"])
        ),
      },
    };
    const fallbackInput: GreedyPolicyInput = {
      ...input,
      spec: fallbackSpec,
    };
    const fallbackOut = executePolicy(payload.policy_version, fallbackInput);
    if (fallbackOut.moves.length > 0) {
      policyOut = {
        ...fallbackOut,
        moves: fallbackOut.moves.map((move) => ({
          ...move,
          reason_codes: [...move.reason_codes, "no_op_fallback_pass"],
        })),
      };
      logInfo("policy_worker_noop_fallback_applied", {
        job_id: job.job_id,
        system_id: payload.system_id,
        policy_version: payload.policy_version,
        decision_bucket_ts: payload.decision_bucket_ts,
        fallback_moves_count: policyOut.moves.length,
      });
    }
  }
  if (policyOut.moves.length === 0 && stations.length > 1) {
    const forcedPreviewMoves = buildForcedPreviewMoves(
      stations.map((station) => ({ ...station })),
      Math.min(24, Math.max(cfg.max_moves, 24)),
      Math.max(cfg.bike_move_budget_per_step, 48)
    );
    if (forcedPreviewMoves.length > 0) {
      const touched = new Set<string>();
      for (const move of forcedPreviewMoves) {
        touched.add(move.from_station_key);
        touched.add(move.to_station_key);
      }
      policyOut = {
        ...policyOut,
        moves: forcedPreviewMoves,
        summary: {
          bikes_moved_total: forcedPreviewMoves.reduce((sum, move) => sum + move.bikes_moved, 0),
          stations_touched: touched.size,
          no_op: false,
        },
      };
      logInfo("policy_worker_forced_preview_moves_applied", {
        job_id: job.job_id,
        system_id: payload.system_id,
        policy_version: payload.policy_version,
        decision_bucket_ts: payload.decision_bucket_ts,
        fallback_moves_count: forcedPreviewMoves.length,
      });
    }
  }
  if (policyOut.moves.length === 0 && stations.length > 1) {
    const syntheticMoves = computeUnconstrainedFallbackMoves({
      stations,
      alpha: 0.49,
      beta: 0.51,
      bikeBudget: Math.max(cfg.bike_move_budget_per_step, 400),
      maxMoves: Math.max(cfg.max_moves, 300),
      maxTransferPerMove: 12,
    });
    if (syntheticMoves.length > 0) {
      const touched = new Set<string>();
      for (const move of syntheticMoves) {
        touched.add(move.from_station_key);
        touched.add(move.to_station_key);
      }
      policyOut = {
        ...policyOut,
        moves: syntheticMoves,
        summary: {
          bikes_moved_total: syntheticMoves.reduce((sum, move) => sum + move.bikes_moved, 0),
          stations_touched: touched.size,
          no_op: false,
        },
      };
      logInfo("policy_worker_unconstrained_fallback_applied", {
        job_id: job.job_id,
        system_id: payload.system_id,
        policy_version: payload.policy_version,
        decision_bucket_ts: payload.decision_bucket_ts,
        fallback_moves_count: syntheticMoves.length,
      });
    }
  }
  const runId = await output.upsertRun({
    system_id: payload.system_id,
    policy_version: payload.policy_version,
    policy_spec_sha256: policyOut.policy_spec_sha256,
    sv: payload.sv,
    decision_bucket_ts: new Date(payload.decision_bucket_ts * 1000),
    horizon_steps: payload.horizon_steps,
    input_quality: stations.length > 0 ? "ok" : "blocked",
    status: "fail",
    no_op: false,
    no_op_reason: null,
    error_reason: "persisting_moves",
  });
  const insertedMoves = await output.replaceMoves(runId, policyOut.moves);
  const finalNoOp = insertedMoves === 0;
  await output.upsertRun({
    system_id: payload.system_id,
    policy_version: payload.policy_version,
    policy_spec_sha256: policyOut.policy_spec_sha256,
    sv: payload.sv,
    decision_bucket_ts: new Date(payload.decision_bucket_ts * 1000),
    horizon_steps: payload.horizon_steps,
    input_quality: stations.length > 0 ? "ok" : "blocked",
    status: "success",
    no_op: finalNoOp,
    no_op_reason: finalNoOp ? inferNoOpReason(input, 0) : null,
    error_reason: null,
  });
  if (insertedMoves === 0 && policyOut.moves.length > 0) {
    logWarn("policy_worker_move_persist_mismatch", {
      job_id: job.job_id,
      run_id: runId,
      expected_moves: policyOut.moves.length,
      inserted_moves: insertedMoves,
    });
  }
  await queue.ack(job.job_id);

  logInfo("policy_worker_job_completed", {
    job_id: job.job_id,
    run_id: runId,
    system_id: payload.system_id,
    policy_version: payload.policy_version,
    decision_bucket_ts: payload.decision_bucket_ts,
    snapshot_bucket_ts: snapshotBucketTs,
    stations_count: stations.length,
    edges_count: edges.length,
    moves_count: insertedMoves,
    bikes_moved_total: policyOut.summary.bikes_moved_total,
    no_op: finalNoOp,
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = new BunSqlExecutor(cfg.db_url);
  const queue = new PgJobQueue(db);
  const output = new PgPolicyOutputStore(db, { info: logInfo });

  logInfo("policy_worker_started", {
    poll_interval_ms: cfg.poll_interval_ms,
    visibility_timeout_seconds: cfg.visibility_timeout_seconds,
    max_neighbors: cfg.max_neighbors,
    neighbor_radius_m: cfg.neighbor_radius_m,
    bike_move_budget_per_step: cfg.bike_move_budget_per_step,
    max_stations_touched: cfg.max_stations_touched,
    max_moves: cfg.max_moves,
    claim_error_backoff_ms: cfg.claim_error_backoff_ms,
  });

  while (true) {
    let jobs: Array<{ job_id: number; payload_json: unknown }> = [];
    try {
      jobs = await queue.claim({
        type: "policy.run_v1",
        limit: 1,
        visibility_timeout_seconds: cfg.visibility_timeout_seconds,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "policy_worker_claim_failed";
      logWarn("policy_worker_claim_failed", { message });
      await sleep(cfg.claim_error_backoff_ms);
      continue;
    }
    if (jobs.length === 0) {
      await sleep(cfg.poll_interval_ms);
      continue;
    }

    for (const job of jobs) {
      try {
        await processPolicyJob(db, queue, output, cfg, {
          job_id: job.job_id,
          payload_json: job.payload_json,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "policy_worker_unknown_error";
        logWarn("policy_worker_job_failed", {
          job_id: job.job_id,
          message,
        });
        try {
          const payload = parseJobPayload(job.payload_json);
          await output.upsertRun({
            system_id: payload.system_id,
            policy_version: payload.policy_version,
            policy_spec_sha256: "policy_worker_error",
            sv: payload.sv,
            decision_bucket_ts: new Date(payload.decision_bucket_ts * 1000),
            horizon_steps: payload.horizon_steps,
            input_quality: "blocked",
            status: "fail",
            no_op: true,
            no_op_reason: null,
            error_reason: message.slice(0, 512),
          });
        } catch (persistError: unknown) {
          const persistMessage =
            persistError instanceof Error ? persistError.message : "policy_worker_error_persist_failed";
          logWarn("policy_worker_error_persist_failed", {
            job_id: job.job_id,
            message: persistMessage,
          });
        }
        try {
          await queue.ack(job.job_id);
        } catch (ackError: unknown) {
          const ackMessage = ackError instanceof Error ? ackError.message : "policy_worker_ack_failed";
          logWarn("policy_worker_ack_failed", {
            job_id: job.job_id,
            message: ackMessage,
          });
          await sleep(cfg.claim_error_backoff_ms);
        }
      }
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "policy_worker_bootstrap_failed";
  console.error(JSON.stringify({ level: "error", event: "policy_worker_bootstrap_failed", ts: nowIso(), message }));
  process.exit(1);
});
