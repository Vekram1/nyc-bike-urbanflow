export type ConfigRouteConfig = {
  bucket_size_seconds: number;
  severity_version: string;
  severity_legend_bins: Array<{
    min: number;
    max: number;
    label: string;
  }>;
  map: {
    initial_center: { lon: number; lat: number };
    initial_zoom: number;
    max_bounds: { min_lon: number; min_lat: number; max_lon: number; max_lat: number };
    min_zoom: number;
    max_zoom: number;
  };
  speed_presets: number[];
  cache_policy: {
    live_tile_max_age_s: number;
  };
  allowlist?: {
    system_ids?: string[];
    tile_schemas?: string[];
    severity_versions?: string[];
    policy_versions?: string[];
    layers_sets?: string[];
    compare_modes?: string[];
  };
  allowlist_provider?: {
    system_id: string;
    list_allowed_values: (args: {
      kind: "system_id" | "tile_schema" | "severity_version" | "policy_version" | "layers_set" | "compare_mode";
      system_id?: string;
    }) => Promise<string[]>;
  };
};
const CONFIG_ALLOWED_QUERY_PARAMS = new Set(["v"]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function hasUnknownQueryParam(searchParams: URLSearchParams, allowed: Set<string>): string | null {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      return key;
    }
  }
  return null;
}

export function createConfigRouteHandler(config: ConfigRouteConfig): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/config") {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }
    const unknown = hasUnknownQueryParam(url.searchParams, CONFIG_ALLOWED_QUERY_PARAMS);
    if (unknown) {
      return json({ error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } }, 400);
    }

    const v = url.searchParams.get("v");
    if (v !== null && v !== "1") {
      return json(
        { error: { code: "unsupported_version", message: "Only v=1 is supported" } },
        400
      );
    }

    const { allowlist_provider: _allowlistProvider, ...baseConfig } = config;
    let allowlist = baseConfig.allowlist;
    if (!allowlist && config.allowlist_provider) {
      const provider = config.allowlist_provider;
      const [system_ids, tile_schemas, severity_versions, policy_versions, layers_sets, compare_modes] =
        await Promise.all([
          provider.list_allowed_values({ kind: "system_id" }),
          provider.list_allowed_values({ kind: "tile_schema", system_id: provider.system_id }),
          provider.list_allowed_values({ kind: "severity_version", system_id: provider.system_id }),
          provider.list_allowed_values({ kind: "policy_version", system_id: provider.system_id }),
          provider.list_allowed_values({ kind: "layers_set", system_id: provider.system_id }),
          provider.list_allowed_values({ kind: "compare_mode", system_id: provider.system_id }),
        ]);
      allowlist = {
        system_ids,
        tile_schemas,
        severity_versions,
        policy_versions,
        layers_sets,
        compare_modes,
      };
    }

    return json({ ...baseConfig, allowlist }, 200);
  };
}
