-- nyc-bike-urbanflow-gtk.13: episode marker buckets for overlay tiles
-- Expand contiguous episodes into 15-minute marker buckets for deterministic tile lookup.

BEGIN;

CREATE TABLE IF NOT EXISTS episode_markers_15m (
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  severity_version TEXT NOT NULL,
  bucket_ts TIMESTAMPTZ NOT NULL,
  episode_type TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  bucket_quality TEXT NOT NULL,
  episode_start_ts TIMESTAMPTZ NOT NULL,
  episode_end_ts TIMESTAMPTZ NOT NULL,
  max_source_as_of_ts TIMESTAMPTZ NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (episode_type IN ('empty', 'full')),
  CHECK (duration_minutes >= 1),
  CHECK (bucket_quality IN ('ok', 'degraded', 'blocked')),
  CHECK (episode_end_ts >= episode_start_ts),
  PRIMARY KEY (system_id, station_key, severity_version, bucket_ts, episode_type)
);

CREATE INDEX IF NOT EXISTS episode_markers_15m_bucket_idx
  ON episode_markers_15m (system_id, bucket_ts DESC, severity_version, episode_type);

CREATE OR REPLACE FUNCTION refresh_episode_markers_15m(
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
  WITH expanded AS (
    SELECT
      e.system_id,
      e.station_key,
      e.severity_version,
      gs.bucket_ts,
      e.episode_type,
      e.duration_minutes,
      e.bucket_quality,
      e.episode_start_ts,
      e.episode_end_ts,
      e.max_source_as_of_ts
    FROM station_reliability_episodes e
    CROSS JOIN LATERAL (
      SELECT generate_series(
        date_bin('15 minutes', e.episode_start_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00'),
        date_bin('15 minutes', e.episode_end_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00'),
        INTERVAL '15 minutes'
      ) AS bucket_ts
    ) gs
    WHERE e.system_id = p_system_id
      AND e.severity_version = p_severity_version
      AND gs.bucket_ts >= date_bin('15 minutes', p_from_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
      AND gs.bucket_ts < date_bin('15 minutes', p_to_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
  ),
  upserted AS (
    INSERT INTO episode_markers_15m (
      system_id,
      station_key,
      severity_version,
      bucket_ts,
      episode_type,
      duration_minutes,
      bucket_quality,
      episode_start_ts,
      episode_end_ts,
      max_source_as_of_ts,
      computed_at
    )
    SELECT
      x.system_id,
      x.station_key,
      x.severity_version,
      x.bucket_ts,
      x.episode_type,
      x.duration_minutes,
      x.bucket_quality,
      x.episode_start_ts,
      x.episode_end_ts,
      x.max_source_as_of_ts,
      NOW()
    FROM expanded x
    ON CONFLICT (system_id, station_key, severity_version, bucket_ts, episode_type)
    DO UPDATE SET
      duration_minutes = EXCLUDED.duration_minutes,
      bucket_quality = EXCLUDED.bucket_quality,
      episode_start_ts = EXCLUDED.episode_start_ts,
      episode_end_ts = EXCLUDED.episode_end_ts,
      max_source_as_of_ts = EXCLUDED.max_source_as_of_ts,
      computed_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_upserted FROM upserted;

  RETURN v_upserted;
END;
$$;

COMMIT;
