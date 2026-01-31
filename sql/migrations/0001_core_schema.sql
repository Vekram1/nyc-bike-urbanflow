-- nyc-bike-urbanflow-av9: Core DB schema + migrations (snapshots, station tables)
-- Deterministic, minimal schema for raw snapshots, station state, and lifecycle.

BEGIN;

CREATE TABLE systems (
  system_id TEXT PRIMARY KEY,
  gbfs_entrypoint_url TEXT NOT NULL,
  default_map_bounds DOUBLE PRECISION[] NOT NULL,
  default_center DOUBLE PRECISION[] NOT NULL,
  timezone TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  provider_region TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (system_id ~ '^[a-z0-9-]+$'),
  CHECK (array_length(default_map_bounds, 1) = 4),
  CHECK (array_length(default_center, 1) = 2),
  CHECK (default_map_bounds[1] >= -180 AND default_map_bounds[1] <= 180),
  CHECK (default_map_bounds[3] >= -180 AND default_map_bounds[3] <= 180),
  CHECK (default_map_bounds[2] >= -90 AND default_map_bounds[2] <= 90),
  CHECK (default_map_bounds[4] >= -90 AND default_map_bounds[4] <= 90),
  CHECK (default_map_bounds[1] < default_map_bounds[3]),
  CHECK (default_map_bounds[2] < default_map_bounds[4]),
  CHECK (default_center[1] >= -180 AND default_center[1] <= 180),
  CHECK (default_center[2] >= -90 AND default_center[2] <= 90)
);

CREATE TABLE logical_snapshots (
  logical_snapshot_id BIGSERIAL PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  feed_name TEXT NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL,
  publisher_last_updated TIMESTAMPTZ NOT NULL,
  parse_schema_id TEXT NOT NULL,
  parser_fingerprint TEXT NOT NULL,
  loader_schema_version TEXT NOT NULL,
  raw_object_sha256 TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  parquet_path TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX logical_snapshots_dedupe_idx
  ON logical_snapshots (system_id, feed_name, publisher_last_updated, loader_schema_version);
CREATE INDEX logical_snapshots_feed_time_idx
  ON logical_snapshots (system_id, feed_name, publisher_last_updated DESC);
CREATE INDEX logical_snapshots_raw_object_idx
  ON logical_snapshots (raw_object_sha256);

CREATE TABLE fetch_attempts (
  fetch_attempt_id BIGSERIAL PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  feed_name TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  collected_at TIMESTAMPTZ,
  publisher_last_updated TIMESTAMPTZ,
  status_code INTEGER,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  response_etag TEXT,
  response_bytes INTEGER,
  duration_ms INTEGER,
  error_message TEXT,
  raw_object_sha256 TEXT,
  manifest_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (response_bytes IS NULL OR response_bytes >= 0),
  CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX fetch_attempts_feed_time_idx
  ON fetch_attempts (system_id, feed_name, requested_at DESC);
CREATE INDEX fetch_attempts_ok_idx
  ON fetch_attempts (ok);

CREATE TABLE raw_manifests (
  raw_manifest_id BIGSERIAL PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  feed_name TEXT NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL,
  publisher_last_updated TIMESTAMPTZ NOT NULL,
  parse_schema_id TEXT NOT NULL,
  parser_fingerprint TEXT NOT NULL,
  loader_schema_version TEXT NOT NULL,
  raw_object_sha256 TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  object_path TEXT NOT NULL,
  content_type TEXT,
  bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (bytes IS NULL OR bytes >= 0)
);

CREATE UNIQUE INDEX raw_manifests_sha256_idx
  ON raw_manifests (raw_object_sha256);
CREATE UNIQUE INDEX raw_manifests_dedupe_idx
  ON raw_manifests (system_id, feed_name, publisher_last_updated, loader_schema_version);
CREATE INDEX raw_manifests_feed_time_idx
  ON raw_manifests (system_id, feed_name, publisher_last_updated DESC);

CREATE TABLE snapshot_station_information (
  logical_snapshot_id BIGINT NOT NULL REFERENCES logical_snapshots(logical_snapshot_id) ON DELETE CASCADE,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  station_id TEXT,
  name TEXT,
  short_name TEXT,
  region_id TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  capacity INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (lat >= -90 AND lat <= 90),
  CHECK (lon >= -180 AND lon <= 180),
  CHECK (capacity IS NULL OR capacity >= 0),
  PRIMARY KEY (logical_snapshot_id, station_key)
);

CREATE INDEX snapshot_station_information_station_idx
  ON snapshot_station_information (system_id, station_key);

CREATE TABLE snapshot_station_status (
  logical_snapshot_id BIGINT NOT NULL REFERENCES logical_snapshots(logical_snapshot_id) ON DELETE CASCADE,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  station_id TEXT,
  bikes_available INTEGER NOT NULL,
  docks_available INTEGER NOT NULL,
  is_installed BOOLEAN,
  is_renting BOOLEAN,
  is_returning BOOLEAN,
  last_reported TIMESTAMPTZ,
  observation_ts_raw TIMESTAMPTZ NOT NULL,
  observation_ts TIMESTAMPTZ NOT NULL,
  quality_flag_codes TEXT[] NOT NULL DEFAULT '{}',
  is_serving_grade BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (bikes_available >= 0),
  CHECK (docks_available >= 0),
  CHECK (observation_ts >= observation_ts_raw),
  PRIMARY KEY (logical_snapshot_id, station_key)
);

CREATE INDEX snapshot_station_status_time_idx
  ON snapshot_station_status (system_id, observation_ts DESC);
CREATE INDEX snapshot_station_status_station_idx
  ON snapshot_station_status (system_id, station_key);

CREATE TABLE stations_scd (
  station_scd_id BIGSERIAL PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  station_id TEXT,
  name TEXT,
  short_name TEXT,
  region_id TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  capacity INTEGER,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_logical_snapshot_id BIGINT REFERENCES logical_snapshots(logical_snapshot_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (lat >= -90 AND lat <= 90),
  CHECK (lon >= -180 AND lon <= 180),
  CHECK (capacity IS NULL OR capacity >= 0)
);

CREATE UNIQUE INDEX stations_scd_key_from_idx
  ON stations_scd (system_id, station_key, valid_from);
CREATE INDEX stations_scd_active_idx
  ON stations_scd (system_id, station_key, valid_to);

CREATE TABLE station_lifecycle (
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ,
  lifecycle_status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (system_id, station_key)
);

COMMIT;
