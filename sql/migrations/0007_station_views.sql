-- nyc-bike-urbanflow-gtk.19: stations_current + station_now views

BEGIN;

CREATE OR REPLACE VIEW stations_current AS
SELECT
  s.system_id,
  s.station_key,
  s.station_id,
  s.name,
  s.short_name,
  s.region_id,
  s.lat,
  s.lon,
  s.capacity,
  s.is_active,
  l.lifecycle_status,
  l.first_seen_at,
  l.last_seen_at,
  l.last_active_at
FROM stations_scd s
LEFT JOIN station_lifecycle l
  ON l.system_id = s.system_id AND l.station_key = s.station_key
WHERE s.valid_to IS NULL;

CREATE OR REPLACE VIEW station_now AS
SELECT DISTINCT ON (system_id, station_key)
  system_id,
  station_key,
  station_id,
  bikes_available,
  docks_available,
  is_installed,
  is_renting,
  is_returning,
  observation_ts,
  bucket_quality,
  is_serving_grade
FROM snapshot_station_status
ORDER BY system_id, station_key, observation_ts DESC;

COMMIT;
