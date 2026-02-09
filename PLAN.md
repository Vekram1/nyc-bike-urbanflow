# UrbanFlow Twin

## Product scope (full web app, not just backend)
## Rebalancing (policy plane): greedy v1 (Profile A baseline)

Badge convention (enforced in this doc):
- [A-REQ] required in Profile A (budget mode)
- [A-OPT] optional in Profile A
- [B-OPT] only in Profile B (scale mode)
- [B-REQ] required only once you enter Profile B

## Multi-system model (required for correctness + extensibility) [A-REQ]
Everything in UrbanFlow Twin is scoped to a `system_id` (e.g., `citibike-nyc`).
This prevents hard-coded assumptions and makes cache keys + data lineage unambiguous.

System definition (config-driven):
- `system_id` (stable string)
- `gbfs_entrypoint_url` (gbfs.json)
- `default_map_bounds`, `default_center`, `timezone` (display only)
- `provider_name`, `provider_region`

Rule: all public endpoints and all dataset_ids are namespaced by `system_id`.

## Deployment profiles (cost-first)

### Profile A — Budget mode (< $50/year, default)
- Frontend: static hosting (CDN-backed) for the web app bundle
- Tiles: CDN + object storage for replay tiles (immutable), origin for live tiles only
- Object storage: raw archive + precomputed tile artifacts
- DB: single Postgres (no replica) sized for live buckets + indices, not full raw history
- Queue: minimal (in-process + durable table) or a low-cost hosted queue; DLQ always persisted
- Observability: structured logs + minimal metrics; no heavy tracing requirement

Reference deployment (Profile A default, concrete):
- Frontend: static hosting on a free CDN-backed platform (Cloudflare Pages / GitHub Pages)
- API + workers: single low-cost container host (Bun runtime) or a single VM with Docker Compose
- DB: one Postgres + PostGIS (no replica); avoid Timescale in Profile A unless you self-host
- Object store: optional; if used, prefer zero-egress object storage for replay artifacts
- CDN: put tiles behind CDN; origin must be shielded (rate limits + cache + stampede control)
- Cost guardrails (Profile A required):
  - Never remount Mapbox map once initialized (avoid extra Mapbox map loads)
  - Default to composite tiles; cap max zoom for anonymous traffic during load
  - Enforce strict query caps + per-IP budgets on uncached origin tile generation

Edge boundary (recommended in Profile A) [A-OPT]:
- Add a thin edge worker (or CDN rules) to:
  - validate allowlisted namespaces (system_id, versions, layers sets)
  - enforce per-IP budgets for cache-miss tile requests
  - reject invalid/expired `sv` tokens before origin
  - optionally mint short-lived anonymous session IDs for fair-rate limiting
This keeps the Bun origin simple and protects the DB under spikes.

### Profile B — Scale mode (when you have budget)
- Timescale + compression + continuous aggregates
- Dedicated queue + workers, Redis for hot keys, optional reader replica
- Full OTEL tracing, richer SLO dashboards

Profile rule:
- Every section that mentions recommended infra must specify whether it is required in Profile A or only in Profile B.

Map provider note (budget-critical):
- Mapbox GL JS pricing is primarily driven by map initialization events.
- The free tier includes up to 50,000 monthly loads for Mapbox GL JS.
- Profile A design goal: keep map loads low by ensuring SPA navigation does not recreate the map,
  and by preferring permalinks/state updates over route-level remounts.

Primary user loop:
- See current system health at a glance (station dots sized by capacity, colored by severity)
- See network-level stats (empty/full counts, delayed data, worst hotspots) without clicking
- Scrub time (replay) to understand when/where stations fail (empty/full) and how quickly they recover
- Click any station to inspect: name + capacity + bikes/docks at current T_bucket (instant) and optionally drill into evidence
- Share a permalink that reproduces the exact view (bbox + time + speed + sv serving token)

Rebalancing effort definition (required) [A-REQ]:
- Policy effort is represented as explicit budgets per decision step:
  - `bike_move_budget_per_step` (B): max bikes moved total per step
  - `max_stations_touched` (S): optional cap on unique stations involved per step
  - `neighbor_radius_m` / `max_neighbors`: bounds on allowable transfers (locality)
- Effort reporting:
  - Always report (bikes_moved, stations_touched, mean/max dist) alongside KPI deltas.

Core UI contract:
- Full-bleed map: map takes 100% viewport (no page scroll); UI is overlay HUD (bikemap.nyc style)
- HUD overlays (all positioned absolute/fixed above map; pointer-events managed):
- top-center: clock chip (date + time, live/replay, sv watermark, data delayed badge)
  - bottom: scrubber bar (play/pause, speed, step, range, gap markers)
  - left: command stack (search, pause, random, about, layer toggles) with key-hints
  - right: stats card (single-glance): active stations, empty/full counts, tile latency, FPS + sparkline
  - station drawer: slides from side (desktop) or bottom (mobile), never resizes the map

HUD design system (required):
- All HUD elements are cards with: subtle blur, dark translucent fill, 8px radius, 1px border, 12px padding
- Key-hints rendered as keycaps (e.g., [Space], [R], [/]) with consistent spacing
- A single global HUD root: pointer-events: none
  - each control card: pointer-events: auto
  - prevents accidental map lockups and preserves pan/zoom UX

HUD telemetry (recommended, dev + trust):
- Show live FPS (client-side) and tile fetch p95 ms (rolling window) in the right stats card
- When ingest lag crosses threshold: show a compact Delayed badge near the clock (not a modal)

Station Inspect contract (required):
- Click on a station dot opens the station drawer in Inspect mode.
- Opening the drawer freezes playback (pauses the clock) by locking T_bucket to the current bucket:
  - No further tile URL updates occur while Inspect is open (deterministic view).
  - HUD clock visually indicates Paused (Inspect) and shows the locked timestamp.
- Closing the drawer resumes playback:
  - If the app was playing before Inspect, it continues playing.
  - If the app was already paused, it remains paused.
- Esc closes the drawer and resumes per the rule above.
- Map: dots at station locations; dot radius ~ capacity (clamped + zoom-scaled)
- Color: severity (0..1) mapped to a deterministic multi-stop scale:
  - low: green
  - medium-low: yellow
  - medium-high: orange
  - high: red
  - unknown/missing severity: neutral gray
- Clock (top middle):
  - Live mode: app time == real time (with server time sync + dataset watermark)
- Replay mode: app time advances at speed factor (e.g., 10x, 60x) pinned to a chosen serving view sv
- Time scrubber:
- Scrub selects a target timestamp T (observation time), while sv pins which data publication watermark set is used

Frontend interaction reliability (required):
- Live jump control:
  - A visible `Live` (or `Go Live`) control must exist in HUD.
  - Clicking it immediately sets current time to real now and resumes playback if paused.
  - While in live mode, the control reflects active live state.
- Pause/replay semantics:
  - `Pause` must stop timeline time advancement (visible clock + timeline position).
  - `Play` must resume advancement from the exact paused timestamp.
  - Any manual seek/step action transitions timeline intent to replay mode.
- Search behavior:
  - Search must return usable station results without relying on unimplemented endpoints.
  - Enter on focused search input picks the top result.
  - Picking a result opens Tier1 inspect for that station immediately.
- Tier1 inventory clarity:
  - Tier1 default labels must be user-facing and explicit:
    - `Total Capacity`
    - `Bikes Available`
    - `Empty Docks`
  - Delta/reconciliation math is not required in Tier1 default view.

Frontend UX simplification and timeline safety (required):
- Tier1 station drawer (default view) must prioritize:
  - `Bikes Available`
  - `Empty Docks`
  - `Total Capacity`
- Tier1 station drawer (default view) must de-emphasize or hide advanced technical fields:
  - `station_key`
  - `T_bucket`
  - `bucket_quality`
  - compare/bucket-offset internals
  - delta/reconciliation diagnostics
- Timeline future bound:
  - Users must not be able to scrub, step, or otherwise move app time into the future beyond server-now.
  - Any attempted future seek must clamp to current server-now.
- Scrub-to-past playback rule:
  - When a user scrubs or steps into the past, playback must not auto-accelerate or auto-resume.
  - Entering past replay should transition to paused replay unless user explicitly presses Play.
  - Playback may resume automatically only on explicit `Go Live` (or equivalent live-jump action).

Severity definition (must be explicit, stable):
- Severity(T) is a weighted score in [0,1] derived from:
  - State (now): empty/full at T (hard penalty, dominates)
  - Reliability (recent): % of last W minutes empty/full + recent episode durations (soft)
  - Pressure (context): expected net flow / capacity OR live proxy deltas (soft, capped)
- Publish score components in API responses so color is explainable (trust + debugging).

Severity contract (required):
- Introduce `severity_version` (e.g., sev.v1) that pins:
  - feature set, window sizes, weight vector, clipping rules, and missing-data behavior
- All tiles/endpoints that return severity must include:
  - `severity_version`
  - `severity_components` (or a compact encoded representation for tiles)
- Any change to the formula increments severity_version and becomes a new cache namespace.

Rebalancing policy contract (required) [A-REQ]:
- Introduce `policy_version` (e.g., rebal.greedy.v1) that pins:
  - decision interval, horizon, target interval rule, effort budgets, neighborhood rules, and missing-data behavior
- All policy outputs must include:
  - `policy_version`
  - `policy_spec_sha256`
  - `sv` (serving view token)
  - `decision_bucket_ts` (the bucket at which the decision is computed)
- Any change to policy logic increments policy_version and becomes a new cache namespace.

No-op semantics (required) [A-REQ]:
- A valid run may return zero moves. This is `status=success` with:
  - `no_op=true`, `no_op_reason` in {no_deficits, no_surpluses, neighborhood_blocked, budget_zero, input_quality_blocked}
- Only true failures use `status=fail` (parse, missing spec, DB error, etc.)

