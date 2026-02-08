import { enforceAllowlist } from "../allowlist/enforce";
import type { AllowlistStore } from "../allowlist/types";
import { originShieldHeaders, validateSvQuery } from "../sv/http";
import type { ServingTokenService } from "../sv/service";
import type { EpisodesTileArgs, EpisodesTileResult } from "../tiles/episodes";

const EPISODES_TILE_PATH_RE = /^\/api\/tiles\/episodes\/(\d{1,2})\/(\d+)\/(\d+)\.mvt$/;
const ALLOWED_QUERY_KEYS = new Set(["sv", "v", "T_bucket", "system_id"]);

export type EpisodesTilesRouteDeps = {
  tokens: ServingTokenService;
  allowlist: AllowlistStore;
  default_severity_version: string;
  servingViews?: {
    getEpisodeBinding: (args: {
      system_id: string;
      view_id: number;
      view_spec_sha256: string;
    }) => Promise<{ severity_version?: string } | null>;
  };
  tileStore: {
    fetchEpisodesTile: (args: EpisodesTileArgs) => Promise<EpisodesTileResult>;
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
  const match = pathname.match(EPISODES_TILE_PATH_RE);
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

async function resolveSeverityVersion(
  deps: EpisodesTilesRouteDeps,
  args: { system_id: string; view_id: number; view_spec_sha256: string }
): Promise<
  | { ok: true; severity_version: string }
  | { ok: false; status: 500; code: string; message: string }
> {
  if (!deps.servingViews) {
    return { ok: true, severity_version: deps.default_severity_version };
  }
  try {
    const binding = await deps.servingViews.getEpisodeBinding(args);
    const version = binding?.severity_version?.trim() || deps.default_severity_version;
    return { ok: true, severity_version: version };
  } catch {
    return {
      ok: false,
      status: 500,
      code: "episode_binding_unavailable",
      message: "Failed to resolve episode binding for sv",
    };
  }
}

export function createEpisodesTilesRouteHandler(
  deps: EpisodesTilesRouteDeps
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

    const tBucket = parsePositiveInt(url.searchParams.get("T_bucket"));
    if (tBucket === null) {
      return json(
        { error: { code: "invalid_t_bucket", message: "T_bucket must be a positive integer epoch second" } },
        400
      );
    }

    const binding = await resolveSeverityVersion(deps, {
      system_id: sv.system_id,
      view_id: sv.view_id,
      view_spec_sha256: sv.view_spec_sha256,
    });
    if (!binding.ok) {
      return json({ error: { code: binding.code, message: binding.message } }, binding.status);
    }

    const tile = await deps.tileStore.fetchEpisodesTile({
      system_id: sv.system_id,
      severity_version: binding.severity_version,
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
