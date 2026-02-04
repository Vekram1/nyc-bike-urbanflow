# Ingest quality flags (GBFS loader)

This document describes loader quality flags and bucket_quality logic for
GBFS station_status normalization.

## Flags

Feed-level flags (applied to every station row in the snapshot):
- MONOTONICITY_VIOLATION: publisher_last_updated is older than the latest
  canonical snapshot for the same system/feed.
- MISSING_PUBLISHER_LAST_UPDATED: manifest lacked a publisher last_updated;
  loader falls back to collected_at.

Row-level flags:
- NEGATIVE_INVENTORY: bikes or docks are negative.
- MISSING_COUNTS: bikes or docks are missing/non-numeric.

## bucket_quality

bucket_quality is derived from flags:
- blocked: any blocking flag present
- degraded: any degrade-only flag present (none today)
- ok: no flags

Blocking flags: NEGATIVE_INVENTORY, MISSING_COUNTS,
MONOTONICITY_VIOLATION, MISSING_PUBLISHER_LAST_UPDATED.

## Serving-grade

is_serving_grade is true only when bucket_quality == ok and the feed-level
flags permit serving-grade publication.

## Logging

The loader emits:
- gbfs_monotonicity_violation when a non-monotonic snapshot is ingested
- gbfs_manifest_loaded with counts and quality flags for observability