Greedy policy algorithm note (required) [A-REQ]:
- Policy goal (Profile A): reduce empty/full incidence by recommending local inventory transfers
  under explicit effort budgets, without modeling truck routing.
- Computation is per decision bucket `decision_bucket_ts = T_bucket`.
- Define target band per station:
  - capacity `C_s`
  - bikes `b_s` at decision bucket
  - targets `[L_s, U_s]` computed from `target_band` rule (e.g., alpha/beta fractions of capacity)
- Define deficits/surpluses:
  - need_s = max(0, L_s - b_s)
  - excess_s = max(0, b_s - U_s)
- Greedy matching loop (local):
  - candidate donor u: excess_u > 0
  - candidate receiver v: need_v > 0
  - candidate edges restricted by neighborhood (radius R and/or top-K neighbor list)
- choose best edge by score(u,v) (default: smallest dist, tie-break by largest transferable x)
- receiver feasibility:
  - available_docks_v = docks_available_v (or max(0, C_v - b_v) if docks not provided/serving-grade)
  - cap receiving by docks: x <= available_docks_v
- transfer amount x = min(excess_u, need_v, available_docks_v, bike_move_budget_per_step_remaining)
  - update b_u -= x; b_v += x; excess_u -= x; need_v -= x; budget -= x
  - stop when budget exhausted OR no feasible donor/receiver pairs remain
- Output: sparse move list (from_station_key, to_station_key, bikes_moved, dist_m, rank)
- Output additions (required for explain) [A-REQ]:
  - include `reason_codes[]` per move (small enum list)
  - include station-level before/after for touched stations only:
    - `bikes_before`, `bikes_after`, `L_s`, `U_s`, `need_before`, `excess_before`
- Hard invariants (must hold; enforce in tests):
  - Never violate station bounds: 0 <= b_s <= C_s
  - Never violate receiver dock feasibility: bikes_after_v <= bikes_before_v + docks_before_v (if docks are serving-grade)
  - Conservation: sum(bikes_after) == sum(bikes_before) across all stations considered in the step
  - Never exceed step budgets: sum(bikes_moved) <= B and unique stations touched <= S (if set)
  - Never use missing/quarantined buckets as inputs unless policy_spec says carry-forward is allowed
- Dynamic meaning:
  - run greedy each decision bucket independently; counterfactual evaluation is computed over replay ranges.

Policy config artifact (required) [A-REQ]:
- Store policy specs in-repo and in DB:
  - `policy_specs(policy_version, spec_json, spec_sha256, created_at)`
- Validate `spec_json` with JSON Schema (or zod->schema) in CI.

Sample policy spec JSON (required) [A-REQ]:
```json
{
  "policy_version": "rebal.greedy.v1",
  "system_id": "citibike-nyc",
  "decision_interval_s": 900,
  "horizon_steps": 0,
  "targets": {
    "type": "band_fraction_of_capacity",
    "alpha": 0.2,
    "beta": 0.8,
    "min_capacity_for_policy": 5,
    "inactive_station_behavior": "ignore"
  },
  "effort": {
    "bike_move_budget_per_step": 120,
    "max_stations_touched": 40,
    "max_moves": 80
  },
  "neighborhood": {
    "type": "precomputed_neighbors",
    "max_neighbors": 25,
    "neighbor_radius_m": 1200,
    "distance_metric": "haversine"
  },
  "scoring": {
    "type": "min_distance_then_max_transfer",
    "epsilon_m": 1.0
  },
  "constraints": {
    "respect_capacity_bounds": true,
    "forbid_donating_below_L": true,
    "forbid_receiving_above_U": true
  },
  "missing_data": {
    "input_bucket_quality_allowed": ["ok", "carried_forward"],
    "carry_forward_window_s": 600,
    "on_missing": "skip_station"
  },
  "outputs": {
    "include_reason_codes": true,
    "include_station_level_summary": true
  }
}
```

Policy spec notes:
- `horizon_steps=0` means recommendations for this bucket only (fast + safe for Profile A).
- Counterfactual simulation over time ranges is handled by evaluation jobs, not by per-request horizon.
- UI can expose budget presets by swapping effort fields while keeping policy_version constant only if
  the spec hash is part of the cache key (recommended); otherwise treat each preset as a new policy_version.

Severity config artifact (required) [A-REQ]:
- Store a JSON severity spec in-repo and in DB:
  - `severity_specs(severity_version, spec_json, spec_sha256, created_at)`
- Validate `spec_json` with a JSON Schema in CI.
- Tile builders reference severity_version -> spec_sha256 and record it in marts.

Missing-data rule (required):
- If serving-grade data is missing at T_bucket:
  - carry forward last-known-good up to carry_window (e.g., 2x ttl)
  - beyond carry_window: severity is unknown (do not pretend it is green)
- Tiles must encode bucket_quality so the UI can render unknown distinctly.

Trust UX (required) [A-REQ]:
- Add a legend entry for Unknown (missing/quarantined) distinct from green/yellow/red.
- Tooltip/drawer must show bucket_quality + sv + severity_version.
- Provide a one-click Why this color? action that opens an evidence panel
  (severity components + recent empty/full episodes + data-quality flags).

Evidence bundle contract (required) [A-REQ]:
- Evidence endpoints must be bounded by default:
  - default range <= 6h, max range <= 48h
  - max points per series <= 360 (server-decimated)
  - max episodes returned <= 50 (most recent first)
- Must be cacheable by (station_key, sv, T_bucket, severity_version, tile_schema_version)
- Must never return raw manifests or raw object hashes to public clients

## Target architecture (end-to-end)

Goal: a replayable, auditable time-series pipeline for station state + trip flows that supports
1) operational metrics (lag, gaps, failures), 2) stable reproducible marts, and 3) fast map queries.
We optimize for: correctness, replayability, and predictable performance under continuous polling and interactive map playback.

Components:
- Frontend [A-REQ]: React + TypeScript (Vite default; Next.js optional) + Mapbox GL JS
- API service [A-REQ]: Bun runtime HTTP service (read-optimized; GeoJSON debug, MVT primary)
- API framework [A-REQ]: choose one minimal framework (Hono or Elysia) and standardize on it
- Postgres + PostGIS [A-REQ]: default canonical store in Profile A
- Timescale [B-OPT]: adopt when budget allows compression + continuous aggregates at scale
- Cache: CDN for tiles + optional Redis for hot keys (tile + station detail)
- Background workers: ingestion + mart/aggregate refresh + tile warmers (optional)
  - Workers runtime [A-REQ]: Bun (same repo, same deploy artifact as API in Profile A)
  - Policy workers [A-REQ]: Bun (same repo) for counterfactual rebalancing runs (greedy v1) and evaluation marts

Serving planes (required) [A-REQ]:
- Control plane (low QPS): `/api/time`, `/api/config`, `/api/timeline`, `/api/search`,
  `/api/stations/*`, `/healthz`, `/metrics`
- Data plane (high QPS): `/api/tiles/*`
- Policy plane (medium QPS, cacheable): `/api/policy/*` (recommendations + counterfactual metrics + explain)

Policy principle (required) [A-REQ]:
- Rebalancing is modeled as an abstract control policy (inventory transfers) with explicit effort budgets,
  not as explicit truck routing. Truck/VRP modeling is deferred to Profile B.

Rule: apply stricter budgets + overload behavior on the data plane first
(tiles degrade before control plane).
- Serving boundary (recommended):
  - Writer DB: ingestion + loaders + continuous aggregate refresh
  - Reader DB (replica when needed): tile queries + station detail + search
  - This isolates write amplification/compression from map traffic and improves tail latency.

Replay serving strategy (required for low-cost reliability):
- Live mode: tiles can be origin-generated (short TTL) because bucket churn is small
- Replay mode (sv pinned): tiles should be served as static immutable artifacts whenever possible:
  - Worker precomputes composite MVT tiles for a bounded set of z-levels and region bboxes
  - Stores artifacts in object storage under an immutable key:
    - tiles/composite/sev=sev.v1/sv=.../T_bucket=.../z/x/y.mvt
  - CDN serves with Cache-Control: public, max-age=31536000, immutable

Fallback rule:
- If a requested replay tile is missing, origin can generate on-demand once, then write-through to storage.

Cache hierarchy (required to avoid stampedes) [A-REQ]:
- Layer 1: CDN cache (public, immutable for replay; short TTL for live)
- Layer 2: Edge cache for live tiles (short TTL) to smooth bursts and protect origin
- Layer 3: Origin (DB) with strict budgets + 429 Retry-After for overload
- Write-through storage for replay artifacts (recommended): zero-egress object storage for tiles/artifacts
  (e.g., Cloudflare R2 economics: zero egress + low $/GB-month).

SWR rule (required) [A-REQ]:
- Live tiles should be served with `Cache-Control: public, max-age=10, stale-while-revalidate=60`
  (exact numbers configurable, ttl-aligned).
- Origin should prefer returning slightly stale cached tiles over recomputing when budgets are exceeded.

Replay tile packaging (optional, reduces object count) [A-OPT]:
- Periodically pack composite tiles into PMTiles/MBTiles tilepacks:
  - `tilepacks/composite/sev=sev.v1/sv=.../T_bucket=.../region=nyc/z=8-14.pmtiles`
- Serving still uses `/api/tiles/...` but the origin can read from the pack when present.
Rule: tilepacks are immutable and content-addressed; missing tiles still fall back to write-through.

Interactive map workload assumptions:
- Most traffic is tiled (z/x/y) requests for dynamic status/severity layers during pan/zoom/scrub
- Station detail queries are per-click (low QPS)
- Explainability endpoints are sparse but essential for trust

## Design principles & invariants (read this before building)

