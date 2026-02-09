import { buildTimeEndpointResponse } from "../serving-views/http";
import type { DatasetId } from "../serving-views/types";

export type TimeRouteDeps = {
  servingViews: {
    mintLiveToken: (args: {
      system_id: string;
      view_version: string;
      ttl_seconds: number;
      tile_schema_version: string;
      severity_version: string;
      severity_spec_sha256: string;
      required_datasets: DatasetId[];
      optional_datasets?: DatasetId[];
    }) => Promise<
      | { ok: true; sv: string; view_spec_sha256: string; view_id: number }
      | { ok: false; status: 400 | 500; code: string; message: string }
    >;
  };
  viewStore: {
    listWatermarks: (system_id: string, dataset_ids: DatasetId[]) => Promise<
      Array<{
        system_id: string;
        dataset_id: string;
        as_of_ts?: Date | null;
        as_of_text?: string | null;
        max_observed_at?: Date | null;
      }>
    >;
  };
  config: {
    view_version: string;
    ttl_seconds: number;
    tile_schema_version: string;
    severity_version: string;
    severity_spec_sha256: string;
    required_datasets: DatasetId[];
    optional_datasets?: DatasetId[];
  };
  network?: {
    getSummary: (args: { system_id: string }) => Promise<{
      active_station_count: number;
      empty_station_count: number;
      full_station_count: number;
      pct_serving_grade: number;
      worst_5_station_keys_by_severity?: string[];
      tile_origin_p95_ms?: number | null;
      observed_bucket_ts?: string | null;
      degrade_level?: number;
      client_should_throttle?: boolean;
    }>;
  };
  clock?: () => Date;
};

type JsonErr = {
  error: {
    code: string;
    message: string;
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

function methodNotAllowed(): Response {
  return json(
    { error: { code: "method_not_allowed", message: "Method must be GET" } satisfies JsonErr["error"] },
    405,
    { Allow: "GET" }
  );
}

function clampDegradeLevel(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 3) {
    return 3;
  }
  return Math.floor(value);
}

function deriveDegradeLevel(summary: {
  active_station_count: number;
  empty_station_count: number;
  full_station_count: number;
  pct_serving_grade: number;
}): number {
  if (summary.active_station_count <= 0) {
    return 3;
  }
  const constrainedServing = Math.max(0, Math.min(1, summary.pct_serving_grade));
  const constrainedPressure = Math.max(
    0,
    Math.min(1, (summary.empty_station_count + summary.full_station_count) / summary.active_station_count)
  );
  if (constrainedServing < 0.5 || constrainedPressure > 0.7) {
    return 3;
  }
  if (constrainedServing < 0.7 || constrainedPressure > 0.5) {
    return 2;
  }
  if (constrainedServing < 0.85 || constrainedPressure > 0.35) {
    return 1;
  }
  return 0;
}

export function createTimeRouteHandler(deps: TimeRouteDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return methodNotAllowed();
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/time") {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }

    const systemId = url.searchParams.get("system_id")?.trim() ?? "";
    if (systemId.length === 0) {
      return json(
        { error: { code: "missing_system_id", message: "Query param system_id is required" } },
        400
      );
    }

    const out = await buildTimeEndpointResponse({
      servingViews: deps.servingViews,
      viewStore: deps.viewStore,
      system_id: systemId,
      view_version: deps.config.view_version,
      ttl_seconds: deps.config.ttl_seconds,
      tile_schema_version: deps.config.tile_schema_version,
      severity_version: deps.config.severity_version,
      severity_spec_sha256: deps.config.severity_spec_sha256,
      required_datasets: deps.config.required_datasets,
      optional_datasets: deps.config.optional_datasets,
      clock: deps.clock,
    });

    if (!out.ok) {
      return json(out.body, out.status);
    }
    let network:
      | {
          active_station_count: number;
          empty_station_count: number;
          full_station_count: number;
          pct_serving_grade: number;
          worst_5_station_keys_by_severity: string[];
          tile_origin_p95_ms?: number | null;
          observed_bucket_ts?: string | null;
          degrade_level: number;
          client_should_throttle: boolean;
        }
      | undefined;

    if (deps.network) {
      try {
        const summary = await deps.network.getSummary({ system_id: systemId });
        const degradeLevel =
          summary.degrade_level === undefined
            ? deriveDegradeLevel(summary)
            : clampDegradeLevel(summary.degrade_level);
        const shouldThrottle =
          summary.client_should_throttle === undefined
            ? degradeLevel >= 1
            : Boolean(summary.client_should_throttle);
        network = {
          active_station_count: summary.active_station_count,
          empty_station_count: summary.empty_station_count,
          full_station_count: summary.full_station_count,
          pct_serving_grade: summary.pct_serving_grade,
          worst_5_station_keys_by_severity: summary.worst_5_station_keys_by_severity ?? [],
          tile_origin_p95_ms: summary.tile_origin_p95_ms ?? undefined,
          observed_bucket_ts: summary.observed_bucket_ts ?? undefined,
          degrade_level: degradeLevel,
          client_should_throttle: shouldThrottle,
        };
        if (degradeLevel >= 1) {
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "time_network_degrade",
              ts: new Date().toISOString(),
              system_id: systemId,
              degrade_level: degradeLevel,
              client_should_throttle: shouldThrottle,
              active_station_count: summary.active_station_count,
              empty_station_count: summary.empty_station_count,
              full_station_count: summary.full_station_count,
              pct_serving_grade: summary.pct_serving_grade,
              observed_bucket_ts: summary.observed_bucket_ts ?? null,
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "time_network_summary_failed",
            ts: new Date().toISOString(),
            system_id: systemId,
            message: error instanceof Error ? error.message : "unknown_error",
          })
        );
      }
    }

    return json(network ? { ...out.body, network } : out.body, out.status);
  };
}
