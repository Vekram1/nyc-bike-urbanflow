-- nyc-bike-urbanflow-lfj: Serving views + sv token issuance prerequisites
-- Track upstream dataset watermarks so sv can bind reproducible inputs.

BEGIN;

CREATE TABLE datasets (
  dataset_id TEXT PRIMARY KEY,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dataset_watermarks (
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  dataset_id TEXT NOT NULL REFERENCES datasets(dataset_id),
  -- Use either a timestamp watermark (GBFS) or a text watermark (e.g., checksum for trips).
  as_of_ts TIMESTAMPTZ,
  as_of_text TEXT,
  max_observed_at TIMESTAMPTZ,
  details_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (system_id, dataset_id),
  CHECK ((as_of_ts IS NOT NULL)::int + (as_of_text IS NOT NULL)::int = 1)
);

CREATE INDEX dataset_watermarks_by_dataset_idx
  ON dataset_watermarks (dataset_id, updated_at DESC);

COMMIT;
