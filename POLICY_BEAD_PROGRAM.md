# POLICY_BEAD_PROGRAM.md

## What This Document Is

This is the execution companion to `POLICY_WORK_PLAN.md`. It translates the policy/preview/global strategy plan into a concrete, dependency-linked Beads program so implementation can proceed without re-deriving architecture intent.

This document is intentionally self-contained:
- product goal
- architectural constraints
- rationale behind sequencing
- per-bead tasks/subtasks and acceptance
- dependency intent (why each edge exists)

Primary epic:
- `nyc-bike-urbanflow-ivx` — `[Optimize Program] Snapshot-locked preview + global optimization execution`

Roadmap anchor:
- `nyc-bike-urbanflow-gtk` — UrbanFlow Twin roadmap epic

---

## Product Intent (User-Centric)

Target user experience:
1. User watches live map.
2. User clicks `Optimize`.
3. Timeline freezes to an explicit preview moment.
4. System computes policy for the exact frozen snapshot.
5. User sees animation of bike moves and a simple before/after summary.
6. User returns to live mode.

Why this matters:
- Trust: result matches what user was looking at, not a near-by snapshot.
- Legibility: non-technical users can understand impact without hashes/tokens.
- Robustness: deterministic keying + snapshot precondition removes “shaky” FE/BE mismatches.

---

## Non-Negotiable Constraints (From PLAN.md + AGENTS.md)

- Profile A first: no unnecessary Profile B infra.
- Bounded keyspace and strict validation (`400` unknown params, non-cacheable invalids).
- Determinism on policy surfaces (versioning + spec hashes + replay consistency).
- Snapshot-bound optimization: no best-effort compute against drifting data.
- Preview is counterfactual only; never imply live state mutation.
- No map remount regressions and no uncontrolled timeline mutation during preview.

---

## Why This Dependency Graph Exists

The graph is optimized for two goals simultaneously:
- Early user-visible value (M0 vertical slice) to stabilize UX and reduce integration churn.
- Contract rigor (M1/M2/M3) to eliminate mismatch classes before deeper global optimization work.

Key sequencing decisions:
- `OptimizationSession` and preview flow first to establish one frontend truth owner.
- Snapshot preconditions before broad rollout so incorrect computes fail explicitly (`409`) instead of silently diverging.
- Shared schema validation before larger feature expansion to prevent contract drift.
- Global strategy work only after deterministic baseline and recovery path are in place.

---

## Bead Graph Overview

Epic:
- `nyc-bike-urbanflow-ivx`

M0 (Delight-first vertical slice):
- `nyc-bike-urbanflow-ivx.2`
- `nyc-bike-urbanflow-ivx.3`
- `nyc-bike-urbanflow-ivx.4`
- `nyc-bike-urbanflow-ivx.5`
- `nyc-bike-urbanflow-ivx.6`
- `nyc-bike-urbanflow-ivx.7`

M1/M2/M3 (Determinism + contract hardening + recovery):
- `nyc-bike-urbanflow-ivx.8`
- `nyc-bike-urbanflow-ivx.9`
- `nyc-bike-urbanflow-ivx.10`
- `nyc-bike-urbanflow-ivx.11`
- `nyc-bike-urbanflow-ivx.12`
- `nyc-bike-urbanflow-ivx.13`
- `nyc-bike-urbanflow-ivx.14`

M4 (User-facing explainability + supportability):
- `nyc-bike-urbanflow-ivx.15`
- `nyc-bike-urbanflow-ivx.16`
- `nyc-bike-urbanflow-ivx.17`

M5 (Test safety net):
- `nyc-bike-urbanflow-ivx.18`
- `nyc-bike-urbanflow-ivx.19`
- `nyc-bike-urbanflow-ivx.20`

M6 (Global optimization):
- `nyc-bike-urbanflow-ivx.21`
- `nyc-bike-urbanflow-ivx.22`
- `nyc-bike-urbanflow-ivx.23`
- `nyc-bike-urbanflow-ivx.24`
- `nyc-bike-urbanflow-ivx.25`

Program closeout:
- `nyc-bike-urbanflow-ivx.26`

Plan-space revisions after graph audit:
- `nyc-bike-urbanflow-ivx.27` snapshot issuance contract from rendered station feed
- `nyc-bike-urbanflow-ivx.28` playback accessibility and reduced-motion mode
- `nyc-bike-urbanflow-ivx.29` playback performance budget and adaptive quality ladder
- Convergence gate added:
  - `nyc-bike-urbanflow-ivx.2` and `nyc-bike-urbanflow-ivx.12` are blocked by `nyc-bike-urbanflow-34t` to avoid split-brain frontend optimize paths during active parallel work