Non-negotiables:
- Raw archive is the source of truth. Anything in Postgres/Timescale is a derived index you can rebuild.
- Ingestion is idempotent. Re-running the same snapshot/time range must not create duplicates or divergent results.
- Every dataset is reproducible. All latest queries should be explainable via a clear serving token (`sv`).
- Every dataset is reproducible. All latest queries should be explainable via a clear serving token (`sv`).
- Failure is isolated. One bad payload/job never blocks the whole pipeline (DLQ + retries).

Two ingestion streams:
- GBFS snapshots (authoritative station state)
  - Discover feeds via `gbfs.json` (canonical entrypoint), then fetch:
    - `station_status.json` (inventory)
    - `station_information.json` (metadata/capacity)
  - (Optional later: `free_bike_status`, `system_information`, `system_regions`, `alerts`.)
- Trip history (historical flows)
  - Citi Bike publishes downloadable trip files (monthly). You’ll pull the most recent completed month of data.
  - Default for preloaded history: ingest the most recent completed calendar month as a baseline dataset.
  - Optional later: add a rolling overlay window (e.g., 14 days) as a separate dataset for recent pressure,
    without changing the baseline marts.

Storage:
- Append-only raw archive (gzip JSON + parsed Parquet) + Timescale/PostGIS for queries.
- Keep DB lean: DB holds query-optimized indexes + marts, while object storage holds full historical truth.

Profile A retention knobs (required) [A-REQ]:
- Keep `snapshot_station_status` in DB for N days (default N=30) via scheduled job.
- Keep `station_status_1m` / `station_severity_5m` for M days (default M=90).
- Keep `episodes` + `reliability_daily` for 1-2 years (small tables).
- Keep raw archive indefinitely (object storage or disk).
Rule: DB must be rebuildable from raw manifests for any dropped range.

Execution model (recommended):
- Fetcher (stateless): HTTP fetch -> raw archive -> enqueue load job
- Queue + DLQ [A-REQ]: implement as Postgres tables with SKIP LOCKED workers.
  Minimum semantics:
  - at-least-once delivery
  - message dedupe key: (`feed_name`, `publisher_last_updated`, `loader_schema_version`)
  - exponential backoff retries with jitter
  - explicit max attempts then DLQ
  - rate limits (per-feed + global) to prevent stampedes
  - backpressure: cap concurrent loaders per table + global DB write QPS
  - circuit breaker: if parse/conflict rate exceeds threshold, pause fetching that feed for N minutes
- Loader (exactly-once effect): read raw -> validate -> write in a single DB transaction keyed by logical_snapshot_id
- Replayer: re-run loaders over a raw time range (for backfills/schema changes)

Profile A concrete schema (required):
- `job_queue(job_id, type, payload_json, dedupe_key, visible_at, attempts, max_attempts, created_at)`
- `job_dlq(job_id, type, payload_json, dedupe_key, failed_at, reason_code, details_json)`

Add policy job types (required) [A-REQ]:
- `policy.run_greedy_v1`:
  - payload: {system_id, sv, decision_bucket_ts, horizon_steps, policy_version}
  - dedupe_key: (system_id, sv, decision_bucket_ts, policy_version)
- `policy.evaluate_counterfactual`:
  - payload: {system_id, sv, start_ts, end_ts, policy_version, baseline_id}
  - dedupe_key: (system_id, sv, start_ts, end_ts, policy_version)

Policy code layout (recommended) [A-REQ]:
- `packages/policy/` (pure TS library; deterministic; unit-tested)
  - `policy_spec.ts` (schema + types)
  - `targets.ts` (computes desired interval [l_s, u_s])
  - `neighbors.ts` (loads/precomputes neighbor list)
  - `greedy.ts` (matching + transfer generation)
  - `counterfactual.ts` (applies transfers to simulated station state for horizon)
  - `metrics.ts` (empty/full minutes, recovery deltas, effort)

Worker claim pattern:
- SELECT ... FOR UPDATE SKIP LOCKED LIMIT N where visible_at <= now()
- UPDATE visible_at = now() + visibility_timeout, attempts = attempts + 1
- On success: DELETE from job_queue
- On failure: set visible_at with backoff; if attempts >= max_attempts => move to job_dlq

Schema/versioning rule (explicit):
- Treat parsing as a versioned contract.
- Every raw manifest must include:
  - `parse_schema_id` (e.g., gbfs.station_status.v1)
  - `parser_fingerprint` (e.g., git SHA of parser package or docker image digest)
  - `loader_schema_version` (DB normalization contract)
- Maintain a lightweight schema registry doc/table that maps:
  - schema_id -> required fields, optional fields, semantic rules, validation gates
  - migration notes (v1 -> v2)
This prevents same raw bytes, different meaning across time.

Core timestamps you will treat distinctly everywhere:
- `collected_at`: when you fetched the payload
- `publisher_last_updated`: GBFS `last_updated` (provider watermark)
- `ingested_at`: when your DB write happened

Add internal serving timestamps (required) [A-REQ]:
- `observation_ts_raw`: the raw provider watermark (`publisher_last_updated`)
- `observation_ts`: a repaired monotonic axis used for bucketing + episode math

Repair rule (deterministic):
- If `observation_ts_raw` <= previous canonical for that feed:
  - mark quality flag MONOTONICITY_VIOLATION
  - set `observation_ts = previous_observation_ts + 1s` (monotonic repair)
  - preserve raw value in `observation_ts_raw`
- Serving-grade rule:
  - repaired rows may be serving-grade only if violation persists for N consecutive updates (config),
    otherwise quarantine.

Time model rule (explicit):
- Observation time axis for state deltas: use collected_at sequencing (with gap caps).
- Reproducibility watermark: use publisher_last_updated as the upstream dataset watermark for serving views.
- Never bucket by collected_at without recording the serving view token that produced it.

UI replay time axis (required for scrub performance):
- Define `observation_ts` for serving:
  - Default: `observation_ts` is the repaired monotonic axis derived from publisher_last_updated
  - Keep `collected_at` for lag/ops, but do not drive replay directly from it
- Serving aggregates use observation_ts buckets:
  - status: 1-minute buckets (or ttl-aligned buckets)
  - severity: 5-minute buckets (stable colors; avoids flicker)
- Frontend scrubbing semantics:
  - User selects target T (observation_ts)
  - Backend serves nearest bucket <= T (deterministic)

Serving bucket provenance (recommended):
- Serving aggregates (status_1m, severity_5m, pressure_now_5m) should include:
  - `source_as_of` (publisher_last_updated watermark used)
  - `bucket_quality` (ok | carried_forward | missing | quarantined)
- Tiles propagate compact bucket_quality flags for UI indicators.

Track dataset watermarks + serving views (required):
- Define a `datasets` catalog (DB table or config) and a `dataset_watermarks` table:
  - `dataset_id` (e.g., gbfs.station_status, gbfs.station_information, trips.2025-12, marts.reliability_daily)
  - `as_of` (gbfs: publisher_last_updated; trips: file checksum + month; marts: derived version)
  - `max_observed_at` (for freshness reporting)
  - `depends_on` (list of upstream dataset_ids + as_of used)
This makes all latest queries explainable and cacheable across the entire system.

Add serving view registry (required) [A-REQ]:
- `serving_views(view_id, view_version, view_spec_json, view_spec_sha256, created_at)`
- `serving_tokens(token_id, view_id, issued_at, expires_at, view_spec_sha256, token_hmac_kid)`
- `view_spec_json` defines the exact upstream dataset_ids+watermarks used for replay.
Rule: composite tiles and policy runs must be keyed by `sv` (not raw dataset ids).

Policy outputs (required) [A-REQ]:
- `policy_runs` (append-only):
  - run_id, system_id, policy_version, policy_spec_sha256
  - sv, decision_bucket_ts, horizon_steps
  - input_quality (ok|carried_forward|missing), created_at
  - status (success|fail), error_reason
- `policy_moves` (per run; sparse):
  - run_id, from_station_key, to_station_key, bikes_moved, dist_m, move_rank
  - constraint_binding flags (budget_exhausted, neighbor_exhausted)
  - reason_codes text[] (bounded enums)

Cache key invariant (policy plane) [A-REQ]:
- Any policy output is uniquely identified by:
  - (system_id, policy_version, policy_spec_sha256, sv, decision_bucket_ts)
- Public endpoints must reject unknown policy_spec hashes (avoid unbounded keyspace).
- If policy spec changes, it must create a new cache namespace automatically via the hash.
- `policy_counterfactual_status` (optional; only if you simulate forward):
  - run_id, sim_bucket_ts, station_key, bikes, docks, bucket_quality

Policy evaluation marts (recommended) [A-REQ]:
- `policy_eval_daily`:
  - day, policy_version, sv, system_id
  - baseline_empty_minutes, policy_empty_minutes, delta_empty_minutes
  - baseline_full_minutes, policy_full_minutes, delta_full_minutes
  - effort_bikes_moved, effort_stations_touched, mean_move_dist_m
  - derived KPI: delta_empty_full_per_100_bikes_moved

Abuse-resistant serving tokens (required in Profile A) [A-REQ]:
- Replace the single ambiguous `as_of` notion with a server-minted serving token: `sv` (serving view token).
- `sv` is an opaque, signed token that pins all upstream versions needed to reproduce responses:
  - gbfs.station_status watermark (publisher_last_updated)
  - gbfs.station_information watermark (publisher_last_updated)
  - trips baseline dataset_id + checksum (e.g., trips.2026-01@sha256=...)
  - severity_version + severity_spec_sha256
  - tile_schema_version namespace
- Server rejects unknown/expired `sv` tokens to prevent cache-busting and unbounded keyspace attacks.
- `/api/time` and `/api/timeline` are the only issuers of current valid `sv` tokens.

