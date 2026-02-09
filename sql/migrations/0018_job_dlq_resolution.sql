-- nyc-bike-urbanflow-ch2: Admin ops DLQ resolution notes
BEGIN;

CREATE TABLE IF NOT EXISTS job_dlq_resolution (
  dlq_id BIGINT PRIMARY KEY REFERENCES job_dlq(dlq_id) ON DELETE CASCADE,
  resolution_note TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_dlq_resolution_resolved_at_idx
  ON job_dlq_resolution (resolved_at DESC);

COMMIT;
