-- nyc-bike-urbanflow-gtk.15: live pressure proxy v2 fields + deterministic heuristics
-- Adds 5m deltas, trailing volatility, and rebalancing-suspected signal.

BEGIN;

ALTER TABLE station_pressure_now_5m
  ADD COLUMN IF NOT EXISTS delta_bikes_5m INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delta_docks_5m INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS volatility_60m DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS rebalancing_suspected BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE station_pressure_now_5m
  DROP CONSTRAINT IF EXISTS station_pressure_now_5m_volatility_60m_check;

ALTER TABLE station_pressure_now_5m
  ADD CONSTRAINT station_pressure_now_5m_volatility_60m_check
  CHECK (volatility_60m >= 0.0);

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
      s.docks_available,
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
      ) AS prev_bikes,
      LAG(b.docks_available) OVER (
        PARTITION BY b.system_id, b.station_key
        ORDER BY b.bucket_ts
      ) AS prev_docks
    FROM buckets b
  ),
  with_deltas AS (
    SELECT
      wp.*,
      COALESCE(wp.bikes_available - wp.prev_bikes, 0) AS delta_bikes_5m,
      COALESCE(wp.docks_available - wp.prev_docks, 0) AS delta_docks_5m
    FROM with_prev wp
  ),
  with_volatility AS (
    SELECT
      wd.*,
      COALESCE(
        STDDEV_SAMP(wd.delta_bikes_5m::DOUBLE PRECISION) OVER (
          PARTITION BY wd.system_id, wd.station_key
          ORDER BY wd.bucket_ts
          ROWS BETWEEN 11 PRECEDING AND CURRENT ROW
        ),
        0.0
      ) AS volatility_60m
    FROM with_deltas wd
  ),
  scored AS (
    SELECT
      wv.system_id,
      wv.station_key,
      wv.bucket_ts,
      CASE
        WHEN wv.capacity IS NULL OR wv.capacity <= 0 THEN 0.0
        ELSE LEAST(
          1.0,
          (
            (0.7 * ABS(wv.delta_bikes_5m)::DOUBLE PRECISION / wv.capacity::DOUBLE PRECISION) +
            (0.3 * LEAST(1.0, wv.volatility_60m / GREATEST(wv.capacity::DOUBLE PRECISION * 0.2, 1.0)))
          )
        )
      END AS pressure_score,
      wv.delta_bikes_5m,
      wv.delta_docks_5m,
      wv.volatility_60m,
      (
        wv.delta_bikes_5m >= 8
        AND EXTRACT(HOUR FROM (wv.bucket_ts AT TIME ZONE 'UTC')) BETWEEN 1 AND 5
      ) AS rebalancing_suspected,
      p_proxy_method AS proxy_method,
      wv.bucket_quality,
      wv.is_serving_grade,
      wv.source_as_of_ts
    FROM with_volatility wv
  ),
  upserted AS (
    INSERT INTO station_pressure_now_5m (
      system_id,
      station_key,
      bucket_ts,
      pressure_score,
      proxy_method,
      delta_bikes_5m,
      delta_docks_5m,
      volatility_60m,
      rebalancing_suspected,
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
      s.delta_bikes_5m,
      s.delta_docks_5m,
      s.volatility_60m,
      s.rebalancing_suspected,
      s.bucket_quality,
      s.is_serving_grade,
      s.source_as_of_ts
    FROM scored s
    ON CONFLICT (system_id, station_key, bucket_ts, proxy_method)
    DO UPDATE SET
      pressure_score = EXCLUDED.pressure_score,
      delta_bikes_5m = EXCLUDED.delta_bikes_5m,
      delta_docks_5m = EXCLUDED.delta_docks_5m,
      volatility_60m = EXCLUDED.volatility_60m,
      rebalancing_suspected = EXCLUDED.rebalancing_suspected,
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

COMMIT;