Namespace registry (prevents unbounded keyspace) [A-REQ]:
Introduce an explicit allowlist for cache-key dimensions (DB-backed) [A-REQ]:
  - allowed `system_id`
  - allowed `severity_version`
  - allowed `policy_version`
  - allowed `layers` sets for composite tiles (e.g., inv,sev | inv,sev,press | inv,sev,epi | inv,sev,press,epi)
  - allowed compare modes (off|delta|split) and enforced T2 range caps

Implementation (required):
- `namespace_allowlist(kind, value, enabled, created_at, disabled_at, note)`
  - kind in {system_id, severity_version, policy_version, tile_schema, layers_set, compare_mode}
- Origin enforces allowlist; edge worker mirrors allowlist with short TTL caching (e.g., 60s).

Enforcement rule:
- Any request with a param outside the allowlist returns 400 (not cached), never 404.
- Policy presets do not create new namespaces unless the spec hash is registered server-side.

Token hardening (required):
- Token includes: `system_id`, `dataset_id`, `publisher_last_updated`, `issued_at`, `expires_at`,
  `severity_version_namespace`, and an HMAC signature.
- Expiration policy:
  - Live token TTL: short (e.g., 10-30 minutes)
  - Replay tokens: longer but bounded (e.g., 7-30 days)
- Key rotation:
  - support `kid` (key id) in token header
  - server keeps active + previous keys to avoid breaking existing permalinks

### Entity model (important)
- Logical snapshot: what the provider published keyed by (`feed_name`, `publisher_last_updated`)
- Fetch attempt: an HTTP attempt to retrieve a snapshot with status, timings, retry counts
- Raw object: the stored payload (content-addressed) referenced by attempts/manifests
This separation prevents mixing operational noise with dataset identity and makes replay/backfill exact.

## Phase 1 — GBFS collector (MacWright-style)

### 1.1 Discover and fetch feeds

Start from Citi Bike’s `gbfs.json`, then discover (at minimum):
- `station_information.json`
- `station_status.json`

Reference (spirit + approach): https://macwright.com/2023/09/17/bikeshare-1
Related ingestion plumbing to scan: https://github.com/NYCComptroller/citi-bike-gbfs

Cadence:
- Use the feed `ttl` value for polling cadence.
- GBFS also exposes `ttl` + `last_updated` semantics; record these fields for auditing/deduping.

### 1.2 Raw archive (do this first, always)

Write every fetch to disk/object storage, partitioned consistently:
```
data/gbfs/

  # content-addressed payload store (dedup; single source of bytes)
  objects/sha256=ab/cd/abcdef....json.gz

  # time-partitioned manifests (cheap; many per day)
  feed=station_status/dt=2026-01-29/hour=17/2026-01-29T17:05:00Z.manifest.json
  feed=station_status/dt=2026-01-29/hour=17/2026-01-29T17:05:00Z.parquet
  feed=station_information/dt=2026-01-29/hour=17/...
```
Why: if your DB schema changes later, you can reprocess from raw truth.

Manifest should include:
- `logical_snapshot_id`, `attempt_id`, `feed_name`, `collected_at`, `publisher_last_updated`, `ttl`
- `http_status`, `etag`, `content_length`
- `payload_sha256`, `parser_fingerprint`
- `content_type`, `content_encoding`, `last_modified` (when present)
- `retry_count`, `fetch_duration_ms`
- `gbfs_version`, `source_url`

Also include (recommended for dedup + provenance):
- `raw_object_sha256` (points to data/gbfs/objects/...)
- `parse_schema_id` (e.g., gbfs.station_status.v1)
- `loader_schema_version` (DB normalization contract)

Raw capture rule (explicit):
- Store the exact HTTP response bytes as the canonical raw object (content-addressed by sha256).
- Parsed JSON + Parquet are derived artifacts linked from the manifest.

Replay ergonomics (recommended):
- Create a thin DB index table `raw_manifests` (append-only) with:
  - feed_name, collected_at, publisher_last_updated, logical_snapshot_id
  - raw_object_sha256, manifest_path, parquet_path, parser_fingerprint, loader_schema_version
- This lets you plan replays via SQL (no object-store listing) and compute missing ranges quickly.

### 1.3 Normalize into Timescale/PostGIS

Minimal tables (backend MVP) - separate snapshot header from station rows:

0) `logical_snapshots` (append-only; one row per provider version)
- `logical_snapshot_id` (deterministic UUID/UUIDv5 from feed_name + publisher_last_updated)
- `feed_name` (station_status, station_information)
- `publisher_last_updated`
- `canonical_payload_sha256` (the one true payload hash for this logical snapshot; set exactly once)
- `first_seen_at` (min collected_at across attempts)
- `ingested_at` (when normalized rows for this logical snapshot were committed)
- `raw_object_sha256` (canonical payload bytes for this logical snapshot)
- `is_valid` + `error_reason`

0b) `fetch_attempts` (append-only; operational record per HTTP attempt)
- `attempt_id` (uuid)
- `logical_snapshot_id` (fk)
- `collected_at`
- `http_status`, `etag`, `content_length`
- `payload_sha256`
- `retry_count`, `fetch_duration_ms`, `source_url`

0c) `loader_runs` (append-only; operational record per load execution)
- `run_id` (uuid)
- `dataset_id` (e.g., gbfs.station_status)
- `logical_snapshot_id` (nullable for non-GBFS loads like trips)
- `input_manifest_path` (or raw_object_sha256)
- `loader_schema_version`, `parser_fingerprint`
- `started_at`, `finished_at`, `status` (success/fail), `error_reason`
- `rows_written`, `rows_skipped`, `quality_flag_codes[]`
This is the backbone for ops dashboards and replay auditing.

Idempotency rule (hard):
- For a given (`feed_name`, `publisher_last_updated`), the pipeline must converge to exactly one
  canonical `raw_object_sha256`. If attempts disagree, quarantine into DLQ for investigation.

Enforcement (recommended):
- DB constraint: unique (`feed_name`, `publisher_last_updated`)
- Loader does: INSERT ... ON CONFLICT DO UPDATE
  - if canonical_payload_sha256 is NULL, set it
  - else if differs from incoming payload_sha256, mark conflict + DLQ
- Optional: advisory lock on `logical_snapshot_id` during normalization to prevent concurrent station-row inserts.

A) `snapshot_station_status` (hypertable; station_status rows)
- `publisher_last_updated` (use as hypertable time partition column)
- `collected_at` (kept for lag/ops; not the primary time axis)
- `publisher_ttl`
- `logical_snapshot_id`
- `feed_name`
- `station_id`
- `num_bikes_available`, `num_docks_available`
- `num_bikes_disabled` (if present), `num_docks_disabled` (if present)
- `is_renting`, `is_returning` (when present)

Idempotency/uniqueness (recommended):
- Unique on (`logical_snapshot_id`, `station_id`)
- Store `collected_at` separately to measure lag and detect stalled feeds

B) `snapshot_station_information` (dimension-ish; only changes when provider changes)
- `publisher_last_updated`, `logical_snapshot_id`, `station_id`
- lat, lon, name, capacity, region_id (when present), station_type (when present)

C) `stations_scd` (slowly changing dimension; the clean versioned station table)
- `station_key` (stable uuid), `station_id` (external), `valid_from`, `valid_to`
- lat, lon, name
- capacity (when present)
- geom GEOGRAPHY(Point, 4326) (derived from lat/lon; required for spatial queries)

This SCD table is the clean answer to your capacity changes concern: you don’t assume it’s constant; you version it.
Practical rule: whenever `station_information` yields a change in (capacity, lat/lon, name), you close the current row and open a new one.

D) `station_lifecycle`
- `station_id`, `active_from`, `retired_at`
- Mark stations as retired rather than deleting so historical joins remain valid.

Performance notes (do early, saves pain later):
- Index `snapshot_station_status(station_id, publisher_last_updated DESC)`
- Consider BRIN on `publisher_last_updated` (large append-only scans)
- If using compression: segment by `station_id`, order by `publisher_last_updated`
- Consider Timescale compression for station_status after N days
- Prefer a derived `station_now` view/materialization:
  - Use Timescale hyperfunctions (e.g., `last(num_bikes_available, publisher_last_updated)`)
    grouped by station_id (and/or station_key).
  - Optional: maintain a cache table only if necessary, rebuilt from the same canonical query.
This removes a mutable write-path and keeps now consistent under replays.
- Create GiST index on `stations_scd(geom)` (and optionally `station_lifecycle(active_from, retired_at)` for joins).
- Map endpoints should spatial-filter via `stations_scd.geom` joined to marts on `station_key`.

Neighborhood index (required for policy performance) [A-REQ]:
- Create a deterministic neighbor list per station_key for greedy matching:
  - `station_neighbors(system_id, station_key, neighbor_key, dist_m, rank, built_at, algo_version)`
- Build rule:
  - rebuild daily OR when `stations_current` changes (station add/remove/move/capacity change)
- Policy uses:
  - `max_neighbors` (e.g., 25) and/or `neighbor_radius_m` (e.g., 1200m) to bound search.

### Add explicit serving layers (static vs dynamic)

Static serving layer (rarely changes):
- `stations_current` view/materialization:
  - one row per station_key with current geom + capacity + display_name + active flag
  - source: stations_scd where valid_to IS NULL joined to station_lifecycle

Keying rule (required for web app correctness):
- Public API identifiers use `station_key` only.
- `station_id` appears as a property (current external id) and may change over time.
- Tiles must include `station_key` as the feature id so Mapbox feature-state works reliably.

Dynamic serving layer (changes with time):
- `station_status_1m` (or ttl-aligned) continuous aggregate:
  - bucket_ts, station_key, bikes_available, docks_available, is_renting, is_returning
  - bucketed on observation_ts
- `station_severity_5m` continuous aggregate:
  - bucket_ts, station_key, severity, and severity components
  - optimized for map color + tooltip

### 1.4 Dedup + integrity checks

