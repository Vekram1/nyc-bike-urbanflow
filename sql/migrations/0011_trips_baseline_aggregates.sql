-- nyc-bike-urbanflow-mzx: trips baseline ingestion + station flow aggregates
-- Deterministic monthly baseline datasets and derived inflow/outflow aggregates.

BEGIN;

CREATE TABLE IF NOT EXISTS trips_baseline_datasets (
  dataset_id TEXT PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  period_month DATE NOT NULL,
  as_of_text TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  schema_version TEXT NOT NULL,
  source TEXT NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (row_count >= 0),
  CHECK (as_of_text LIKE 'sha256=%')
);

CREATE INDEX IF NOT EXISTS trips_baseline_datasets_system_month_idx
  ON trips_baseline_datasets (system_id, period_month DESC);

CREATE TABLE IF NOT EXISTS trips_baseline_rows (
  dataset_id TEXT NOT NULL REFERENCES trips_baseline_datasets(dataset_id) ON DELETE CASCADE,
  trip_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  start_station_key TEXT NOT NULL,
  end_station_key TEXT NOT NULL,
  member_type TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  CHECK (duration_s >= 0),
  CHECK (ended_at >= started_at),
  PRIMARY KEY (dataset_id, trip_id)
);

CREATE INDEX IF NOT EXISTS trips_baseline_rows_started_idx
  ON trips_baseline_rows (dataset_id, started_at);
CREATE INDEX IF NOT EXISTS trips_baseline_rows_start_station_idx
  ON trips_baseline_rows (dataset_id, start_station_key);
CREATE INDEX IF NOT EXISTS trips_baseline_rows_end_station_idx
  ON trips_baseline_rows (dataset_id, end_station_key);

CREATE TABLE IF NOT EXISTS station_outflows_monthly (
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  dataset_id TEXT NOT NULL REFERENCES trips_baseline_datasets(dataset_id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  station_key TEXT NOT NULL,
  trips_out INTEGER NOT NULL,
  total_duration_s BIGINT NOT NULL,
  member_trips INTEGER NOT NULL,
  casual_trips INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (trips_out >= 0),
  CHECK (member_trips >= 0),
  CHECK (casual_trips >= 0),
  CHECK (member_trips + casual_trips = trips_out),
  PRIMARY KEY (dataset_id, period_month, station_key)
);

CREATE INDEX IF NOT EXISTS station_outflows_monthly_lookup_idx
  ON station_outflows_monthly (system_id, period_month DESC, station_key);

CREATE TABLE IF NOT EXISTS station_inflows_monthly (
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  dataset_id TEXT NOT NULL REFERENCES trips_baseline_datasets(dataset_id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  station_key TEXT NOT NULL,
  trips_in INTEGER NOT NULL,
  total_duration_s BIGINT NOT NULL,
  member_trips INTEGER NOT NULL,
  casual_trips INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (trips_in >= 0),
  CHECK (member_trips >= 0),
  CHECK (casual_trips >= 0),
  CHECK (member_trips + casual_trips = trips_in),
  PRIMARY KEY (dataset_id, period_month, station_key)
);

CREATE INDEX IF NOT EXISTS station_inflows_monthly_lookup_idx
  ON station_inflows_monthly (system_id, period_month DESC, station_key);

COMMIT;
