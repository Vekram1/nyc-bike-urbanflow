import { enforceAllowlistedQueryParams } from "../allowlist/http";
import type { AllowlistStore } from "../allowlist/types";

export type SearchResult = {
  station_key: string;
  name: string;
  short_name?: string;
  lat: number;
  lon: number;
};

export type SearchRouteDeps = {
  allowlist: AllowlistStore;
  searchStore: {
    searchStations: (args: {
      system_id: string;
      q: string;
      bbox?: { min_lon: number; min_lat: number; max_lon: number; max_lat: number };
      limit: number;
    }) => Promise<SearchResult[]>;
  };
  default_limit?: number;
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

function parseBbox(
  raw: string | null
): { min_lon: number; min_lat: number; max_lon: number; max_lat: number } | null | undefined {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }
  const nums = raw.split(",").map((p) => Number(p.trim()));
  if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [minLon, minLat, maxLon, maxLat] = nums;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90 || minLon >= maxLon || minLat >= maxLat) {
    return null;
  }
  return { min_lon: minLon, min_lat: minLat, max_lon: maxLon, max_lat: maxLat };
}

export function createSearchRouteHandler(deps: SearchRouteDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/search") {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }

    const allowedParams = new Set(["system_id", "q", "bbox", "limit"]);
    for (const key of url.searchParams.keys()) {
      if (!allowedParams.has(key)) {
        return json({ error: { code: "unknown_param", message: `Unknown query parameter: ${key}` } }, 400);
      }
    }

    const systemId = url.searchParams.get("system_id")?.trim() ?? "";
    if (systemId.length === 0) {
      return json(
        { error: { code: "missing_system_id", message: "Query param system_id is required" } },
        400
      );
    }

    const allow = await enforceAllowlistedQueryParams(
      deps.allowlist,
      new URLSearchParams({ system_id: systemId }),
      ["system_id"]
    );
    if (!allow.ok) {
      return json({ error: { code: allow.code, message: allow.message } }, allow.status, allow.headers);
    }

    const q = url.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2 || q.length > 80) {
      return json(
        { error: { code: "invalid_q", message: "q must be between 2 and 80 characters" } },
        400
      );
    }

    const rawBbox = url.searchParams.get("bbox");
    const bbox = parseBbox(rawBbox);
    if (rawBbox && bbox === null) {
      return json(
        { error: { code: "invalid_bbox", message: "bbox must be minLon,minLat,maxLon,maxLat" } },
        400
      );
    }

    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : deps.default_limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return json(
        { error: { code: "invalid_limit", message: "limit must be an integer between 1 and 50" } },
        400
      );
    }

    const results = await deps.searchStore.searchStations({
      system_id: systemId,
      q,
      bbox: bbox ?? undefined,
      limit,
    });

    return json({ results }, 200);
  };
}
