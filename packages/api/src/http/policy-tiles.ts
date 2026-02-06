import { enforceAllowlist } from "../allowlist/enforce";
import { enforceAllowlistedQueryParams } from "../allowlist/http";
import type { AllowlistStore } from "../allowlist/types";
import { originShieldHeaders, validateSvQuery } from "../sv/http";
import type { ServingTokenService } from "../sv/service";
import type { PolicyMovesTileArgs, PolicyMovesTileResult } from "../tiles/policy_moves";

const POLICY_TILE_PATH_RE = /^\/api\/tiles\/policy_moves\/(\d{1,2})\/(\d+)\/(\d+)\.mvt$/;
const ALLOWED_QUERY_KEYS = new Set(["sv", "v", "T_bucket", "policy_version", "system_id"]);

export type PolicyMovesTilesRouteDeps = {
  tokens: ServingTokenService;
  allowlist: AllowlistStore;
  tileStore: {
    fetchPolicyMovesTile: (args: PolicyMovesTileArgs) => Promise<PolicyMovesTileResult>;
  };
  cache: {
    max_age_s: number;
    s_maxage_s: number;
    stale_while_revalidate_s: number;
  };
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

function parseTilePath(pathname: string): { z: number; x: number; y: number } | null {
  const match = pathname.match(POLICY_TILE_PATH_RE);
  if (!match) {
    return null;
  }
  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  if (!Number.isInteger(z) || z < 0 || z > 22) {
    return null;
  }
  const maxCoord = (1 << z) - 1;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > maxCoord || y > maxCoord) {
    return null;
  }
  return { z, x, y };
}

function hasUnknown(searchParams: URLSearchParams): string | null {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
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

export function createPolicyMovesTilesRouteHandler(
  deps: PolicyMovesTilesRouteDeps
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405, { Allow: "GET" });
    }

    const url = new URL(request.url);
    const tilePath = parseTilePath(url.pathname);
    if (!tilePath) {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }

    const unknown = hasUnknown(url.searchParams);
    if (unknown) {
      return json({ error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } }, 400);
    }

    const v = url.searchParams.get("v");
    if (v !== null && v !== "1") {
      return json({ error: { code: "unsupported_version", message: "Only v=1 is supported" } }, 400);
    }

    const sv = await validateSvQuery(deps.tokens, url.searchParams, { ctx: { path: url.pathname } });
    if (!sv.ok) {
      return json({ error: { code: sv.code, message: sv.message } }, sv.status, sv.headers);
    }

    const requestedSystemId = url.searchParams.get("system_id")?.trim();
    if (requestedSystemId && requestedSystemId !== sv.system_id) {
      return json({ error: { code: "system_id_mismatch", message: "system_id must match sv token" } }, 400);
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

    const tile = await deps.tileStore.fetchPolicyMovesTile({
      system_id: sv.system_id,
      sv: sv.sv,
      policy_version: policyVersion,
      t_bucket_epoch_s: tBucket,
      z: tilePath.z,
      x: tilePath.x,
      y: tilePath.y,
    });
    if (!tile.ok) {
      const headers =
        tile.status === 429
          ? originShieldHeaders(tile.code, tile.retry_after_s ?? 3)
          : { "Cache-Control": "no-store" };
      return json({ error: { code: tile.code, message: tile.message } }, tile.status, headers);
    }

    return new Response(tile.mvt, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Cache-Control":
          `public, max-age=${deps.cache.max_age_s}, s-maxage=${deps.cache.s_maxage_s}, stale-while-revalidate=${deps.cache.stale_while_revalidate_s}`,
        "X-Tile-Feature-Count": String(tile.feature_count),
        "X-Tile-Bytes": String(tile.bytes),
      },
    });
  };
}
