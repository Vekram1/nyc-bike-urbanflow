-- nyc-bike-urbanflow-gtk.12: reliability marts + episode tables
-- Empty/full minute rollups and contiguous episode extraction with lineage fields.

BEGIN;

CREATE TABLE IF NOT EXISTS station_reliability_daily (
  day DATE NOT NULL,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  severity_version TEXT NOT NULL,
  total_minutes INTEGER NOT NULL,
  empty_minutes INTEGER NOT NULL,
  full_minutes INTEGER NOT NULL,
  degraded_minutes INTEGER NOT NULL,
  blocked_minutes INTEGER NOT NULL,
  serving_grade_minutes INTEGER NOT NULL,
  max_source_as_of_ts TIMESTAMPTZ NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (total_minutes >= 0),
  CHECK (empty_minutes >= 0),
  CHECK (full_minutes >= 0),
  CHECK (degraded_minutes >= 0),
  CHECK (blocked_minutes >= 0),
  CHECK (serving_grade_minutes >= 0),
  PRIMARY KEY (day, system_id, station_key, severity_version)
);

CREATE INDEX IF NOT EXISTS station_reliability_daily_system_day_idx
  ON station_reliability_daily (system_id, day DESC, severity_version);

CREATE TABLE IF NOT EXISTS station_reliability_episodes (
  episode_id BIGSERIAL PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  severity_version TEXT NOT NULL,
  episode_type TEXT NOT NULL,
  episode_start_ts TIMESTAMPTZ NOT NULL,
  episode_end_ts TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  bucket_quality TEXT NOT NULL,
  max_source_as_of_ts TIMESTAMPTZ NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (episode_type IN ('empty', 'full')),
  CHECK (duration_minutes >= 1),
  CHECK (bucket_quality IN ('ok', 'degraded', 'blocked')),
  CHECK (episode_end_ts >= episode_start_ts)
);

CREATE UNIQUE INDEX IF NOT EXISTS station_reliability_episodes_uniq_idx
  ON station_reliability_episodes (
    system_id,
    station_key,
    severity_version,
    episode_type,
    episode_start_ts
  );
CREATE INDEX IF NOT EXISTS station_reliability_episodes_time_idx
  ON station_reliability_episodes (system_id, episode_start_ts DESC, severity_version, episode_type);

CREATE TABLE IF NOT EXISTS reliability_mart_headers (
  day DATE NOT NULL,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  severity_version TEXT NOT NULL,
  stations_count INTEGER NOT NULL,
  total_minutes INTEGER NOT NULL,
  empty_minutes INTEGER NOT NULL,
  full_minutes INTEGER NOT NULL,
  degraded_minutes INTEGER NOT NULL,
  blocked_minutes INTEGER NOT NULL,
  serving_grade_minutes INTEGER NOT NULL,
  episodes_count INTEGER NOT NULL,
  max_source_as_of_ts TIMESTAMPTZ NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (stations_count >= 0),
  CHECK (total_minutes >= 0),
  CHECK (empty_minutes >= 0),
  CHECK (full_minutes >= 0),
  CHECK (degraded_minutes >= 0),
  CHECK (blocked_minutes >= 0),
  CHECK (serving_grade_minutes >= 0),
  CHECK (episodes_count >= 0),
  PRIMARY KEY (day, system_id, severity_version)
);

CREATE INDEX IF NOT EXISTS reliability_mart_headers_system_day_idx
  ON reliability_mart_headers (system_id, day DESC, severity_version);

