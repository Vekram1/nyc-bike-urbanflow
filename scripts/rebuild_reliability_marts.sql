-- Rebuild reliability marts and episode rollups for a bounded time window.
-- Usage example:
--   psql "$DATABASE_URL" -v system_id='citibike-nyc' -v from_day='2026-02-01' -v to_day='2026-02-07' -f scripts/rebuild_reliability_marts.sql

\set ON_ERROR_STOP on

BEGIN;

SELECT refresh_station_reliability_daily(
  :'system_id',
  :'from_day'::date,
  :'to_day'::date,
  'sev.v1'
) AS daily_rows_upserted;

SELECT refresh_station_reliability_episodes(
  :'system_id',
  :'from_day'::date::timestamptz,
  (:'to_day'::date + INTERVAL '1 day')::timestamptz,
  'sev.v1'
) AS episodes_rows_upserted;

SELECT refresh_episode_markers_15m(
  :'system_id',
  :'from_day'::date::timestamptz,
  (:'to_day'::date + INTERVAL '1 day')::timestamptz,
  'sev.v1'
) AS episode_markers_rows_upserted;

SELECT refresh_reliability_mart_headers(
  :'system_id',
  :'from_day'::date,
  :'to_day'::date,
  'sev.v1'
) AS header_rows_upserted;

COMMIT;
