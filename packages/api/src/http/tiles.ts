import { enforceAllowlist } from "../allowlist/enforce";
import { canonicalizeLayersSet, enforceAllowlistedQueryParams } from "../allowlist/http";
import type { AllowlistStore } from "../allowlist/types";
import { originShieldHeaders, validateSvQuery } from "../sv/http";
import type { ServingTokenService } from "../sv/service";

const TILE_PATH_RE = /^\/api\/tiles\/composite\/(\d{1,2})\/(\d+)\/(\d+)\.mvt$/;
const ALLOWED_QUERY_KEYS = new Set([
  "sv",
  "v",
  "tile_schema",
  "severity_version",
  "layers",
  "T_bucket",
  "system_id",
]);

export type CompositeTileArgs = {
  system_id: string;
  view_id: number;
  view_spec_sha256: string;
  pressure_source: "live_proxy" | "trips_baseline";
  trips_baseline_id?: string;
  trips_baseline_sha256?: string;
  z: number;
  x: number;
  y: number;
  t_bucket_epoch_s: number;
  tile_schema: string;
  severity_version: string;
  layers_set: string;
};

export type CompositeTileResult =
  | {
      ok: true;
      mvt: Uint8Array;
      feature_count: number;
      bytes: number;
      degrade_level?: number;
      dropped_optional_props?: string[];
    }
  | {
      ok: false;
      status: 400 | 404 | 429 | 500;
      code: string;
      message: string;
      retry_after_s?: number;
    };

