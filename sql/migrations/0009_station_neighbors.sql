-- nyc-bike-urbanflow-i6o: deterministic station_neighbors index for policy runtime

BEGIN;

CREATE TABLE IF NOT EXISTS station_neighbors (
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  station_key TEXT NOT NULL,
  neighbor_key TEXT NOT NULL,
  dist_m DOUBLE PRECISION NOT NULL,
  rank INTEGER NOT NULL,
  built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (station_key <> neighbor_key),
  CHECK (dist_m >= 0),
  CHECK (rank > 0),
  PRIMARY KEY (system_id, station_key, neighbor_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS station_neighbors_rank_idx
  ON station_neighbors (system_id, station_key, rank);

CREATE INDEX IF NOT EXISTS station_neighbors_lookup_idx
  ON station_neighbors (system_id, station_key);

COMMIT;
