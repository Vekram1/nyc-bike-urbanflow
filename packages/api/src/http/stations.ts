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
};

export type StationSeriesPoint = {
  bucket_ts: string;
  bikes_available: number;
  docks_available: number;
  bucket_quality: string;
  severity?: number;
  pressure_score?: number;
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

const defaultLogger = {
  info(event: string, details: Record<string, unknown>): void {
    console.info(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...details }));
  },
  warn(event: string, details: Record<string, unknown>): void {
    console.warn(JSON.stringify({ level: "warn", event, ts: new Date().toISOString(), ...details }));
  },
};

function extractStationPath(pathname: string): { station_key: string; is_series: boolean } | null {
  const seriesMatch = pathname.match(/^\/api\/stations\/([^/]+)\/series$/);
  if (seriesMatch) {
    return { station_key: decodeURIComponent(seriesMatch[1] ?? ""), is_series: true };
  }
  const detailMatch = pathname.match(/^\/api\/stations\/([^/]+)$/);
  if (detailMatch) {
    return { station_key: decodeURIComponent(detailMatch[1] ?? ""), is_series: false };
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
    if (!route) {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
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
          view_id: sv.view_id,
        });
        return json({ error: { code: "station_not_found", message: "Station not found" } }, 404);
      }
      logger.info("stations.detail.ok", {
        system_id: sv.system_id,
        station_key: route.station_key,
        view_id: sv.view_id,
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
    logger.info("stations.series.ok", {
      system_id: sv.system_id,
      station_key: route.station_key,
      view_id: sv.view_id,
      from_epoch_s: fromEpoch,
      to_epoch_s: toEpoch,
      bucket_seconds: bucket,
      points_returned: series.length,
    });

    return json(
      {
        station_key: route.station_key,
        from_epoch_s: fromEpoch,
        to_epoch_s: toEpoch,
        bucket_seconds: bucket,
        points: series,
      },
      200
    );
  };
}
