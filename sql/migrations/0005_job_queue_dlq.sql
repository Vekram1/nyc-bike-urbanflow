-- nyc-bike-urbanflow-zjr: Postgres job queue + DLQ (Profile A)
-- Minimal, deterministic SKIP LOCKED queue with dedupe and dead-lettering.

BEGIN;

CREATE TABLE job_queue (
  job_id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  dedupe_key TEXT,
  visible_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (attempts >= 0),
  CHECK (max_attempts >= 1)
);

CREATE INDEX job_queue_visible_at_idx
  ON job_queue (visible_at, job_id);
CREATE INDEX job_queue_type_visible_at_idx
  ON job_queue (type, visible_at, job_id);
CREATE UNIQUE INDEX job_queue_dedupe_idx
  ON job_queue (type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE job_dlq (
  dlq_id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL,
  type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  dedupe_key TEXT,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason_code TEXT NOT NULL,
  details_json JSONB,
  attempts INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (attempts >= 0),
  CHECK (max_attempts >= 1)
);

CREATE INDEX job_dlq_failed_at_idx
  ON job_dlq (failed_at DESC);
CREATE INDEX job_dlq_type_idx
  ON job_dlq (type, failed_at DESC);
CREATE UNIQUE INDEX job_dlq_job_id_idx
  ON job_dlq (job_id);

COMMIT;
