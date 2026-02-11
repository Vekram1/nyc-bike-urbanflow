# POLICY_WORK_PLAN.md

Execution companion:
- `POLICY_BEAD_PROGRAM.md` contains the granular bead graph (`nyc-bike-urbanflow-ivx.*`) with dependency intent, subtasks, and self-documenting implementation notes.

## Purpose

This plan closes the frontend-backend policy gap so **Optimize (Preview)** always computes against the exact data the user is viewing, never silently goes stale, and is explainable enough to ship now under Profile A constraints.

Primary product outcome:
- A user can pick a time, click `Optimize`, watch bikes move in Preview mode, and understand before/after impact without technical knowledge.
- Trust guarantee (internal): every result corresponds to `(system_id, sv, decision_bucket_ts, view_snapshot_id, policy_version, policy_spec_sha256)`.

### Golden user journey (non-technical)
1. `Live` mode: user watches the city timeline.
2. User clicks `Optimize` and app freezes time into `Preview`.
3. App computes with a visible stepper: `Freeze -> Compute -> Animate -> Summary`.
4. App plays bike-move animation on the frozen map.
5. User sees simple summary KPIs and before/after controls.
6. User clicks `Return to Live`; preview clears and live resumes.

---

## Scope And Non-Goals

In scope:
- Frontend timeline/policy state machine hardening
- Backend policy request/response contract hardening
- Deterministic stale detection and refresh paths
- Explicit locking behavior while station inspect is open
- Policy impact rendering readiness contract
- QA coverage for control-plane and policy-plane integration
- Release guardrails and observability for shipping
- Global optimization policy mode with deterministic contracts (`policy_version=global.v1`)
- Solver lifecycle management and async job handling for global runs
- Comparative UX for Greedy vs Global output on the same locked view key

Out of scope for this phase:
- Always-on optimization loop
- Fleet routing with real truck constraints
- Profile B infrastructure (Redis/Timescale/worker fleet)

---

## Required Contracts (Must Hold)

Policy run identity key:
- `system_id`
- `sv`
- `decision_bucket_ts` (derived from displayed time)
- `view_snapshot_id` (server-issued snapshot identity for rendered station vector)
- `view_snapshot_sha256` (hash for rendered station vector integrity)
- `policy_version`
- `policy_spec_sha256`

Frontend acceptance rules:
- `Optimize (Preview)` always uses currently active view key.
- If any member of the view key changes, previous policy result becomes `Stale`.
- `Policy Impact` can only render when status is `Ready` and key matches current view.
- While inspect drawer is open and time is locked, policy runs against locked `T_bucket` only.
- Optimize requests must include `view_snapshot_id` and `view_snapshot_sha256` from the rendered map state.
- If snapshot metadata is unavailable, optimize controls are disabled until a render snapshot is available.
- FE uses backend-provided `bucket_size_s` and `timezone` for display and alignment metadata, not local assumptions.

Backend acceptance rules:
- Response echoes full run identity key.
- Response includes deterministic `no_op` semantics.
- Unknown params return `400 unknown_param` with `Cache-Control: no-store`.
- No implicit fallback to latest `sv` when client passes explicit `sv`.
- Policy compute must execute against the exact `view_snapshot_id` provided or fail deterministically.
- If snapshot is unknown, expired, or hash-mismatched, backend returns `409 view_snapshot_mismatch` with current snapshot metadata.

---

## Milestones

0. M0: Delight-first vertical slice (Preview mode + playback + fixture moves)
1. M1: Deterministic frontend policy state machine
2. M2: Backend policy contract strictness + idempotent semantics
3. M3: End-to-end sync, stale handling, and inspect lock behavior
4. M4: UX visibility + failure handling
5. M5: Test matrix + ship checklist
6. M6: Global optimization (MILP/min-cost-flow) implementation and rollout

---

## Detailed Work Breakdown

## M0. Delight-first vertical slice (build the cool path first)

Goal:
- Ship the exact `Optimize` product loop early, independent from full solver complexity.

Tasks:
- Implement `OptimizationSession` + Preview mode entry/exit.
- Implement playback engine consuming:
  - local fixture move list in dev
  - real backend payload when available
- Add dev-only `Demo data` toggle for UI debugging isolation.

