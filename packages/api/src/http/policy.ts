import { enforceAllowlist } from "../allowlist/enforce";
import { enforceAllowlistedQueryParams } from "../allowlist/http";
import type { AllowlistStore } from "../allowlist/types";
import { validateSvQuery } from "../sv/http";
import type { ServingTokenService } from "../sv/service";
import type { PolicyMove, PolicyRunSummary } from "../policy/store";

const CONFIG_PATH = "/api/policy/config";
const RUN_PATH = "/api/policy/run";
const MOVES_PATH = "/api/policy/moves";

const ALLOWED_CONFIG_KEYS = new Set(["v"]);
const ALLOWED_RUN_KEYS = new Set(["sv", "v", "policy_version", "T_bucket", "horizon_steps", "system_id"]);
const ALLOWED_MOVES_KEYS = new Set([
  "sv",
  "v",
  "policy_version",
  "T_bucket",
  "horizon_steps",
  "top_n",
  "system_id",
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
  queue: {
    enqueue: (args: {
      type: string;
      payload: unknown;
      dedupe_key?: string;
      max_attempts?: number;
    }) => Promise<{ ok: true; job_id: number } | { ok: false; reason: "deduped" }>;
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

function hasUnknown(searchParams: URLSearchParams, allowed: Set<string>): string | null {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      return key;
    }
  }
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

function pendingResponse(params: {
  system_id: string;
  sv: string;
  policy_version: string;
  t_bucket: number;
  horizon_steps: number;
  retry_after_ms: number;
}): Response {
  const cacheKey =
    `${params.system_id}:${params.policy_version}:${params.sv}:${params.t_bucket}:${params.horizon_steps}`;
  return json(
    {
      status: "pending",
      retry_after_ms: params.retry_after_ms,
      cache_key: cacheKey,
    },
    202,
    { "Retry-After": String(Math.max(1, Math.ceil(params.retry_after_ms / 1000))) }
  );
}

export function createPolicyRouteHandler(deps: PolicyRouteDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const logger = deps.logger ?? defaultLogger;

    if (request.method !== "GET") {
      return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    if (path !== CONFIG_PATH && path !== RUN_PATH && path !== MOVES_PATH) {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }

    const v = url.searchParams.get("v");
    if (v !== null && v !== "1") {
      return json({ error: { code: "unsupported_version", message: "Only v=1 is supported" } }, 400);
    }

    if (path === CONFIG_PATH) {
      const unknown = hasUnknown(url.searchParams, ALLOWED_CONFIG_KEYS);
      if (unknown) {
        return json(
          { error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } },
          400
        );
      }
      return json(
        {
          default_policy_version: deps.config.default_policy_version,
          available_policy_versions: deps.config.available_policy_versions,
          default_horizon_steps: deps.config.default_horizon_steps,
          max_moves: deps.config.max_moves,
          budget_presets: deps.config.budget_presets,
        },
        200
      );
    }

    const unknown = hasUnknown(url.searchParams, path === RUN_PATH ? ALLOWED_RUN_KEYS : ALLOWED_MOVES_KEYS);
    if (unknown) {
      return json(
        { error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } },
        400
      );
    }

    const sv = await validateSvQuery(deps.tokens, url.searchParams, { ctx: { path: url.pathname } });
    if (!sv.ok) {
      return json({ error: { code: sv.code, message: sv.message } }, sv.status, sv.headers);
    }

    const requestedSystemId = url.searchParams.get("system_id")?.trim();
    if (requestedSystemId && requestedSystemId !== sv.system_id) {
      return json(
        { error: { code: "system_id_mismatch", message: "system_id must match sv token" } },
        400
      );
    }

    const systemAllow = await enforceAllowlist(
      deps.allowlist,
      [{ kind: "system_id", value: sv.system_id }],
      { path: url.pathname }
    );
    if (!systemAllow.ok) {
      return json({ error: { code: systemAllow.code, message: systemAllow.message } }, systemAllow.status);
    }

    const allowlisted = await enforceAllowlistedQueryParams(
      deps.allowlist,
      url.searchParams,
      ["policy_version"],
      { system_id: sv.system_id, ctx: { path: url.pathname } }
    );
    if (!allowlisted.ok) {
      return json({ error: { code: allowlisted.code, message: allowlisted.message } }, allowlisted.status);
    }

    const policyVersion = requireText(url.searchParams, "policy_version");
    if (!policyVersion) {
      return json(
        { error: { code: "missing_policy_version", message: "policy_version is required" } },
        400
      );
    }

    const tBucket = parsePositiveInt(url.searchParams.get("T_bucket"));
    if (tBucket === null) {
      return json(
        { error: { code: "invalid_t_bucket", message: "T_bucket must be a positive integer epoch second" } },
        400
      );
    }

    const horizonSteps = parsePositiveInt(url.searchParams.get("horizon_steps")) ?? deps.config.default_horizon_steps;
    if (!Number.isInteger(horizonSteps) || horizonSteps < 0 || horizonSteps > 288) {
      return json(
        { error: { code: "invalid_horizon_steps", message: "horizon_steps must be an integer between 0 and 288" } },
        400
      );
    }

    const run = await deps.policyStore.getRunSummary({
      system_id: sv.system_id,
      sv: sv.sv,
      policy_version: policyVersion,
      decision_bucket_epoch_s: tBucket,
      horizon_steps: horizonSteps,
    });

    if (!run) {
      const payload = {
        system_id: sv.system_id,
        sv: sv.sv,
        decision_bucket_ts: tBucket,
        horizon_steps: horizonSteps,
        policy_version: policyVersion,
      };
      const dedupeKey = `${sv.system_id}:${sv.sv}:${tBucket}:${policyVersion}:${horizonSteps}`;
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
        t_bucket: tBucket,
        horizon_steps: horizonSteps,
        retry_after_ms: deps.config.retry_after_ms,
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
      return json(
        { error: { code: "invalid_top_n", message: "top_n must be a positive integer" } },
        400
      );
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
