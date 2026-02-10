# UrbanFlow Twin

UrbanFlow Twin is a tiles-first bike-system digital twin for NYC Citi Bike.
Status: early dev. Expect breaking schema/contract changes until versioned releases are tagged.

This repository is for:
- Developers extending the ingest/API/web stack.
- Researchers and practitioners evaluating optimization policies on reproducible replay data.

Current optimization support:
- Implemented: `rebal.greedy.v1` (Greedy policy).
- Planned direction: a plug-and-play policy toolbox so additional algorithms can run against the same data/control interfaces.

## What Is In This Repo

- `apps/web`: Next.js frontend (HUD + map + inspect + replay controls).
- `packages/api`: Bun API server (control plane, stations, tiles, policy routes).
- `packages/ingest`: GBFS ingestion CLI/poller.
- `packages/policy`: Policy logic package (currently Greedy v1 focus).
- `packages/shared`: Shared types/utilities.
- `sql/`: Migrations.
- `scripts/`: SQL/scripts for rebuild/ops tasks.
- `PLAN.md`: product/architecture contract and invariants.
- `AGENTS.md`: execution protocol for coding agents.

## Two Ways To Run

Pick the workflow that matches your immediate goal.

### A) Live View (fastest dev loop)
- Goal: render real stations and bikes/docks quickly.
- Requires: DB + API + ingest loop (current stack is DB-backed).
- Result: map dots and Tier1 inspect from live data.

### B) Replay And Evaluation (contract-first)
- Goal: reproducible replay, policy runs, episodes, reliability marts.
- Requires: everything in (A), plus refresh/rebuild jobs and retention tuning.

## Prerequisites

- Bun `>=1.3`
- PostgreSQL with PostGIS
- Mapbox token for frontend map rendering (`NEXT_PUBLIC_MAPBOX_TOKEN`)
- Docker (recommended for local DB)

## Ports

Default local ports:
- API: `3000`
- Web: `3001` (set `PORT=3001` if your machine prefers `3000`)

## Docker DB Quickstart (PostGIS)

If you want to run today without cloud setup, this is the fastest path.

Start Postgres + PostGIS in Docker:

```bash
docker run -d \
  --name urbanflow-postgis \
  -e POSTGRES_USER=urbanflow \
  -e POSTGRES_PASSWORD=urbanflow \
  -e POSTGRES_DB=urbanflow \
  -p 5432:5432 \
  -v urbanflow-pgdata:/var/lib/postgresql/data \
  postgis/postgis:16-3.4
```

Set DB URL:

```bash
export DATABASE_URL='postgres://urbanflow:urbanflow@127.0.0.1:5432/urbanflow'
```

If `psql` is missing on macOS:

```bash
brew install libpq
brew link --force libpq
```

Sanity check PostGIS:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT PostGIS_Version();"
```

Optional `docker compose` equivalent:

```yaml
services:
  postgis:
    image: postgis/postgis:16-3.4
    container_name: urbanflow-postgis
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: urbanflow
      POSTGRES_PASSWORD: urbanflow
      POSTGRES_DB: urbanflow
    volumes:
      - urbanflow-pgdata:/var/lib/postgresql/data

volumes:
  urbanflow-pgdata:
