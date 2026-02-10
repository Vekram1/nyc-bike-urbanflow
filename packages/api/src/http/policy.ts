import { enforceAllowlist } from "../allowlist/enforce";
import { enforceAllowlistedQueryParams } from "../allowlist/http";
import type { AllowlistStore } from "../allowlist/types";
import { validateSvQuery } from "../sv/http";
import type { ServingTokenService } from "../sv/service";
import type { PolicyMove, PolicyRunSummary } from "../policy/store";
import { buildSnapshotIdentity, deriveEffectiveSnapshotBucket } from "./snapshot-identity";
import type { StationSnapshot } from "./stations";

const CONFIG_PATH = "/api/policy/config";
const RUN_PATH = "/api/policy/run";
const MOVES_PATH = "/api/policy/moves";
const STATUS_PATH = "/api/policy/status";
const CANCEL_PATH = "/api/policy/cancel";

const ALLOWED_CONFIG_KEYS = new Set(["v"]);
const ALLOWED_RUN_KEYS = new Set([
  "sv",
  "v",
  "policy_version",
  "strategy",
  "T_bucket",
  "horizon_steps",
  "system_id",
  "view_snapshot_id",
  "view_snapshot_sha256",
]);
const ALLOWED_MOVES_KEYS = new Set([
  "sv",
  "v",
  "policy_version",
  "strategy",
  "T_bucket",
  "horizon_steps",
  "top_n",
  "system_id",
  "view_snapshot_id",
  "view_snapshot_sha256",
]);

export type PolicyRouteDeps = {
  tokens: ServingTokenService;
  allowlist: AllowlistStore;
  policyStore: {
    getRunSummary: (args: {
      system_id: string;
      sv: string;
      policy_version: string;
      decision_bucket_epoch_s: number;
      horizon_steps: number;
    }) => Promise<PolicyRunSummary | null>;
    listMoves: (args: { run_id: number; limit: number }) => Promise<PolicyMove[]>;
  };
  stationsStore?: {
    getStationsSnapshot: (args: {
      system_id: string;
      view_id: number;
      t_bucket_epoch_s: number | null;
      limit: number;
    }) => Promise<StationSnapshot[]>;
  };
  queue: {
    enqueue: (args: {
      type: string;
      payload: unknown;
      dedupe_key?: string;
      max_attempts?: number;
    }) => Promise<{ ok: true; job_id: number } | { ok: false; reason: "deduped" }>;
    getPendingByDedupeKey?: (args: { type: string; dedupe_key: string }) => Promise<{ job_id: number } | null>;
    cancelByDedupeKey?: (args: { type: string; dedupe_key: string }) => Promise<boolean>;
  };
  config: {
    default_policy_version: string;
    available_policy_versions: string[];
    default_horizon_steps: number;
    retry_after_ms: number;
    max_moves: number;
    budget_presets: Array<{
      key: string;
      max_bikes_per_move: number;
      max_total_bikes_moved: number;
      max_stations_touched: number;
      max_total_distance_m: number;
    }>;
  };
  logger?: {
    info: (event: string, details: Record<string, unknown>) => void;
    warn: (event: string, details: Record<string, unknown>) => void;
  };
};

const defaultLogger = {
  info(event: string, details: Record<string, unknown>): void {
    console.info(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...details }));
  },
  warn(event: string, details: Record<string, unknown>): void {
    console.warn(JSON.stringify({ level: "warn", event, ts: new Date().toISOString(), ...details }));
  },
};

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(headers ?? {}),
    },
  });
}

type PolicyErrorCategory =
  | "invalid_request"
  | "view_snapshot_mismatch"
  | "namespace_disallowed"
  | "sv_invalid"
  | "internal_error";
type PolicyStrategy = "greedy.v1" | "global.v1";

function classifyPolicyError(code: string): { category: PolicyErrorCategory; retryable: boolean } {
  switch (code) {
    case "view_snapshot_mismatch":
      return { category: "view_snapshot_mismatch", retryable: true };
    case "namespace_not_allowed":
    case "policy_version_not_allowed":
    case "system_id_not_allowed":
      return { category: "namespace_disallowed", retryable: false };
    case "sv_required":
    case "sv_invalid":
    case "sv_revoked":
    case "sv_expired":
      return { category: "sv_invalid", retryable: false };
    case "method_not_allowed":
    case "not_found":
      return { category: "internal_error", retryable: false };
    default:
      return { category: "invalid_request", retryable: false };
  }
}

function errorResponse(params: {
  code: string;
  message: string;
  status: number;
  headers?: Record<string, string>;
  extra?: Record<string, unknown>;
}): Response {
  const classified = classifyPolicyError(params.code);
  return json(
    {
      error: {
        code: params.code,
        category: classified.category,
        retryable: classified.retryable,
        message: params.message,
      },
      ...(params.extra ?? {}),
    },
    params.status,
    params.headers
  );
}

function hasUnknown(searchParams: URLSearchParams, allowed: Set<string>): string | null {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      return key;
    }
  }
  return null;
}

function inferStrategyFromPolicyVersion(policyVersion: string): PolicyStrategy | null {
  if (policyVersion.includes(".greedy.")) return "greedy.v1";
  if (policyVersion.includes(".global.")) return "global.v1";
  return null;
}

function parseStrategy(value: string | null): PolicyStrategy | null {
  if (!value || value.trim().length === 0) return null;
  const normalized = value.trim();
  if (normalized === "greedy.v1" || normalized === "global.v1") return normalized;
  return null;
}