Acceptance:
- User can always click `Optimize` and see deterministic movement in Preview, even when backend is temporarily flaky in dev.

## M1. Frontend Policy State Machine

### M1.0 Introduce optimize UX mode machine (Freeze -> Compute -> Playback -> Resume)
Goal:
- Make optimize behavior explicit and user-trustworthy on a frozen view.

States:
- `Live`, `Frozen`, `Computing`, `Playback`, `Error`.

Rules:
- Clicking optimize from `Live` immediately transitions to `Frozen`.
- `Frozen -> Computing` when request starts.
- `Computing -> Playback` on successful run payload.
- `Playback -> Frozen` when playback finishes or user pauses.
- `Frozen -> Live` only via explicit `Resume Live`.

Acceptance:
- No policy run executes against a moving timeline.

### M1.0A Introduce a single `OptimizationSession` integration spine
Goal:
- Eliminate FE drift by giving one object ownership of freeze key, request lifecycle, and playback.

Definition:
- `OptimizationSession` fields:
  - `sessionId`
  - `mode` (`Live|Frozen|Computing|Playback|Error`)
  - `frozenKey`
  - `activeRequestId`
  - `result`
  - `playback` (cursor/speed/paused/startedAt)

Rules:
- Only active session can drive Preview overlays and playback.
- Late responses are ignored unless `(sessionId, requestId)` matches.
- Timeline/map/policy UI read from active session state.

Acceptance:
- No code path exists where map, timeline, and policy panel disagree on active optimized view.

### M1.1 Introduce canonical policy view key utility
Goal:
- Centralize generation/compare logic for policy run identity.

Tasks:
- Introduce `RenderedViewModel` as the single source of truth for rendered map state.
- `RenderedViewModel` fields include: `system_id`, `sv`, `decisionBucketTs`, `view_snapshot_id`, `view_snapshot_sha256`, `mode`.
- Add `buildPolicyViewKey(renderedViewModel, policyParams)` helper in frontend state layer.
- Include: `systemId`, `sv`, `decisionBucketTs`, `viewSnapshotId`, `viewSnapshotSha256`, `policyVersion`, `policySpecSha256`.
- Add stable string form for cache maps and equality checks.
- Ensure `decisionBucketTs` is bucket-aligned exactly once in one utility.

Acceptance:
- All policy dispatch and stale checks use helper (no ad hoc key building).
- Map rendering, inspect drawer, and policy HUD read from the same `RenderedViewModel`.

### M1.2 Add strict status machine with explicit transitions
Goal:
- Eliminate ambiguous state transitions that cause stale or ghost ready states.

States:
- `Idle`, `Computing`, `Ready`, `Stale`, `Error`.

Transitions:
- `Idle -> Computing` on user run request.
- `Computing -> Ready` on success with matching request id + matching key.
- `Computing -> Error` on request failure/timeout.
- `Ready -> Stale` when view key changes.
- `Stale -> Computing` on user rerun.
- `Error -> Computing` on user retry.

Tasks:
- Define reducer with exhaustive switch and compile-time unreachable checks.
- Track `activeRequestId` and `requestedKey`.
- Reject late responses if request id does not match active.
- Store `readyResultKey` separately from current key for deterministic stale detection.

Acceptance:
- No path exists where UI shows `Ready` for non-matching key.

### M1.3 Make stale invalidation deterministic and immediate
Goal:
- Mark policy stale exactly when replay/live inputs change.

Invalidation triggers:
- `sv` changed
- `displayedTime` bucket crosses boundary
- `view_snapshot_id` changed
- `view_snapshot_sha256` changed
- `policy_version` changed
- `policy_spec_sha256` changed
- `system_id` changed

Tasks:
- Wire invalidation in one shared effect/hook.
- Use bucket-aligned `decisionBucketTs` to avoid jitter invalidations.
- Add debug log tags: `POLICY_STALE` with old/new key deltas.

Acceptance:
- Every key change creates exactly one stale transition.

### M1.4 Enforce inspect lock coupling
Goal:
- If drawer is open and timeline is inspect-locked, policy must run on locked bucket.

Tasks:
- Read lock source-of-truth from timeline state (`inspectLockedTs`).
- Build run key from locked timestamp while lock active.
- Prevent autoplay transitions from mutating active key under lock.
- Show small UI label: `Inspect Lock: <timestamp>`.

