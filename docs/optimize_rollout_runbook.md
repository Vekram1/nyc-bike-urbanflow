# Optimize Rollout Runbook

Bead: `nyc-bike-urbanflow-ivx.26`

## Purpose

This runbook defines how to safely roll out optimize preview + global strategy in Profile A.
It is focused on:
- controlled promotion (`shadow` -> `internal` -> `public`)
- explicit kill switches and rollback triggers
- operator-visible telemetry for runtime decisions

Scope:
- frontend optimize UX (`Live -> Frozen -> Computing -> Playback`)
- policy API endpoints (`/api/policy/*`)
- policy worker execution (`rebal.greedy.v1`, `rebal.global.v1`)

## Preconditions

Before any rollout stage:
- `POLICY_AVAILABLE_VERSIONS` and `POLICY_DEFAULT_VERSION` are intentionally set on API server startup.
- allowlist contains required `policy_version` values for target `system_id`.
- migrations including `sql/migrations/0012_policy_outputs_eval_marts.sql` are applied.
- policy worker process is healthy and consuming queue.
- web and API are on matching expected commits for this release window.

Verification checklist:
- `GET /api/policy/config?v=1` returns expected versions and default.
- `GET /api/policy/run?...` returns deterministic `run_key` shape.
- `GET /api/policy/moves?...` resolves for recent run keys.
- `GET /api/policy/status?...` and `POST /api/policy/cancel?...` function as expected.

## Rollout Stages

Use these stages in order. Do not skip.

### Stage 1: Shadow

Goal:
- execute global path in background/internal traffic while user-facing default remains greedy.

Config:
- `POLICY_DEFAULT_VERSION=rebal.greedy.v1`
- `POLICY_AVAILABLE_VERSIONS=rebal.greedy.v1,rebal.global.v1`

Exit criteria:
- gate evaluation passes for `shadow` thresholds:
  - `timeout_rate <= 0.15`
  - `fallback_rate <= 0.20`
  - `objective_delta_ratio >= -0.20`

### Stage 2: Internal

Goal:
- expose global toggle to internal users/operators only.

Config:
- keep default greedy
- keep global available
- enable operator/internal UI path to select global strategy

Exit criteria:
- gate evaluation passes for `internal` thresholds:
  - `timeout_rate <= 0.08`
  - `fallback_rate <= 0.10`
  - `objective_delta_ratio >= -0.10`

### Stage 3: Public

Goal:
- public rollout with full strategy selection.

Config:
- optional: keep default greedy until confidence is high
- keep global available publicly

Exit criteria (steady-state):
- gate evaluation passes for `public` thresholds:
  - `timeout_rate <= 0.03`
  - `fallback_rate <= 0.05`
  - `objective_delta_ratio >= -0.03`

## Kill Switches

Use these first when incidents occur.

### Disable global immediately

Set:
- `POLICY_AVAILABLE_VERSIONS=rebal.greedy.v1`
- `POLICY_DEFAULT_VERSION=rebal.greedy.v1`

Effect:
- `/api/policy/config` no longer advertises global version
- frontend strategy paths naturally collapse to greedy only

### Force stable network posture for UX

Set (if needed during broader incident):
- `NETWORK_DEGRADE_LEVEL=1|2|3`

Effect:
- `/api/time.network.degrade_level` signals clients to throttle/degrade behavior deterministically.

### Stop in-flight expensive runs

For a problematic run key:
- `POST /api/policy/cancel?v=1&sv=...&policy_version=...&T_bucket=...`

Effect:
- queue entry transitions to canceled path (when pending).

## Rollback Triggers

Rollback to greedy-only rollout posture if any condition is sustained over a 15-minute window:
- `timeout_rate` above stage threshold.
- `fallback_rate` above stage threshold.
- `objective_delta_ratio` below stage threshold.
- `policy/run` p95 latency breaches team target with user-visible UI degradation.
- repeated `view_snapshot_mismatch` errors above baseline (indicates FE/BE drift).

Rollback actions:
1. Disable global in `POLICY_AVAILABLE_VERSIONS`.
2. Confirm `/api/policy/config` reflects greedy-only.
3. Keep worker running for queue drain and diagnostics collection.
4. Post incident note with metric snapshot and timestamp.

## Observability Dashboard Spec

Create dashboards with these panels.

### API + Queue Health

- `policy_run_requests_total` (or equivalent request log count) split by status (`ready|pending|error`).
- `policy_run_latency_ms` p50/p95.
- queue depth and age for policy jobs.
- cancel outcomes for `/api/policy/cancel`.

### Policy Output Quality

From `policy_runs` + `policy_moves`:
- runs by `policy_version`, `status`.
- move count distribution.
- no-op rate (`no_op = true`).
- failure reason breakdown (`error_reason`).

### User Experience Signals

From web telemetry (`__UF_E2E` in test/dev and frontend analytics in prod):
- optimize state transition success rate.
- playback quality distribution (`full|reduced|summary`).
- mismatch recovery events (`view_snapshot_mismatch` and sync success).

### Suggested SQL Snapshots (Postgres)

Timeout/failure snapshot:

```sql
SELECT
  policy_version,
  COUNT(*) AS total_runs,
  COUNT(*) FILTER (WHERE status = 'fail') AS failed_runs
FROM policy_runs
WHERE created_at >= NOW() - INTERVAL '15 minutes'
GROUP BY policy_version
ORDER BY policy_version;
```

No-op and move pressure:

```sql
SELECT
  r.policy_version,
  COUNT(*) AS runs,
  COUNT(*) FILTER (WHERE r.no_op) AS no_op_runs,
  COALESCE(AVG(m.move_count), 0) AS avg_move_count
FROM policy_runs r
LEFT JOIN (
  SELECT run_id, COUNT(*) AS move_count
  FROM policy_moves
  GROUP BY run_id
) m ON m.run_id = r.run_id
WHERE r.created_at >= NOW() - INTERVAL '15 minutes'
GROUP BY r.policy_version
ORDER BY r.policy_version;
```

## Gate Evaluation Reference

Threshold logic is implemented in:
- `packages/api/src/policy/rollout_gates.ts`

Use that module as source of truth for stage thresholds and reason formatting.

## Release Checklist

Before promotion:
1. Confirm latest web/API builds deployed.
2. Confirm policy config reflects intended versions/default.
3. Run targeted optimize E2E suite.
4. Capture baseline metric snapshot.

After promotion:
1. Watch dashboards for at least 30 minutes.
2. Re-evaluate rollout gate metrics.
3. Record pass/fail decision with timestamp.

## Incident Notes Template

- Stage: `shadow|internal|public`
- Trigger metric(s):
- First observed timestamp:
- Kill switch applied:
- Rollback command/config change:
- Customer impact summary:
- Follow-up owner and ETA:
