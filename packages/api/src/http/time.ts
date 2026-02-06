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
    return json(out.body, out.status);
  };
}
