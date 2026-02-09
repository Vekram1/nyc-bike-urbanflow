import { enforceAllowlist } from "../allowlist/enforce";
import { enforceAllowlistedQueryParams } from "../allowlist/http";
import type { AllowlistStore } from "../allowlist/types";
import { validateSvQuery } from "../sv/http";

export type StationDrawerPointInTime = {
  bucket_ts: string | null;
  bikes_available: number | null;
  docks_available: number | null;
  bucket_quality: string | null;
  severity: number | null;
  pressure_score: number | null;
  pressure_delta_bikes_5m?: number | null;
  pressure_delta_docks_5m?: number | null;
  pressure_volatility_60m?: number | null;
  pressure_rebalancing_suspected?: boolean | null;
  severity_components?: unknown;
};

export type StationDrawerSeriesPoint = {
  bucket_ts: string;
  bikes_available: number;
  docks_available: number;
  bucket_quality: string;
  severity?: number;
  pressure_score?: number;
};

export type StationDrawerEpisode = {
  bucket_ts: string;
  episode_type: "empty" | "full";
  duration_minutes: number;
  bucket_quality: string;
  episode_start_ts: string;
  episode_end_ts: string;
};

export type StationDrawerResponse = {
  station_key: string;
  sv: string | null;
  t_bucket_epoch_s: number;
  range_s: number;
  bucket_seconds: number;
  severity_version: string;
  tile_schema: string;
  metadata: {
    name?: string | null;
    capacity?: number | null;
  };
  point_in_time: StationDrawerPointInTime;
  series: {
    points: StationDrawerSeriesPoint[];
    truncated: boolean;
  };
  episodes: {
    items: StationDrawerEpisode[];
    truncated: boolean;
  };
};

export type StationDrawerRouteDeps = {
  tokens: {
    validate: (token: string) => Promise<
      | {
          ok: true;
          payload: { system_id: string; view_id: number; view_spec_sha256: string };
        }
      | {
          ok: false;
          reason: string;
        }
    >;
  };
  allowlist: AllowlistStore;
  stationsStore: {
    getStationDrawer: (args: {
      system_id: string;
      view_id: number;
      station_key: string;
      t_bucket_epoch_s: number;
      range_s: number;
      bucket_seconds: number;
      max_series_points: number;
      max_episodes: number;
      severity_version: string;
    }) => Promise<StationDrawerResponse | null>;
  };
  defaults: {
    severity_version: string;
    tile_schema: string;
    range_s: number;
    bucket_seconds: number;
  };
  limits: {
    max_range_s: number;
    max_series_points: number;
    max_episodes: number;
  };
  cache: {
    max_age_s: number;
    s_maxage_s: number;
    stale_while_revalidate_s: number;
  };
  logger?: {
    info: (event: string, details: Record<string, unknown>) => void;
    warn: (event: string, details: Record<string, unknown>) => void;
  };
};

const stationKeyRe = /^[A-Za-z0-9._:-]{1,80}$/;
const drawerPathRe = /^\/api\/stations\/([^/]+)\/drawer$/;
const allowedQueryKeys = new Set([
  "v",
  "sv",
  "system_id",
  "T_bucket",
  "range",
  "bucket",
  "severity_version",
  "tile_schema",
]);

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

function parseEpochSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    return null;
  }
  return n;
}

function parseRangeSeconds(value: string | null, fallback: number): number | null {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  const raw = value.trim().toLowerCase();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const match = raw.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    return null;
  }
  const count = Number(match[1]);
  if (!Number.isInteger(count) || count <= 0) {
    return null;
  }
  const unit = match[2];
  if (unit === "m") {
    return count * 60;
  }
  if (unit === "h") {
    return count * 60 * 60;
  }
  return count * 24 * 60 * 60;
}

function parseBucketSeconds(value: string | null, fallback: number): number | null {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 60 || n > 3600) {
    return null;
  }
  return n;
}

function parseStationKey(pathname: string): string | null {
  const match = pathname.match(drawerPathRe);
  if (!match) {
    return null;
  }
  const key = decodeURIComponent(match[1] ?? "");
  return stationKeyRe.test(key) ? key : null;
}

function hasUnknownQueryParam(searchParams: URLSearchParams): string | null {
  for (const key of searchParams.keys()) {
    if (!allowedQueryKeys.has(key)) {
      return key;
    }
  }
  return null;
}

