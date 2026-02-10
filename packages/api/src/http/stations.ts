import { validateSvQuery } from "../sv/http";

export type StationDetail = {
  station_key: string;
  name?: string | null;
  capacity?: number | null;
  bucket_ts?: string | null;
  bikes_available?: number | null;
  docks_available?: number | null;
  bucket_quality?: string | null;
  severity?: number | null;
  pressure_score?: number | null;
  pressure_delta_bikes_5m?: number | null;
  pressure_delta_docks_5m?: number | null;
  pressure_volatility_60m?: number | null;
  pressure_rebalancing_suspected?: boolean | null;
};

export type StationSeriesPoint = {
  bucket_ts: string;
  bikes_available: number;
  docks_available: number;
  bucket_quality: string;
  severity?: number;
  pressure_score?: number;
  pressure_delta_bikes_5m?: number;
  pressure_delta_docks_5m?: number;
  pressure_volatility_60m?: number;
  pressure_rebalancing_suspected?: boolean;
};

export type StationSnapshot = {
  station_key: string;
  name: string | null;
  lat: number;
  lon: number;
  capacity: number | null;
  bucket_ts: string | null;
  bikes_available: number | null;
  docks_available: number | null;
  bucket_quality: string | null;
};

export type StationsRouteDeps = {
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
  stationsStore: {
    getStationDetail: (args: {
      system_id: string;
      view_id: number;
      station_key: string;
    }) => Promise<StationDetail | null>;
    getStationSeries: (args: {
      system_id: string;
      view_id: number;
      station_key: string;
      from_epoch_s: number;
      to_epoch_s: number;
      bucket_seconds: number;
      limit: number;
    }) => Promise<StationSeriesPoint[]>;
    getStationsSnapshot?: (args: {
      system_id: string;
      view_id: number;
      t_bucket_epoch_s: number | null;
      limit: number;
    }) => Promise<StationSnapshot[]>;
  };
  default_bucket_seconds: number;
  max_series_window_s: number;
  max_series_points: number;
  logger?: {
    info: (event: string, details: Record<string, unknown>) => void;
    warn: (event: string, details: Record<string, unknown>) => void;
  };
};

const stationKeyRe = /^[A-Za-z0-9._:-]{1,80}$/;
const SNAPSHOT_ALLOWED_QUERY_PARAMS = new Set(["v", "sv", "T_bucket", "limit", "system_id"]);
const DETAIL_ALLOWED_QUERY_PARAMS = new Set(["sv"]);
const SERIES_ALLOWED_QUERY_PARAMS = new Set(["sv", "bucket", "from", "to", "start", "end"]);

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

function jsonByteSize(body: unknown): number {
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

function parseBucket(value: string | null, fallback: number): number | null {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 60 || n > 3600) {
    return null;
  }
  return n;
}

function parseEpochSeconds(value: string | null): number | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    return null;
  }
  return n;
}

function parseLimit(value: string | null, fallback: number): number | null {
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10000) {
    return null;
  }
  return n;
}

const defaultLogger = {
  info(event: string, details: Record<string, unknown>): void {
    console.info(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...details }));
  },
  warn(event: string, details: Record<string, unknown>): void {
    console.warn(JSON.stringify({ level: "warn", event, ts: new Date().toISOString(), ...details }));
  },
};

function extractStationPath(pathname: string): { station_key: string; is_series: boolean; is_snapshot: boolean } | null {
  if (pathname === "/api/stations") {
    return { station_key: "", is_series: false, is_snapshot: true };
  }
  const seriesMatch = pathname.match(/^\/api\/stations\/([^/]+)\/series$/);
  if (seriesMatch) {
    return { station_key: decodeURIComponent(seriesMatch[1] ?? ""), is_series: true, is_snapshot: false };
  }
  const detailMatch = pathname.match(/^\/api\/stations\/([^/]+)$/);
  if (detailMatch) {
    return { station_key: decodeURIComponent(detailMatch[1] ?? ""), is_series: false, is_snapshot: false };
  }
  return null;
}