GBFS feeds can update irregularly. Use:
- (`feed_name`, `publisher_last_updated`) as a publisher update id
- If you poll but `last_updated` hasn’t changed, still archive (optional) but don’t insert duplicate `snapshot_station_status` rows.

Data quality gates (explicit behavior):
- Hard fail + DLQ (no DB write):
  - JSON parse errors, missing required top-level keys, or logical_snapshot_id collisions with different raw_object_sha256
- Soft fail (write snapshot + flag, optionally skip station rows):
  - station_count deviates > X% from trailing median
  - negative counts or bikes+docks wildly inconsistent with capacity (when capacity known)
- Always record: is_valid, error_reason, and quality_flags JSONB for debugging and audits

Serving-grade vs archive-grade (required for UX trust):
- Archive-grade: always store raw objects/manifests (unless transport totally fails)
- Serving-grade: only publish into serving aggregates/tiles if:
  - snapshot is_valid AND no blocking quality flags (e.g., NEGATIVE_INVENTORY)
- If a snapshot is archived but not serving-grade, the UI should:
  - keep last known good bucket for that station/time and surface a small data quality flag in /api/time

Provider anomaly policy (recommended):
- If `publisher_last_updated` goes backwards vs last canonical for that feed:
  - ingest attempt, flag MONOTONICITY_VIOLATION, quarantine snapshot for investigation
- If station_count drops sharply:
  - still archive raw; only accept as canonical if it persists for N consecutive updates
  - otherwise quarantine as likely partial publish
- Allow station_information and station_status to have different as_of; marts must record both upstream as_of values.

Operational debuggability (recommended):
- Use typed quality flags:
  - `quality_flag_codes` (e.g., STATION_COUNT_DROP, NEGATIVE_INVENTORY, CAPACITY_INCONSISTENT, SCHEMA_MISSING_KEY)
- Add `quarantined_snapshots`:
  - logical_snapshot_id, feed_name, publisher_last_updated
  - reason_code, details_jsonb, raw_object_sha256, created_at, resolved_at, resolution_note
This makes DLQ searchable, triageable, and reportable.

Add pipeline health metrics (recommended):
- `ingest_health_15m` (ops) + `ingest_health_daily` (trend):
  - `station_count_seen`, `station_count_expected`
  - `pct_missing_status`, `pct_missing_info`
  - `median_ingest_lag_seconds`, `p95_ingest_lag_seconds`
  - `duplicate_row_rate`, `parse_error_count`
- Alert on sustained lag, rising gaps, or sudden station count drops

Implementability (recommended):
Implementability:
- Profile A [A-REQ]: Postgres materialized views + scheduled refresh (cron) for `ingest_health_*`
- Profile B [B-OPT]: Timescale continuous aggregates for `ingest_health_*`
- Define SLOs (e.g., p95 lag < 2x ttl for 30 minutes)

## Phase 2 — Trip data ingestion (completed month baseline)

### 2.1 Source and filter

Citi Bike’s system data page provides monthly trip history downloads:
https://citibikenyc.com/system-data
To ingest the most recent completed month (recommended baseline), you will:
- determine month M via deterministic selection:
  - enumerate candidate months in descending order: last_month, last_month-1, ... (max lookback K=6)
  - pick the newest month whose file is discoverable AND passes parsing/rowcount sanity checks
- persist the chosen month as `trips.baseline_month` in dataset_watermarks (explainability)
- expose it in /api/time and /api/config so UI labels pressure as baseline month: YYYY-MM
- download the monthly trip file for month M (where M is the newest available completed-month file)
- treat that file as an immutable batch input (watermark = file checksum + schema_version)
- compute flow aggregates for that month once (idempotent rebuild by month partition)

Selection invariants (required):
- Never partially ingest a month. Either the month is accepted and becomes canonical, or it is rejected/quarantined.
- If a newer month appears later, ingest it as a NEW dataset_id (e.g., trips.2026-02) without rewriting the old one.

Optional overlay dataset (later):
- rolling window W (e.g., 14 days), recomputed daily, clearly labeled as `window_type=rolling`
- never mix baseline + overlay implicitly; consumers request which dataset_id they want

Add trip file metadata table (recommended):
- `trip_files`: filename/url, downloaded_at, bytes, checksum, schema_version, row_count, parsed_ok
  - add: `month_key` (YYYY-MM), `parser_fingerprint`, `ingest_status`, `reject_reason`

Trip file quality gates (explicit):
- hard reject (do not publish dataset_id):
  - parse errors, zero rows, missing required columns, absurd timestamps (outside month range)
- soft accept with flags:
  - row_count deviates > X% from trailing median for that month-of-year (seasonality-aware optional)

Raw archive for trips (match GBFS principle):
- Store downloaded ZIP/CSV in object storage (content-addressed) + per-file manifest for exact replays

### 2.2 Normalize trips

Robust ingestion pattern (recommended):
- Load CSV into a staging table keyed by (`trip_file_id`, row_number) or raw line hash
- Normalize into canonical `trips` with stable IDs and clean types

Privacy-first storage (required) [A-REQ]:
- Do not store rider-level identifiers or any user-identifying fields.
- Prefer aggregate-first ingestion: compute station inflow/outflow aggregates directly from the monthly file,
  and only persist the aggregates needed for pressure baselines.
- If a canonical `trips` table is kept, restrict to strictly necessary columns and drop it after aggregates
  are verified (or keep only sampled rows for debugging in a private/admin-only schema).

Identity invariant (recommended):
- All downstream joins/marts should be keyed on `station_key`, not `station_id`.
- Maintain `station_identity` mapping (station_key <-> current_station_id + aliases) as a required dimension.

Also create pre-aggregated flow tables for performance:
- `station_outflows_15m` (`dataset_id`, `bucket_ts`, `station_key`, `departures`)
- `station_inflows_15m` (`dataset_id`, `bucket_ts`, `station_key`, `arrivals`)
These are what you join into `reliability_daily` / map layers.

Partitioning rule (recommended):
- For completed-month baselines, partition (or cluster) flow aggregates by month.
- For rolling overlays, retain only recent buckets and rebuild frequently.

### 2.3 Station ID reconciliation

Trip data typically has station IDs, but sometimes there are:
- missing IDs
- legacy IDs
- station name mismatches

Strategy:
- primary key join on `station_id` when present
- secondary mapping table `station_id_aliases` for legacy IDs -> current IDs when you detect collisions or renames
- log unmatched stations for later cleanup

(You can build this mapping incrementally; don’t block MVP on 100% matching.)

Optional escalation (when mismatches matter):
- If `station_id` missing: try name + proximity match (fuzzy name + nearest within X meters)
- Maintain `station_identity`:
  - `station_key` (uuid), `current_station_id`, plus aliases

## Phase 3 — Reliability + pressure + policy (backend outputs)

Now that GBFS is in Timescale:

### 3.1 Empty/full minutes

For each station and day:
- Compute time-in-state using observation-to-next-observation deltas:
  - For each row, define `dt = min(next_observation_ts - observation_ts, max_gap)`
  - Sum `dt` where `bikes_available == 0` (empty) and `docks_available == 0` (full)
  - Choose `max_gap` (e.g., 2-3x expected ttl) to avoid counting long outages as empty/full time

This makes metrics robust to jitter, missed polls, and ttl changes.

Note:
- Use collected_at for lag/ops metrics only.
- Use observation_ts for user-facing replay metrics so the map and episodes agree.

### 3.2 Recovery time (the metric that feels operational)

Compute event segments:
- empty episode: from first snapshot where bikes = 0 until bikes > 0
- full episode: from first snapshot where docks = 0 until docks > 0

Persist episodes (recommended; makes debugging + UX compelling):
- `station_empty_episodes`:
  - station_key, start_ts, end_ts, duration_s, censored, start_logical_snapshot_id, end_logical_snapshot_id
- `station_full_episodes`:
  - same fields
This enables leaderboard worst incidents, percentiles, and drill-down explanations.

Add an episodes map layer (compelling UX):
- Publish episode markers for replay:
  - `episode_markers_15m` (or event table served by tiles):
    - bucket_ts, station_key, episode_type (empty|full), duration_s, censored
- Serve as optional overlay tiles:
  - `GET /api/tiles/episodes/{z}/{x}/{y}.mvt?T_bucket=...&sv=...`

Computation approach (recommended):
- Compute episodes with SQL window functions over `publisher_last_updated` ordered rows:
  - detect boundaries where state enters/exits empty/full
  - assign segment_id via cumulative sum of boundary markers
  - compute start/end via MIN/MAX per segment_id
- Store episode rows; derive daily/hourly rollups from episodes (faster + consistent).

Reliability rule:
- If there is a data gap > `max_gap`, close the current episode as censored/unknown
- Track censored counts separately so you can distinguish operational issues from data outages

Outputs:
- mean recovery time
- p95 recovery time
- number of episodes per day
- censored_empty_episodes, censored_full_episodes

### 3.3 Inflow/outflow baselines (from trips)

For the same day/hour bins:
- inflow rate = arrivals per station per 15 min (or hour)
- outflow rate = departures per station per 15 min (or hour)
- net flow = inflow - outflow

This becomes your demand pressure layer to interpret why empties happen.

Add a pressure layer (context for severity):
- `station_pressure_15m`:
  - bucket_ts, station_key, expected_outflow, expected_inflow, net_expected, normalized_pressure
- Expose pressure as a toggleable map layer and as a severity component (optional weight).

UI labeling rule (required for trust):
- Any layer derived from trips must carry:
  - dataset_id (trips.YYYY-MM) and month_key
  - label baseline (completed month) in UI

Add a live pressure proxy from GBFS deltas (high value):
- `station_pressure_now_5m` (computed from station_status deltas):
  - bucket_ts, station_key
  - delta_bikes_5m, delta_docks_5m
  - volatility_60m (stddev of deltas) to highlight churn
  - rebalancing_suspected flag (large positive deltas during low-demand hours, optional heuristic)
