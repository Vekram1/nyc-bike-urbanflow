import type { GreedyPolicyMove } from "./types";

export type SqlQueryResult<Row extends Record<string, unknown>> = {
  rows: Row[];
};

export type SqlExecutor = {
  query<Row extends Record<string, unknown>>(
    text: string,
    params?: Array<unknown>
  ): Promise<SqlQueryResult<Row>>;
};

type PolicyRunRow = { run_id: number };

export type PolicyRunInsert = {
  system_id: string;
  policy_version: string;
  policy_spec_sha256: string;
  sv: string;
  decision_bucket_ts: Date;
  horizon_steps: number;
  input_quality: "ok" | "carried_forward" | "missing" | "blocked";
  status: "success" | "fail";
  no_op?: boolean;
  no_op_reason?: string | null;
  error_reason?: string | null;
};

export type PolicyOutputLogger = {
  info: (event: string, details: Record<string, unknown>) => void;
};

const defaultLogger: PolicyOutputLogger = {
  info(event, details) {
    console.info(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...details }));
  },
};

export class PgPolicyOutputStore {
  private readonly db: SqlExecutor;
  private readonly logger: PolicyOutputLogger;

  constructor(db: SqlExecutor, logger?: PolicyOutputLogger) {
    this.db = db;
    this.logger = logger ?? defaultLogger;
  }

  async upsertRun(params: PolicyRunInsert): Promise<number> {
    const out = await this.db.query<PolicyRunRow>(
      `INSERT INTO policy_runs (
         system_id,
         policy_version,
         policy_spec_sha256,
         sv,
         decision_bucket_ts,
         horizon_steps,
         input_quality,
         status,
         no_op,
         no_op_reason,
         error_reason
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (system_id, policy_version, policy_spec_sha256, sv, decision_bucket_ts, horizon_steps)
       DO UPDATE SET
         input_quality = EXCLUDED.input_quality,
         status = EXCLUDED.status,
         no_op = EXCLUDED.no_op,
         no_op_reason = EXCLUDED.no_op_reason,
         error_reason = EXCLUDED.error_reason
       RETURNING run_id`,
      [
        params.system_id,
        params.policy_version,
        params.policy_spec_sha256,
        params.sv,
        params.decision_bucket_ts,
        params.horizon_steps,
        params.input_quality,
        params.status,
        params.no_op ?? false,
        params.no_op_reason ?? null,
        params.error_reason ?? null,
      ]
    );
    const runId = out.rows[0]?.run_id;
    if (!runId) {
      throw new Error("policy_run_upsert_failed");
    }
    return runId;
  }

  async replaceMoves(run_id: number, moves: GreedyPolicyMove[]): Promise<number> {
    await this.db.query(`DELETE FROM policy_moves WHERE run_id = $1`, [run_id]);
    let inserted = 0;
    for (let i = 0; i < moves.length; i += 1) {
      const move = moves[i];
      await this.db.query(
        `INSERT INTO policy_moves (
           run_id,
           move_rank,
           from_station_key,
           to_station_key,
           bikes_moved,
           dist_m,
           budget_exhausted,
           neighbor_exhausted,
           reason_codes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[])`,
        [
          run_id,
          i + 1,
          move.from_station_key,
          move.to_station_key,
          move.bikes_moved,
          move.dist_m,
          false,
          false,
          move.reason_codes,
        ]
      );
      inserted += 1;
    }
    return inserted;
  }

  async replaceCounterfactualStatus(
    run_id: number,
    rows: Array<{
      sim_bucket_ts: Date;
      station_key: string;
      bikes: number;
      docks: number;
      bucket_quality: "ok" | "carried_forward" | "missing" | "blocked";
    }>
  ): Promise<number> {
    await this.db.query(`DELETE FROM policy_counterfactual_status WHERE run_id = $1`, [run_id]);
    let inserted = 0;
    for (const row of rows) {
      await this.db.query(
        `INSERT INTO policy_counterfactual_status (
           run_id, sim_bucket_ts, station_key, bikes, docks, bucket_quality
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [run_id, row.sim_bucket_ts, row.station_key, row.bikes, row.docks, row.bucket_quality]
      );
      inserted += 1;
    }
    return inserted;
  }

  async refreshEvalDaily(params: {
    system_id: string;
    from_day: string;
    to_day: string;
  }): Promise<number> {
    const started = Date.now();
    const out = await this.db.query<{ refresh_policy_eval_daily: number }>(
      `SELECT refresh_policy_eval_daily($1, $2::date, $3::date)`,
      [params.system_id, params.from_day, params.to_day]
    );
    const upserted = Number(out.rows[0]?.refresh_policy_eval_daily ?? 0);
    this.logger.info("policy_eval_daily_refresh", {
      system_id: params.system_id,
      from_day: params.from_day,
      to_day: params.to_day,
      upserted_rows: upserted,
      elapsed_ms: Date.now() - started,
    });
    return upserted;
  }
}
