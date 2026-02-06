# Station neighbors index

Purpose: precompute deterministic neighbor sets for policy runtime to keep
per-decision work bounded and reproducible.

## Rebuild cadence
- Rebuild whenever `stations_current` changes materially:
  - station adds/removals
  - station lat/lon changes
  - station active/inactive state changes
- Otherwise, rebuild on a scheduled cadence (e.g., weekly) to keep `built_at`
  fresh and avoid drift.

## Build inputs
- Source: `stations_current`
- Filter: `is_active = true`

## Determinism rules
- Distance metric: `ST_DistanceSphere` (meters)
- Ranking: `ORDER BY dist_m ASC, neighbor_key ASC`
- Limit: `rank <= max_neighbors`
- Radius: `dist_m <= neighbor_radius_m`

These rules are encoded in `scripts/rebuild_station_neighbors.sql`.

## Indexing notes
- `station_neighbors` has a primary key on `(system_id, station_key, neighbor_key)`.
- A unique index on `(system_id, station_key, rank)` enforces stable rank slots.
- No spatial index is required for the neighbor table itself.
- The rebuild step currently performs a full pairwise join of active stations,
  which is acceptable for Profile A. If rebuild cost becomes a concern,
  consider adding a generated geography column + GiST index or moving to a
  worker in Profile B.
