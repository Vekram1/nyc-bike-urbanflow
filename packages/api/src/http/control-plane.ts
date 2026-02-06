import { createConfigRouteHandler, type ConfigRouteConfig } from "./config";
import { createSearchRouteHandler, type SearchRouteDeps } from "./search";
import { createTimeRouteHandler, type TimeRouteDeps } from "./time";
import { createTimelineRouteHandler, type TimelineRouteDeps } from "./timeline";

export type ControlPlaneDeps = {
  time: TimeRouteDeps;
  config: ConfigRouteConfig;
  timeline: TimelineRouteDeps;
  search: SearchRouteDeps;
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

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
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
