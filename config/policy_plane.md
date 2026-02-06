# Policy Plane HTTP Contract

Bead: `nyc-bike-urbanflow-9gd`

## Endpoints

- `GET /api/policy/config?v=1`
  - returns available `policy_version` values, default policy version, horizon defaults, and budget presets.
- `GET /api/policy/run?v=1&sv=...&policy_version=...&T_bucket=...`
  - returns `200 { status: "ready", run: ... }` when policy output exists.
  - returns `202 { status: "pending", retry_after_ms, cache_key }` when missing and enqueues a job.
- `GET /api/policy/moves?v=1&sv=...&policy_version=...&T_bucket=...&top_n=...`
  - returns sparse top-N move list for a ready run.
  - returns same `202 pending` behavior when run is missing.
- `GET /api/tiles/policy_moves/{z}/{x}/{y}.mvt?v=1&sv=...&policy_version=...&T_bucket=...`
  - returns policy move vectors as MVT for visual explanation.

## Bounded keyspace + cache rules

- unknown query params return `400` with `Cache-Control: no-store`.
- `sv` is required and validated on all run/moves/tile endpoints.
- `system_id` must match the `sv` payload when provided.
- allowlist enforcement is required for:
  - `system_id`
  - `policy_version`
- policy run enqueue dedupe key:
  - `(system_id, sv, decision_bucket_ts, policy_version, horizon_steps)`

## Async behavior

- On cache miss, run/moves enqueue `policy.run_v1` and return `202`.
- response includes:
  - `retry_after_ms`
  - `cache_key`
  - `status = "pending"`
