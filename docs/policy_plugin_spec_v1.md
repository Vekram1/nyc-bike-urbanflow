# Policy Plugin Spec v1 (Draft)

Status: Draft for discussion and iterative implementation.
Scope: Make UrbanFlow policy execution plug-and-play for researchers/practitioners while preserving deterministic replay, versioned contracts, and Profile A constraints.

## 1. Goals

- Allow new optimization algorithms to run without changing API route logic.
- Keep all runs reproducible against the same serving view (`sv`) + decision bucket.
- Standardize inputs/outputs so UI, evaluation, and storage stay compatible.
- Support both built-in policies and external researcher plugins through one adapter.

## 2. Non-goals (v1)

- Arbitrary untrusted code execution in production.
- Multi-tenant marketplace and billing.
- Custom UI per algorithm.

## 3. Terminology

- Plugin: policy module that implements the Policy Plugin Contract.
- Policy run key: `(system_id, sv, decision_bucket_ts, policy_version, policy_spec_sha256, horizon_steps)`.
- Snapshot identity: `(view_snapshot_id, view_snapshot_sha256)` used to bind runs to rendered data.

## 4. Compatibility with Current System

This spec is designed to sit on top of existing surfaces:

- API: `/api/policy/config`, `/api/policy/run`, `/api/policy/moves`, `/api/policy/status`, `/api/policy/cancel`
- Worker: `packages/api/src/policy/worker.ts`
- Existing policies: `rebal.greedy.v1`, `rebal.global.v1`
- Storage: `policy_runs`, `policy_moves`, policy output store

No public route contract change is required for phase 1 adoption.

## 5. Plugin Contract

Every plugin must export the following metadata and entrypoint.

```ts
export type PolicyPluginManifestV1 = {
  contract_version: "policy.plugin.v1";
  plugin_id: string;               // e.g., "research.my_algo.v1"
  plugin_version: string;          // semantic/plugin-local version
  policy_version: string;          // external version namespace used by API
  strategy: string;                // e.g., "myalgo.v1"
  display_name: string;
  description?: string;
  author?: string;
  deterministic: true;             // v1 requires deterministic behavior
  supports_horizon_steps: boolean;
  max_horizon_steps: number;       // 0..288
  requires_neighbor_graph: boolean;
  input_schema_version: "policy.input.v1";
  output_schema_version: "policy.output.v1";
};

export type PolicyPluginContextV1 = {
  system_id: string;
  sv: string;
  decision_bucket_ts: number;
  horizon_steps: number;
  request_id: string;
  now_iso: string;
};

export type PolicyPluginInputV1 = {
  stations: Array<{
    station_key: string;
    capacity: number;
    bikes: number;
    docks: number;
    bucket_quality: string;
  }>;
  neighbors: Array<{
    from_station_key: string;
    to_station_key: string;
    dist_m: number;
    rank: number;
  }>;
  effort: {
    bike_move_budget_per_step: number;
    max_stations_touched: number;
    max_moves: number;
  };
  targets: {
    alpha: number;
    beta: number;
    min_capacity_for_policy: number;
  };
};

export type PolicyPluginOutputV1 = {
  moves: Array<{
    move_rank: number;
    from_station_key: string;
    to_station_key: string;
    bikes_moved: number;
    dist_m: number;
    budget_exhausted: boolean;
    neighbor_exhausted: boolean;
    reason_codes: string[];
  }>;
  summary: {
    bikes_moved_total: number;
    stations_touched: number;
    no_op: boolean;
  };
  diagnostics?: Record<string, unknown>;
};

export type PolicyPluginV1 = {
  manifest: PolicyPluginManifestV1;
  run: (ctx: PolicyPluginContextV1, input: PolicyPluginInputV1) =>
    Promise<PolicyPluginOutputV1> | PolicyPluginOutputV1;
};
```

## 6. Determinism Rules (Required)

- Given identical `ctx + input`, output must be identical.
- If randomness is used, plugin must consume an explicit seed derived from run key.
- Output ordering must be deterministic (`move_rank`, stable tiebreakers).
- Semantic changes require a new `policy_version`.

