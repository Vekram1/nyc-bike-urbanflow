-- nyc-bike-urbanflow-gtk.11: ingest health metrics views

BEGIN;

CREATE OR REPLACE VIEW ingest_health_15m AS
SELECT
  system_id,
  feed_name,
  date_trunc('hour', collected_at)
    + (floor(extract(minute from collected_at) / 15) * interval '15 minutes')
    AS bucket_start,
  COUNT(*) AS snapshots_total,
  COUNT(DISTINCT publisher_last_updated) AS snapshots_distinct,
  (COUNT(*) - COUNT(DISTINCT publisher_last_updated)) AS duplicates,
  MAX(collected_at) AS last_collected_at,
  MAX(publisher_last_updated) AS last_publisher_last_updated,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (collected_at - publisher_last_updated)))
    AS median_ingest_lag_seconds,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (collected_at - publisher_last_updated)))
    AS p95_ingest_lag_seconds
FROM logical_snapshots
GROUP BY system_id, feed_name, bucket_start;

CREATE OR REPLACE VIEW ingest_health_daily AS
SELECT
  system_id,
  feed_name,
  date_trunc('day', collected_at) AS day_start,
  COUNT(*) AS snapshots_total,
  COUNT(DISTINCT publisher_last_updated) AS snapshots_distinct,
  (COUNT(*) - COUNT(DISTINCT publisher_last_updated)) AS duplicates,
  MAX(collected_at) AS last_collected_at,
  MAX(publisher_last_updated) AS last_publisher_last_updated,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (collected_at - publisher_last_updated)))
    AS median_ingest_lag_seconds,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (collected_at - publisher_last_updated)))
    AS p95_ingest_lag_seconds
FROM logical_snapshots
GROUP BY system_id, feed_name, day_start;

COMMIT;
