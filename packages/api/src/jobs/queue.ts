import type { SqlExecutor } from "../db/types";
import type { BackoffStrategy, EnqueueResult, JobRecord, JobType } from "./types";

type JobRow = {
  job_id: number;
  type: string;
  payload_json: unknown;
  dedupe_key: string | null;
  visible_at: string;
  attempts: number;
  max_attempts: number;
  created_at: string;
};

const defaultBackoffSeconds: BackoffStrategy = (attempt: number): number => {
  // attempt is 1-based (after increment). Cap so failures don't disappear for hours in dev.
  const base = Math.min(60, Math.pow(2, Math.min(attempt, 6)));
  return base;
};

export class PgJobQueue {
  private readonly db: SqlExecutor;
  private readonly backoffSeconds: BackoffStrategy;

  constructor(db: SqlExecutor, backoffSeconds: BackoffStrategy = defaultBackoffSeconds) {
    this.db = db;
    this.backoffSeconds = backoffSeconds;
  }

  async enqueue(params: {
    type: JobType;
    payload: unknown;
    dedupe_key?: string;
    visible_at?: Date;
    max_attempts?: number;
  }): Promise<EnqueueResult> {
    const rows = await this.db.query<{ job_id: number }>(
      `INSERT INTO job_queue (type, payload_json, dedupe_key, visible_at, max_attempts)
       VALUES ($1, $2, $3, COALESCE($4, NOW()), COALESCE($5, 10))
       ON CONFLICT (type, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING job_id`,
      [
        params.type,
        JSON.stringify(params.payload),
        params.dedupe_key ?? null,
        params.visible_at ?? null,
        params.max_attempts ?? null,
      ]
    );
    if (rows.rows.length === 0) {
      return { ok: false, reason: "deduped" };
    }
    return { ok: true, job_id: rows.rows[0].job_id };
  }

  async claim(params: {
    type?: JobType;
    limit: number;
    visibility_timeout_seconds: number;
  }): Promise<JobRecord[]> {
    const rows = await this.db.query<JobRow>(
      `WITH cte AS (
         SELECT job_id
         FROM job_queue
         WHERE visible_at <= NOW()
           AND ($1::text IS NULL OR type = $1)
         ORDER BY visible_at ASC, job_id ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       UPDATE job_queue
       SET attempts = attempts + 1,
           visible_at = NOW() + make_interval(secs => $3)
       WHERE job_id IN (SELECT job_id FROM cte)
       RETURNING job_id, type, payload_json, dedupe_key, visible_at, attempts, max_attempts, created_at`,
      [params.type ?? null, params.limit, params.visibility_timeout_seconds]
    );
    return rows.rows.map((r) => ({
      job_id: r.job_id,
      type: r.type,
      payload_json: r.payload_json,
      dedupe_key: r.dedupe_key,
      visible_at: new Date(r.visible_at),
      attempts: r.attempts,
      max_attempts: r.max_attempts,
      created_at: new Date(r.created_at),
    }));
  }

  async ack(job_id: number): Promise<void> {
    await this.db.query(`DELETE FROM job_queue WHERE job_id = $1`, [job_id]);
  }

  async fail(params: {
    job_id: number;
    reason_code: string;
    details?: unknown;
  }): Promise<{ moved_to_dlq: boolean }> {
    // Atomically decide retry vs DLQ based on attempts/max_attempts at the time of failure.
    // We do not increment attempts here; claim() already incremented attempts for this lease.
    const rows = await this.db.query<{ attempts: number; max_attempts: number }>(
      `SELECT attempts, max_attempts
       FROM job_queue
       WHERE job_id = $1
       LIMIT 1`,
      [params.job_id]
    );
    if (rows.rows.length === 0) {
      return { moved_to_dlq: false };
    }

    const { attempts, max_attempts } = rows.rows[0];
    if (attempts >= max_attempts) {
      await this.db.query(
        `WITH moved AS (
           DELETE FROM job_queue
           WHERE job_id = $1
           RETURNING job_id, type, payload_json, dedupe_key, attempts, max_attempts, created_at
         )
         INSERT INTO job_dlq (
           job_id, type, payload_json, dedupe_key,
           reason_code, details_json,
           attempts, max_attempts, created_at
         )
         SELECT
           job_id, type, payload_json, dedupe_key,
           $2, $3,
           attempts, max_attempts, created_at
         FROM moved`,
        [params.job_id, params.reason_code, params.details ? JSON.stringify(params.details) : null]
      );
      return { moved_to_dlq: true };
    }

    const delaySeconds = this.backoffSeconds(attempts);
    await this.db.query(
      `UPDATE job_queue
       SET visible_at = NOW() + make_interval(secs => $2)
       WHERE job_id = $1`,
      [params.job_id, delaySeconds]
    );
    return { moved_to_dlq: false };
  }
}

