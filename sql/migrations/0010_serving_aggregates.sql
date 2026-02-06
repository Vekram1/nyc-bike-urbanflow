-- nyc-bike-urbanflow-an0: serving aggregates (status_1m, severity_5m, pressure_now_5m)
-- Deterministic, sv-friendly aggregate inputs for control/data plane.

BEGIN;

CREATE TABLE IF NOT EXISTS station_status_1m (
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  bucket_ts TIMESTAMPTZ NOT NULL,
  bikes_available INTEGER NOT NULL,
  docks_available INTEGER NOT NULL,
  capacity INTEGER,
  bucket_quality TEXT NOT NULL,
  is_serving_grade BOOLEAN NOT NULL,
  source_logical_snapshot_id BIGINT NOT NULL REFERENCES logical_snapshots(logical_snapshot_id),
  source_as_of_ts TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (bikes_available >= 0),
  CHECK (docks_available >= 0),
  CHECK (capacity IS NULL OR capacity >= 0),
  CHECK (bucket_quality IN ('ok', 'degraded', 'blocked')),
  PRIMARY KEY (system_id, station_key, bucket_ts)
);

CREATE INDEX IF NOT EXISTS station_status_1m_time_idx
  ON station_status_1m (system_id, bucket_ts DESC);
CREATE INDEX IF NOT EXISTS station_status_1m_station_idx
  ON station_status_1m (system_id, station_key, bucket_ts DESC);

CREATE TABLE IF NOT EXISTS station_severity_5m (
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  bucket_ts TIMESTAMPTZ NOT NULL,
  severity DOUBLE PRECISION NOT NULL,
  severity_version TEXT NOT NULL,
  severity_components_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  bucket_quality TEXT NOT NULL,
  is_serving_grade BOOLEAN NOT NULL,
  source_as_of_ts TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (severity >= 0.0 AND severity <= 1.0),
  CHECK (bucket_quality IN ('ok', 'degraded', 'blocked')),
  PRIMARY KEY (system_id, station_key, bucket_ts, severity_version)
);

CREATE INDEX IF NOT EXISTS station_severity_5m_time_idx
  ON station_severity_5m (system_id, bucket_ts DESC, severity_version);
CREATE INDEX IF NOT EXISTS station_severity_5m_station_idx
  ON station_severity_5m (system_id, station_key, bucket_ts DESC, severity_version);

CREATE TABLE IF NOT EXISTS station_pressure_now_5m (
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  bucket_ts TIMESTAMPTZ NOT NULL,
  pressure_score DOUBLE PRECISION NOT NULL,
  proxy_method TEXT NOT NULL,
  bucket_quality TEXT NOT NULL,
  is_serving_grade BOOLEAN NOT NULL,
  source_as_of_ts TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (pressure_score >= 0.0 AND pressure_score <= 1.0),
  CHECK (bucket_quality IN ('ok', 'degraded', 'blocked')),
  PRIMARY KEY (system_id, station_key, bucket_ts, proxy_method)
);

CREATE INDEX IF NOT EXISTS station_pressure_now_5m_time_idx
  ON station_pressure_now_5m (system_id, bucket_ts DESC, proxy_method);
CREATE INDEX IF NOT EXISTS station_pressure_now_5m_station_idx
  ON station_pressure_now_5m (system_id, station_key, bucket_ts DESC, proxy_method);

