import { validateSvQuery } from "../sv/http";

export type TimelineRange = {
  min_observation_ts: string;
  max_observation_ts: string;
  live_edge_ts: string;
  gap_intervals?: Array<{ start: string; end: string }>;
};

export type TimelineDensityPoint = {
  bucket_ts: string;
  pct_serving_grade: number;
  empty_rate: number;
  full_rate: number;
  severity_p95?: number;
};

export type TimelineRouteDeps = {
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
  timelineStore: {
    getRange: (args: { system_id: string; view_id: number }) => Promise<TimelineRange>;
    getDensity: (args: {
      system_id: string;
      view_id: number;
      bucket_seconds: number;
    }) => Promise<TimelineDensityPoint[]>;
  };
  default_bucket_seconds: number;
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

export function createTimelineRouteHandler(deps: TimelineRouteDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    if (path !== "/api/timeline" && path !== "/api/timeline/density") {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }

    const v = url.searchParams.get("v");
    if (v !== null && v !== "1") {
      return json({ error: { code: "unsupported_version", message: "Only v=1 is supported" } }, 400);
    }

    const sv = await validateSvQuery(deps.tokens as unknown as import("../sv/service").ServingTokenService, url.searchParams, {
      ctx: { path },
    });
    if (!sv.ok) {
      return json({ error: { code: sv.code, message: sv.message } }, sv.status, sv.headers);
    }

    if (path === "/api/timeline") {
      const range = await deps.timelineStore.getRange({
        system_id: sv.system_id,
        view_id: sv.view_id,
      });
      return json(
        {
          available_range: [range.min_observation_ts, range.max_observation_ts],
          bucket_size_seconds: deps.default_bucket_seconds,
          gap_intervals: range.gap_intervals ?? [],
          live_edge_ts: range.live_edge_ts,
        },
        200
      );
    }

    const bucket = parseBucket(url.searchParams.get("bucket"), deps.default_bucket_seconds);
    if (bucket === null) {
      return json(
        { error: { code: "invalid_bucket", message: "bucket must be integer seconds between 60 and 3600" } },
        400
      );
    }
    const points = await deps.timelineStore.getDensity({
      system_id: sv.system_id,
      view_id: sv.view_id,
      bucket_seconds: bucket,
    });
    return json({ bucket_size_seconds: bucket, points }, 200);
  };
}
