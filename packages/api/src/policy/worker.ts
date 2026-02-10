/// <reference path="../runtime-shims.d.ts" />

import { SQL } from "bun";

import type { SqlExecutor, SqlQueryResult } from "../db/types";
import { PgJobQueue } from "../jobs/queue";
import { PgPolicyOutputStore } from "../../../policy/src/output_store";
import { runGreedyPolicyV1 } from "../../../policy/src/greedy_v1";
import type {
  GreedyPolicyInput,
  GreedyPolicySpec,
  PolicyInputStation,
  PolicyNeighborEdge,
} from "../../../policy/src/types";

type WorkerConfig = {
  db_url: string;
  poll_interval_ms: number;
  visibility_timeout_seconds: number;
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
    max_neighbors: parseIntEnv("POLICY_MAX_NEIGHBORS", 6),
    neighbor_radius_m: parseFloatEnv("POLICY_NEIGHBOR_RADIUS_M", 1500),
    target_alpha: parseFloatEnv("POLICY_TARGET_ALPHA", 0.2),
    target_beta: parseFloatEnv("POLICY_TARGET_BETA", 0.8),
    min_capacity_for_policy: parseIntEnv("POLICY_MIN_CAPACITY_FOR_POLICY", 5),
    bike_move_budget_per_step: parseIntEnv("POLICY_BIKE_MOVE_BUDGET_PER_STEP", 60),
    max_stations_touched: parseIntEnv("POLICY_MAX_STATIONS_TOUCHED", 80),
    max_moves: parseIntEnv("POLICY_MAX_MOVES_PER_RUN", 120),
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

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    const out = await this.sql.unsafe(text, params);
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
  return {
    targets: {
      type: "band_fraction_of_capacity",
      alpha: cfg.target_alpha,
      beta: cfg.target_beta,
      min_capacity_for_policy: cfg.min_capacity_for_policy,
      inactive_station_behavior: "ignore",
    },
    effort: {
      bike_move_budget_per_step: cfg.bike_move_budget_per_step,
      max_stations_touched: cfg.max_stations_touched,
      max_moves: cfg.max_moves,
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

async function processPolicyJob(
  db: SqlExecutor,
  queue: PgJobQueue,
  output: PgPolicyOutputStore,
  cfg: WorkerConfig,
  job: { job_id: number; payload_json: unknown }
): Promise<void> {
  const payload = parseJobPayload(job.payload_json);
  if (payload.policy_version !== "rebal.greedy.v1") {
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
  const edges = await loadNeighborEdges(db, {
    system_id: payload.system_id,
    max_neighbors: cfg.max_neighbors,
    neighbor_radius_m: cfg.neighbor_radius_m,
  });

  const spec = buildSpec(cfg, edges);
  const input: GreedyPolicyInput = {
    policy_version: payload.policy_version,
    system_id: payload.system_id,
    decision_bucket_ts: payload.decision_bucket_ts,
    bucket_size_s: cfg.bucket_size_s,
    spec,
    stations,
  };

  const policyOut = runGreedyPolicyV1(input, {
    logger: { info: logInfo },
  });
  const runId = await output.upsertRun({
    system_id: payload.system_id,
    policy_version: payload.policy_version,
    policy_spec_sha256: policyOut.policy_spec_sha256,
    sv: payload.sv,
    decision_bucket_ts: new Date(payload.decision_bucket_ts * 1000),
    horizon_steps: payload.horizon_steps,
    input_quality: stations.length > 0 ? "ok" : "blocked",
    status: "success",
    no_op: policyOut.summary.no_op,
    no_op_reason: inferNoOpReason(input, policyOut.moves.length),
    error_reason: null,
  });
  await output.replaceMoves(runId, policyOut.moves);
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
    moves_count: policyOut.moves.length,
    bikes_moved_total: policyOut.summary.bikes_moved_total,
    no_op: policyOut.summary.no_op,
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
  });

  while (true) {
    const jobs = await queue.claim({
      type: "policy.run_v1",
      limit: 1,
      visibility_timeout_seconds: cfg.visibility_timeout_seconds,
    });
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
        await queue.fail({
          job_id: job.job_id,
          reason_code: "policy_worker_error",
          details: { message },
        });
      }
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "policy_worker_bootstrap_failed";
  console.error(JSON.stringify({ level: "error", event: "policy_worker_bootstrap_failed", ts: nowIso(), message }));
  process.exit(1);
});
