# Backend Operator Guide

This backend ships with a checked-in standalone Bun API server bootstrap:
- `packages/api/src/server.ts`

That entrypoint wires `createControlPlaneHandler(...)` to DB-backed stores for:
- serving-view token mint/verify
- allowlist validation
- control-plane endpoints
- stations/timeline/search reads
- composite/policy/episodes MVT tiles
- policy read + async queue

## What the backend supports today

- Serving-view tokens (`sv`) for reproducible live/replay requests.
- Control plane endpoints:
  - `/api/time`
  - `/api/config`
  - `/api/timeline`, `/api/timeline/density`
  - `/api/search`
  - `/api/stations/*`
  - `/api/policy/*`
- Data plane tile endpoints:
  - `/api/tiles/composite/{z}/{x}/{y}.mvt`
  - `/api/tiles/policy_moves/{z}/{x}/{y}.mvt`
  - `/api/tiles/episodes/{z}/{x}/{y}.mvt`
- Allowlist-bounded keyspace (`system_id`, schema/version/layers/compare dimensions).
- Replay-vs-live tile cache policy based on `sv` TTL.
- Reliability episodes and `episode_markers_15m` support.
- Pressure proxy v2 fields:
  - `delta_bikes_5m`
  - `delta_docks_5m`
  - `volatility_60m`
  - `rebalancing_suspected`

## Required infra/services

- Postgres + PostGIS with migrations applied (`sql/migrations/*.sql`).
- Ingest poller process for historical/raw collection:
  - `bun packages/ingest/src/cli.ts --system citibike-nyc --poll`
- API server process:
  - `bun packages/api/src/server.ts`

## API bootstrap env

Required:
- `DATABASE_URL`: Postgres connection string.

Required for production token verification:
- `SV_KEY_MATERIAL_JSON`: JSON object mapping key ids to secret strings.
  Example: `{"k1":"replace-with-secret"}`

Optional with defaults:
- `API_HOST` default `0.0.0.0`
- `API_PORT` default `3000`
- `SYSTEM_ID` default `citibike-nyc`
- `SV_VIEW_VERSION` default `sv.v1`
- `SV_TTL_SECONDS` default `1200`
- `SV_CLOCK_SKEW_SECONDS` default `30`
- `TILE_SCHEMA_VERSION` default `tile.v1`
- `SEVERITY_VERSION` default `sev.v1`
- `SEVERITY_SPEC_SHA256` default `sev.v1.default`
- `REQUIRED_DATASETS` default `gbfs.station_status`
- `OPTIONAL_DATASETS` default `gbfs.station_information`
- `TIMELINE_BUCKET_SECONDS` default `300`
- `TILE_MAX_FEATURES` default `1500`
- `TILE_MAX_BYTES` default `200000`
- `TILE_LIVE_MAX_AGE_S` default `30`
- `TILE_LIVE_S_MAXAGE_S` default `120`
- `TILE_LIVE_SWR_S` default `15`
- `TILE_REPLAY_MIN_TTL_S` default `86400`
- `TILE_REPLAY_MAX_AGE_S` default `600`
- `TILE_REPLAY_S_MAXAGE_S` default `3600`
- `TILE_REPLAY_SWR_S` default `60`
- `POLICY_RETRY_AFTER_MS` default `2000`
- `POLICY_DEFAULT_VERSION` default `rebal.greedy.v1`
- `POLICY_AVAILABLE_VERSIONS` default `rebal.greedy.v1`
- `POLICY_DEFAULT_HORIZON_STEPS` default `0`
- `POLICY_MAX_MOVES` default `80`
- `POLICY_BUDGET_PRESETS_JSON` default `[]`
- `NETWORK_DEGRADE_LEVEL` default unset (when set to `0..3`, overrides `/api/time.network.degrade_level`)
- `REPLAY_TILE_CACHE_DIR` default unset (when set, enables replay tile write-through cache on local disk)

## Running the API

Minimal local start:

```bash
export DATABASE_URL='postgres://...'
export SV_KEY_MATERIAL_JSON='{"k1":"dev-secret"}'
bun packages/api/src/server.ts
```

Health check examples:

```bash
curl 'http://127.0.0.1:3000/api/time?system_id=citibike-nyc&tile_schema=tile.v1&severity_version=sev.v1'
```

## DB setup and refresh

Apply migrations in order:
- `sql/migrations/0003_namespace_allowlist.sql`
- ...
- `sql/migrations/0017_allowlist_seed_defaults.sql`

Refresh serving aggregates (bounded window):
- `scripts/rebuild_serving_aggregates.sql`

Refresh reliability marts/episodes (bounded window):
- `scripts/rebuild_reliability_marts.sql`

## Operator checklist (minimum)

1. Ensure ingest poller is running and writing new snapshots.
2. Run/monitor serving aggregate refresh jobs.
3. Run/monitor reliability mart refresh jobs.
4. Ensure allowlist entries are present/enabled (seeded defaults + your system-specific values).
5. Verify `/api/time` issues valid `sv` and downstream routes accept it.
6. Verify tile routes return cache headers expected for live vs replay tokens.

## Validation commands

Run backend-focused tests:
- `bun test packages/api/src/http/control-plane.e2e.test.ts`
- `bun test packages/api/src/http/tiles.test.ts`
- `bun test packages/api/src/serving-views/lfj.e2e.test.ts`

Run targeted suites as needed:
- `bun test packages/api/src/sv/service.test.ts`
- `bun test packages/api/src/tiles/composite.test.ts`
- `bun test packages/api/src/http/episodes-tiles.test.ts`
