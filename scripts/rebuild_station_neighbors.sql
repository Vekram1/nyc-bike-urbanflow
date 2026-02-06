-- Rebuild station_neighbors deterministically from stations_current.
-- NOTE: Running this script deletes existing station_neighbors rows.
-- Requires PostGIS for ST_DistanceSphere.

BEGIN;

-- Parameters: update these constants to match policy defaults.
WITH params AS (
  SELECT
    1200.0::double precision AS neighbor_radius_m,
    25::integer AS max_neighbors
),
active_stations AS (
  SELECT
    system_id,
    station_key,
    lat,
    lon
  FROM stations_current
  WHERE is_active = TRUE
),
pairs AS (
  SELECT
    a.system_id,
    a.station_key AS station_key,
    b.station_key AS neighbor_key,
    ST_DistanceSphere(
      ST_MakePoint(a.lon, a.lat),
      ST_MakePoint(b.lon, b.lat)
    ) AS dist_m
  FROM active_stations a
  JOIN active_stations b
    ON a.system_id = b.system_id
   AND a.station_key <> b.station_key
),
ranked AS (
  SELECT
    pairs.system_id,
    pairs.station_key,
    pairs.neighbor_key,
    pairs.dist_m,
    ROW_NUMBER() OVER (
      PARTITION BY pairs.system_id, pairs.station_key
      ORDER BY pairs.dist_m ASC, pairs.neighbor_key ASC
    ) AS rank
  FROM pairs
  CROSS JOIN params
  WHERE pairs.dist_m <= params.neighbor_radius_m
)
DELETE FROM station_neighbors;

INSERT INTO station_neighbors (system_id, station_key, neighbor_key, dist_m, rank)
SELECT
  ranked.system_id,
  ranked.station_key,
  ranked.neighbor_key,
  ranked.dist_m,
  ranked.rank
FROM ranked
CROSS JOIN params
WHERE ranked.rank <= params.max_neighbors
ORDER BY ranked.system_id, ranked.station_key, ranked.rank;

COMMIT;