Administrative:
- `nyc-bike-urbanflow-ivx.1` linkage marker

---

## Detailed Bead Specs

## `nyc-bike-urbanflow-ivx`
Title: `[Optimize Program] Snapshot-locked preview + global optimization execution`
- Purpose: umbrella coordination epic for the full optimize experience and global strategy.
- Why now: current policy interactions can be stale or unclear to end users.
- Contract surfaces: policy + control plane + frontend state machine.
- Cache-key impact: yes (versioned policy run identity with snapshot dimensions).

## `nyc-bike-urbanflow-ivx.2`
Title: `[M0] Vertical slice: cinematic preview with fixture playback`
- Depends on: `nyc-bike-urbanflow-gtk`, `nyc-bike-urbanflow-ivx`.
- Blocks: `.3`, `.4`, `.5`, `.6`, `.7`.
- Subtasks:
  - Wire one-click optimize entrypoint in UI.
  - Freeze timeline and enter preview shell.
  - Render a fixture-based policy playback path end-to-end.
  - Exit back to live deterministically.
- Acceptance:
  - User can complete full preview loop without backend dependency.

## `nyc-bike-urbanflow-ivx.3`
Title: `[M0] Implement OptimizationSession state spine`
- Depends on: `.2`.
- Why: prevents map/timeline/policy panel divergence.
- Subtasks:
  - Define `OptimizationSession` schema.
  - Add reducer/actions for mode + request + playback cursor.
  - Gate late responses by `(sessionId, requestId)`.
  - Expose selectors for all preview consumers.
- Acceptance:
  - No UI surface reads optimize state from ad hoc local state.

## `nyc-bike-urbanflow-ivx.4`
Title: `[M0] Cinematic Preview mode shell + gated controls`
- Depends on: `.2`, `.3`.
- Subtasks:
  - Dark-focus visual treatment and frozen timestamp pill.
  - Hide non-essential controls while computing/playback.
  - Keep only safe preview controls visible.
- Acceptance:
  - Preview mode is visually unmistakable and interaction-safe.

## `nyc-bike-urbanflow-ivx.5`
Title: `[M0] Playback engine v1 with fixture move plan`
- Depends on: `.2`, `.3`, `.4`.
- Subtasks:
  - Deterministic playback plan format.
  - Animate bike-like markers + edge highlight + station pulse.
  - Add controls: play/pause/speed/step/before-after.
  - Guarantee no network fetch during playback.
- Acceptance:
  - Users can interpret movement as bike rebalancing, not abstract state flip.

## `nyc-bike-urbanflow-ivx.6`
Title: `[M0] Dev-only demo-data switch for preview debugging`
- Depends on: `.2`, `.5`.
- Subtasks:
  - Add guarded dev-only fixture force flag.
  - Ensure flag is unavailable in production builds.
  - Document usage for UI debugging.
- Acceptance:
  - UI progress is not blocked by temporary API instability.

## `nyc-bike-urbanflow-ivx.7`
Title: `[M0] E2E happy-path: Optimize preview journey`
- Depends on: `.2`, `.5`, `.6`.
- Subtasks:
  - Automate golden journey assertions.
  - Assert freeze -> compute -> animate -> summary -> return-live sequence.
  - Add flake resistance for animation timing.
- Acceptance:
  - Regression in the core preview journey fails CI.

## `nyc-bike-urbanflow-ivx.8`
Title: `[M1] RenderedViewModel + canonical run-key utility`
- Depends on: roadmap + epic.
- Why: single canonical rendered state avoids drift.
- Subtasks:
  - Implement `RenderedViewModel`.
  - Derive run key in one shared utility.
  - Centralize bucket rounding/alignment.
- Acceptance:
  - All policy actions derive identity from one canonical model.

## `nyc-bike-urbanflow-ivx.9`
Title: `[M2] Backend snapshot precondition validation (409 mismatch)`
- Depends on: `.8`.
- Subtasks:
  - Require snapshot id/hash in optimize requests.
  - Validate existence and hash integrity.
  - Return deterministic `409 view_snapshot_mismatch` with current snapshot metadata.
- Acceptance:
  - Backend never computes policy against non-matching rendered snapshot.