function requireText(searchParams: URLSearchParams, key: string): string | null {
  const value = searchParams.get(key)?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function parsePositiveInt(value: string | null): number | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function buildPolicyRunDedupeKey(args: {
  system_id: string;
  sv: string;
  t_bucket: number;
  policy_version: string;
  horizon_steps: number;
}): string {
  return `${args.system_id}:${args.sv}:${args.t_bucket}:${args.policy_version}:${args.horizon_steps}`;
}

function pendingResponse(params: {
  system_id: string;
  sv: string;
  policy_version: string;
  t_bucket: number;
  horizon_steps: number;
  retry_after_ms: number;
  strategy: PolicyStrategy;
  view_snapshot_id: string | null;
  view_snapshot_sha256: string | null;
}): Response {
  const cacheKey =
    `${params.system_id}:${params.policy_version}:${params.sv}:${params.t_bucket}:${params.horizon_steps}`;
  return json(
    {
      status: "pending",
      retry_after_ms: params.retry_after_ms,
      cache_key: cacheKey,
      computed_at: new Date().toISOString(),
      run_key: {
        system_id: params.system_id,
        sv: params.sv,
        decision_bucket_epoch_s: params.t_bucket,
        policy_version: params.policy_version,
        strategy: params.strategy,
        policy_spec_sha256: null,
        horizon_steps: params.horizon_steps,
        view_snapshot_id: params.view_snapshot_id,
        view_snapshot_sha256: params.view_snapshot_sha256,
      },
    },
    202,
    { "Retry-After": String(Math.max(1, Math.ceil(params.retry_after_ms / 1000))) }
  );
}

function snapshotMismatchResponse(params: {
  requested_view_snapshot_id: string;
  requested_view_snapshot_sha256: string;
  current_view_snapshot_id: string;
  current_view_snapshot_sha256: string;
}): Response {
  return errorResponse({
    code: "view_snapshot_mismatch",
    message: "Snapshot precondition does not match current rendered snapshot",
    status: 409,
    extra: {
      requested_view_snapshot_id: params.requested_view_snapshot_id,
      requested_view_snapshot_sha256: params.requested_view_snapshot_sha256,
      current_view_snapshot_id: params.current_view_snapshot_id,
      current_view_snapshot_sha256: params.current_view_snapshot_sha256,
    },
  });
}

export function createPolicyRouteHandler(deps: PolicyRouteDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const logger = deps.logger ?? defaultLogger;

    const url = new URL(request.url);
    const path = url.pathname;
    if (
      path !== CONFIG_PATH &&
      path !== RUN_PATH &&
      path !== MOVES_PATH &&
      path !== STATUS_PATH &&
      path !== CANCEL_PATH
    ) {
      return errorResponse({ code: "not_found", message: "Route not found", status: 404 });
    }
    if (path === CANCEL_PATH) {
      if (request.method !== "POST") {
        return errorResponse({ code: "method_not_allowed", message: "Method must be POST", status: 405 });
      }
    } else if (request.method !== "GET") {
      return errorResponse({ code: "method_not_allowed", message: "Method must be GET", status: 405 });
    }

    const v = url.searchParams.get("v");
    if (v !== null && v !== "1") {
      return errorResponse({ code: "unsupported_version", message: "Only v=1 is supported", status: 400 });
    }

    if (path === CONFIG_PATH) {
      const unknown = hasUnknown(url.searchParams, ALLOWED_CONFIG_KEYS);
      if (unknown) {
        return errorResponse({
          code: "unknown_param",
          message: `Unknown query parameter: ${unknown}`,
          status: 400,
        });
      }
      return json(
        {
          default_policy_version: deps.config.default_policy_version,
          default_strategy: inferStrategyFromPolicyVersion(deps.config.default_policy_version) ?? "greedy.v1",
          available_policy_versions: deps.config.available_policy_versions,
          available_strategies: ["greedy.v1", "global.v1"],
          default_horizon_steps: deps.config.default_horizon_steps,
          max_moves: deps.config.max_moves,
          budget_presets: deps.config.budget_presets,
        },
        200
      );
    }

    const unknown = hasUnknown(
      url.searchParams,
      path === MOVES_PATH ? ALLOWED_MOVES_KEYS : ALLOWED_RUN_KEYS
    );
    if (unknown) {
      return errorResponse({
        code: "unknown_param",
        message: `Unknown query parameter: ${unknown}`,
        status: 400,
      });
    }

    const sv = await validateSvQuery(deps.tokens, url.searchParams, { ctx: { path: url.pathname } });
    if (!sv.ok) {
      return errorResponse({ code: sv.code, message: sv.message, status: sv.status, headers: sv.headers });
    }

    const requestedSystemId = url.searchParams.get("system_id")?.trim();
    if (requestedSystemId && requestedSystemId !== sv.system_id) {
      return errorResponse({
        code: "system_id_mismatch",
        message: "system_id must match sv token",
        status: 400,
      });
    }

    const systemAllow = await enforceAllowlist(
      deps.allowlist,
      [{ kind: "system_id", value: sv.system_id }],
      { path: url.pathname }
    );
    if (!systemAllow.ok) {
      return errorResponse({
        code: systemAllow.code,
        message: systemAllow.message,
        status: systemAllow.status,
      });
    }

    const allowlisted = await enforceAllowlistedQueryParams(
      deps.allowlist,
      url.searchParams,
      ["policy_version"],
      { system_id: sv.system_id, ctx: { path: url.pathname } }
    );
    if (!allowlisted.ok) {
      return errorResponse({
        code: allowlisted.code,
        message: allowlisted.message,
        status: allowlisted.status,
      });
    }

    const policyVersion = requireText(url.searchParams, "policy_version");
    if (!policyVersion) {
      return errorResponse({
        code: "missing_policy_version",
        message: "policy_version is required",
        status: 400,
      });
    }
    const requestedStrategy = parseStrategy(url.searchParams.get("strategy"));
    if (url.searchParams.get("strategy") !== null && requestedStrategy === null) {
      return errorResponse({
        code: "invalid_strategy",
        message: "strategy must be one of greedy.v1 or global.v1",
        status: 400,
      });
    }
    const inferredStrategy = inferStrategyFromPolicyVersion(policyVersion);
    const effectiveStrategy = requestedStrategy ?? inferredStrategy;
    if (!effectiveStrategy) {
      return errorResponse({
        code: "invalid_policy_version",
        message: "Cannot infer strategy from policy_version",
        status: 400,
      });
    }
    if (requestedStrategy && inferredStrategy && requestedStrategy !== inferredStrategy) {
      return errorResponse({
        code: "strategy_policy_mismatch",
        message: "strategy must match policy_version family",
        status: 400,
      });
    }

    const tBucket = parsePositiveInt(url.searchParams.get("T_bucket"));
    if (tBucket === null) {
      return errorResponse({
        code: "invalid_t_bucket",
        message: "T_bucket must be a positive integer epoch second",
        status: 400,
      });
    }

    const horizonSteps = parsePositiveInt(url.searchParams.get("horizon_steps")) ?? deps.config.default_horizon_steps;
    if (!Number.isInteger(horizonSteps) || horizonSteps < 0 || horizonSteps > 288) {
      return errorResponse({
        code: "invalid_horizon_steps",
        message: "horizon_steps must be an integer between 0 and 288",
        status: 400,
      });
    }

    const requestedViewSnapshotId = requireText(url.searchParams, "view_snapshot_id");
    const requestedViewSnapshotSha = requireText(url.searchParams, "view_snapshot_sha256");
    const hasSnapshotPrecondition = requestedViewSnapshotId !== null || requestedViewSnapshotSha !== null;
    if (hasSnapshotPrecondition && (!requestedViewSnapshotId || !requestedViewSnapshotSha)) {
      return errorResponse({
        code: "invalid_snapshot_precondition",
        message: "view_snapshot_id and view_snapshot_sha256 must be provided together",
        status: 400,
      });
    }
    let resolvedSnapshotIdentity: { view_snapshot_id: string; view_snapshot_sha256: string } | null = null;
    if (requestedViewSnapshotId && requestedViewSnapshotSha && deps.stationsStore?.getStationsSnapshot) {
      const snapshotRows = await deps.stationsStore.getStationsSnapshot({
        system_id: sv.system_id,
        view_id: sv.view_id,
        t_bucket_epoch_s: tBucket,
        limit: 10000,
      });
      const effectiveSnapshotBucket = deriveEffectiveSnapshotBucket(tBucket, snapshotRows);
      const currentSnapshot = buildSnapshotIdentity({
        system_id: sv.system_id,
        view_id: sv.view_id,
        view_spec_sha256: sv.view_spec_sha256,
        effective_t_bucket: effectiveSnapshotBucket,
        snapshot: snapshotRows,
      });
      resolvedSnapshotIdentity = currentSnapshot;
      if (
        currentSnapshot.view_snapshot_id !== requestedViewSnapshotId ||
        currentSnapshot.view_snapshot_sha256 !== requestedViewSnapshotSha
      ) {
        logger.warn("policy.snapshot_precondition_mismatch", {
          system_id: sv.system_id,
          view_id: sv.view_id,
          t_bucket: tBucket,
          requested_view_snapshot_id: requestedViewSnapshotId,
          current_view_snapshot_id: currentSnapshot.view_snapshot_id,
        });
        return snapshotMismatchResponse({
          requested_view_snapshot_id: requestedViewSnapshotId,
          requested_view_snapshot_sha256: requestedViewSnapshotSha,
          current_view_snapshot_id: currentSnapshot.view_snapshot_id,
          current_view_snapshot_sha256: currentSnapshot.view_snapshot_sha256,
        });
      }
    } else if (requestedViewSnapshotId && requestedViewSnapshotSha) {
      resolvedSnapshotIdentity = {
        view_snapshot_id: requestedViewSnapshotId,
        view_snapshot_sha256: requestedViewSnapshotSha,
      };
    }

    const dedupeKey = buildPolicyRunDedupeKey({
      system_id: sv.system_id,
      sv: sv.sv,
      t_bucket: tBucket,
      policy_version: policyVersion,
      horizon_steps: horizonSteps,
    });

    const run = await deps.policyStore.getRunSummary({
      system_id: sv.system_id,
      sv: sv.sv,
      policy_version: policyVersion,
      decision_bucket_epoch_s: tBucket,
      horizon_steps: horizonSteps,
    });

    if (path === STATUS_PATH) {
      if (run) {
        return json(
          {
            status: "ready",
            computed_at: new Date().toISOString(),
            run_key: {
              system_id: run.system_id,
              sv: run.sv,
              decision_bucket_epoch_s: tBucket,
              policy_version: run.policy_version,
              strategy: effectiveStrategy,
              policy_spec_sha256: run.policy_spec_sha256,
              horizon_steps: run.horizon_steps,
              view_snapshot_id: requestedViewSnapshotId ?? resolvedSnapshotIdentity?.view_snapshot_id ?? null,
              view_snapshot_sha256: requestedViewSnapshotSha ?? resolvedSnapshotIdentity?.view_snapshot_sha256 ?? null,
            },
            run: {
              run_id: run.run_id,
              policy_version: run.policy_version,
              policy_spec_sha256: run.policy_spec_sha256,
              decision_bucket_ts: run.decision_bucket_ts,
              horizon_steps: run.horizon_steps,
            },
          },
          200
        );
      }
      const pending = deps.queue.getPendingByDedupeKey
        ? await deps.queue.getPendingByDedupeKey({ type: "policy.run_v1", dedupe_key: dedupeKey })
        : null;
      if (pending) {
        return pendingResponse({
          system_id: sv.system_id,
          sv: sv.sv,
          policy_version: policyVersion,
          strategy: effectiveStrategy,
          t_bucket: tBucket,
          horizon_steps: horizonSteps,
          retry_after_ms: deps.config.retry_after_ms,
          view_snapshot_id: requestedViewSnapshotId ?? resolvedSnapshotIdentity?.view_snapshot_id ?? null,
          view_snapshot_sha256: requestedViewSnapshotSha ?? resolvedSnapshotIdentity?.view_snapshot_sha256 ?? null,
        });
      }
      return errorResponse({
        code: "policy_run_not_found",
        message: "No ready or pending policy run for the provided run key",
        status: 404,
      });
    }

    if (path === CANCEL_PATH) {
      if (run) {
        return errorResponse({
          code: "policy_run_already_completed",
          message: "Policy run is already completed and cannot be canceled",
          status: 409,
        });
      }
      const canceled = deps.queue.cancelByDedupeKey
        ? await deps.queue.cancelByDedupeKey({ type: "policy.run_v1", dedupe_key: dedupeKey })
        : false;
      if (!canceled) {
        return errorResponse({
          code: "policy_run_not_found",
          message: "No pending policy run found for cancellation",
          status: 404,
        });
      }
      return json(
        {
          status: "canceled",
          canceled: true,
          run_key: {
            system_id: sv.system_id,
            sv: sv.sv,
            decision_bucket_epoch_s: tBucket,
            policy_version: policyVersion,
            strategy: effectiveStrategy,
            policy_spec_sha256: null,
            horizon_steps: horizonSteps,
            view_snapshot_id: requestedViewSnapshotId ?? resolvedSnapshotIdentity?.view_snapshot_id ?? null,
            view_snapshot_sha256: requestedViewSnapshotSha ?? resolvedSnapshotIdentity?.view_snapshot_sha256 ?? null,
          },
        },
        200
      );
    }

    if (!run) {
      const payload = {
        system_id: sv.system_id,
        sv: sv.sv,
        decision_bucket_ts: tBucket,
        horizon_steps: horizonSteps,
        policy_version: policyVersion,
        strategy: effectiveStrategy,
      };
      const enqueue = await deps.queue.enqueue({
        type: "policy.run_v1",
        payload,
        dedupe_key: dedupeKey,
      });
      logger.info("policy.run.pending", {
        system_id: sv.system_id,
        policy_version: policyVersion,
        t_bucket: tBucket,
        horizon_steps: horizonSteps,
        enqueue_result: enqueue.ok ? "enqueued" : "deduped",
      });
      return pendingResponse({
        system_id: sv.system_id,
        sv: sv.sv,
        policy_version: policyVersion,
        strategy: effectiveStrategy,
        t_bucket: tBucket,
        horizon_steps: horizonSteps,
        retry_after_ms: deps.config.retry_after_ms,
        view_snapshot_id: requestedViewSnapshotId ?? resolvedSnapshotIdentity?.view_snapshot_id ?? null,
        view_snapshot_sha256: requestedViewSnapshotSha ?? resolvedSnapshotIdentity?.view_snapshot_sha256 ?? null,
      });
    }

    if (path === RUN_PATH) {
      logger.info("policy.run.ok", {
        run_id: run.run_id,
        system_id: run.system_id,
        policy_version: run.policy_version,
        t_bucket: tBucket,
      });
      return json(
        {
          status: "ready",
          computed_at: new Date().toISOString(),
          run_key: {
            system_id: run.system_id,
            sv: run.sv,
            decision_bucket_epoch_s: tBucket,
            policy_version: run.policy_version,
            strategy: effectiveStrategy,
            policy_spec_sha256: run.policy_spec_sha256,
            horizon_steps: run.horizon_steps,
            view_snapshot_id: requestedViewSnapshotId ?? resolvedSnapshotIdentity?.view_snapshot_id ?? null,
            view_snapshot_sha256: requestedViewSnapshotSha ?? resolvedSnapshotIdentity?.view_snapshot_sha256 ?? null,
          },
          run: {
            run_id: run.run_id,
            system_id: run.system_id,
            policy_version: run.policy_version,
            policy_spec_sha256: run.policy_spec_sha256,
            sv: run.sv,
            decision_bucket_ts: run.decision_bucket_ts,
            horizon_steps: run.horizon_steps,
            input_quality: run.input_quality,
            no_op: run.no_op,
            no_op_reason: run.no_op_reason,
            error_reason: run.error_reason,
            move_count: run.move_count,
            created_at: run.created_at,
          },
        },
        200
      );
    }

    const requestedTopN = parsePositiveInt(url.searchParams.get("top_n"));
    const topN = Math.min(deps.config.max_moves, requestedTopN ?? deps.config.max_moves);
    if (topN <= 0) {
      return errorResponse({
        code: "invalid_top_n",
        message: "top_n must be a positive integer",
        status: 400,
      });
    }

    const moves = await deps.policyStore.listMoves({ run_id: run.run_id, limit: topN });
    logger.info("policy.moves.ok", {
      run_id: run.run_id,
      system_id: run.system_id,
      policy_version: run.policy_version,
      returned: moves.length,
      requested_top_n: topN,
    });

    return json(
      {
        status: "ready",
        computed_at: new Date().toISOString(),
        run_key: {
          system_id: run.system_id,
          sv: run.sv,
          decision_bucket_epoch_s: tBucket,
          policy_version: run.policy_version,
          strategy: effectiveStrategy,
          policy_spec_sha256: run.policy_spec_sha256,
          horizon_steps: run.horizon_steps,
          view_snapshot_id: requestedViewSnapshotId ?? resolvedSnapshotIdentity?.view_snapshot_id ?? null,
          view_snapshot_sha256: requestedViewSnapshotSha ?? resolvedSnapshotIdentity?.view_snapshot_sha256 ?? null,
        },
        run: {
          run_id: run.run_id,
          policy_version: run.policy_version,
          policy_spec_sha256: run.policy_spec_sha256,
          decision_bucket_ts: run.decision_bucket_ts,
          horizon_steps: run.horizon_steps,
        },
        top_n: topN,
        moves,
      },
      200
    );
  };
}
