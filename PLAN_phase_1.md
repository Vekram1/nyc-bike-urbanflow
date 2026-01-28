# UrbanFlow Phase 1 Plan (Baseline Replay)

## Goal
Deliver a baseline-only replay experience for Dec 1, 2025 12:00-1:00 PM with a map-first UI inspired by bikemap.nyc.

## Scope (Phase 1 Only)
- Baseline-only replay (no rebalancing, no counterfactuals).
- 5-minute bins across a fixed 1-hour window.
- Station dots sized by bikes available, colored by risk.
- Click pauses replay and opens an anchored floating card.
- KPI panel shows operational failure minutes and unreliable minutes.

## Proposed Directory Structure
.
├── PLAN_phase_1.md
├── frontend
│   ├── public
│   │   └── styles
│   │       └── map-style.json
│   └── src
│       ├── app
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   └── providers.tsx
│       ├── components
│       │   ├── MapView.tsx
│       │   ├── StationLayer.tsx
│       │   ├── StationCard.tsx
│       │   ├── ReplayControls.tsx
│       │   └── KPIPanel.tsx
│       ├── data
│       │   ├── api.ts
│       │   ├── queries.ts
│       │   └── adapters.ts
│       ├── hooks
│       │   ├── useReplay.ts
│       │   └── useStations.ts
│       ├── layers
│       │   └── stationDots.ts
│       ├── styles
│       │   ├── globals.css
│       │   ├── theme.css
│       │   └── tokens.css
│       └── utils
│           ├── format.ts
│           ├── time.ts
│           └── colors.ts
└── backend
    └── src
        └── api
            └── routes
                ├── stations.py
                ├── state.py
                ├── replay.py
                └── metrics.py

## UX Requirements
### Map
- Full-bleed map dominates the view.
- Station dots sized by bikes available.
- Station dots colored by risk (green -> amber -> red).
- Click on a station pauses replay and opens an anchored floating card.

### Station Card (Anchored)
- Station name (from GBFS station_information).
- Bikes available, docks available, capacity.
- Net delta for the last bin.
- Reliability status and empty/full flags.

### Replay Controls
- 5-minute bins.
- Fixed time window: Dec 1, 2025 12:00-1:00 PM (America/New_York).
- Play/pause and scrubber.
- Prefetch adjacent bins for smooth playback.

### KPI Panel
- Operational failure-minutes (reliable bins only).
- Unreliable/outage minutes shown separately.

## Data Expectations (Phase 1)
### Station Metadata
- station_id
- name
- lat/lon
- capacity

### Replay State (Per Bin)
- timestamp: ISO 8601 string, 5-minute boundary (left edge)
- bikes_available: integer, >= 0
- docks_available: integer, >= 0
- capacity: integer, >= 0 (effective capacity for the bin)
- delta_bikes: integer (net change over the bin; + means bikes added)
- risk: float in [0, 1]
- is_reliable: boolean
- failure_empty: boolean
- failure_full: boolean

## Demo Window Contract
- Timezone: America/New_York.
- Window start: 2025-12-01T12:00:00-05:00.
- Window end: 2025-12-01T13:00:00-05:00 (exclusive).
- Bin cadence: 5 minutes (12 bins total).
- Bin timestamps are the left edge of each interval (e.g., 12:00, 12:05, ... 12:55).

## Architecture Decisions (Phase 1)
### Data Source + API
- Use FastAPI for replay data in Phase 1 to keep iteration fast.
- Endpoints required: `/stations`, `/state`, `/replay`, `/metrics`.
- `/replay` returns 5-minute bins for the fixed 1-hour window.
- `/state` returns the current bin and reliability flags for the selected time.
- Frontend owns replay clock; API is read-only.

### Storage + DB
- Source of truth for Phase 1 is the existing backend storage (Postgres).
- Only the fixed window is required for initial demo (Dec 1, 2025 12:00-1:00 PM).
- No DuckDB/parquet in Phase 1; migration planned for Phase 2.

### Data Flow
- Frontend loads station metadata once on startup.
- Replay state is fetched by time window and cached client-side.
- Prefetch one bin ahead and one bin behind for scrub smoothness.
- Metrics are fetched once per session (baseline only).

## Animation + Interaction Decisions
### Replay
- 5-minute bins advance in discrete steps (no continuous tweening of inventory).
- Target playback rate: 1 hour of replay completes in 30 seconds.
- With 5-minute bins (12 bins/hour), advance every ~2.5 seconds per bin.
- Pausing freezes map state and opens station card when clicking.

### Station Dot Animation
- Pulse on bin change when `delta_bikes != 0`.
- Pulse intensity proportional to `abs(delta_bikes)`.
- Color transitions are eased between bins (short, 150-250ms).

### Station Card Behavior
- Anchored to the clicked station coordinate on the map.
- Closes on map click or ESC; replay resumes only when explicitly unpaused.
- Uses the selected bin snapshot (not live updates while paused).

## Acceptance Criteria
- Map loads with stations for Dec 1, 2025 12:00-1:00 PM.
- Station dots size by bikes available and color by risk.
- Clicking a station pauses playback and opens the anchored card.
- Card displays name, bikes, docks, capacity, delta, reliability.
- KPI panel shows operational vs unreliable minutes.
