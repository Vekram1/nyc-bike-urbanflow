# Serving Aggregates

Bead: `nyc-bike-urbanflow-an0`

This document defines refresh cadence, lineage, and observability for:
- `station_status_1m`
- `station_severity_5m`
- `station_pressure_now_5m`

## Refresh cadence
- `station_status_1m`: every minute, rolling window over recent snapshots.
- `station_severity_5m`: every 5 minutes after `station_status_1m` refresh.
- `station_pressure_now_5m`: every 5 minutes after `station_status_1m` refresh.
  - includes `pressure_score`, `delta_bikes_5m`, `delta_docks_5m`,
    `volatility_60m`, `rebalancing_suspected`.

Recommended execution order per system:
1. `refresh_station_status_1m(system_id, from_ts, to_ts)`
2. `refresh_station_severity_5m(system_id, from_ts, to_ts, severity_version)`
3. `refresh_station_pressure_now_5m(system_id, from_ts, to_ts, proxy_method)`
   - computes deterministic 5-minute deltas, trailing 60-minute volatility
     (12 buckets), and rebalancing heuristic flags.

`scripts/rebuild_serving_aggregates.sql` provides a deterministic rebuild template.

## Lineage + sv binding
- `station_status_1m` stores:
  - `source_logical_snapshot_id`
  - `source_as_of_ts` (`logical_snapshots.publisher_last_updated`)
- `station_severity_5m` and `station_pressure_now_5m` carry `source_as_of_ts` forward.

These fields are the aggregate-side lineage inputs for serving views. Public requests
remain `sv`-bound and never accept raw `as_of`.

Pressure source selection (tiles):
- Composite tiles resolve pressure source from `sv`-bound serving view metadata.
- If `trips_baseline_id` is present in the serving view spec, press layer uses
  baseline inflow/outflow aggregates (`station_inflows_monthly` / `station_outflows_monthly`).
- If not present, press layer falls back to `station_pressure_now_5m` live proxy.
- No public query params control this switch; keyspace remains bounded by `sv`.

## Bucket quality policy
- Bucket quality is propagated as `ok` | `degraded` | `blocked`.
- `severity_5m` and `pressure_now_5m` aggregate bucket quality conservatively:
  - any `blocked` -> `blocked`
  - else any `degraded` -> `degraded`
  - else `ok`

## Observability
- `serving_aggregate_lag` view reports per-system freshness lag in seconds.
- `serving_aggregate_bucket_quality_counts` view reports per-bucket quality counts.

These views support logs/alerts for stale aggregates and degraded data quality.