## `nyc-bike-urbanflow-ivx.10`
Title: `[M2] Policy response metadata expansion + run-key echo`
- Depends on: `.9`.
- Subtasks:
  - Echo full run key (including snapshot identity).
  - Include deterministic no-op fields and timestamps.
  - Include bucket/timezone metadata for UI alignment.
- Acceptance:
  - Frontend can compare response key to current key directly.

## `nyc-bike-urbanflow-ivx.11`
Title: `[M2] Strict unknown-param/error taxonomy hardening`
- Depends on: `.9`.
- Subtasks:
  - Enforce unknown-param rejection with no-store.
  - Normalize error taxonomy and retryability categories.
  - Add contract tests for invalid paths.
- Acceptance:
  - No ambiguous “best effort” validation behavior remains.

## `nyc-bike-urbanflow-ivx.12`
Title: `[M1] Frontend stale invalidation + lock coupling`
- Depends on: `.8`, `.10`.
- Subtasks:
  - Stale on any run-key change dimension.
  - Maintain inspect-lock bucket behavior.
  - Ensure stale transitions are deterministic and non-duplicative.
- Acceptance:
  - Ready state cannot survive a key change.

## `nyc-bike-urbanflow-ivx.13`
Title: `[M1] Adapter boundary + shared schema safe-parse`
- Depends on: `.10`.
- Subtasks:
  - Introduce single policy client adapter boundary.
  - Add shared request/response schema package usage.
  - Fail fast in dev/CI on shape drift.
- Acceptance:
  - Contract drift is caught before runtime usage.

## `nyc-bike-urbanflow-ivx.14`
Title: `[M3] Mismatch recovery UX: Sync view and rerun`
- Depends on: `.9`, `.12`, `.13`.
- Subtasks:
  - Handle `409` by staying in frozen mode.
  - Show user-facing `Sync view` action.
  - Refetch same-bucket snapshot and rerun.
- Acceptance:
  - Mismatch is recoverable in one user action without jargon.

## `nyc-bike-urbanflow-ivx.15`
Title: `[M4] User-first summary panel + progressive disclosure`
- Depends on: `.12`, `.10`.
- Subtasks:
  - Default KPI summary for non-technical users.
  - Advanced metadata section collapsed by default.
  - Friendly no-op messaging.
- Acceptance:
  - User can explain what happened without reading technical identifiers.

## `nyc-bike-urbanflow-ivx.16`
Title: `[M4] Diagnostics export payload for support/debug`
- Depends on: `.15`.
- Subtasks:
  - Add copy diagnostics payload.
  - Include run key, snapshot, solver stats, move summary.
  - Bound payload and exclude secrets.
- Acceptance:
  - Support can reproduce mismatch complaints from one pasted payload.

## `nyc-bike-urbanflow-ivx.17`
Title: `[M4] Preview semantics/copy audit across optimize surfaces`
- Depends on: `.15`.
- Subtasks:
  - Audit labels/buttons/tooltips for “preview only” semantics.
  - Ensure no UI text implies real-world mutation.
  - Align terminology across HUD, panel, and toasts.
- Acceptance:
  - Preview semantics are consistent and unambiguous.

## `nyc-bike-urbanflow-ivx.18`
Title: `[M5] Unit tests for session machine, keying, and stale logic`
- Depends on: `.8`, `.12`.
- Subtasks:
  - Session transition tests.
  - Key equality/serialization tests.
  - Late response discard tests.
- Acceptance:
  - State-machine regressions are caught at unit level.

## `nyc-bike-urbanflow-ivx.19`
Title: `[M5] API contract tests for snapshot preconditions and error codes`
- Depends on: `.9`, `.10`, `.11`.
- Subtasks:
  - Positive run-key echo tests.
  - Snapshot mismatch `409` tests.
  - Unknown-param and no-store tests.
- Acceptance:
  - API contract is enforceable and deterministic.

## `nyc-bike-urbanflow-ivx.20`
Title: `[M5] E2E matrix for preview, mismatch, playback, and recovery`
- Depends on: `.14`, `.15`, `.5`.
- Subtasks:
  - Cover live, replay, mismatch-recovery, before/after, return-live.
  - Repeat for multiple bucket sizes.
  - Ensure non-flaky timing windows.
- Acceptance:
  - End-to-end behavior is stable across realistic interaction paths.

## `nyc-bike-urbanflow-ivx.21`
Title: `[M6] Strategy contract + policy versioning for global.v1`
- Depends on: `.10`.
- Subtasks:
  - Add strategy selector and policy version semantics.
  - Update version allowlists and docs.
  - Preserve snapshot-bound run identity.
