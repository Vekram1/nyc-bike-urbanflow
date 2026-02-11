import type { SqlExecutor } from "../db/types";

export type PolicyRunSummary = {
  run_id: number;
  system_id: string;
  policy_version: string;
  policy_spec_sha256: string;
  sv: string;
  decision_bucket_ts: string;
  horizon_steps: number;
  input_quality: string;
  status: "success" | "fail";
  no_op: boolean;
  no_op_reason: string | null;
  error_reason: string | null;
  created_at: string;
  move_count: number;
};

export type PolicyMove = {
  move_rank: number;
  from_station_key: string;
  to_station_key: string;
  bikes_moved: number;
  dist_m: number;
  budget_exhausted: boolean;
  neighbor_exhausted: boolean;
  reason_codes: string[];
};

type RunRow = {
  run_id: number | string;
  system_id: string;
  policy_version: string;
  policy_spec_sha256: string;
  sv: string;
  decision_bucket_ts: Date | string;
  horizon_steps: number;
  input_quality: string;
  status: "success" | "fail";
  no_op: boolean;
  no_op_reason: string | null;
  error_reason: string | null;
  created_at: Date | string;
  move_count: number | string;
};

type MoveRow = {
  move_rank: number;
  from_station_key: string;
  to_station_key: string;
  bikes_moved: number;
  dist_m: number | string;
  budget_exhausted: boolean;
  neighbor_exhausted: boolean;
  reason_codes: string[] | null;
};

export class PgPolicyReadStore {
  private readonly db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.db = db;
  }

  async getRunSummary(args: {
    system_id: string;
    sv: string;
    policy_version: string;
    decision_bucket_epoch_s: number;
    horizon_steps: number;
  }): Promise<PolicyRunSummary | null> {
    const out = await this.db.query<RunRow>(
      `SELECT
         r.run_id,
         r.system_id,
         r.policy_version,
         r.policy_spec_sha256,
         r.sv,
         r.decision_bucket_ts,
         r.horizon_steps,
         r.input_quality,
         r.status,
         r.no_op,
         r.no_op_reason,
         r.error_reason,
         r.created_at,
         COALESCE(m.move_count, 0) AS move_count
       FROM policy_runs r
       LEFT JOIN (
         SELECT run_id, COUNT(*)::int AS move_count
         FROM policy_moves
         GROUP BY run_id
       ) m ON m.run_id = r.run_id
       WHERE r.system_id = $1
         AND r.sv = $2
         AND r.policy_version = $3
         AND r.decision_bucket_ts = TO_TIMESTAMP($4)
         AND r.horizon_steps = $5
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [
        args.system_id,
        args.sv,
        args.policy_version,
        args.decision_bucket_epoch_s,
        args.horizon_steps,
      ]
    );
    const row = out.rows[0];
    if (!row) {
      return null;
    }
    return {
      run_id: Number(row.run_id),
      system_id: row.system_id,
      policy_version: row.policy_version,
      policy_spec_sha256: row.policy_spec_sha256,
      sv: row.sv,
      decision_bucket_ts: new Date(row.decision_bucket_ts).toISOString(),
      horizon_steps: row.horizon_steps,
      input_quality: row.input_quality,
      status: row.status,
      no_op: row.no_op,
      no_op_reason: row.no_op_reason,
      error_reason: row.error_reason,
      created_at: new Date(row.created_at).toISOString(),
      move_count: Number(row.move_count),
    };
  }

  async listMoves(args: { run_id: number; limit: number }): Promise<PolicyMove[]> {
    const out = await this.db.query<MoveRow>(
      `SELECT
         move_rank,
         from_station_key,
         to_station_key,
         bikes_moved,
         dist_m,
         budget_exhausted,
         neighbor_exhausted,
         reason_codes
       FROM policy_moves
       WHERE run_id = $1
       ORDER BY move_rank ASC
       LIMIT $2`,
      [args.run_id, args.limit]
    );
    return out.rows.map((row) => ({
      move_rank: row.move_rank,
      from_station_key: row.from_station_key,
      to_station_key: row.to_station_key,
      bikes_moved: row.bikes_moved,
      dist_m: Number(row.dist_m),
      budget_exhausted: row.budget_exhausted,
      neighbor_exhausted: row.neighbor_exhausted,
      reason_codes: row.reason_codes ?? [],
    }));
  }
}
