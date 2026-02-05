# Ingest health metrics + SLOs

This doc describes lightweight ingest health metrics that power control-plane
health checks without extra infra.

## Views

`ingest_health_15m` and `ingest_health_daily` are SQL views over
`logical_snapshots` that compute:
- snapshots_total
- snapshots_distinct
- duplicates (total - distinct publisher_last_updated)
- last_collected_at
- last_publisher_last_updated
- median_ingest_lag_seconds
- p95_ingest_lag_seconds

Lag is computed as `(collected_at - publisher_last_updated)` in seconds.

## SLO guidance

Baseline SLOs (Profile A):
- station_status: p95 ingest lag < 2x ttl sustained over 30 minutes
- station_information: p95 ingest lag < 6x ttl sustained over 2 hours

When breached, the control plane should surface a "Live data delayed" badge and
record a structured log event with the latest metrics sample.

## Notes

- These views are designed for polling by a control-plane endpoint or
  lightweight cron; they do not require Timescale.
- Use `duplicates` to detect repeated publisher_last_updated values (stale feeds).