- Acceptance:
  - Global strategy is contractually versioned and deterministic.

## `nyc-bike-urbanflow-ivx.22`
Title: `[M6] Global solver implementation + invariants`
- Depends on: `.21`.
- Subtasks:
  - Implement global optimization core path.
  - Enforce invariants (conservation, bounds, dock feasibility, budget caps).
  - Add runtime guardrails and deterministic tie/order behavior.
- Acceptance:
  - Solver returns invariant-safe outputs or deterministic failure modes.

## `nyc-bike-urbanflow-ivx.23`
Title: `[M6] Async job lifecycle + coalescing + cancel endpoint`
- Depends on: `.21`, `.22`.
- Subtasks:
  - Implement 202->terminal lifecycle endpoints.
  - Coalesce duplicate run-key jobs.
  - Add cancel endpoint and state transition.
- Acceptance:
  - Global runs remain responsive and cancellable.

## `nyc-bike-urbanflow-ivx.24`
Title: `[M6] Frontend strategy toggle, compare cards, cancel UX`
- Depends on: `.23`, `.15`.
- Subtasks:
  - Expose Greedy/Global toggle.
  - Add compare KPIs for same frozen snapshot.
  - Add in-flight cancel interaction and status states.
- Acceptance:
  - Users can compare strategies safely and understand tradeoffs.

## `nyc-bike-urbanflow-ivx.25`
Title: `[M6] Global fixtures/property tests + shadow rollout gates`
- Depends on: `.22`, `.23`.
- Subtasks:
  - Golden fixtures with known optima.
  - Property tests for invariants.
  - Rollout gates for timeout/fallback/objective deltas.
- Acceptance:
  - Global rollout decisions are evidence-based and reproducible.

## `nyc-bike-urbanflow-ivx.26`
Title: `Rollout runbook + observability dashboards`
- Depends on: `.20`, `.25`.
- Subtasks:
  - Document rollout phases and feature flags.
  - Define incident rollback triggers and commands.
  - Define dashboard queries and alert thresholds.
- Acceptance:
  - Operators can safely ship, monitor, and rollback optimize features.

## `nyc-bike-urbanflow-ivx.27`
Title: `[M2] Snapshot issuance contract from rendered station feed`
- Depends on: `.8`.
- Blocks: `.9`, `.10`.
- Why this was added:
  - snapshot precondition validation is incomplete unless the system has an explicit server-issued snapshot identity on rendered station feeds.
- Subtasks:
  - define snapshot id/hash issuance source
  - expose snapshot metadata on render feed (or deterministic ETag mapping)
  - document staleness and cache semantics
- Acceptance:
  - optimize precondition inputs are mintable and reproducible from rendered data surface.

## `nyc-bike-urbanflow-ivx.28`
Title: `[M4] Playback accessibility + reduced-motion mode`
- Depends on: `.5`, `.15`.
- Blocks: `.20`.
- Why this was added:
  - non-technical and motion-sensitive users need a first-class non-animated path.
- Subtasks:
  - reduced-motion fallback summary mode
  - keyboard navigation for playback controls
  - assistive announcements for mode transitions
- Acceptance:
  - optimize preview remains fully usable without animation.

## `nyc-bike-urbanflow-ivx.29`
Title: `[M4] Playback performance budget + adaptive quality ladder`
- Depends on: `.5`.
- Blocks: `.20`.
- Why this was added:
  - Profile A targets heterogeneous devices; uncontrolled animation quality harms trust and usability.
- Subtasks:
  - define target frame-time budgets
  - implement adaptive marker/animation detail ladder
  - deterministic fallback to summary-only mode when budget exceeded
- Acceptance:
  - preview remains smooth or gracefully degraded on low-end devices.

---

## Program-Level Success Criteria

The optimize program is complete when:
- Preview journey is stable and understandable for non-technical users.
- Every policy result is provably tied to the rendered snapshot.
- FE/BE mismatch paths are explicit (`409`) and recoverable (`Sync view`).
- Contract drift is guarded by shared schemas + tests.
- Global strategy is versioned, bounded, and safely rollable.

---

## Notes To Future Maintainers

- Do not bypass snapshot precondition checks for convenience; that reintroduces silent mismatch.
- Keep user-facing copy simple; put technical identifiers in advanced/details surfaces.
- Preserve one-state-owner architecture (`OptimizationSession`, `RenderedViewModel`); avoid fragmented local state in UI components.
- If adding new policy dimensions, update both run-key identity and deterministic test fixtures in the same change.
