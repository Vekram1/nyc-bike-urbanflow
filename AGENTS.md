# AGENTS.md — UrbanFlow Twin

## Safety and irreversible actions

- Never delete files or directories unless the user provides the exact command in the same session.
- Never run destructive git commands (`git reset --hard`, `git clean -fd`, force push) unless the user provides the exact command in the same session.
- If a destructive command is requested, restate the command, list affected paths, and wait for confirmation.

## Tooling rules

- Use Bun for all JS/TS tasks (`bun install`, `bun run ...`). Do not use npm/yarn/pnpm.
- Prefer small, explicit edits; avoid bulk-modifying scripts or large refactors unless requested.
- Do not edit generated outputs by hand. Generate artifacts via the documented commands.

## Target stack (budget-first)

Goal: stay under $50/year by avoiding always-on servers.

Frontend:
- React + TypeScript (Vite or Next.js).
- Host on Cloudflare Pages (static + CDN).
- Map: Mapbox GL JS (option to switch to MapLibre later).

API:
- Cloudflare Workers (TypeScript) for read-only endpoints:
  - `/api/as_of`, `/api/reliability`, `/api/reliability/explain`.
- Use CDN caching keyed on `dataset_id` + `as_of`.

Database:
- Neon Postgres (serverless). Confirm PostGIS availability on chosen plan.

Object storage:
- Cloudflare R2 for raw archives, manifests, and precomputed artifacts (GeoJSON/PMTiles).

## Data delivery strategy

- Prefer precomputed artifacts for map layers (GeoJSON or PMTiles) served from R2 + CDN.
- Keep the API thin; avoid per-pan/zoom DB queries.

## Deployment notes

- Cloudflare Workers do not run Bun in production; keep Worker code TS-compatible with the Workers runtime.
- Use Bun locally for builds and tooling.

## Security and reliability

- Read-only public endpoints by default; no public write APIs.
- Enforce strict cache keys and watermarks for reproducibility.
- Lock Mapbox tokens to approved origins.

## Session completion

- Summarize changes with file references.
- Do not push unless explicitly asked.