- Serve as a separate overlay so users can see movement even when trip baselines are stale.

Serve live pressure proxy as tiles:
- `GET /api/tiles/pressure_now/{z}/{x}/{y}.mvt?v=1&T_bucket=...&sv=...`
Properties: station_key, delta_bikes_5m, volatility_60m, rebalancing_suspected
Cache-Control:
- live: public, max-age=5..15 seconds
- replay: public, immutable (sv pinned)

Add compare mode support (cheap, high value):
- API supports multiple T values:
- `GET /api/tiles/inventory/{z}/{x}/{y}.mvt?T_bucket=...&T2_bucket=...&sv=...`
- `GET /api/tiles/severity/{z}/{x}/{y}.mvt?T_bucket=...&T2_bucket=...&sv=...&severity_version=sev.v1`
- Or provide a delta tile endpoint:
- `GET /api/tiles/inventory_delta/{z}/{x}/{y}.mvt?T_bucket=...&T2_bucket=...&sv=...`
- `GET /api/tiles/severity_delta/{z}/{x}/{y}.mvt?T_bucket=...&T2_bucket=...&sv=...&severity_version=sev.v1`

Compare UX (required for product stickiness) [A-REQ]:
- Add a HUD toggle: Compare
  - modes: off | delta | split
- Delta: single layer shows change intensity
- Split: draggable divider; left side uses T, right side uses T2 (same sv)
- Permalink includes compare params: compare=delta|split&T2_bucket=...

### 3.4 Publish a small reliability mart

Materialize something like:
- station_id, day, empty_minutes, full_minutes, empty_events, full_events, p95_empty_recovery, p95_full_recovery, net_flow_peak_hour, ...

Recommended: publish a small reliability mart
- `reliability_daily` (historical ranking, stable)
- `reliability_hourly` or `reliability_15m` (operational layer)
- `station_now` view/materialization:
  - latest bikes/docks, latest timestamp, trailing 2h empty/full time, recent recovery episodes

Mart reproducibility invariant (required):
- Every mart table must include or be joinable to a mart header with:
  - `mart_run_id`, `mart_version`
  - upstream `dataset_id` + `as_of` for gbfs.station_status, gbfs.station_information, trips.*
This makes explain endpoints and cache keys correct under backfills.

Retention/rollup policy (recommended):
- Keep high-frequency `snapshot_station_status` in DB for N days (e.g., 30-90)
- Keep `reliability_*` marts longer (e.g., 1-2 years)
- Keep raw archive forever (cheap, reproducible), rebuild DB ranges as needed

Operationalize it (do now, not later):
- Timescale policies:
  - compress snapshot_station_status after 7-14 days
  - drop raw hypertable chunks after N days only if ingest lag is healthy and raw manifests cover the range
- Continuous aggregates:
  - define refresh window (e.g., last 3 days) + daily full refresh for late-arriving data
- Index policy:
  - keep only essential indexes on compressed hypertables to avoid write amplification

Restore playbook (recommended):
- `restore_range --from ... --to ...`:
  1) query `raw_manifests` for the range
  2) replay loaders into snapshot tables
  3) rebuild episodes + reliability marts
- Safety checks: refuse restore/drop if gaps in raw manifests exceed threshold.

## Deployment + release engineering (required for a web app)

## Threat model + abuse model (required for Profile A) [A-REQ]
Primary adversary: anonymous scraper / bot traffic targeting the data plane (tiles) to:
1) drive origin DB load (cache-miss stampede), 2) exhaust bandwidth/CPU, 3) create unbounded cache keyspace,
4) induce expensive map re-loads via SPA remounts or permalink spam.

Attack surfaces:
- Data plane: `/api/tiles/*` (high QPS; must degrade first)
- Watermark issuance: `/api/time`, `/api/timeline` (keyspace control)
- Station series endpoints (range abuse)
- Search (enumeration + spam)

Success criteria (defense):
- Unbounded keyspace is impossible (tokens + server-known namespaces only)
- Origin has a hard per-IP + global budget for uncached tile generation
- Degrade ladder is deterministic and observable (returned in `/api/time.network`)
- Public endpoints never expose raw object locations or listing primitives

Required mitigations:
- Edge rate-limits and WAF rules for `/api/tiles/*` and `/api/*` (separate policies)
- Strict CORS + deny-by-default headers (no wildcard for admin endpoints)
- Known namespace only validation for: system_id, severity_version, policy_version, layer sets

Security boundary (required) [A-REQ]:
- Public plane (anonymous/read-only): tiles + time/config/search + station drawer endpoints
- Control plane (authenticated/admin-only): replay/backfill, DLQ triage, pipeline_state, raw manifest browsing
- Never expose raw object URLs publicly; only serve derived artifacts and bounded evidence bundles.

Admin UI (minimal, required for survivability) [A-REQ]:
- A small admin-only page (static) that calls admin endpoints to:
  - view queue depth + DLQ depth + last success per feed
  - list DLQ items (reason_code, first_seen, payload summary)
  - mark DLQ item resolved with resolution_note (writes to DB)
  - view active degrade_level history (last 1h)
This can be a separate route gated by `X-Admin-Token` and strict CORS.

Ops/auth boundary (required in Profile A) [A-REQ]:
- Public endpoints: tiles + `/api/time`, `/api/config`, `/api/timeline`, `/api/search`, basic station drawer
- Admin endpoints (require `X-Admin-Token`):
  - `/metrics`, `/api/pipeline_state`, debug GeoJSON, explain endpoints beyond small caps
Rule: never leak raw manifests, raw_object_sha256 listings, or object paths publicly.

- DB migrations:
  - use a migration tool (Sqitch/Flyway/Prisma migrate - pick one) and run in CI/CD
- API versioning:
  - /api/* endpoints require v=1 and additive-only changes within a major version
- CI gates:
  - run golden payload tests + idempotency tests on every PR
  - run a tile query smoke test against a seeded mini dataset
- Rollout:
  - deploy API + workers with separate autoscaling policies
  - serve tiles behind CDN; origin protected by rate limits

SLOs (serving + ingestion):
- Ingestion: p95 ingest lag < 2x ttl sustained
- Serving: tile p95 < 300ms end-to-end; station detail p95 < 500ms end-to-end

Serving protection (required for reliability):
- Rate limit non-tile endpoints (/api/status geojson, /api/reliability/explain) per IP
- Prefer CDN for tiles; origin should reject uncached tile stampedes with backpressure (429 + retry-after)
- Separate SLOs:
  - tiles: p95 < 300ms end-to-end
  - station detail: p95 < 500ms end-to-end
  - explain: p95 < 1500ms end-to-end (bounded via pagination/range caps)

Cost & abuse controls (required in Profile A):
- Enforce a global origin tile budget:
  - if CDN miss rate spikes: temporarily increase bucket_size or clamp max zoom for anonymous users
- Per-IP token bucket for origin tile generation (CDN hits do not count)
- Strict query caps:
  - /api/stations/*/series max range, max points, server-enforced downsampling
  - /api/search max results, min query length, debounce guidance
- Bot friction:
  - optional lightweight proof-of-work or anonymous quota key for heavy replay scraping
- Graceful degradation:
  - if origin is under load: degrade in this order (deterministic ladder):
    1) clamp max zoom for anonymous users (e.g., Z_max = 13)
    2) disable optional overlays (episodes/pressure) via `client_should_throttle`
    3) switch dynamic layer to last-known-good bucket only
    4) serve stations-only tiles if still overloaded (no hard failure)
  - Origin must surface the active degrade level via `/api/time.network.client_should_throttle`.

Overload playbook (required) [A-REQ]:
Backend signals (in `/api/time.network`):
- `degrade_level`: 0|1|2|3
  - 0 normal
  - 1 drop optional overlays (episodes/pressure)
  - 2 clamp max zoom for anonymous users + increase bucket_size
  - 3 serve last-known-good dynamic tiles only (stale-while-revalidate)

Frontend policy:
- When degrade_level >= 1: auto-disable optional overlays + show compact Degraded chip
- When degrade_level >= 2: clamp zoom + warn user
- When degrade_level >= 3: pause playback auto-advance (avoid tile churn), allow manual scrub only

## Frontend architecture (Mapbox-first)

Stack:
- React + TypeScript
- Mapbox GL JS (vector tiles)
- TanStack Query (server state caching) + lightweight client store (e.g., Zustand) for time controls

Core UI state:
- time:
  - mode: live | replay
  - speed: number (1, 10, 60, etc.)
  - T: observation_ts (selected playback time; internal)
  - T_bucket: integer (aligned; the only value used for tiles)
  - sv: serving view token (pinned in replay)
  - playback:
    - is_playing: boolean
    - pause_reason: null | user | inspect
    - locked_T_bucket: null | integer (set when pause_reason=inspect)
- map:
  - bbox/viewport, zoom
  - layer toggles: stations, severity, bikes/docks, episodes overlay, demand pressure
- selection:
  - selected station_key (drawer)

Rendering strategy:
- Add two sources:
  - stations source: /api/tiles/stations/{z}/{x}/{y}.mvt
  - dynamic source (Profile A): /api/tiles/composite/{z}/{x}/{y}.mvt?v=1&tile_schema=tile.v1&T_bucket=...&sv=...&severity_version=sev.v1&layers=inv,sev,press,epi
- Dot radius from capacity:
  - apply sqrt scaling + clamp to avoid huge circles
  - optionally zoom-dependent scaling (Mapbox expression)
- Color from severity:
  - deterministic mapping (green -> yellow -> red)
  - tooltip shows severity components for explainability

Interaction performance (recommended):
- Use Mapbox feature-state keyed by `station_key` for:
  - hover highlight
  - selected station styling
- Do not fetch station detail on hover; only on click.
- Preload minimal tooltip fields (bikes, docks, severity) in tiles to keep hover instant.