Acceptance:
- Repeated policy runs during inspect lock use identical `decision_bucket_ts`.

### M1.5 Optimize click behavior (freeze and lock snapshot)
Goal:
- Ensure optimize always corresponds to the exact frozen user-visible view.

Tasks:
- On optimize click:
  - pause replay immediately
  - lock `decisionBucketTs`
  - capture `view_snapshot_id` and `view_snapshot_sha256` from current render
- Disable scrub controls during `Computing`; keep `Cancel` and `Resume Live` enabled.
- Keep `Frozen` mode active through mismatch recovery flows until user explicitly resumes live.

Acceptance:
- Every optimize run is attached to a frozen bucket and specific snapshot identity.

---

## M2. Backend Policy Contract Hardening

### M2.1 Enforce required request fields and strict validation
Goal:
- Reject ambiguous policy requests.

Tasks:
- Validate presence and format of:
  - `system_id`
  - `sv`
  - `decision_bucket_ts`
  - `view_snapshot_id`
  - `view_snapshot_sha256`
  - `policy_version`
- Enforce namespace allowlist.
- Validate timestamp bucket alignment against configured interval.
- Return `400` with machine-readable error code for each invalid case.
- Ensure unknown query/body fields are rejected (not ignored).
- Validate snapshot preconditions:
  - unknown/expired snapshot -> `409 view_snapshot_mismatch`
  - hash mismatch -> `409 view_snapshot_mismatch`
  - include `current_view_snapshot_id` and `current_view_snapshot_sha256` in mismatch response

Acceptance:
- No request silently falls back to defaults when fields are explicit.

### M2.2 Echo canonical run metadata in every response
Goal:
- Let frontend prove freshness without inference.

Response required:
- `run_key` object with all identity fields
- `status` (`success|fail`)
- `no_op` + `no_op_reason` when success/no moves
- `computed_at`
- `policy_spec_sha256`
- `view_snapshot_id`
- `view_snapshot_sha256`
- `bucket_size_s`
- `timezone`

Tasks:
- Add serializer path used by all policy outcomes.
- Ensure no-op path shares same run metadata shape as non-no-op.
- Add response versioning guard if shape changes.

Acceptance:
- Frontend can compare `run_key` directly to current key.

### M2.3 Idempotent semantics per run key
Goal:
- Re-running same key yields deterministic payload or deterministic job handle.

Tasks:
- Add cache lookup by full run key.
- If hit, return existing result with `cache_hit=true`.
- If miss and async mode enabled, return `202` job token with same run key.
- Ensure duplicate in-flight requests for same key coalesce.

Acceptance:
- Same request key cannot create divergent outputs.

### M2.4 Error taxonomy and degradations
Goal:
- Distinguish temporary failures from invalid requests.

Tasks:
- Standardize errors:
  - `invalid_request`
  - `sv_expired`
  - `namespace_disallowed`
  - `input_unavailable`
  - `view_snapshot_mismatch`
  - `compute_timeout`
  - `internal_error`
- Map to status codes and retry guidance.
- Add `Retry-After` when applicable.

Acceptance:
- UI can classify `retryable` vs `non-retryable`.
- UI has explicit mismatch recovery for `view_snapshot_mismatch`.

---

## M3. Frontend-Backend Integration

### M3.1 Single policy client adapter boundary
Goal:
- One mapping boundary from backend schema to frontend model.

Tasks:
- Implement `policyClient.runPolicy(viewKey, strategy, options)`.
- Normalize backend fields to frontend internal shape once.
- Preserve raw backend response for diagnostics in dev mode.
- Add shared schema enforcement:
  - define `PolicyRunRequestSchema` and `PolicyRunResponseSchema` in a shared contracts package
  - backend validates input/output against schema
  - frontend uses schema safe-parse and surfaces contract mismatch in dev

Acceptance:
- No other component parses raw policy payload directly.
- Contract drift is caught by CI schema/snapshot tests.

### M3.2 Request lifecycle and cancellation
Goal:
- Prevent race conditions during rapid scrub/play interactions.

Tasks:
- Use `AbortController` per run request.
- Abort on:
  - new run request
  - critical key invalidation while computing
  - unmount
