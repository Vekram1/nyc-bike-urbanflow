import { createConfigRouteHandler, type ConfigRouteConfig } from "./config";
import { createPolicyRouteHandler, type PolicyRouteDeps } from "./policy";
import { createPolicyMovesTilesRouteHandler, type PolicyMovesTilesRouteDeps } from "./policy-tiles";
import { createSearchRouteHandler, type SearchRouteDeps } from "./search";
import { createStationsRouteHandler, type StationsRouteDeps } from "./stations";
import { createTimeRouteHandler, type TimeRouteDeps } from "./time";
import { createCompositeTilesRouteHandler, type CompositeTilesRouteDeps } from "./tiles";
import { createTimelineRouteHandler, type TimelineRouteDeps } from "./timeline";

export type ControlPlaneDeps = {
  time: TimeRouteDeps;
  config: ConfigRouteConfig;
  timeline: TimelineRouteDeps;
  search: SearchRouteDeps;
  policy?: PolicyRouteDeps;
  stations?: StationsRouteDeps;
  tiles?: CompositeTilesRouteDeps;
  policyTiles?: PolicyMovesTilesRouteDeps;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function createControlPlaneHandler(deps: ControlPlaneDeps): (request: Request) => Promise<Response> {
  const handleTime = createTimeRouteHandler(deps.time);
  const handleConfig = createConfigRouteHandler(deps.config);
  const handleTimeline = createTimelineRouteHandler(deps.timeline);
  const handleSearch = createSearchRouteHandler(deps.search);
  const handlePolicy = deps.policy ? createPolicyRouteHandler(deps.policy) : null;
  const handleStations = deps.stations ? createStationsRouteHandler(deps.stations) : null;
  const handleTiles = deps.tiles ? createCompositeTilesRouteHandler(deps.tiles) : null;
  const handlePolicyTiles = deps.policyTiles ? createPolicyMovesTilesRouteHandler(deps.policyTiles) : null;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/stations/")) {
      if (!handleStations) {
        return json({ error: { code: "not_found", message: "Route not found" } }, 404);
      }
      return handleStations(request);
    }
    if (url.pathname.startsWith("/api/policy/")) {
      if (!handlePolicy) {
        return json({ error: { code: "not_found", message: "Route not found" } }, 404);
      }
      return handlePolicy(request);
    }
    if (url.pathname.startsWith("/api/tiles/policy_moves/")) {
      if (!handlePolicyTiles) {
        return json({ error: { code: "not_found", message: "Route not found" } }, 404);
      }
      return handlePolicyTiles(request);
    }
    if (url.pathname.startsWith("/api/tiles/")) {
      if (!handleTiles) {
        return json({ error: { code: "not_found", message: "Route not found" } }, 404);
      }
      return handleTiles(request);
    }

    switch (url.pathname) {
      case "/api/time":
        return handleTime(request);
      case "/api/config":
        return handleConfig(request);
      case "/api/timeline":
      case "/api/timeline/density":
        return handleTimeline(request);
      case "/api/search":
        return handleSearch(request);
      default:
        return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }
  };
}
