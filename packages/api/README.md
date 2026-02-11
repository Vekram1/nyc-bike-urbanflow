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
  - `/api/stations/{station_key}/drawer`
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

## Retention policy (hot window + size cap)

Keep data light with a retention run from ingest CLI:

```bash
# Dry-run (default): reports what would be pruned
bun packages/ingest/src/cli.ts \
  --system citibike-nyc \
  --prune \
  --retention-days 30 \
  --max-archive-gb 10
```

```bash
# Apply pruning (destructive): only run intentionally
bun packages/ingest/src/cli.ts \
  --system citibike-nyc \
  --prune \
  --retention-days 30 \
  --max-archive-gb 10 \
  --apply
```

Behavior:
- DB hot-window prune (system-scoped):
  - `station_status_1m`
  - `station_severity_5m`
  - `station_pressure_now_5m`
  - `episode_markers_15m`
  - `logical_snapshots`
  - `raw_manifests`
  - `fetch_attempts`
- Archive prune (`data/gbfs`):
  - removes files older than `retention-days`
  - then trims oldest files until total size is under `max-archive-gb`

Safety flags:
- Default is dry-run unless `--apply` is provided.
- `--no-prune-db` to only prune archive files.
- `--no-prune-archive` to only prune DB rows.

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
- `TILE_COMPARE_MAX_WINDOW_S` default `604800` (7 days; max absolute `|T_bucket - T2_bucket|` for compare requests)
- `POLICY_RETRY_AFTER_MS` default `2000`
- `POLICY_PENDING_TIMEOUT_MS` default `15000` (return `policy_worker_unavailable` if same run key stays queued too long)
- `POLICY_DEFAULT_VERSION` default `rebal.greedy.v1`
- `POLICY_AVAILABLE_VERSIONS` default `rebal.greedy.v1,rebal.global.v1`
- `POLICY_DEFAULT_HORIZON_STEPS` default `0`
- `POLICY_MAX_MOVES` default `240`
- `POLICY_MAX_MOVES_PER_RUN` default `240` (worker-side move cap)
- `POLICY_BIKE_MOVE_BUDGET_PER_STEP` default `240` (worker-side bike budget per run)
- `POLICY_MAX_STATIONS_TOUCHED` default `200` (worker-side station-touch cap)
- `POLICY_MAX_NEIGHBORS` default `12` (worker-side neighbor fanout)
- `POLICY_NEIGHBOR_RADIUS_M` default `4000` (worker-side neighbor radius)
- `POLICY_TARGET_ALPHA` default `0.45` (lower occupancy target bound)
- `POLICY_TARGET_BETA` default `0.55` (upper occupancy target bound)
- `POLICY_WORKER_CLAIM_ERROR_BACKOFF_MS` default `2000` (worker retry delay after queue claim/database errors)
- `POLICY_BUDGET_PRESETS_JSON` default `[]`
- `NETWORK_DEGRADE_LEVEL` default unset (when set to `0..3`, overrides `/api/time.network.degrade_level`)
- `REPLAY_TILE_CACHE_DIR` default unset (when set, enables replay tile write-through cache on local disk)
- `ADMIN_TOKEN` default unset (required to enable admin endpoints)
- `ADMIN_ALLOWED_ORIGINS` default empty (comma-separated strict CORS allowlist for admin APIs)

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

Compare-mode composite tile examples:

```bash
# Baseline (single timestamp)
curl 'http://127.0.0.1:3000/api/tiles/composite/12/1200/1530.mvt?sv=<sv>&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev,press&T_bucket=1738872000&compare_mode=off'

# Delta (T1 - T2) within bounded compare window
curl 'http://127.0.0.1:3000/api/tiles/composite/12/1200/1530.mvt?sv=<sv>&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev,press&T_bucket=1738872000&T2_bucket=1738871700&compare_mode=delta'

# Split (secondary snapshot at T2 for dual-map UI)
curl 'http://127.0.0.1:3000/api/tiles/composite/12/1200/1530.mvt?sv=<sv>&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev,press&T_bucket=1738872000&T2_bucket=1738871700&compare_mode=split'
```

Station drawer evidence bundle example:

```bash
curl 'http://127.0.0.1:3000/api/stations/STA-001/drawer?v=1&sv=<sv>&T_bucket=1738872000&range=6h&severity_version=sev.v1&tile_schema=tile.v1'
```

Drawer endpoint bounds:
- default `range=6h`, max `48h`
- max series points `360` (server-decimated)
- max episode markers `50`

Admin ops examples:

```bash
export ADMIN_TOKEN='replace-me'
export ADMIN_ALLOWED_ORIGINS='https://ops.example.com'
curl -H "X-Admin-Token: $ADMIN_TOKEN" 'http://127.0.0.1:3000/api/pipeline_state?v=1'
curl -H "X-Admin-Token: $ADMIN_TOKEN" 'http://127.0.0.1:3000/api/admin/dlq?v=1&limit=20'
curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"dlq_id":1,"resolution_note":"investigated"}' \
  'http://127.0.0.1:3000/api/admin/dlq/resolve?v=1'
```

## DB setup and refresh

Apply migrations in order:
- `sql/migrations/0003_namespace_allowlist.sql`
- ...
- `sql/migrations/0017_allowlist_seed_defaults.sql`
- `sql/migrations/0018_job_dlq_resolution.sql`
- `sql/migrations/0019_allowlist_seed_global_policy.sql`

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
