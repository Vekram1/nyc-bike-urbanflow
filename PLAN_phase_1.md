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
- short_name (optional)
- region_id (optional)
- station_type (optional)
- lat/lon
- geom (Point, 4326)
- capacity (nullable)
- is_manhattan
- active

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
- Use TimescaleDB for raw snapshots and 5-minute bins.
- Store typed columns only; avoid raw JSON payloads for station_status.
- Station metadata is slow-changing; upsert on change, not every minute.
- Continuous aggregates power replay; Python batch reserved for later analytics.

### Data Flow
- Ingest writes 60-second snapshot rows to Timescale hypertable.
- Continuous aggregates compute 5-minute bins for replay.
- Frontend loads station metadata once on startup.
- Replay state is fetched by time window and cached client-side.
- Prefetch one bin ahead and one bin behind for scrub smoothness.
- Metrics are fetched once per session (baseline only).

## Timescale Schema (Proposed)
### Tables
- stations: station metadata (slow-changing).
- snapshots: snapshot headers with feed_ts and row counts.
- snapshot_station_status: time-series rows (hypertable on ts).
- station_bins_5m: continuous aggregate for replay bins.

### SQL Plan
```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS stations (
  station_id TEXT PRIMARY KEY,
  name TEXT,
  short_name TEXT NULL,
  region_id TEXT NULL,
  station_type TEXT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  geom GEOGRAPHY(Point, 4326),
  capacity INTEGER NULL,
  is_manhattan BOOLEAN NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_updated TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id UUID PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  feed_ts TIMESTAMPTZ NOT NULL,
  station_row_count INTEGER NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  error_reason TEXT NULL,
  ingest_meta JSONB NULL
);

CREATE TABLE IF NOT EXISTS snapshot_station_status (
  ts TIMESTAMPTZ NOT NULL,
  feed_ts TIMESTAMPTZ NOT NULL,
  snapshot_id UUID NOT NULL,
  station_id TEXT NOT NULL,
  bikes_available INTEGER NOT NULL,
  docks_available INTEGER NOT NULL,
  is_installed BOOLEAN NOT NULL,
  is_renting BOOLEAN NOT NULL,
  is_returning BOOLEAN NOT NULL,
  disabled_bikes INTEGER NOT NULL DEFAULT 0,
  disabled_docks INTEGER NOT NULL DEFAULT 0,
  is_reliable BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (station_id, ts)
);

SELECT create_hypertable('snapshot_station_status', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_status_station_ts ON snapshot_station_status (station_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_status_ts ON snapshot_station_status (ts DESC);
CREATE INDEX IF NOT EXISTS idx_status_snapshot_id ON snapshot_station_status (snapshot_id);

CREATE OR REPLACE VIEW manhattan_stations_v AS
SELECT *
FROM stations
WHERE active = TRUE AND is_manhattan = TRUE;

CREATE MATERIALIZED VIEW IF NOT EXISTS station_bins_5m
WITH (timescaledb.continuous) AS
SELECT
  station_id,
  time_bucket('5 minutes', ts) AS bin_ts,
  last(bikes_available, ts) AS bikes_last,
  last(docks_available, ts) AS docks_last,
  min(bikes_available) AS bikes_min,
  min(docks_available) AS docks_min,
  count(*) AS snapshots_in_bin,
  bool_and(is_installed) AS all_installed,
  bool_and(is_renting) AS all_renting,
  bool_and(is_returning) AS all_returning
FROM snapshot_station_status
GROUP BY station_id, time_bucket('5 minutes', ts);

CREATE OR REPLACE VIEW station_bins_5m_v AS
SELECT
  station_id,
  bin_ts,
  bikes_last,
  docks_last,
  bikes_min,
  docks_min,
  snapshots_in_bin,
  (snapshots_in_bin >= 3) AND all_installed AND all_renting AND all_returning AS is_reliable_bin,
  (bikes_min = 0) AS empty_any,
  (docks_min = 0) AS full_any
FROM station_bins_5m;

SELECT add_continuous_aggregate_policy('station_bins_5m',
  start_offset => INTERVAL '6 hours',
  end_offset   => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes');

ALTER TABLE snapshot_station_status
  SET (timescaledb.compress, timescaledb.compress_orderby = 'ts DESC');

SELECT add_compression_policy('snapshot_station_status', INTERVAL '2 days');
SELECT add_retention_policy('snapshot_station_status', INTERVAL '14 days');

ALTER MATERIALIZED VIEW station_bins_5m
  SET (timescaledb.compress, timescaledb.compress_orderby = 'bin_ts DESC');

SELECT add_compression_policy('station_bins_5m', INTERVAL '30 days');
```

### Continuity Checks
```sql
SELECT ts, feed_ts, station_row_count, is_valid, error_reason
FROM snapshots
ORDER BY ts DESC
LIMIT 20;

SELECT
  COUNT(*) FILTER (WHERE feed_ts <= lag(feed_ts) OVER (ORDER BY ts)) AS non_monotonic
FROM snapshots;

WITH latest AS (
  SELECT snapshot_id, ts
  FROM snapshots
  ORDER BY ts DESC
  LIMIT 1
),
counts AS (
  SELECT
    (SELECT COUNT(*) FROM snapshot_station_status s
     JOIN latest l ON s.snapshot_id = l.snapshot_id) AS row_count,
    (SELECT COUNT(*) FROM manhattan_stations_v) AS station_count
)
SELECT row_count, station_count,
       row_count::float / NULLIF(station_count, 0) AS coverage_ratio
FROM counts;

SELECT bin_ts, MIN(snapshots_in_bin) AS min_snapshots
FROM station_bins_5m
GROUP BY bin_ts
ORDER BY bin_ts DESC
LIMIT 12;
```

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
