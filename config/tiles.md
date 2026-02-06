# Composite Tiles (tile.v1)

Bead: `nyc-bike-urbanflow-dy7`

## Immutable cache key dimensions

Composite tile URLs are immutable identifiers of response semantics:
- path: `/api/tiles/composite/{z}/{x}/{y}.mvt`
- query:
  - `sv` (required)
  - `tile_schema` (required, allowlisted)
  - `severity_version` (required, allowlisted)
  - `layers` (required, allowlisted as canonical sorted CSV)
  - `T_bucket` (required epoch seconds)
  - `v=1` (optional fixed API version)

Unknown query params return `400` with `Cache-Control: no-store`.

## Canonical SQL + deterministic output

- SQL shape is fixed in `packages/api/src/tiles/composite.ts` via `buildCompositeTileSql`.
- Spatial filter is fixed to `ST_TileEnvelope(z, x, y)` with station points transformed to EPSG:3857.
- Feature order is deterministic by `station_key ASC`.
- Layer composition is stable (`inv`, `sev`, `press`, `epi`) and toggled only by allowlisted `layers`.

## Hard caps and degrade behavior

- `max_features_per_tile` cap is applied in SQL (`LIMIT` over deterministic order).
- `max_bytes_per_tile` is enforced after MVT generation:
  1. primary render includes optional properties
  2. if oversized, rerender without optional properties
  3. if still oversized, return `429 tile_overloaded` + `Retry-After`

Dropped optional properties under degrade level 1:
- `inv.flags`
- `sev.severity_components_compact`
- `press.pressure_components_compact`
- `epi.episode_duration_s`
