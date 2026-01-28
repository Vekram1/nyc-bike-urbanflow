# UrbanFlow Twin Frontend Spec

## Goals
- Map-first ops console inspired by bikemap.nyc.
- Replay and counterfactual planning are the core workflows.
- Keep baseline vs plan behavior explicit and honest.

## Layout
- Full-bleed map dominates the view.
- Bottom time scrubber for replay.
- Compact control stack for optimize + KPIs.
- Station drawer for detailed baseline/plan comparison.

## Modes
- Baseline mode: observed GBFS deltas only.
- Plan mode: counterfactual inventory (baseline + intervention offset).
- Difference mode: plan minus baseline deltas and failure reduction.

## Animation + Movement
- Default state is mostly static per time step.
- Replay: stations pulse on observed changes; color transitions per bin.
- Plan: arcs animate only when optimization is active.

## Station Dots
- Color by risk (green -> amber -> red).
- Pulse on change between bins (baseline), amber-tinted pulse in plan.
- Difference mode visualizes net improvement.

## Station Drawer
Show at selected time:
- baseline inventory (x_t)
- plan inventory (x_t + intervention offset)
- inflow/outflow for bin (observed deltas, unchanged)
- baseline vs plan failure flags
- time-to-empty/full baseline vs plan

## Replay Scrubber
- 5-minute bins.
- Prefetch adjacent windows for smooth playback.
- Current timestamp displayed on scrub.

## KPI Panel
- Operational failure-minutes (reliable bins only).
- Unreliable/outage minutes shown separately.
- Plan vs baseline delta shown when in plan mode.

## Map Provider
- Current: MapLibre + local style JSON.
- Optional: Mapbox (token required) for higher-quality basemap.

## Env Vars
- `NEXT_PUBLIC_MAPBOX_TOKEN`: Mapbox access token for frontend map rendering.