- Ignore aborted responses without triggering `Error`.

Acceptance:
- Rapid interactions do not leave UI in incorrect status.

### M3.3 Stale banner and rerun affordance
Goal:
- Make stale state obvious and recoverable.

Tasks:
- Add non-blocking stale indicator in HUD policy card.
- Show stale reason summary (e.g., `sv changed`, `time bucket changed`).
- Add one-click `Rerun on current view`.
- If backend returns `409 view_snapshot_mismatch`:
  - remain in `Frozen` mode
  - show action label `Sync view`
  - show message: `The map view changed while optimizing. Sync to the frozen view and try again.`
  - on action, refetch snapshot for same bucket and rerun optimize

Acceptance:
- User can always recover stale state in one action.

### M3.4 Policy impact render gating
Goal:
- Never overlay mismatched impact results.

Tasks:
- Gate overlay by `status === Ready` and key equality.
- Auto-disable toggle when stale or error.
- Keep last ready result in memory for optional compare panel (not active overlay).

Acceptance:
- Overlay cannot display stale or orphaned output.

---

## M4. UX/Explainability And Motion

### M4.0 Cinematic Preview mode (dark focus layer)
Goal:
- Make Preview unmistakable within one second and reduce interaction surface during optimization.

Tasks:
- On optimize click, apply smooth dark-focus transition:
  - dim basemap
  - increase contrast for motion/touched stations
  - hide non-essential controls while preview active
- Add top-center frozen-time pill with human-readable timestamp.
- Keep one clear exit CTA: `Return to Live`.

Acceptance:
- Non-technical users can instantly tell they are in Preview mode.
- During Preview, only safe controls remain: play/pause/speed/step/return.

### M4.1 User-first summary (default) + technical details (advanced)
Goal:
- Keep default UX understandable for non-technical users while preserving deep diagnostics.

Default section:
- `Frozen at <timestamp>`
- `Strategy: Greedy | Global`
- KPI cards: `Stations improved`, `Shortage reduced`, `Bikes moved`
- preview disclaimer: `This is a simulated preview and does not change live system state.`
- user-friendly no-op text when applicable

Advanced section (collapsed):
- `system_id`, `sv`, `decision_bucket_ts`
- `view_snapshot_id`, `view_snapshot_sha256`
- `policy_version`, `policy_spec_sha256`
- `computed_at`, solver stats, cache metadata

Acceptance:
- Non-technical users understand what happened without reading hashes.
- Engineers can verify exact run identity in one expansion/copy action.

### M4.2 Move-level explainability
Goal:
- Make recommendations interpretable.

Tasks:
- For each move show:
  - from station, to station
  - bikes moved
  - distance
  - reason codes
- For touched stations show before/after bikes and target band.

Acceptance:
- User can inspect `why this move` without backend logs.

### M4.3 Policy playback engine (ship v1, OSRM optional later)
Goal:
- Show policy outcome as visible movement and station count updates on the frozen snapshot.

Tasks:
- Define deterministic `PlaybackPlan` derived from run result:
  - ordered move list
  - per-move duration model
  - station delta events for depart/arrive
- Simulate entirely client-side:
  - start from frozen snapshot vector
  - apply move deltas over time
  - never fetch mid-playback
- Render v1 animation:
  - animate bike-like aggregate markers/particles along straight station-to-station segments
  - highlight active edge with `+k` moved indicator
  - pulse touched stations on depart/arrive
- Add playback controls:
  - play/pause
  - speed (0.5x, 1x, 2x, 4x)
  - step previous/next move
  - jump to end (`After`)
  - `Before/After` toggle
- Keep OSRM route polylines as optional post-ship enhancement behind a feature flag.

Acceptance:
- Users can freeze, optimize, and watch a deterministic playback on that exact snapshot.
- Animation reads as bike movement, not only line changes.
- Users can instantly compare before vs after without rerunning.

### M4.4 Preview semantics and user trust language
Goal:
- Prevent users from confusing counterfactual policy previews with real-time system state.

Tasks:
- Label impact and playback surfaces as `Preview` when showing simulated policy effects.
- Add concise helper text: `Preview does not mutate live system state`.
- Keep clear CTA to return to live view.

Acceptance:
- UI language does not imply that policy results were automatically applied in reality.