function jsonByteSize(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

export function createStationDrawerRouteHandler(
  deps: StationDrawerRouteDeps
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const logger = deps.logger ?? defaultLogger;
    if (request.method !== "GET") {
      return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405);
    }

    const url = new URL(request.url);
    const stationKey = parseStationKey(url.pathname);
    if (!stationKey) {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }

    const unknown = hasUnknownQueryParam(url.searchParams);
    if (unknown) {
      return json({ error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } }, 400);
    }

    const version = url.searchParams.get("v");
    if (version !== null && version !== "1") {
      return json({ error: { code: "unsupported_version", message: "Only v=1 is supported" } }, 400);
    }

    const sv = await validateSvQuery(deps.tokens as unknown as import("../sv/service").ServingTokenService, url.searchParams, {
      ctx: { path: url.pathname },
    });
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
      return json({ error: { code: systemAllow.code, message: systemAllow.message } }, systemAllow.status, systemAllow.headers);
    }

    const severityVersion = (url.searchParams.get("severity_version") ?? "").trim() || deps.defaults.severity_version;
    const tileSchema = (url.searchParams.get("tile_schema") ?? "").trim() || deps.defaults.tile_schema;
    const allowlisted = await enforceAllowlistedQueryParams(
      deps.allowlist,
      new URLSearchParams({
        severity_version: severityVersion,
        tile_schema: tileSchema,
      }),
      ["severity_version", "tile_schema"],
      {
        system_id: sv.system_id,
        ctx: { path: url.pathname },
      }
    );
    if (!allowlisted.ok) {
      return json({ error: { code: allowlisted.code, message: allowlisted.message } }, allowlisted.status, allowlisted.headers);
    }

    const tBucket = parseEpochSeconds(url.searchParams.get("T_bucket"));
    if (tBucket === null) {
      return json({ error: { code: "invalid_t_bucket", message: "T_bucket must be a positive integer epoch second" } }, 400);
    }
    const rangeS = parseRangeSeconds(url.searchParams.get("range"), deps.defaults.range_s);
    if (rangeS === null || rangeS > deps.limits.max_range_s) {
      return json(
        {
          error: {
            code: "invalid_range",
            message: `range must be <= ${deps.limits.max_range_s} seconds`,
          },
        },
        400
      );
    }
    const bucketSeconds = parseBucketSeconds(url.searchParams.get("bucket"), deps.defaults.bucket_seconds);
    if (bucketSeconds === null) {
      return json({ error: { code: "invalid_bucket", message: "bucket must be integer seconds between 60 and 3600" } }, 400);
    }

    const drawer = await deps.stationsStore.getStationDrawer({
      system_id: sv.system_id,
      view_id: sv.view_id,
      station_key: stationKey,
      t_bucket_epoch_s: tBucket,
      range_s: rangeS,
      bucket_seconds: bucketSeconds,
      max_series_points: deps.limits.max_series_points,
      max_episodes: deps.limits.max_episodes,
      severity_version: severityVersion,
    });
    if (!drawer) {
      logger.warn("stations.drawer.not_found", {
        system_id: sv.system_id,
        station_key: stationKey,
        sv: url.searchParams.get("sv"),
        view_id: sv.view_id,
      });
      return json({ error: { code: "station_not_found", message: "Station not found" } }, 404);
    }

    const payload = {
      ...drawer,
      sv: url.searchParams.get("sv"),
      t_bucket_epoch_s: tBucket,
      range_s: rangeS,
      bucket_seconds: bucketSeconds,
      severity_version: severityVersion,
      tile_schema: tileSchema,
    };
    const cacheControl = `public, max-age=${deps.cache.max_age_s}, s-maxage=${deps.cache.s_maxage_s}, stale-while-revalidate=${deps.cache.stale_while_revalidate_s}`;
    logger.info("stations.drawer.ok", {
      system_id: sv.system_id,
      station_key: stationKey,
      sv: url.searchParams.get("sv"),
      view_id: sv.view_id,
      t_bucket_epoch_s: tBucket,
      range_s: rangeS,
      bucket_seconds: bucketSeconds,
      severity_version: severityVersion,
      tile_schema: tileSchema,
      points_returned: payload.series.points.length,
      episodes_returned: payload.episodes.items.length,
      payload_bytes: jsonByteSize(payload),
    });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": cacheControl,
      },
    });
  };
}
