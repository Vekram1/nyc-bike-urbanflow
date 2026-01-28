# UrbanFlow Twin v1 Plan (Frozen)

Plan Overview
Goal: Deliver a replayable Manhattan Citi Bike digital twin with counterfactual rebalancing and an interactive ops console. This plan locks assumptions to minimize rework and keep replay deterministic.

Locked v1 Assumptions
- Replay mode: Mode A (exogenous delta replay; observed deltas do not change after interventions).
- Reliability gating: exclude unreliable bins from optimization, report unreliable minutes separately in KPIs.
- Effective capacity policy: status sum > 0, else station_information.capacity > 0, else unreliable.
- Distance model: EPSG:2263 projected distance for all travel-time calculations.
- Truck model: teleport to first pickup, enforce travel-time constraints thereafter.
- Contracts: OpenAPI generated from FastAPI is source of truth; frontend consumes generated TS types.

Conventions
- Time granularity: 60-second ingest cadence, 5-minute binning for replay/simulation.
- Travel time quantization: convert to integer 5-minute steps with handling time included.
- Manhattan boundary: strict polygon contains; no buffer applied in v1.

Proposed File Structure (Tree)
.
├── PLAN.md
├── README.md
├── .env.example
├── shared
│   ├── openapi
│   │   └── openapi.json
│   └── types
│       ├── api.d.ts
│       └── api.ts
├── ingest
│   ├── README.md
│   ├── pyproject.toml
│   ├── src
│   │   ├── ingest
│   │   │   ├── __init__.py
│   │   │   ├── config.py
│   │   │   ├── gbfs_client.py
│   │   │   ├── poller.py
│   │   │   ├── validators.py
│   │   │   ├── parser.py
│   │   │   └── recorder.py
│   │   ├── db
│   │   │   ├── __init__.py
│   │   │   ├── engine.py
│   │   │   ├── models.py
│   │   │   └── migrations
│   │   │       └── README.md
│   │   └── utils
│   │       ├── __init__.py
│   │       ├── time.py
│   │       └── geo.py
│   └── tests
│       └── test_poller.py
├── backend
│   ├── README.md
│   ├── pyproject.toml
│   ├── src
│   │   ├── app
│   │   │   ├── __init__.py
│   │   │   ├── main.py
│   │   │   ├── config.py
│   │   │   ├── deps.py
│   │   │   └── logging.py
│   │   ├── api
│   │   │   ├── __init__.py
│   │   │   ├── routes
│   │   │   │   ├── stations.py
│   │   │   │   ├── state.py
│   │   │   │   ├── replay.py
│   │   │   │   ├── faults.py
│   │   │   │   ├── metrics.py
│   │   │   │   ├── simulate.py
│   │   │   │   └── optimize.py
│   │   │   └── schemas
│   │   │       ├── common.py
│   │   │       ├── stations.py
│   │   │       ├── replay.py
│   │   │       ├── faults.py
│   │   │       ├── metrics.py
│   │   │       ├── simulate.py
│   │   │       └── optimize.py
│   │   ├── core
│   │   │   ├── __init__.py
│   │   │   ├── binning.py
│   │   │   ├── reliability.py
│   │   │   ├── nowcast.py
│   │   │   ├── capacity.py
│   │   │   └── distance.py
│   │   ├── simulator
│   │   │   ├── __init__.py
│   │   │   ├── engine.py
│   │   │   ├── inventory.py
│   │   │   └── scoring.py
│   │   ├── optimizer
│   │   │   ├── __init__.py
│   │   │   ├── candidates.py
│   │   │   ├── constraints.py
│   │   │   ├── solver.py
│   │   │   └── tie_breakers.py
│   │   ├── db
│   │   │   ├── __init__.py
│   │   │   ├── engine.py
│   │   │   ├── models.py
│   │   │   ├── queries.py
│   │   │   └── migrations
│   │   │       └── README.md
│   │   └── services
│   │       ├── __init__.py
│   │       ├── replay_service.py
│   │       ├── metrics_service.py
│   │       ├── faults_service.py
│   │       └── optimization_service.py
│   └── tests
│       ├── test_reliability.py
│       ├── test_simulator.py
│       └── test_optimizer.py
├── frontend
│   ├── README.md
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── public
│   │   └── styles
│   │       └── map-style.json
│   ├── src
│   │   ├── app
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── providers.tsx
│   │   ├── components
│   │   │   ├── MapView.tsx
│   │   │   ├── StationLayer.tsx
│   │   │   ├── ReplayControls.tsx
│   │   │   ├── OptimizationPanel.tsx
│   │   │   ├── KPIPanel.tsx
│   │   │   ├── StationDrawer.tsx
│   │   │   └── Legend.tsx
│   │   ├── data
│   │   │   ├── api.ts
│   │   │   ├── queries.ts
│   │   │   └── adapters.ts
│   │   ├── hooks
│   │   │   ├── useReplay.ts
│   │   │   ├── useStations.ts
│   │   │   └── useOptimize.ts
│   │   ├── layers
│   │   │   ├── stationDots.ts
│   │   │   ├── rebalancingArcs.ts
│   │   │   ├── heatmap.ts
│   │   │   └── clusters.ts
│   │   ├── styles
│   │   │   ├── globals.css
│   │   │   ├── theme.css
│   │   │   └── tokens.css
│   │   └── utils
│   │       ├── format.ts
│   │       ├── time.ts
│   │       └── colors.ts
│   └── tests
│       └── replay.spec.ts
├── infra
│   ├── docker
│   │   ├── docker-compose.yml
│   │   └── postgres-init
│   │       └── schema.sql
│   └── scripts
│       ├── export_parquet.sh
│       └── generate_types.sh
└── data
    ├── manhattan
    │   ├── borough.geojson
    │   └── borough.buffered.geojson
    └── replay
        └── README.md