```

Tip: save this as `docker-compose.yml` so contributors can use `docker compose up -d` and `docker compose down`.

Apply all migrations in order:

```bash
for f in sql/migrations/*.sql; do
  echo "Applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

Seed `systems` row (required by FK constraints before ingest):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO systems (
  system_id,
  gbfs_entrypoint_url,
  default_map_bounds,
  default_center,
  timezone,
  provider_name,
  provider_region
)
VALUES (
  'citibike-nyc',
  'https://gbfs.citibikenyc.com/gbfs/gbfs.json',
  ARRAY[-74.25909, 40.477399, -73.700272, 40.917577]::double precision[],
  ARRAY[-73.98513, 40.758896]::double precision[],
  'America/New_York',
  'Citi Bike',
  'NYC'
)
ON CONFLICT (system_id) DO UPDATE SET
  gbfs_entrypoint_url = EXCLUDED.gbfs_entrypoint_url,
  default_map_bounds = EXCLUDED.default_map_bounds,
  default_center = EXCLUDED.default_center,
  timezone = EXCLUDED.timezone,
  provider_name = EXCLUDED.provider_name,
  provider_region = EXCLUDED.provider_region,
  updated_at = NOW();
SQL
```

## Install

From repo root:

```bash
bun install
```

## Environment

Create `.env.local` files from examples:

```bash
cp .env.example .env.local
cp apps/web/.env.example apps/web/.env.local
cp packages/api/.env.example packages/api/.env.local
```

### DATABASE_URL quick reference

`DATABASE_URL` points to whichever Postgres instance you are using.

Common values:
- Local Docker: `postgres://urbanflow:urbanflow@127.0.0.1:5432/urbanflow`
- Hosted Postgres: provider DSN (PostGIS must be enabled)

Quick connectivity check:

```bash
psql "$DATABASE_URL" -c "select current_database(), inet_server_addr(), inet_server_port();"
```

### Backend (`packages/api`)

Minimum required:

```bash
export DATABASE_URL='postgres://...'
export SV_KEY_MATERIAL_JSON='{"k1":"dev-secret"}'
```

Common optional vars:
- `API_HOST` (default `0.0.0.0`)
- `API_PORT` (default `3000`)
- `SYSTEM_ID` (default `citibike-nyc`)
- `ADMIN_TOKEN` for admin endpoints

Security note:
- `SV_KEY_MATERIAL_JSON` signs/verifies `sv` serving-view tokens.
- Use strong random secrets for shared environments and rotate keys.

See `packages/api/README.md` for the full backend env surface.

### Frontend (`apps/web`)

Recommended:

```bash
export NEXT_PUBLIC_MAPBOX_TOKEN='...'
export URBANFLOW_API_ORIGIN='http://127.0.0.1:3000'
export SYSTEM_ID='citibike-nyc'
export NEXT_PUBLIC_SYSTEM_ID='citibike-nyc'
```

Env naming notes:
- Query params to API should always use `system_id`.
- `NEXT_PUBLIC_SYSTEM_ID` is consumed by browser-side control-plane helpers.
- `SYSTEM_ID` is consumed by Next API proxy routes in `apps/web/src/app/api/*`.
- Set both to the same value to avoid split behavior.

## Run The Stack

## Dev Scripts

Use the `scripts/dev` helpers to reduce manual setup.

```bash
scripts/dev/setup.sh         # deps + db + migrations + system seed
scripts/dev/start-api.sh     # bun API server
scripts/dev/start-web.sh     # Next web app
scripts/dev/start-ingest.sh  # poll + load-db + refresh-serving
scripts/dev/smoke.sh         # deterministic smoke (API + ingest + optional web)
scripts/dev/up.sh            # tmux launcher for all of the above
```

## Quickstart: Fastest Visual Win (dots + inspect)

This is the fastest path to see real station dots and click-through inventory.

1. Start Docker PostGIS and apply migrations.
2. Start backend API (`bun packages/api/src/server.ts`).
3. Start frontend (`bun run dev:web`).
4. Start ingest with DB load (`bun packages/ingest/src/cli.ts --system citibike-nyc --poll --load-db --refresh-serving`).
5. Open `http://localhost:3001` and confirm:
   - stations render as dots
   - clicking a station opens Tier1 inventory

Note:
- A true no-DB mode is not part of the current stack.
- Current live dots are fetched through `/api/gbfs/stations` (web proxy), backed by API control-plane + stations data.
- Contract target remains tiles-first (`/api/tiles/*`) for production replay/cache behavior.

### 1) Start backend API

From repo root:

```bash
bun packages/api/src/server.ts
```

Health check:

```bash
curl -sS 'http://127.0.0.1:3000/api/time?v=1&system_id=citibike-nyc&tile_schema=tile.v1&severity_version=sev.v1' | head
```

### 2) Start frontend

From repo root:

```bash
bun run dev:web
```

Equivalent:

```bash
bun --bun --cwd apps/web run dev
```

If local port selection collides:

```bash
PORT=3001 bun --bun --cwd apps/web run dev
```

### 3) (Optional) Start GBFS poller

From repo root:

```bash
bun packages/ingest/src/cli.ts --system citibike-nyc --poll
```

### 4) DB-backed polling/load workflow (recommended for replay)

`packages/ingest/src/cli.ts` now supports loading manifests into Postgres.

Load all existing manifests from `data/gbfs`:

```bash
export DATABASE_URL='postgres://...'
bun packages/ingest/src/cli.ts --system citibike-nyc --load
```

Collect once, then load that batch to DB:

```bash
export DATABASE_URL='postgres://...'
bun packages/ingest/src/cli.ts --system citibike-nyc --load-db
```

Continuous polling with per-cycle DB load:

```bash
export DATABASE_URL='postgres://...'
bun packages/ingest/src/cli.ts --system citibike-nyc --poll --load-db
```

Continuous polling with per-cycle DB load + serving refresh:

```bash
export DATABASE_URL='postgres://...'
bun packages/ingest/src/cli.ts --system citibike-nyc --poll --load-db --refresh-serving
```

Ingest sanity check:

```bash
psql "$DATABASE_URL" -c "select count(*) from logical_snapshots;"
```

Optional refresh tuning flags:
- `--refresh-lookback-minutes <N>` (default `180`)
- `--severity-version <version>` (default `sev.v1`)
- `--pressure-proxy-method <method>` (default `delta_cap.v1`)

### 5) Retention workflow (keep storage light)

Dry-run retention (safe default):

```bash
bun packages/ingest/src/cli.ts --system citibike-nyc --prune --retention-days 30 --max-archive-gb 10
```

Apply retention:

```bash
bun packages/ingest/src/cli.ts --system citibike-nyc --prune --retention-days 30 --max-archive-gb 10 --apply
```

What this currently prunes:
- DB rows older than cutoff from hot/derived and ingest-tracking tables:
  - `station_pressure_now_5m`
  - `station_severity_5m`
  - `station_status_1m`
  - `episode_markers_15m`
  - `logical_snapshots`
  - `raw_manifests`
  - `fetch_attempts`
- Archive files under `data/gbfs`:
  - first by age (`retention-days`)
  - then oldest-first until under `max-archive-gb`

Retention implementation notes:
- Archive pruning currently uses filesystem `mtime` ordering.
- DB prune currently executes as sequential delete statements (not a single explicit transaction).

Retention invariants:
- Prune order is derived/hot tables first, then ingest tracking tables.
- `logical_snapshots` deletes cascade to snapshot tables via FK `ON DELETE CASCADE`.
- If one DB delete statement fails, later statements are not executed.

Recommendation:
- Move prune to a single explicit transaction once FK behavior is fully stabilized, to avoid partial prune windows.

Manual refresh (if you want explicit control):

```bash
psql "$DATABASE_URL" -v system_id='citibike-nyc' -v from_ts='2026-02-09T00:00:00Z' -v to_ts='2026-02-09T23:59:59Z' -f scripts/rebuild_serving_aggregates.sql
```

## Testing

### Frontend

From `apps/web`:

```bash
bun run lint
bun run build
bun run test:e2e
```

Install Playwright browser once per machine:

```bash
bunx playwright install chromium
```

Quick smoke subset used in current integration workflow:

```bash
bunx playwright test e2e/mapshell.inspect.spec.ts -g "timeline bucket advances while playing and stays stable while paused|go-live button switches replay back to live time progression|search result selection opens Tier-1 drawer for selected station|search keyboard navigation selects active result with Enter|search shows backend-unavailable fallback indicator|tier1 drawer shows simplified capacity/bikes/docks labels|inspect lock blocks timeline mutations and keeps tile key stable" --workers=1
```

### Backend

From repo root (examples):

```bash
bun test packages/api/src/http/control-plane.e2e.test.ts
bun test packages/api/src/http/tiles.test.ts
bun test packages/api/src/serving-views/lfj.e2e.test.ts
```

More backend validation examples are documented in `packages/api/README.md`.

## Operational Notes

- `sv` is a serving-view token: opaque and signed, pinning upstream watermarks + versions so replay is reproducible and tile keyspace stays bounded.
- Public clients use server-issued `sv` tokens (not raw `as_of`).
- Replay/live behavior is controlled by control-plane endpoints (`/api/time`, `/api/timeline`).
- The data plane is `/api/tiles/*`; keep keyspace bounded via allowlists and versioned dimensions.
- Frontend inspect behavior should not mutate timeline/tile request keys while drawer lock is active.
- For deep historical scrub/replay, keep DB loader + aggregate refresh running (raw polling alone is not enough).
- Profile A runs correctly on a single Bun API + Postgres/PostGIS instance; optional scale components are not required for correctness.

## Contribution Quickstart

- Frontend HUD work: `apps/web/src/components/hud/*`
- Frontend map/state work: `apps/web/src/components/map/*`, `apps/web/src/lib/*`
- Backend control-plane routes: `packages/api/src/http/*`
- Tile generation/data-plane: `packages/api/src/tiles/*`
- Policy algorithms: `packages/policy/*` and `/api/policy/*` integration

## Optimization Algorithms

Current:
- `rebal.greedy.v1` is the active policy implementation integrated in the stack.

Near-term direction:
- Maintain API/data contracts so additional optimization algorithms can be swapped in with minimal integration work.
- Keep algorithm execution reproducible against the same replay snapshots and serving-view tokens.

Long-term goal:
- Evolve this repository into a plug-and-play toolbox for researchers/practitioners to compare optimization approaches on shared, deterministic data slices.

## Troubleshooting

- `README.md` commands succeed but map is blank:
  - confirm `NEXT_PUBLIC_MAPBOX_TOKEN` is set.
- Frontend cannot reach backend:
  - confirm API is running on `URBANFLOW_API_ORIGIN` (default `http://127.0.0.1:3000`).
  - if unset, Next proxy routes fall back to `http://127.0.0.1:3000`.
- Map loads but no dots:
  - confirm ingest loop is running and DB has rows (`select count(*) from logical_snapshots;`).
  - verify `/api/time` returns a non-empty `recommended_live_sv`.
- E2E fails to start server:
  - run `bun run build` in `apps/web` before Playwright.
- `bd` reports out-of-sync database/jsonl:
  - run `bd sync --import-only`.
