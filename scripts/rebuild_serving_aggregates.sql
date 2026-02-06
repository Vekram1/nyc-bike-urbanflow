-- Rebuild serving aggregates for a bounded range.
-- Update params before execution.

BEGIN;

WITH params AS (
  SELECT
    'citibike-nyc'::text AS system_id,
    TIMESTAMPTZ '2026-02-01 00:00:00+00' AS from_ts,
    TIMESTAMPTZ '2026-02-07 00:00:00+00' AS to_ts,
    'sev.v1'::text AS severity_version,
    'delta_cap.v1'::text AS pressure_proxy_method
)
SELECT refresh_station_status_1m(system_id, from_ts, to_ts)
FROM params;

WITH params AS (
  SELECT
    'citibike-nyc'::text AS system_id,
    TIMESTAMPTZ '2026-02-01 00:00:00+00' AS from_ts,
    TIMESTAMPTZ '2026-02-07 00:00:00+00' AS to_ts,
    'sev.v1'::text AS severity_version
)
SELECT refresh_station_severity_5m(system_id, from_ts, to_ts, severity_version)
FROM params;

WITH params AS (
  SELECT
    'citibike-nyc'::text AS system_id,
    TIMESTAMPTZ '2026-02-01 00:00:00+00' AS from_ts,
    TIMESTAMPTZ '2026-02-07 00:00:00+00' AS to_ts,
    'delta_cap.v1'::text AS pressure_proxy_method
)
SELECT refresh_station_pressure_now_5m(system_id, from_ts, to_ts, pressure_proxy_method)
FROM params;

COMMIT;