export type CompositeTilesRouteDeps = {
  tokens: ServingTokenService;
  allowlist: AllowlistStore;
  servingViews?: {
    getPressureBinding: (args: {
      system_id: string;
      view_id: number;
      view_spec_sha256: string;
    }) => Promise<{ trips_baseline_id?: string; trips_baseline_sha256?: string } | null>;
  };
  tileStore: {
    fetchCompositeTile: (args: CompositeTileArgs) => Promise<CompositeTileResult>;
  };
  cache: {
    max_age_s: number;
    s_maxage_s: number;
    stale_while_revalidate_s: number;
    replay_max_age_s?: number;
    replay_s_maxage_s?: number;
    replay_stale_while_revalidate_s?: number;
    replay_min_ttl_s?: number;
  };
  replayCache?: {
    get: (key: string) => Promise<{
      mvt: Uint8Array;
      feature_count: number;
      bytes: number;
      degrade_level?: number;
    } | null>;
    put: (
      key: string,
      value: {
        mvt: Uint8Array;
        feature_count: number;
        bytes: number;
        degrade_level?: number;
      }
    ) => Promise<void>;
  };
  logger?: {
    info: (event: string, details: Record<string, unknown>) => void;
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

function parsePositiveInt(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function requiredQuery(searchParams: URLSearchParams, key: string): string | null {
  const value = searchParams.get(key)?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function parseTilePath(pathname: string): { z: number; x: number; y: number } | null {
  const match = pathname.match(TILE_PATH_RE);
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

function hasUnknownQueryParam(searchParams: URLSearchParams): string | null {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      return key;
    }
  }
  return null;
}

async function resolvePressureBinding(
  deps: CompositeTilesRouteDeps,
  args: { system_id: string; view_id: number; view_spec_sha256: string }
): Promise<
  | {
      ok: true;
      pressure_source: "live_proxy" | "trips_baseline";
      trips_baseline_id?: string;
      trips_baseline_sha256?: string;
    }
  | { ok: false; status: 500; code: string; message: string }
> {
  if (!deps.servingViews) {
    return { ok: true, pressure_source: "live_proxy" };
  }

  try {
    const binding = await deps.servingViews.getPressureBinding(args);
    const baselineId = binding?.trips_baseline_id?.trim();
    if (!baselineId) {
      return { ok: true, pressure_source: "live_proxy" };
    }
    return {
      ok: true,
      pressure_source: "trips_baseline",
      trips_baseline_id: baselineId,
      trips_baseline_sha256: binding?.trips_baseline_sha256?.trim() || undefined,
    };
  } catch {
    return {
      ok: false,
      status: 500,
      code: "pressure_binding_unavailable",
      message: "Failed to resolve pressure baseline binding for sv",
    };
  }
}

function buildReplayCacheKey(args: {
  system_id: string;
  sv: string;
  z: number;
  x: number;
  y: number;
  t_bucket_epoch_s: number;
  tile_schema: string;
  severity_version: string;
  layers_set: string;
}): string {
  return [
    "composite.v1",
    args.system_id,
    args.sv,
    String(args.z),
    String(args.x),
    String(args.y),
    String(args.t_bucket_epoch_s),
    args.tile_schema,
    args.severity_version,
    args.layers_set,
  ].join("|");
}

export function createCompositeTilesRouteHandler(
  deps: CompositeTilesRouteDeps
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

    const unknown = hasUnknownQueryParam(url.searchParams);
    if (unknown) {
      return json(
        { error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } },
        400
      );
    }

    const version = url.searchParams.get("v");
    if (version !== null && version !== "1") {
      return json({ error: { code: "unsupported_version", message: "Only v=1 is supported" } }, 400);
    }

    const sv = await validateSvQuery(deps.tokens, url.searchParams, {
      ctx: { path: url.pathname },
    });
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
      return json({ error: { code: systemAllow.code, message: systemAllow.message } }, systemAllow.status, systemAllow.headers);
    }

    const tileSchema = requiredQuery(url.searchParams, "tile_schema");
    if (!tileSchema) {
      return json(
        { error: { code: "missing_tile_schema", message: "tile_schema is required" } },
        400
      );
    }
    const severityVersion = requiredQuery(url.searchParams, "severity_version");
    if (!severityVersion) {
      return json(
        { error: { code: "missing_severity_version", message: "severity_version is required" } },
        400
      );
    }
    const layersRaw = requiredQuery(url.searchParams, "layers");
    if (!layersRaw) {
      return json(
        { error: { code: "invalid_layers", message: "layers is required and must contain at least one layer" } },
        400
      );
    }

    const allowlisted = await enforceAllowlistedQueryParams(
      deps.allowlist,
      url.searchParams,
      ["tile_schema", "severity_version", "layers"],
      {
        system_id: sv.system_id,
        ctx: { path: url.pathname },
      }
    );
    if (!allowlisted.ok) {
      return json({ error: { code: allowlisted.code, message: allowlisted.message } }, allowlisted.status, allowlisted.headers);
    }

    const tBucket = parsePositiveInt(url.searchParams.get("T_bucket"));
    if (tBucket === null) {
      return json(
        { error: { code: "invalid_t_bucket", message: "T_bucket must be a positive integer epoch second" } },
        400
      );
    }
    const layersSet = canonicalizeLayersSet(layersRaw);
    if (layersSet.length === 0) {
      return json(
        { error: { code: "invalid_layers", message: "layers is required and must contain at least one layer" } },
        400
      );
    }

    const pressureBinding = await resolvePressureBinding(deps, {
      system_id: sv.system_id,
      view_id: sv.view_id,
      view_spec_sha256: sv.view_spec_sha256,
    });
    if (!pressureBinding.ok) {
      return json(
        { error: { code: pressureBinding.code, message: pressureBinding.message } },
        pressureBinding.status
      );
    }

    const svTtl =
      typeof sv.expires_at_s === "number" && typeof sv.issued_at_s === "number"
        ? sv.expires_at_s - sv.issued_at_s
        : null;
    const replayMinTtl = deps.cache.replay_min_ttl_s ?? 86_400;
    const isReplay = svTtl !== null && svTtl >= replayMinTtl;
    const maxAge = isReplay ? (deps.cache.replay_max_age_s ?? deps.cache.max_age_s) : deps.cache.max_age_s;
    const sMaxage = isReplay ? (deps.cache.replay_s_maxage_s ?? deps.cache.s_maxage_s) : deps.cache.s_maxage_s;
    const swr = isReplay
      ? (deps.cache.replay_stale_while_revalidate_s ?? deps.cache.stale_while_revalidate_s)
      : deps.cache.stale_while_revalidate_s;

    const cacheControl = isReplay
      ? `public, max-age=${maxAge}, s-maxage=${sMaxage}, stale-while-revalidate=${swr}, immutable`
      : `public, max-age=${maxAge}, s-maxage=${sMaxage}, stale-while-revalidate=${swr}`;

    const rawSv = requiredQuery(url.searchParams, "sv") ?? "";
    const replayCacheKey = isReplay
      ? buildReplayCacheKey({
          system_id: sv.system_id,
          sv: rawSv,
          z: tilePath.z,
          x: tilePath.x,
          y: tilePath.y,
          t_bucket_epoch_s: tBucket,
          tile_schema: tileSchema,
          severity_version: severityVersion,
          layers_set: layersSet,
        })
      : null;

    if (isReplay && replayCacheKey && deps.replayCache) {
      const cached = await deps.replayCache.get(replayCacheKey);
      if (cached) {
        deps.logger?.info("tiles.replay_cache_hit", {
          path: url.pathname,
          system_id: sv.system_id,
          tile_schema: tileSchema,
          severity_version: severityVersion,
          layers_set: layersSet,
          key: replayCacheKey,
        });
        return new Response(cached.mvt, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.mapbox-vector-tile",
            "Cache-Control": cacheControl,
            "X-Tile-Feature-Count": String(cached.feature_count),
            "X-Tile-Bytes": String(cached.bytes),
            "X-Tile-Degrade-Level": String(cached.degrade_level ?? 0),
            "X-Replay-Tile-Source": "write-through-cache",
          },
        });
      }
      deps.logger?.info("tiles.replay_cache_miss", {
        path: url.pathname,
        system_id: sv.system_id,
        tile_schema: tileSchema,
        severity_version: severityVersion,
        layers_set: layersSet,
        key: replayCacheKey,
      });
    }

    const tile = await deps.tileStore.fetchCompositeTile({
      system_id: sv.system_id,
      view_id: sv.view_id,
      view_spec_sha256: sv.view_spec_sha256,
      pressure_source: pressureBinding.pressure_source,
      trips_baseline_id: pressureBinding.trips_baseline_id,
      trips_baseline_sha256: pressureBinding.trips_baseline_sha256,
      z: tilePath.z,
      x: tilePath.x,
      y: tilePath.y,
      t_bucket_epoch_s: tBucket,
      tile_schema: tileSchema,
      severity_version: severityVersion,
      layers_set: layersSet,
    });
    if (!tile.ok) {
      const headers =
        tile.status === 429
          ? originShieldHeaders(tile.code, tile.retry_after_s ?? 3)
          : { "Cache-Control": "no-store" };
      return json({ error: { code: tile.code, message: tile.message } }, tile.status, headers);
    }

    if (isReplay && replayCacheKey && deps.replayCache) {
      await deps.replayCache.put(replayCacheKey, {
        mvt: tile.mvt,
        feature_count: tile.feature_count,
        bytes: tile.bytes,
        degrade_level: tile.degrade_level,
      });
      deps.logger?.info("tiles.replay_cache_write", {
        path: url.pathname,
        system_id: sv.system_id,
        tile_schema: tileSchema,
        severity_version: severityVersion,
        layers_set: layersSet,
        key: replayCacheKey,
        bytes: tile.bytes,
      });
    }

    deps.logger?.info("tiles.cache_policy", {
      path: url.pathname,
      system_id: sv.system_id,
      tile_schema: tileSchema,
      severity_version: severityVersion,
      layers_set: layersSet,
      sv_ttl_s: svTtl,
      cache_mode: isReplay ? "replay" : "live",
      cache_control: cacheControl,
    });

    return new Response(tile.mvt, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Cache-Control": cacheControl,
        "X-Tile-Feature-Count": String(tile.feature_count),
        "X-Tile-Bytes": String(tile.bytes),
        "X-Tile-Degrade-Level": String(tile.degrade_level ?? 0),
        ...(isReplay && deps.replayCache ? { "X-Replay-Tile-Source": "origin-write-through" } : {}),
      },
    });
  };
}