CREATE OR REPLACE FUNCTION refresh_station_reliability_daily(
  p_system_id TEXT,
  p_from_day DATE,
  p_to_day DATE,
  p_severity_version TEXT DEFAULT 'sev.v1'
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_upserted INTEGER := 0;
BEGIN
  WITH rolled AS (
    SELECT
      DATE_TRUNC('day', s.bucket_ts)::date AS day,
      s.system_id,
      s.station_key,
      p_severity_version AS severity_version,
      COUNT(*)::int AS total_minutes,
      COUNT(*) FILTER (WHERE s.bikes_available = 0)::int AS empty_minutes,
      COUNT(*) FILTER (WHERE s.docks_available = 0)::int AS full_minutes,
      COUNT(*) FILTER (WHERE s.bucket_quality = 'degraded')::int AS degraded_minutes,
      COUNT(*) FILTER (WHERE s.bucket_quality = 'blocked')::int AS blocked_minutes,
      COUNT(*) FILTER (WHERE s.is_serving_grade)::int AS serving_grade_minutes,
      MAX(s.source_as_of_ts) AS max_source_as_of_ts
    FROM station_status_1m s
    WHERE s.system_id = p_system_id
      AND DATE_TRUNC('day', s.bucket_ts)::date >= p_from_day
      AND DATE_TRUNC('day', s.bucket_ts)::date <= p_to_day
    GROUP BY DATE_TRUNC('day', s.bucket_ts)::date, s.system_id, s.station_key
  ),
  upserted AS (
    INSERT INTO station_reliability_daily (
      day,
      system_id,
      station_key,
      severity_version,
      total_minutes,
      empty_minutes,
      full_minutes,
      degraded_minutes,
      blocked_minutes,
      serving_grade_minutes,
      max_source_as_of_ts,
      computed_at
    )
    SELECT
      r.day,
      r.system_id,
      r.station_key,
      r.severity_version,
      r.total_minutes,
      r.empty_minutes,
      r.full_minutes,
      r.degraded_minutes,
      r.blocked_minutes,
      r.serving_grade_minutes,
      r.max_source_as_of_ts,
      NOW()
    FROM rolled r
    ON CONFLICT (day, system_id, station_key, severity_version)
    DO UPDATE SET
      total_minutes = EXCLUDED.total_minutes,
      empty_minutes = EXCLUDED.empty_minutes,
      full_minutes = EXCLUDED.full_minutes,
      degraded_minutes = EXCLUDED.degraded_minutes,
      blocked_minutes = EXCLUDED.blocked_minutes,
      serving_grade_minutes = EXCLUDED.serving_grade_minutes,
      max_source_as_of_ts = EXCLUDED.max_source_as_of_ts,
      computed_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_upserted FROM upserted;

  RETURN v_upserted;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_station_reliability_episodes(
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
  WITH base AS (
    SELECT
      s.system_id,
      s.station_key,
      s.bucket_ts,
      CASE
        WHEN s.bikes_available = 0 THEN 'empty'
        WHEN s.docks_available = 0 THEN 'full'
        ELSE NULL
      END AS episode_type,
      s.bucket_quality,
      s.source_as_of_ts
    FROM station_status_1m s
    WHERE s.system_id = p_system_id
      AND s.bucket_ts >= p_from_ts
      AND s.bucket_ts < p_to_ts
  ),
  tagged AS (
    SELECT
      b.*,
      ROW_NUMBER() OVER (PARTITION BY b.system_id, b.station_key, b.episode_type ORDER BY b.bucket_ts) AS rn1,
      ROW_NUMBER() OVER (PARTITION BY b.system_id, b.station_key ORDER BY b.bucket_ts) AS rn2
    FROM base b
    WHERE b.episode_type IS NOT NULL
  ),
  grouped AS (
    SELECT
      t.system_id,
      t.station_key,
      t.episode_type,
      MIN(t.bucket_ts) AS episode_start_ts,
      MAX(t.bucket_ts) AS episode_end_ts,
      COUNT(*)::int AS duration_minutes,
      CASE
        WHEN BOOL_OR(t.bucket_quality = 'blocked') THEN 'blocked'
        WHEN BOOL_OR(t.bucket_quality = 'degraded') THEN 'degraded'
        ELSE 'ok'
      END AS bucket_quality,
      MAX(t.source_as_of_ts) AS max_source_as_of_ts
    FROM tagged t
    GROUP BY
      t.system_id,
      t.station_key,
      t.episode_type,
      (t.rn2 - t.rn1)
  ),
  upserted AS (
    INSERT INTO station_reliability_episodes (
      system_id,
      station_key,
      severity_version,
      episode_type,
      episode_start_ts,
      episode_end_ts,
      duration_minutes,
      bucket_quality,
      max_source_as_of_ts,
      computed_at
    )
    SELECT
      g.system_id,
      g.station_key,
      p_severity_version,
      g.episode_type,
      g.episode_start_ts,
      g.episode_end_ts,
      g.duration_minutes,
      g.bucket_quality,
      g.max_source_as_of_ts,
      NOW()
    FROM grouped g
    ON CONFLICT (
      system_id,
      station_key,
      severity_version,
      episode_type,
      episode_start_ts
    )
    DO UPDATE SET
      episode_end_ts = EXCLUDED.episode_end_ts,
      duration_minutes = EXCLUDED.duration_minutes,
      bucket_quality = EXCLUDED.bucket_quality,
      max_source_as_of_ts = EXCLUDED.max_source_as_of_ts,
      computed_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_upserted FROM upserted;

  RETURN v_upserted;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_reliability_mart_headers(
  p_system_id TEXT,
  p_from_day DATE,
  p_to_day DATE,
  p_severity_version TEXT DEFAULT 'sev.v1'
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_upserted INTEGER := 0;
BEGIN
  WITH daily AS (
    SELECT
      r.day,
      r.system_id,
      r.severity_version,
      COUNT(DISTINCT r.station_key)::int AS stations_count,
      SUM(r.total_minutes)::int AS total_minutes,
      SUM(r.empty_minutes)::int AS empty_minutes,
      SUM(r.full_minutes)::int AS full_minutes,
      SUM(r.degraded_minutes)::int AS degraded_minutes,
      SUM(r.blocked_minutes)::int AS blocked_minutes,
      SUM(r.serving_grade_minutes)::int AS serving_grade_minutes,
      MAX(r.max_source_as_of_ts) AS max_source_as_of_ts
    FROM station_reliability_daily r
    WHERE r.system_id = p_system_id
      AND r.severity_version = p_severity_version
      AND r.day >= p_from_day
      AND r.day <= p_to_day
    GROUP BY r.day, r.system_id, r.severity_version
  ),
  episodes AS (
    SELECT
      DATE_TRUNC('day', e.episode_start_ts)::date AS day,
      e.system_id,
      e.severity_version,
      COUNT(*)::int AS episodes_count
    FROM station_reliability_episodes e
    WHERE e.system_id = p_system_id
      AND e.severity_version = p_severity_version
      AND DATE_TRUNC('day', e.episode_start_ts)::date >= p_from_day
      AND DATE_TRUNC('day', e.episode_start_ts)::date <= p_to_day
    GROUP BY DATE_TRUNC('day', e.episode_start_ts)::date, e.system_id, e.severity_version
  ),
  upserted AS (
    INSERT INTO reliability_mart_headers (
      day,
      system_id,
      severity_version,
      stations_count,
      total_minutes,
      empty_minutes,
      full_minutes,
      degraded_minutes,
      blocked_minutes,
      serving_grade_minutes,
      episodes_count,
      max_source_as_of_ts,
      computed_at
    )
    SELECT
      d.day,
      d.system_id,
      d.severity_version,
      d.stations_count,
      d.total_minutes,
      d.empty_minutes,
      d.full_minutes,
      d.degraded_minutes,
      d.blocked_minutes,
      d.serving_grade_minutes,
      COALESCE(e.episodes_count, 0) AS episodes_count,
      d.max_source_as_of_ts,
      NOW()
    FROM daily d
    LEFT JOIN episodes e
      ON e.day = d.day
     AND e.system_id = d.system_id
     AND e.severity_version = d.severity_version
    ON CONFLICT (day, system_id, severity_version)
    DO UPDATE SET
      stations_count = EXCLUDED.stations_count,
      total_minutes = EXCLUDED.total_minutes,
      empty_minutes = EXCLUDED.empty_minutes,
      full_minutes = EXCLUDED.full_minutes,
      degraded_minutes = EXCLUDED.degraded_minutes,
      blocked_minutes = EXCLUDED.blocked_minutes,
      serving_grade_minutes = EXCLUDED.serving_grade_minutes,
      episodes_count = EXCLUDED.episodes_count,
      max_source_as_of_ts = EXCLUDED.max_source_as_of_ts,
      computed_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_upserted FROM upserted;

  RETURN v_upserted;
END;
$$;

COMMIT;