Map performance (recommended):
- Use Mapbox circle layers with expression-driven radius/color (GPU-friendly)
- Optional: enable clustering for z <= Z_cluster (e.g., 11) on stations layer only
- Never recreate Mapbox sources during playback; update tile URL params for the existing source

Client performance budget (required):
- React renders: controls only (scrubber, chips). Map canvas must not be re-mounted.
- Map source updates: at most 1 URL mutation per bucket transition.
- Telemetry exposed in dev HUD (and optionally to users):
  - FPS (rolling avg), tiles/sec, last tile fetch ms, cache hit ratio (if available)
- If FPS drops below threshold during playback:
  - auto-reduce visual complexity (disable optional overlays, clamp max zoom, reduce label density)

Enforcement pattern (required) [A-REQ]:
- Create `MapShell` as the top-level, route-invariant component that owns:
  - Mapbox map instance
  - sources + layers
- All navigation uses URL state + overlay UI only; never conditional-render MapShell.
- Add an automated test (or runtime assert in dev) that MapShell mounts exactly once per session.

HUD input + pointer-events policy (required for full-bleed UX):
- Default HUD container uses pointer-events: none so map pan/zoom always works
- Individual controls (search, scrubber, toggles, drawer) use pointer-events: auto
- Centralize keyboard shortcuts in a TimeController/InputRouter:
  - Space: play/pause
  - Left/Right: step buckets
  - Esc: close drawer
  - /: focus search

Clock behavior:
- Live: poll /api/time every N seconds; T follows server_now; sv follows recommended_live_sv
- Replay: T advances via requestAnimationFrame at speed factor but tile fetches step on discrete buckets:
  - define T_bucket = floor(T / bucket_size) * bucket_size (bucket_size = 5m default)
  - only update Mapbox source URL when T_bucket changes
  - this bounds tile churn and makes playback cache-friendly

Playback state machine (required):
- User pause (Space):
  - toggles is_playing and sets pause_reason=user when paused
- Inspect pause (click station):
  - if is_playing==true: set pause_reason=inspect, locked_T_bucket=current T_bucket, is_playing=false
  - if already paused: set pause_reason=inspect, locked_T_bucket=current T_bucket (do not overwrite user intent)
- Close Inspect (Esc or close button):
  - if pause_reason==inspect and previous state was playing: resume is_playing=true, pause_reason=null, locked_T_bucket=null
  - if pause_reason==inspect but user had paused earlier: return to pause_reason=user (remain paused)

Live-mode nuance (required):
- While pause_reason=inspect, live polling may continue for freshness indicators, but the map time (T_bucket used for tiles) must remain locked.

Playback invariants (test-required) [A-REQ]:
- I1: While Inspect is open, the tile `T_bucket` must not change (no URL mutations).
- I2: Closing Inspect must restore the pre-inspect playing/paused intent.
- I3: Selecting a different station while Inspect is open must not resume playback.
- I4: Live polling may update freshness chips, but must not change map time while locked.

Implementation note:
- Store `pre_inspect_is_playing` and restore it on close; do not infer from `pause_reason` alone.

Policy mode semantics (required) [A-REQ]:
- Replay mode (sv pinned): policy runs are counterfactual and may simulate forward over a horizon.
- Live mode: policy runs in SHADOW only (no operational claims). Display as:
  - Recommendation (shadow) and show effort only; hide KPI deltas unless computed from historical backtests.

Hard API rule (required):
- Tile endpoints accept T_bucket only (integer seconds since epoch aligned to bucket_size).
- Non-tile endpoints may accept T (for station drawer queries), but must resolve deterministically to T_bucket.

Permalinks:
- URL encodes: bbox, zoom, mode, speed, T_bucket, sv, severity_version, layer toggles, selected station
- enables share this replay exactly reproducibly

Client replay cache (recommended) [A-OPT]:
- For replay mode only (sv pinned + immutable), cache fetched composite tiles in IndexedDB:
  key = (sv, severity_version, T_bucket, z, x, y, layers)
- Evict with an LRU cap (e.g., 100-300 MB) to keep storage bounded.
- Result: near-instant back/forward scrubs and lower CDN/origin load.

## Phase 4 — Backend service contract for Mapbox + Web app

Primary endpoints are tiles-first. GeoJSON endpoints remain for debugging and small bbox.

### Time + watermark sync (required)
```
GET /api/time
```
Response:
- server_now (UTC)
- datasets: [{dataset_id, as_of, max_observed_at, ingest_lag_s}]
- recommended_live_sv token (for live mode cache keys)

Add network health summary (recommended; powers right-side HUD):
- network: {
    active_station_count,
    empty_station_count,
    full_station_count,
    pct_serving_grade,
    worst_5_station_keys_by_severity,
    tile_origin_p95_ms (optional),
    client_should_throttle (boolean hint)
  }

Frontend freshness rules (recommended):
- If ingest_lag_s > 2x ttl for station_status: show banner Live data delayed
- If station_information is older than N days: show banner Station metadata may be stale
- If sv changes during live mode: animate subtle data updated tick (UX polish)

`GET /api/config?v=1`
Returns:
- bucket_size_seconds (e.g., 300)
- severity_version default (e.g., sev.v1)
- severity_legend_bins (for UI legend)
- map defaults: initial center/zoom, max bounds, preferred min/max zoom
- allowed speed presets (1x, 10x, 60x)
- cache policy hints (live tile max-age)

### Timeline metadata (required for scrub UX)
```
GET /api/timeline?v=1&sv=...
```
Returns:
- available_range: [min_observation_ts, max_observation_ts]
- bucket_size_seconds
- gap_intervals (optional, coarse): [{start, end}] where serving-grade data is missing
- live_edge_ts (max_observation_ts) for snapping replay -> live

Add scrubber density endpoint (recommended) [A-OPT]:
```
GET /api/timeline/density?v=1&sv=...&bucket=300s
```
Returns (bounded, cacheable):
- points: [{bucket_ts, pct_serving_grade, empty_rate, full_rate, optional: severity_p95}]
Purpose: render scrubber activity + gaps without any tile traffic.

### Static stations layer (long cache)
```
GET /api/tiles/stations/{z}/{x}/{y}.mvt?v=1
```
Properties (required): station_key, name, capacity, active, geom (implicit by feature)
Properties (optional): short_name, region_id
Cache-Control: public, max-age=86400 (or longer) + ETag

### Dynamic inventory and severity layers (short cache in live, immutable in replay)
Profile A (required): composite tile to minimize requests
```
GET /api/tiles/composite/{z}/{x}/{y}.mvt?v=1&tile_schema=tile.v1&T_bucket=...&sv=...&severity_version=sev.v1&layers=inv,sev,press,epi
```

Profile B (optional): split tiles if you need independent cache policies per layer
```
GET /api/tiles/inventory/{z}/{x}/{y}.mvt?v=1&T_bucket=...&sv=...
GET /api/tiles/severity/{z}/{x}/{y}.mvt?v=1&T_bucket=...&sv=...&severity_version=sev.v1
```
Properties (inventory): station_key, bikes, docks, flags, observation_ts_bucket
Properties (severity): station_key, severity, severity_version, (optional) compact components, observation_ts_bucket
Properties (composite, required minimum for Inspect):
- station_key
- bikes_available, docks_available
- observation_ts_bucket (echoed T_bucket)
- bucket_quality
Properties (composite, optional): severity, pressure, episode markers, compact components
Properties (composite): tile_schema_version (echoed)

Rule:
- Any change to feature properties, encoding, or layer composition increments `tile_schema_version`
  and becomes a new cache namespace.

Frontend rule (required):
- On click, resolve name/capacity from stations tile feature props and bikes/docks from composite feature props (no API call required for the basic Inspect panel).
Cache-Control:
- live: public, max-age=5..15 seconds (ttl-aligned)
- replay (sv pinned): public, max-age=31536000, immutable

Cost rule (required in Profile A):
- At any moment, the map should have at most:
  - 1 static stations source
  - 1 composite dynamic source
- All other layers are client-side styles over those two sources.

Cache key invariant (required):
- All tile URLs must be immutable identifiers of the response:
  - layer + z/x/y + T_bucket + sv + severity_version (+ metrics if any)

### Debug GeoJSON (small bbox only)
```
GET /api/status?v=1&bbox=...&T=...&sv=...&format=geojson
```
Response: FeatureCollection (same properties as tile layer)

### Station detail (for click drawer)
```
GET /api/stations/{station_key}?T=...&sv=...
```
Returns:
- station metadata (capacity, name, location)
- current/nearest-bucket status at T
- trailing window stats (last W minutes)
- most recent empty/full episode(s) + durations

Station drawer UX (required):
- Tier 1 (instant, no API call):
  - name, capacity (from stations tile)
  - bikes/docks, bucket timestamp, bucket_quality (from composite tile)
  - small status line: Bikes: X • Docks: Y • Updated: <T_bucket>
- Tier 2 (optional, on-demand):
  - fetch evidence bundle only when user clicks Details or when drawer is pinned open > N ms
  - endpoint: /api/stations/{station_key}/drawer (downsampled series + episodes + severity components)

Network rule (Profile A required):
- Opening Tier 1 must never require origin traffic (works purely from tile payloads).

Add station series endpoint (recommended; makes drawer fast + rich):
```
GET /api/stations/{station_key}/series?v=1&sv=...&start=...&end=...&bucket=60s
```
Returns:
- bucketed bikes/docks series
- bucketed severity series (if requested) with severity_version
- episode markers within range (start/end/duration/censored)

Drawer bundle (recommended; fewer round trips):
```
GET /api/stations/{station_key}/drawer?v=1&sv=...&T_bucket=...&range=6h
```
Returns:
- metadata + lifecycle
- point-in-time values at T_bucket (inventory, severity, pressure proxy)
- downsampled series (server-decimated) for the requested range
- episode markers in-range
- severity_components (explainability) with severity_version