### M4.5 Diagnostics export for FE/BE mismatch debugging
Goal:
- Make support/debugging fast when users report mismatch or stale issues.

Tasks:
- Add `Copy Diagnostics` action on policy panel.
- Include payload:
  - run key
  - snapshot metadata
  - strategy and solver stats
  - top move deltas summary
- Keep export safe (no secrets, bounded payload size).

Acceptance:
- Engineers can reproduce policy issues with one pasted diagnostics payload.

---

## M5. Test Plan (Detailed)

## Unit tests

Frontend:
- Key builder:
  - stable ordering
  - bucket rounding correctness
  - snapshot identity propagation
  - equality/inequality cases
- Reducer:
  - all legal transitions
  - illegal transition protection
  - late response ignored
  - optimize mode transitions (`Live|Frozen|Computing|Playback`)
- Stale logic:
  - each trigger independently
  - combined trigger single stale event

Backend:
- Validation:
  - missing required fields
  - unknown fields
  - namespace violations
  - bad timestamp format
  - snapshot mismatch returns `409`
- Response shape:
  - includes full run key on all outcomes
  - no-op path includes no-op reason
  - includes bucket/timezone metadata
- Idempotency:
  - repeated same key returns consistent run key/payload signature

## Integration tests

API contract tests:
- `POST/GET policy` with current view key returns run metadata
- stale `sv` returns expected code
- unknown param returns `400` and `no-store`
- snapshot mismatch returns `409` and recovery metadata

Frontend integration:
- run policy while live
- scrub to past, run policy, verify locked bucket usage
- change time bucket after ready, verify stale
- rerun and verify ready restores overlay
- optimize click freezes timeline and captures snapshot metadata
- `409` mismatch path supports refresh and rerun without leaving frozen mode

## E2E tests

Scenarios:
1. Live view run -> ready -> impact visible
2. Scrub to past -> replay paused -> run -> ready
3. While ready, move time bucket -> stale badge appears -> impact disabled
4. Inspect drawer open -> lock timestamp -> run twice -> same run key
5. Backend error -> error state -> retry -> ready
6. Snapshot mismatch -> refresh snapshot -> rerun -> ready
7. Ready run -> playback animates moves and station counts in preview mode

Reliability:
- Repeat each scenario for at least two bucket sizes where applicable.

---

## M6. Global Optimization Track (Detailed)

### M6.1 Product/contract definition
Goal:
- Add a globally optimal strategy without breaking greedy behavior or contract determinism.

Tasks:
- Introduce `policy_version=global.v1`.
- Define strategy selector contract:
  - request field `strategy` in `{greedy.v1, global.v1}`.
  - response echoes strategy and resolved policy version.
- Keep run identity key unchanged except policy version/spec hash values, including snapshot identity fields.
- Ensure stale semantics are identical to greedy path.

Acceptance:
- Frontend can request either strategy and compare outputs on the same view key.

### M6.2 Mathematical model specification
Goal:
- Formalize optimization objective and constraints for reproducible solver outputs.

Decision variables:
- `x_uv >= 0`: bikes moved from donor station `u` to receiver station `v`.

Objective (baseline global.v1):
- Minimize:
  - weighted unmet deficits after moves
  - weighted residual surpluses after moves
  - transport penalty proportional to distance and moved bikes
- Example objective structure:
  - `alpha * unmet_deficit + beta * residual_surplus + gamma * distance_cost`

Constraints:
- Donor limits: outbound from `u` cannot exceed available excess.
- Receiver limits: inbound to `v` cannot exceed available need and dock feasibility.
- Conservation at station level after transfers.
- Global bike move budget cap `B`.
- Optional max stations touched cap `S` (linearized with binary activations if enabled).
- Neighborhood constraints:
  - allowed edges only within radius `R` or precomputed top-K adjacency.

Determinism rules:
- Stable station ordering by `station_key`.
- Stable edge ordering `(u,v)` lexicographic for tie handling.
- Fixed solver parameters and numeric tolerances in spec.

Acceptance:
- Spec document and code comments define exact objective and constraints.

### M6.3 Solver implementation strategy
Goal:
- Implement a deterministic global solver path compatible with current runtime limits.

Tasks:
- Add internal solver abstraction:
  - `solveGreedy(spec, inputs)`
  - `solveGlobal(spec, inputs)`
