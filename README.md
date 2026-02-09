# UrbanFlow Twin

UrbanFlow Twin is a tiles-first bike-system digital twin for NYC Citi Bike.

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

## Prerequisites

- Bun `>=1.3`
- PostgreSQL with PostGIS
- Mapbox token for frontend map rendering (`NEXT_PUBLIC_MAPBOX_TOKEN`)

## Install

From repo root:

```bash
bun install
```

## Environment

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

See `packages/api/README.md` for the full backend env surface.

### Frontend (`apps/web`)

Recommended:

```bash
export NEXT_PUBLIC_MAPBOX_TOKEN='...'
export URBANFLOW_API_ORIGIN='http://127.0.0.1:3000'
export SYSTEM_ID='citibike-nyc'
```

## Run The Stack

### 1) Start backend API

From repo root:

```bash
bun packages/api/src/server.ts
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

### 3) (Optional) Start GBFS poller

From repo root:

```bash
bun packages/ingest/src/cli.ts --system citibike-nyc --poll
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

- Public clients use server-issued `sv` serving-view tokens.
- Replay/live behavior is controlled by control-plane endpoints (`/api/time`, `/api/timeline`).
- The data plane is `/api/tiles/*`; keep keyspace bounded via allowlists and versioned dimensions.
- Frontend inspect behavior should not mutate timeline/tile request keys while drawer lock is active.

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
- E2E fails to start server:
  - run `bun run build` in `apps/web` before Playwright.
- `bd` reports out-of-sync database/jsonl:
  - run `bd sync --import-only`.
