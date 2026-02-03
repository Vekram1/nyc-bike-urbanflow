export type JobType = string;

export type JobRecord = {
  job_id: number;
  type: JobType;
  payload_json: unknown;
  dedupe_key: string | null;
  visible_at: Date;
  attempts: number;
  max_attempts: number;
  created_at: Date;
};

export type DlqRecord = {
  dlq_id: number;
  job_id: number;
  type: JobType;
  payload_json: unknown;
  dedupe_key: string | null;
  failed_at: Date;
  reason_code: string;
  details_json: unknown | null;
  attempts: number;
  max_attempts: number;
  created_at: Date;
};

export type EnqueueResult =
  | { ok: true; job_id: number }
  | { ok: false; reason: "deduped" };

export type BackoffStrategy = (attempt: number) => number;