- Implement `global.v1` in one of two modes:
  - exact min-cost-flow if constraints map cleanly
  - MILP fallback when station-touch cap or discrete constraints are enabled
- Add hard runtime ceiling:
  - terminate with `compute_timeout` and retry guidance
- Add warm-start/reuse:
  - seed with greedy output for faster convergence where supported
- Persist solver metadata:
  - algorithm type
  - iteration count
  - solve duration
  - termination reason

Acceptance:
- Solver path returns deterministic metadata and does not block event loop beyond guardrails.

### M6.4 Async job handling for global runs
Goal:
- Keep UX responsive for expensive solves.

Tasks:
- Route global solves through async job path by default.
- On miss:
  - return `202` with job token and run key.
- Add poll endpoint for job status by run key/job id.
- Add cancel endpoint:
  - `POST /policy/jobs/:job_id/cancel`
  - alternative cancel by run key for idempotent UX
- Terminal states:
  - `ready`
  - `error`
  - `timeout`
  - `canceled`
- Ensure duplicate same-key jobs coalesce.

Acceptance:
- Repeated clicks do not spawn duplicate global jobs for same run key.
- User can cancel in-flight global runs and return cleanly to frozen mode.

### M6.5 Backend schema and response shape extensions
Goal:
- Provide enough metadata for explainability and side-by-side comparison.

Tasks:
- Add response fields:
  - `strategy`
  - `objective_value`
  - `objective_components` (deficit term, surplus term, distance term)
  - `solver_stats` (duration_ms, status, iterations, gap if available)
- Preserve existing move list and reason code schema.
- Keep no-op semantics unchanged for global path.

Acceptance:
- Frontend can display why global differs from greedy numerically.

### M6.6 Frontend UX integration for strategy selection
Goal:
- Let user run and compare strategies explicitly on the current/locked view.

Tasks:
- Add strategy toggle in policy HUD:
  - `Greedy`
  - `Global`
- Persist strategy choice in URL/view state where existing policy params are stored.
- Trigger stale on strategy change due to policy version/spec hash change.
- Add compare mode:
  - run greedy and global on same key
  - show KPI delta cards:
    - unmet deficit reduction
    - stations improved
    - bikes moved
    - distance cost

Acceptance:
- User can switch strategies and clearly see tradeoff differences.

### M6.7 Safeguards and fallback behavior
Goal:
- Maintain reliability under constrained compute budgets.

Tasks:
- Add max station/edge caps for global solve inputs.
- If input exceeds cap:
  - fallback to greedy with explicit `fallback_reason`.
- Add server-side kill switch for global strategy.
- Add per-request timeout override bounds with strict allowlist.

Acceptance:
- Global mode cannot degrade control plane availability.

### M6.8 Global optimizer test matrix
Goal:
- Prove correctness and determinism.

Unit tests:
- objective component calculations
- constraint builder correctness
- deterministic edge/station ordering
- fallback trigger logic

Property tests:
- invariants:
  - station bounds
  - conservation
  - budget limits
  - dock feasibility

Golden fixtures:
- fixed small networks where known optimal solution is precomputed
- compare greedy vs global objective values

Integration tests:
- `202 -> ready` async lifecycle
- duplicate request coalescing
- timeout/error taxonomy

Frontend tests:
- strategy toggle state transitions
- stale handling on strategy change
- compare panel rendering with mismatched keys blocked

Acceptance:
- Global strategy path has parity-level test confidence with greedy.

### M6.9 Release plan for global strategy
Goal:
- Ship safely with incremental exposure.

Phases:
1. `shadow`:
   - compute global in background for sampled requests
   - do not expose in UI
   - log objective deltas vs greedy
2. `internal`:
   - expose toggle to internal users only
   - monitor compute latency and timeout rate
3. `public-beta`:
   - expose with feature flag and fallback to greedy
4. `general`:
   - keep kill switch and async path permanently

Success criteria:
- timeout rate below agreed threshold
- no increase in control-plane latency budget violations
- meaningful KPI improvement vs greedy on replay benchmarks

---

## Implementation Order (Execution Sequence)

