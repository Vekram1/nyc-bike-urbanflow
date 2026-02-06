# Policy Outputs and Eval Marts

Bead: `nyc-bike-urbanflow-9pz`

## Persistent output tables

- `policy_runs`
  - keyed by `(system_id, policy_version, policy_spec_sha256, sv, decision_bucket_ts, horizon_steps)`
  - records run status, input quality, no-op semantics, and failure reason.
- `policy_moves`
  - sparse per-run moves with rank, moved bikes, distance, and bounded reason codes.
- `policy_counterfactual_status`
  - optional simulated station snapshots by `run_id` + `sim_bucket_ts`.

## Evaluation mart

- `policy_eval_daily`
  - keyed by `(day, system_id, policy_version, policy_spec_sha256, sv)`
  - includes effort rollups (bikes moved, stations touched, mean distance)
  - stores computed KPI slots for baseline/policy deltas.
- refresh function:
  - `refresh_policy_eval_daily(system_id, from_day, to_day)`

## Logging + refresh discipline

`PgPolicyOutputStore.refreshEvalDaily` emits structured log event:
- `policy_eval_daily_refresh`
  - `system_id`
  - `from_day` / `to_day`
  - `upserted_rows`
  - `elapsed_ms`

This keeps mart refresh timings and row deltas observable in Profile A.