CREATE OR REPLACE FUNCTION refresh_station_status_1m(
  p_system_id TEXT,
  p_from_ts TIMESTAMPTZ,
  p_to_ts TIMESTAMPTZ
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_upserted INTEGER := 0;
BEGIN
  WITH latest_per_bucket AS (
    SELECT DISTINCT ON (
      s.system_id,
      s.station_key,
      date_bin('1 minute', s.observation_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
    )
      s.system_id,
      s.station_key,
      date_bin('1 minute', s.observation_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket_ts,
      s.bikes_available,
      s.docks_available,
      info.capacity,
      s.bucket_quality,
      s.is_serving_grade,
      s.logical_snapshot_id AS source_logical_snapshot_id,
      ls.publisher_last_updated AS source_as_of_ts
    FROM snapshot_station_status s
    JOIN logical_snapshots ls ON ls.logical_snapshot_id = s.logical_snapshot_id
    LEFT JOIN stations_current info
      ON info.system_id = s.system_id
     AND info.station_key = s.station_key
    WHERE s.system_id = p_system_id
      AND s.observation_ts >= p_from_ts
      AND s.observation_ts < p_to_ts
    ORDER BY
      s.system_id,
      s.station_key,
      date_bin('1 minute', s.observation_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00'),
      s.observation_ts DESC,
      s.logical_snapshot_id DESC
  ),
  upserted AS (
    INSERT INTO station_status_1m (
      system_id,
      station_key,
      bucket_ts,
      bikes_available,
      docks_available,
      capacity,
      bucket_quality,
      is_serving_grade,
      source_logical_snapshot_id,
      source_as_of_ts
    )
    SELECT
      l.system_id,
      l.station_key,
      l.bucket_ts,
      l.bikes_available,
      l.docks_available,
      l.capacity,
      l.bucket_quality,
      l.is_serving_grade,
      l.source_logical_snapshot_id,
      l.source_as_of_ts
    FROM latest_per_bucket l
    ON CONFLICT (system_id, station_key, bucket_ts)
    DO UPDATE SET
      bikes_available = EXCLUDED.bikes_available,
      docks_available = EXCLUDED.docks_available,
      capacity = EXCLUDED.capacity,
      bucket_quality = EXCLUDED.bucket_quality,
      is_serving_grade = EXCLUDED.is_serving_grade,
      source_logical_snapshot_id = EXCLUDED.source_logical_snapshot_id,
      source_as_of_ts = EXCLUDED.source_as_of_ts,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_upserted FROM upserted;

  RETURN v_upserted;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_station_severity_5m(
  p_system_id TEXT,
  p_from_ts TIMESTAMPTZ,
  p_to_ts TIMESTAMPTZ,
  p_severity_version TEXT DEFAULT 'sev.v1'
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_upserted INTEGER := 0;
BEGIN
  WITH rolled AS (
    SELECT
      s.system_id,
      s.station_key,
      date_bin('5 minutes', s.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket_ts,
      BOOL_OR(s.bikes_available = 0) AS was_empty,
      BOOL_OR(s.docks_available = 0) AS was_full,
      MAX(s.capacity) AS capacity,
      CASE
        WHEN BOOL_OR(s.bucket_quality = 'blocked') THEN 'blocked'
        WHEN BOOL_OR(s.bucket_quality = 'degraded') THEN 'degraded'
        ELSE 'ok'
      END AS bucket_quality,
      BOOL_AND(s.is_serving_grade) AS is_serving_grade,
      MAX(s.source_as_of_ts) AS source_as_of_ts
    FROM station_status_1m s
    WHERE s.system_id = p_system_id
      AND s.bucket_ts >= p_from_ts
      AND s.bucket_ts < p_to_ts
    GROUP BY
      s.system_id,
      s.station_key,
      date_bin('5 minutes', s.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
  ),
  computed AS (
    SELECT
      r.system_id,
      r.station_key,
      r.bucket_ts,
      CASE
        WHEN r.was_empty OR r.was_full THEN 1.0
        ELSE 0.0
      END AS severity,
      p_severity_version AS severity_version,
      jsonb_build_object(
        'empty_flag', r.was_empty,
        'full_flag', r.was_full,
        'capacity', r.capacity
      ) AS severity_components_json,
      r.bucket_quality,
      r.is_serving_grade,
      r.source_as_of_ts
    FROM rolled r
  ),
  upserted AS (
    INSERT INTO station_severity_5m (
      system_id,
      station_key,
      bucket_ts,
      severity,
      severity_version,
      severity_components_json,
      bucket_quality,
      is_serving_grade,
      source_as_of_ts
    )
    SELECT
      c.system_id,
      c.station_key,
      c.bucket_ts,
      c.severity,
      c.severity_version,
      c.severity_components_json,
      c.bucket_quality,
      c.is_serving_grade,
      c.source_as_of_ts
    FROM computed c
    ON CONFLICT (system_id, station_key, bucket_ts, severity_version)
    DO UPDATE SET
      severity = EXCLUDED.severity,
      severity_components_json = EXCLUDED.severity_components_json,
      bucket_quality = EXCLUDED.bucket_quality,
      is_serving_grade = EXCLUDED.is_serving_grade,
      source_as_of_ts = EXCLUDED.source_as_of_ts,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_upserted FROM upserted;

  RETURN v_upserted;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_station_pressure_now_5m(
  p_system_id TEXT,
  p_from_ts TIMESTAMPTZ,
  p_to_ts TIMESTAMPTZ,
  p_proxy_method TEXT DEFAULT 'delta_cap.v1'
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_upserted INTEGER := 0;
BEGIN
  WITH buckets AS (
    SELECT DISTINCT ON (
      s.system_id,
      s.station_key,
      date_bin('5 minutes', s.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
    )
      s.system_id,
      s.station_key,
      date_bin('5 minutes', s.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket_ts,
      s.bikes_available,
      COALESCE(s.capacity, NULLIF(s.bikes_available + s.docks_available, 0)) AS capacity,
      s.bucket_quality,
      s.is_serving_grade,
      s.source_as_of_ts
    FROM station_status_1m s
    WHERE s.system_id = p_system_id
      AND s.bucket_ts >= p_from_ts
      AND s.bucket_ts < p_to_ts
    ORDER BY
      s.system_id,
      s.station_key,
      date_bin('5 minutes', s.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00'),
      s.bucket_ts DESC
  ),
  with_prev AS (
    SELECT
      b.*,
      LAG(b.bikes_available) OVER (
        PARTITION BY b.system_id, b.station_key
        ORDER BY b.bucket_ts
      ) AS prev_bikes
    FROM buckets b
  ),
  scored AS (
    SELECT
      wp.system_id,
      wp.station_key,
      wp.bucket_ts,
      CASE
        WHEN wp.capacity IS NULL OR wp.capacity <= 0 OR wp.prev_bikes IS NULL THEN 0.0
        ELSE LEAST(1.0, ABS(wp.bikes_available - wp.prev_bikes)::DOUBLE PRECISION / wp.capacity::DOUBLE PRECISION)
      END AS pressure_score,
      p_proxy_method AS proxy_method,
      wp.bucket_quality,
      wp.is_serving_grade,
      wp.source_as_of_ts
    FROM with_prev wp
  ),
  upserted AS (
    INSERT INTO station_pressure_now_5m (
      system_id,
      station_key,
      bucket_ts,
      pressure_score,
      proxy_method,
      bucket_quality,
      is_serving_grade,
      source_as_of_ts
    )
    SELECT
      s.system_id,
      s.station_key,
      s.bucket_ts,
      s.pressure_score,
      s.proxy_method,
      s.bucket_quality,
      s.is_serving_grade,
      s.source_as_of_ts
    FROM scored s
    ON CONFLICT (system_id, station_key, bucket_ts, proxy_method)
    DO UPDATE SET
      pressure_score = EXCLUDED.pressure_score,
      bucket_quality = EXCLUDED.bucket_quality,
      is_serving_grade = EXCLUDED.is_serving_grade,
      source_as_of_ts = EXCLUDED.source_as_of_ts,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_upserted FROM upserted;

  RETURN v_upserted;
END;
$$;

CREATE OR REPLACE VIEW serving_aggregate_lag AS
SELECT
  'station_status_1m'::text AS aggregate_name,
  system_id,
  MAX(bucket_ts) AS latest_bucket_ts,
  GREATEST(0, EXTRACT(EPOCH FROM (NOW() - MAX(bucket_ts))))::BIGINT AS lag_s
FROM station_status_1m
GROUP BY system_id
UNION ALL
SELECT
  'station_severity_5m'::text AS aggregate_name,
  system_id,
  MAX(bucket_ts) AS latest_bucket_ts,
  GREATEST(0, EXTRACT(EPOCH FROM (NOW() - MAX(bucket_ts))))::BIGINT AS lag_s
FROM station_severity_5m
GROUP BY system_id
UNION ALL
SELECT
  'station_pressure_now_5m'::text AS aggregate_name,
  system_id,
  MAX(bucket_ts) AS latest_bucket_ts,
  GREATEST(0, EXTRACT(EPOCH FROM (NOW() - MAX(bucket_ts))))::BIGINT AS lag_s
FROM station_pressure_now_5m
GROUP BY system_id;

CREATE OR REPLACE VIEW serving_aggregate_bucket_quality_counts AS
SELECT
  'station_status_1m'::text AS aggregate_name,
  system_id,
  bucket_ts,
  bucket_quality,
  COUNT(*)::BIGINT AS station_count
FROM station_status_1m
GROUP BY system_id, bucket_ts, bucket_quality
UNION ALL
SELECT
  'station_severity_5m'::text AS aggregate_name,
  system_id,
  bucket_ts,
  bucket_quality,
  COUNT(*)::BIGINT AS station_count
FROM station_severity_5m
GROUP BY system_id, bucket_ts, bucket_quality
UNION ALL
SELECT
  'station_pressure_now_5m'::text AS aggregate_name,
  system_id,
  bucket_ts,
  bucket_quality,
  COUNT(*)::BIGINT AS station_count
FROM station_pressure_now_5m
GROUP BY system_id, bucket_ts, bucket_quality;

COMMIT;