Phase 0 — Project Setup & Contracts
- Define repo layout: /frontend, /backend, /ingest, /shared, /infra.
- Establish OpenAPI as source of truth from FastAPI; frontend consumes generated TS types.
- Document env var configuration and defaults (GBFS URLs in .env.example).
- Acceptance:
  - OpenAPI types flow frontend <- backend.
  - Env config documented, no hardcoded feed URLs.

Phase 1 — Ingestion & Hot Store
- Build GBFS poller (60s) for station_information + station_status.
- Reject snapshots if feed timestamp unchanged.
- Store raw payload + parsed fields.
- Persist to Postgres:
  - snapshots header (snapshot_id, ts, feed_ts, ingest_meta, is_valid)
  - snapshot_station_status child rows
  - stations static table with geometry (WGS84) and capacity fallback
- Manhattan filter by strict polygon contains (no buffer).
- Acceptance:
  - Reliable ingest with feed timestamp advance checks.
  - Raw payload retained.
  - Manhattan-only station set persisted.

Phase 2 — Binning & Reliability Logic
- Compute 5-minute bins:
  - inventory/delta per station
  - empty/full flags
- Effective capacity policy:
  - status sum > 0 -> capacity_source = status_sum
  - else station_info.capacity > 0 -> capacity_source = station_info
  - else mark unreliable
- Reliability flags:
  - is_reliable_bin
  - reliability_reason enum (offline, disabled, capacity_missing, status_invalid)
- Acceptance:
  - Bins carry reliability flags and capacity source.
  - Unreliable bins are identifiable and separable.

Phase 3 — Replay & Metrics APIs (FastAPI)
- /stations: metadata + geometry + capacity.
- /state: latest bin with reliability + risk.
- /replay: 5-minute bins by time range.
- /faults: split operational failures vs unreliable/outage minutes.
- /metrics: failure-minutes aggregates, hotspots, long failures.
- Acceptance:
  - Reliable bins used for operational KPIs.
  - Unreliable minutes exposed separately.

Phase 4 — Nowcasting (30-minute Window)
- Compute 30-min net drift per station.
- Project time-to-empty/full; map to risk in [0,1]:
  - risk = 1 if crossing < 15 min
  - taper to 0 by 60 min
- Expose time-to-empty/full + risk in /state and /stations.
- Acceptance:
  - Risk is interpretable and consistent in UI and API.

Phase 5 — Simulation Core (Mode A)
- 5-minute discrete simulator:
  - apply interventions first
  - advance using observed deltas (exogenous)
  - enforce 0 <= inventory <= capacity
- Skip unreliable bins for KPI scoring.
- Acceptance:
  - Deterministic replay; no negative or over-capacity states.
  - Explicit Mode A assumption documented.

Phase 6 — Optimization (OR-Tools / Greedy)
- Candidate generation: at-risk receivers + feasible donors.
- EPSG:2263 distances; convert to integer 5-minute steps.
- Travel model: distance/12 kmh + 3-min handling; quantized.
- Truck model: teleport to first pickup; enforce travel times thereafter.
- Objective: minimize failure-minutes; tie-breakers:
  1) fewer moves 2) shorter travel 3) smaller moved quantity
- Return "no feasible plan" with reasons if constraints fail.
- Acceptance:
  - Plan always feasible under constraints.
  - Optimization ignores unreliable bins.

Phase 7 — Frontend (Next.js + Mapbox GL + deck.gl)
- Map: stations with risk/failure coloring; clusters/heatmaps.
- Playback: 5-min scrubber + prefetch for smooth replay.
- Controls: horizon (30/60/120), trucks, capacity, Optimize, Compare toggle.
- Views: Baseline / Plan / Difference.
- Station drawer: inventory timeline (baseline vs plan), failure strip, time-to-empty/full.
- KPI panel: operational failure minutes vs unreliable/outage minutes.
- Acceptance:
  - Visual parity with bikemap.nyc feel.
  - Clear operational vs data-quality separation.

Phase 8 — Cold Path (Optional v1)
- Export Parquet partitions by day/hour.
- DuckDB server-side for batch metrics.
- DuckDB WASM optional (not a blocker).
- Acceptance:
  - Parquet export works; analytics not required for demo.

Phase 9 — QA & Observability
- Tests:
  - inventory bounds
  - plan feasibility
  - reliability gating
- Ingest health: lag/stale metrics and feed timestamp drift.
- Acceptance:
  - Demo-safe reliability checks in place.

Phase 10 — Demo Script
- Select "known bad moment" with multiple station failures.
- Replay baseline -> run optimize -> show reduced failure window.
- Capture before/after KPI deltas and station examples.
- Acceptance:
  - Single narrative demonstrates diagnosis + counterfactual improvement.
