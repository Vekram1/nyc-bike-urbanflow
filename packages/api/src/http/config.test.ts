import { describe, expect, it } from "bun:test";

import { createConfigRouteHandler } from "./config";

const config = {
  bucket_size_seconds: 300,
  severity_version: "sev.v1",
  severity_legend_bins: [
    { min: 0, max: 0.33, label: "low" },
    { min: 0.33, max: 0.66, label: "medium" },
    { min: 0.66, max: 1, label: "high" },
  ],
  map: {
    initial_center: { lon: -73.98, lat: 40.75 },
    initial_zoom: 12,
    max_bounds: { min_lon: -74.3, min_lat: 40.45, max_lon: -73.65, max_lat: 40.95 },
    min_zoom: 9,
    max_zoom: 18,
  },
  speed_presets: [1, 10, 60],
  cache_policy: { live_tile_max_age_s: 10 },
} as const;

describe("createConfigRouteHandler", () => {
  it("returns config for GET /api/config", async () => {
    const handler = createConfigRouteHandler(config);
    const res = await handler(new Request("https://example.test/api/config?v=1", { method: "GET" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bucket_size_seconds).toBe(300);
    expect(body.severity_version).toBe("sev.v1");
  });

  it("returns 400 for unsupported version", async () => {
    const handler = createConfigRouteHandler(config);
    const res = await handler(new Request("https://example.test/api/config?v=2", { method: "GET" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unsupported_version");
  });

  it("returns 405 for non-GET", async () => {
    const handler = createConfigRouteHandler(config);
    const res = await handler(new Request("https://example.test/api/config?v=1", { method: "POST" }));
    expect(res.status).toBe(405);
  });

  it("exports allowlist values from provider when static allowlist is omitted", async () => {
    const handler = createConfigRouteHandler({
      ...config,
      allowlist_provider: {
        system_id: "citibike-nyc",
        async list_allowed_values({ kind }) {
          switch (kind) {
            case "system_id":
              return ["citibike-nyc"];
            case "tile_schema":
              return ["tile.v1"];
            case "severity_version":
              return ["sev.v1"];
            case "policy_version":
              return ["rebal.greedy.v1"];
            case "layers_set":
              return ["inv,sev", "inv,press,sev"];
            case "compare_mode":
              return ["off", "delta", "split"];
          }
        },
      },
      allowlist: undefined,
    });

    const res = await handler(new Request("https://example.test/api/config?v=1", { method: "GET" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowlist.system_ids).toEqual(["citibike-nyc"]);
    expect(body.allowlist.tile_schemas).toEqual(["tile.v1"]);
    expect(body.allowlist.compare_modes).toEqual(["off", "delta", "split"]);
  });
});