1. Implement `OptimizationSession` (single FE integration spine).
2. Implement Cinematic Preview mode and Optimize flow (`Live|Frozen|Computing|Playback`).
3. Implement playback engine v1 with fixture moves and before/after controls.
4. Build frontend key utility + reducer transition table + stale invalidation hooks.
5. Wire policy client adapter, shared schema validation, and cancellation.
6. Harden backend validation + snapshot preconditions + response metadata.
7. Implement `409` mismatch recovery with user-facing `Sync view`.
8. Implement global policy contract (`strategy`, `policy_version`, async job semantics).
9. Implement global solver and invariants.
10. Add strategy toggle, compare UX, and global cancel UX.
11. Add unit tests (frontend/backend).
12. Add integration tests.
13. Add E2E scenarios.
14. Run full quality gates and fix flakes.

---

## Quality Gates Before Marking Done

Backend:
- `bun run lint` (packages/api)
- `bun run typecheck` (packages/api)
- policy route tests pass

Frontend:
- `bun run lint` (apps/web)
- `bun run build` (apps/web)
- policy state and e2e suites pass

Contracts:
- policy response snapshots updated
- no unknown-param regressions on control/policy routes
- shared contract schema tests pass (request/response)
- mismatch recovery snapshots pass (`409 view_snapshot_mismatch`)

---

## Rollout Plan

Phase 1 (dark launch):
- Deploy backend strict metadata/validation with frontend compatibility mode.
- Add logging for stale transitions and run key mismatches.

Phase 2 (frontend strict mode):
- Enable strict stale gating and impact lock.
- Enable playback engine v1 in preview mode.

Phase 3 (ship):
- Remove compatibility branches.
- Keep diagnostics for one release cycle.

Phase 4 (global shadow):
- Execute global solver in shadow mode and record deltas.

Phase 5 (global limited exposure):
- Enable UI toggle behind feature flag for internal/beta users.

Phase 6 (global public):
- Roll out with kill switch and fallback rules retained.

Rollback:
- Feature-flag strict UI gating independently of backend validation.
- Backend can keep metadata additions (additive, safe).

---

## Observability And Debug Hooks

Client logs (dev):
- `POLICY_RUN_REQUESTED` with run key
- `POLICY_RUN_READY` with run key
- `POLICY_RUN_STALE` with key delta
- `POLICY_RUN_ERROR` with error taxonomy
- `POLICY_RUN_MISMATCH` with snapshot mismatch metadata
- `POLICY_PLAYBACK_STARTED` and `POLICY_PLAYBACK_FINISHED`

Server logs:
- request key hash
- validation failure reason
- compute duration
- cache hit/miss
- no-op reason distribution

Metrics:
- policy request rate
- ready/stale ratio
- error rate by taxonomy
- median and p95 compute time
- no-op percentage
- snapshot mismatch rate
- playback completion rate
- global solver timeout rate
- global fallback-to-greedy rate
- objective improvement delta (global vs greedy)

---

## Risks And Mitigations

Risk:
- Excess stale transitions due to tiny time jitter.
Mitigation:
- Always compare bucket-aligned timestamps only.

Risk:
- Race conditions from overlapping requests.
Mitigation:
- Abort + request id matching + reducer gate.

Risk:
- Frontend/backed contract drift.
Mitigation:
- Adapter boundary + contract tests + snapshot assertions.

Risk:
- User confusion with no-op.
Mitigation:
- Explicit no-op reason text in UI.

---

## Definition Of Done

Done when all are true:
- `Optimize (Preview)` always computes against current or explicitly locked view.
- Ready results automatically become stale when view key changes.
- Policy impact never renders for stale key.
- Backend responds with full deterministic run metadata and strict validation.
- Unit/integration/e2e suites pass for policy flows.
- README/docs updated for operator behavior and user-visible policy states.
- Optimize requires and validates frozen snapshot preconditions.
- `409 view_snapshot_mismatch` has deterministic FE recovery path.
- Playback preview is deterministic and does not fetch mid-animation.
- `Run Global` is available with async lifecycle and deterministic metadata.
- Global strategy respects invariants and has tested fallback behavior.

---

## Stretch After Ship (Optional)

- OSRM polyline fetching for move animation under feature flag.
- Station-level confidence bands from input quality.
- Compare mode: baseline vs policy counterfactual on same locked bucket.
