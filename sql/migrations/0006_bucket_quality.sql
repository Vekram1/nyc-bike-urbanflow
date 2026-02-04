-- nyc-bike-urbanflow-2zn.1: bucket_quality and serving-grade metadata

BEGIN;

ALTER TABLE snapshot_station_status
  ADD COLUMN bucket_quality TEXT NOT NULL DEFAULT 'ok';

ALTER TABLE snapshot_station_status
  ADD CONSTRAINT snapshot_station_status_bucket_quality_check
  CHECK (bucket_quality IN ('ok', 'degraded', 'blocked'));

COMMIT;