Performance contract:
- drawer endpoint must be single-digit KB for default range (e.g., 6h) via decimation.

### Search (UX-critical)
```
GET /api/search?q=...&bbox=... (optional)
```
Returns station matches by name/short_name + station_key.

Search UX (bikemap-style):
- Selecting a search result:
  - flyTo station location
  - apply temporary pulse highlight via feature-state
  - open station drawer with details at current T_bucket

Additional endpoints (high value; debuggable + compelling):
- `GET /api/as_of`:
  - returns latest watermark per dataset/feed + ingest lag stats (what data are we looking at?)
- `GET /api/reliability/explain?station_id=...&day=...&sv=...`:
  - returns episode evidence (worst incidents, censored counts, last snapshots)
This makes metrics defensible and dramatically improves trust in outputs.

Policy endpoints (required for rebalancing feature) [A-REQ]:
```
GET /api/policy/config?v=1
```
Returns: available policy_versions + default policy + allowed budget presets.

```
GET /api/policy/run?v=1&policy_version=...&sv=...&T_bucket=...
```
Serving rule (required) [A-REQ]:
- If cached policy_run exists: return 200 with the run summary.
- If missing: enqueue `policy.run_*` and return 202 with:
  - `retry_after_ms`, `cache_key`, `status=pending`
- Policy compute must be budgeted separately from tiles; under overload, policy always degrades first.

```
GET /api/policy/moves?v=1&policy_version=...&sv=...&T_bucket=...
```
Returns: sparse move list (from,to,bikes_moved,dist_m) bounded to top-N moves.

Policy tiles (recommended) [A-OPT]:
```
GET /api/tiles/policy_moves/{z}/{x}/{y}.mvt?v=1&T_bucket=...&sv=...&policy_version=...
```
Renders move vectors (or origin stations heat) for visual explanation.

Frontend UX (required) [A-REQ]:
- Add a HUD toggle: Rebalancing (Policy)
  - off | show recommendations | show counterfactual delta (if simulated)
- Drawer: Policy suggestion panel for selected station:
  - suggested in/out bikes at T_bucket, plus nearest counterparties.

Contract improvements:
- `bbox=minLon,minLat,maxLon,maxLat` for spatial filtering
- `sv` pins the serving view (debuggable + cacheable)
- Return `ETag` and `Cache-Control` headers for map clients

Operational endpoints (recommended):
- `GET /healthz` (DB connectivity + latest watermark freshness)
- `GET /metrics` (Prometheus format; ingest lag, queue depth, error rates)

Observability (recommended):
- Emit structured logs with correlation IDs: attempt_id, logical_snapshot_id, raw_object_sha256
- Add OpenTelemetry tracing across:
  - fetch span (DNS/TTFB/download) -> enqueue span -> load span (db txn timing)
- Add `GET /api/pipeline_state`:
  - current queue depth, DLQ depth, last successful ingestion per feed, p95 end-to-end latency, circuit breaker status

### Tile + aggregate performance rules (required)
- Never serve map playback directly from raw snapshot_station_status for normal operation.
- All map playback reads from bucketed aggregates (1m status, 5m severity).
- Tile cache key includes:
  - layer (stations|status), z/x/y, metrics, T_bucket, sv
- Enforce query budgets:
  - tile query p95 < 150ms (DB time)
  - station detail p95 < 250ms
  - explain endpoint can be slower but must be bounded (pagination, max range)

Tile compute contract (required) [A-REQ]:
- Use a single canonical SQL shape per tile type (no dynamic joins per request).
- Spatial bound must be expressed as `geom && ST_TileEnvelope(z,x,y)` (or equivalent) to guarantee GiST usage.
- MVT generation must use ST_AsMVTGeom with fixed extent (e.g., 4096) and buffer (e.g., 64).
- Enforce per-tile caps:
  - `max_features_per_tile` (default 5k) with deterministic downsampling (stable station_key order).
  - `max_bytes_per_tile` (default ~200KB) -> if exceeded, drop optional properties first (components/episodes/pressure).
- Composite tile property policy:
  - required minimal Inspect props always included
  - optional props are tiered and dropped under load or size pressure.

Optional: Redis for hot tiles/station detail
- Cache very hot (z<=12 Manhattan) tiles for live mode with short TTL
- Cache station detail responses keyed by (station_key, T_bucket, sv)

## Implementation checklist (what to code, in order)

Milestone 1 — Data truth pipeline (exit criteria: reproducible replay for a 24h window) [A-REQ]:
- Docker compose: Postgres + your collector
- GBFS collector (ttl-based cron/loop)
- Raw archive writing + DB normalization
- Daily reliability materialization
- Queue + DLQ wiring (minimal, but do it now)
- Ingest health materialized views + basic alert thresholds

Determinism + correctness tests (do early):
- Golden payload tests: raw bytes -> parsed canonical JSON -> parquet schema hash
- Idempotency tests: replay same logical_snapshot_id twice -> no row count change
- Replay determinism: rebuild a fixed date range -> identical marts + episode counts
- Invariant tests: uniqueness constraints, monotonic publisher_last_updated, station_key join coverage thresholds

Contract test suite (required) [A-REQ]:
- A checked-in `fixtures/` set:
  - GBFS raw bytes (gz) + manifest + expected parse output hash
  - A mini month trips sample (sanitized) with expected aggregates
- Deterministic DB assertions:
  - rowcount + checksum per table for a seeded run
- Tile assertions:
- for fixed bbox/z and fixed T_bucket/sv: feature_count and stable property presence checks
Rule: any change to severity/parsers/loaders must update fixtures intentionally (reviewable diffs).

Add policy fixture tests (required) [A-REQ]:
- Given a fixed stations_current + station_status_1m bucket, greedy.v1 must produce:
  - identical `policy_moves` ordering + bikes_moved totals
  - never exceed budgets (B bikes, S stations) and never violate [0, capacity] bounds
- Add a runtime bound test:
  - greedy step must complete under X ms for N≈2000 stations using K-limited matching.

Greedy tie-break determinism (required) [A-REQ]:
- When multiple edges have equal distance, break ties by:
  1) larger transferable x first
  2) then stable station_key lexicographic (from, to)
- This prevents nondeterminism across runtimes/DB ordering.

Add (early) tooling for replay/backfill:
- CLI: `replay_gbfs --feed station_status --from ... --to ... --loader-version vX`
- CLI: `rebuild_metrics --from ... --to ...`
- Ensure loaders are idempotent and keyed by `logical_snapshot_id` / `publisher_last_updated`

Milestone 2 — Baseline pressure dataset (exit criteria: one completed-month ingested + pressure tiles) [A-REQ]:
- Trip downloader + loader
- Completed-month baseline ingestion + monthly flow aggregates
- Join flows into reliability outputs

Milestone 3 — Tiles-first web app (exit criteria: bikemap-style HUD + permalinks + station inspect) [A-REQ]:
- Tiles-first API (stations + composite dynamic tiles)
- /api/time + /api/stations/{station_key} + search
- Vite app with map, time scrubber, station drawer, permalinks

## References (placed where used above; duplicated here for convenience)
- MacWright bikeshare GBFS archive approach: https://macwright.com/2023/09/17/bikeshare-1
- Citi Bike trip history downloads: https://citibikenyc.com/system-data
- NYC Comptroller GBFS collection/analysis repo: https://github.com/NYCComptroller/citi-bike-gbfs

## Commentary and rationale (expanded)

### Product scope and UX

The product is map-first with a full-bleed canvas to keep Mapbox stable and avoid reinitialization costs. HUD overlays are intentionally minimal and layered so panning/zooming remains primary. Inspect mode freezes playback to keep the view deterministic and trustworthy while reading evidence. This avoids UX drift (tiles changing while a user reads) and keeps cache keys stable.

### Profiles and cost posture

Profile A keeps the system under $50/year by minimizing always-on infra and leaning on CDN caches + object storage for replay. Profile B is explicitly opt-in. Any new infra or dependency should be justified in terms of cost, operational benefit, and why it cannot be done within Profile A.

### Serving views and reproducibility

Serving view tokens (`sv`) capture all upstream watermarks so replay is reproducible across GBFS, trips, severity specs, and tile schema versions. This also bounds cache keyspace and prevents mixing incompatible inputs in composite tiles. `sv` tokens are the only public-facing handle for state.

### Data ingestion and raw archive

Raw GBFS and trip artifacts are the source of truth. Every derived table is rebuildable via manifests and serving views. The archive layout is intentionally simple and deterministic to support replays and avoid silent drift in parsing or schema evolution.

### Tile serving and cache safety

Tiles are the highest QPS surface. Composite tiles in Profile A reduce request fan-out, and tile schema versioning prevents accidental cache poisoning when properties change. The tile compute contract enforces a stable SQL shape, deterministic caps, and fixed MVT settings to keep latency predictable.

### Severity and policy versioning

Severity and policy outputs are versioned, hashed, and tied to allowlists. This prevents silent behavior changes and keeps caches correct. Any change to formulas or constraints must result in a new namespace so old permalinks remain reproducible.

### Policy plane intent

Greedy v1 is designed as a budgeted, local control policy suitable for Profile A. It is deterministic, bounded, and meant for counterfactual evaluation in replay. Live mode is shadow-only until evaluation metrics are trusted.

### Security and abuse model

The system assumes anonymous, potentially abusive traffic. Keyspace is bounded by allowlists and `sv` tokens, while edge caching and deterministic degrade ladders prevent origin stampedes. Admin endpoints remain isolated and authenticated.

### Testing and contract fixtures

Fixtures and contract tests ensure that parsing, serving, and policy outputs remain deterministic. Any versioned change requires explicit fixture updates so future maintainers can reason about intentional differences.
