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

Recommended execution order per system:
1. `refresh_station_status_1m(system_id, from_ts, to_ts)`
2. `refresh_station_severity_5m(system_id, from_ts, to_ts, severity_version)`
3. `refresh_station_pressure_now_5m(system_id, from_ts, to_ts, proxy_method)`

`scripts/rebuild_serving_aggregates.sql` provides a deterministic rebuild template.

## Lineage + sv binding
- `station_status_1m` stores:
  - `source_logical_snapshot_id`
  - `source_as_of_ts` (`logical_snapshots.publisher_last_updated`)
- `station_severity_5m` and `station_pressure_now_5m` carry `source_as_of_ts` forward.

These fields are the aggregate-side lineage inputs for serving views. Public requests
remain `sv`-bound and never accept raw `as_of`.

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