function hasUnknownQueryParam(searchParams: URLSearchParams, allowed: Set<string>): string | null {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      return key;
    }
  }
  return null;
}

export function createStationsRouteHandler(deps: StationsRouteDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const logger = deps.logger ?? defaultLogger;
    if (request.method !== "GET") {
      return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405);
    }

    const url = new URL(request.url);
    const route = extractStationPath(url.pathname);
    const svToken = url.searchParams.get("sv") ?? null;
    if (!route) {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }
    const unknown = hasUnknownQueryParam(
      url.searchParams,
      route.is_snapshot
        ? SNAPSHOT_ALLOWED_QUERY_PARAMS
        : route.is_series
          ? SERIES_ALLOWED_QUERY_PARAMS
          : DETAIL_ALLOWED_QUERY_PARAMS
    );
    if (unknown) {
      return json({ error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } }, 400);
    }

    if (route.is_snapshot) {
      const sv = await validateSvQuery(
        deps.tokens as unknown as import("../sv/service").ServingTokenService,
        url.searchParams,
        { ctx: { path: url.pathname } }
      );
      if (!sv.ok) {
        return json({ error: { code: sv.code, message: sv.message } }, sv.status, sv.headers);
      }
      const requestedSystemId = url.searchParams.get("system_id")?.trim();
      if (requestedSystemId && requestedSystemId !== sv.system_id) {
        return json(
          { error: { code: "system_id_mismatch", message: "system_id must match serving token system_id" } },
          400
        );
      }
      const tBucket = parseEpochSeconds(url.searchParams.get("T_bucket"));
      if (url.searchParams.get("T_bucket") !== null && tBucket === null) {
        return json(
          { error: { code: "invalid_t_bucket", message: "T_bucket must be positive integer epoch seconds" } },
          400
        );
      }
      const limit = parseLimit(url.searchParams.get("limit"), 5000);
      if (limit === null) {
        return json({ error: { code: "invalid_limit", message: "limit must be integer between 1 and 10000" } }, 400);
      }
      if (!deps.stationsStore.getStationsSnapshot) {
        return json({ error: { code: "not_found", message: "Route not found" } }, 404);
      }

      const snapshot = await deps.stationsStore.getStationsSnapshot({
        system_id: sv.system_id,
        view_id: sv.view_id,
        t_bucket_epoch_s: tBucket,
        limit,
      });
      const effectiveBucket = tBucket;
      const featureCollection = {
        system_id: sv.system_id,
        view_id: sv.view_id,
        requested_t_bucket: tBucket,
        effective_t_bucket: effectiveBucket,
        type: "FeatureCollection" as const,
        features: snapshot.map((station) => ({
          type: "Feature" as const,
          id: station.station_key,
          geometry: {
            type: "Point" as const,
            coordinates: [station.lon, station.lat] as [number, number],
          },
          properties: {
            station_id: station.station_key,
            name: station.name ?? station.station_key,
            capacity: station.capacity,
            bikes: station.bikes_available,
            docks: station.docks_available,
            bucket_quality: station.bucket_quality,
            t_bucket: station.bucket_ts,
          },
        })),
      };
      logger.info("stations.snapshot.ok", {
        system_id: sv.system_id,
        sv: svToken,
        view_id: sv.view_id,
        requested_t_bucket: tBucket,
        features_returned: featureCollection.features.length,
        payload_bytes: jsonByteSize(featureCollection),
      });
      return json(featureCollection, 200);
    }

    if (!stationKeyRe.test(route.station_key)) {
      logger.warn("stations.invalid_station_key", { station_key: route.station_key, path: url.pathname });
      return json(
        { error: { code: "invalid_station_key", message: "station_key must be 1-80 safe characters" } },
        400
      );
    }

    const sv = await validateSvQuery(deps.tokens as unknown as import("../sv/service").ServingTokenService, url.searchParams, {
      ctx: { path: url.pathname },
    });
    if (!sv.ok) {
      return json({ error: { code: sv.code, message: sv.message } }, sv.status, sv.headers);
    }

    if (!route.is_series) {
      const detail = await deps.stationsStore.getStationDetail({
        system_id: sv.system_id,
        view_id: sv.view_id,
        station_key: route.station_key,
      });
      if (!detail) {
        logger.warn("stations.detail.not_found", {
          system_id: sv.system_id,
          station_key: route.station_key,
          sv: svToken,
          view_id: sv.view_id,
        });
        return json({ error: { code: "station_not_found", message: "Station not found" } }, 404);
      }
      const payloadBytes = jsonByteSize(detail);
      logger.info("stations.detail.ok", {
        system_id: sv.system_id,
        station_key: route.station_key,
        sv: svToken,
        view_id: sv.view_id,
        payload_bytes: payloadBytes,
      });
      return json(detail, 200);
    }

    const bucket = parseBucket(url.searchParams.get("bucket"), deps.default_bucket_seconds);
    if (bucket === null) {
      logger.warn("stations.series.invalid_bucket", {
        system_id: sv.system_id,
        station_key: route.station_key,
        bucket_raw: url.searchParams.get("bucket"),
      });
      return json(
        { error: { code: "invalid_bucket", message: "bucket must be integer seconds between 60 and 3600" } },
        400
      );
    }

    const fromEpoch = parseEpochSeconds(url.searchParams.get("from") ?? url.searchParams.get("start"));
    const toEpoch = parseEpochSeconds(url.searchParams.get("to") ?? url.searchParams.get("end"));
    if (fromEpoch === null || toEpoch === null || fromEpoch >= toEpoch) {
      logger.warn("stations.series.invalid_range", {
        system_id: sv.system_id,
        station_key: route.station_key,
        from: url.searchParams.get("from") ?? url.searchParams.get("start"),
        to: url.searchParams.get("to") ?? url.searchParams.get("end"),
      });
      return json(
        { error: { code: "invalid_range", message: "from/to (or start/end) must be epoch seconds with from < to" } },
        400
      );
    }
    if (toEpoch - fromEpoch > deps.max_series_window_s) {
      logger.warn("stations.series.range_too_large", {
        system_id: sv.system_id,
        station_key: route.station_key,
        from_epoch_s: fromEpoch,
        to_epoch_s: toEpoch,
        max_series_window_s: deps.max_series_window_s,
      });
      return json(
        { error: { code: "range_too_large", message: "Requested series range exceeds max window" } },
        400
      );
    }

    const points = Math.floor((toEpoch - fromEpoch) / bucket) + 1;
    if (points > deps.max_series_points) {
      logger.warn("stations.series.too_many_points", {
        system_id: sv.system_id,
        station_key: route.station_key,
        requested_points: points,
        max_series_points: deps.max_series_points,
      });
      return json(
        { error: { code: "too_many_points", message: "Requested points exceed max_series_points" } },
        400
      );
    }

    const series = await deps.stationsStore.getStationSeries({
      system_id: sv.system_id,
      view_id: sv.view_id,
      station_key: route.station_key,
      from_epoch_s: fromEpoch,
      to_epoch_s: toEpoch,
      bucket_seconds: bucket,
      limit: deps.max_series_points,
    });
    const responseBody = {
      station_key: route.station_key,
      from_epoch_s: fromEpoch,
      to_epoch_s: toEpoch,
      bucket_seconds: bucket,
      points: series,
    };
    logger.info("stations.series.ok", {
      system_id: sv.system_id,
      station_key: route.station_key,
      sv: svToken,
      view_id: sv.view_id,
      from_epoch_s: fromEpoch,
      to_epoch_s: toEpoch,
      bucket_seconds: bucket,
      points_returned: series.length,
      payload_bytes: jsonByteSize(responseBody),
    });

    return json(responseBody, 200);
  };
}
