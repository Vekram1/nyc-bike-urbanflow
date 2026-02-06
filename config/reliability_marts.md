# Reliability Marts and Episodes

Bead: `nyc-bike-urbanflow-gtk.12`

## Purpose

Provide reproducible reliability analytics (empty/full minutes and contiguous
episodes) with lineage fields so replay/debug surfaces can explain metrics.

## Tables

- `station_reliability_daily`
  - key: `(day, system_id, station_key, severity_version)`
  - metrics:
    - `total_minutes`
    - `empty_minutes`
    - `full_minutes`
    - `degraded_minutes`
    - `blocked_minutes`
    - `serving_grade_minutes`
  - lineage:
    - `max_source_as_of_ts`
    - `computed_at`

- `station_reliability_episodes`
  - contiguous per-station episodes where either:
    - `bikes_available = 0` (`episode_type = empty`)
    - `docks_available = 0` (`episode_type = full`)
  - key uniqueness:
    - `(system_id, station_key, severity_version, episode_type, episode_start_ts)`
  - fields:
    - `episode_start_ts`
    - `episode_end_ts`
    - `duration_minutes`
    - `bucket_quality` (worst quality over episode)
    - `max_source_as_of_ts`

- `reliability_mart_headers`
  - key: `(day, system_id, severity_version)`
  - daily rolled totals and `episodes_count`
  - intended for cheap header-level observability and API summaries.

## Refresh Functions

- `refresh_station_reliability_daily(system_id, from_day, to_day, severity_version)`
- `refresh_station_reliability_episodes(system_id, from_ts, to_ts, severity_version)`
- `refresh_reliability_mart_headers(system_id, from_day, to_day, severity_version)`

## Rebuild Script

Use:
- `scripts/rebuild_reliability_marts.sql`

The script runs daily rollup, episodes extraction, and mart-header refresh for a
bounded date window.
