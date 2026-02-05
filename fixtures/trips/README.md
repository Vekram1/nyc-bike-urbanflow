# Trips fixtures

This directory contains a tiny "mini-month" CSV fixture that represents a
small subset of monthly trip data.

Files:
- mini_month.csv: raw CSV payload bytes
- mini_month.manifest.json: checksum + dataset metadata
- mini_month.expected.json: expected aggregate checks

Hashing rationale:
- checksum_sha256 is SHA-256 of the exact CSV bytes.
- as_of is recorded as sha256=<checksum> to align with PLAN.md guidance for
  trips dataset watermarks.

Aggregate checks:
- row_count
- member_type_counts
- unique_start_stations / unique_end_stations