## 7. Safety and Runtime Constraints

v1 execution tiers:

1. Built-in modules (default): local TypeScript modules imported by worker.
2. Trusted plugin modules: file-based plugins loaded from allowlisted paths.
3. Future (v2+): isolated process/container sandbox for untrusted uploads.

All tiers must enforce:

- timeout per run
- max memory budget
- max output moves cap
- strict schema validation before persistence

## 8. Registry and Discovery

Introduce a plugin registry (config + DB-backed optional cache):

- `plugin_id`
- `policy_version`
- `strategy`
- manifest hash
- enabled systems (allowlist)
- activation status

`/api/policy/config` continues to expose:

- `available_policy_versions`
- `available_strategies`

derived from enabled plugins + existing allowlists.

## 9. Worker Integration Model

Worker flow (target shape):

1. Resolve plugin by `policy_version`.
2. Build canonical `PolicyPluginInputV1` from DB snapshot + neighbors + effort config.
3. Execute plugin with timeout and cancellation support.
4. Validate `PolicyPluginOutputV1`.
5. Persist runs/moves using existing stores.
6. Return ready/pending/error through existing API semantics.

## 10. Evaluation and Research UX Requirements

- Every run records:
  - plugin manifest hash
  - policy spec hash
  - run key and snapshot identity
- Batch replay mode should support:
  - fixed time window
  - baseline comparison (`rebal.greedy.v1`, `rebal.global.v1`)
  - export of KPI tables and move logs

Recommended first KPI set:

- constrained station-minutes
- empty station-minutes
- full station-minutes
- bikes moved total
- stations touched
- weighted transfer distance

## 11. Versioning and Contract Governance

- Contract version for this document: `policy.plugin.v1`.
- Changes to input/output semantics require:
  - schema version bump
  - fixture updates in `fixtures/policy/*`
  - contract test updates in `packages/shared/src/test/*` and `contracts/*`
- Public `policy_version` remains allowlisted.

## 12. Minimal Example Plugin

```ts
import type { PolicyPluginV1 } from "./types";

export const plugin: PolicyPluginV1 = {
  manifest: {
    contract_version: "policy.plugin.v1",
    plugin_id: "research.baseline.shift.v1",
    plugin_version: "1.0.0",
    policy_version: "rebal.research.shift.v1",
    strategy: "research.shift.v1",
    display_name: "Research Shift Baseline",
    deterministic: true,
    supports_horizon_steps: false,
    max_horizon_steps: 0,
    requires_neighbor_graph: true,
    input_schema_version: "policy.input.v1",
    output_schema_version: "policy.output.v1",
  },
  run: (_ctx, input) => {
    // Example no-op deterministic output.
    return {
      moves: [],
      summary: {
        bikes_moved_total: 0,
        stations_touched: 0,
        no_op: true,
      },
      diagnostics: {
        stations_seen: input.stations.length,
      },
    };
  },
};
```

## 13. Proposed Implementation Plan

Phase 1 (in-repo plugins):

1. Add shared TS types for `policy.plugin.v1`.
2. Add worker adapter interface and registry loader.
3. Port existing greedy/global into plugin form behind adapter.
4. Add manifest + output schema validation.
5. Add fixtures and contract tests for plugin execution path.

Phase 2 (research-friendly):

1. Add CLI/script to scaffold plugin template.
2. Add local plugin folder convention (`packages/policy/plugins/*`).
3. Add experiment runner for replay windows and KPI exports.

Phase 3 (optional isolated execution):

1. Process/container sandbox runtime.
2. Resource quotas and strict I/O boundaries.
3. Signed plugin artifacts + approval workflow.

## 14. Open Questions

- Should v1 allow per-plugin custom effort fields, or strictly enforce common effort schema?
- Should `diagnostics` be persisted in `policy_runs` JSON column now, or emitted separately?
- What is the minimum acceptable timeout for research plugins in Profile A?
- Do we need an explicit plugin ABI boundary (JSON in/out over stdio) before containerization?

