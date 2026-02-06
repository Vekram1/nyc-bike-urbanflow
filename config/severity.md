# Severity Spec Registry

Bead: `nyc-bike-urbanflow-gtk.1`

## Goal

Persist versioned severity specs as immutable, hash-addressed artifacts so
`severity_version` is reproducible and auditable.

## Table

- `severity_specs`
  - `severity_version` (primary key namespace, e.g. `sev.v1`)
  - `spec_json` (schema-validated JSON payload)
  - `spec_sha256` (stable JSON hash)
  - `created_at`
  - immutable row semantics (trigger rejects spec/version mutation)

## Default sev.v1

- formula type: `empty_or_full_flag`
- bucket: `300s`
- weights:
  - `empty_weight = 1`
  - `full_weight = 1`
- clamp:
  - `clamp_min = 0`
  - `clamp_max = 1`
- missing-data:
  - allowed qualities: `ok`, `degraded`
  - `on_missing = zero`

## Allowlist

Migration registers `sev.v1` in `namespace_allowlist` as
`kind = severity_version` (global scope) if not already present.
