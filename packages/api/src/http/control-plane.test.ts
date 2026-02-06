import { describe, expect, it } from "bun:test";

import { createControlPlaneHandler } from "./control-plane";

const deps = {
  time: {
    servingViews: {
      async mintLiveToken() {
        return {
          ok: true as const,
          sv: "sv1.kid.payload.sig",
          view_spec_sha256: "abc123",
          view_id: 9,
        };
      },
    },
    viewStore: {
      async listWatermarks() {
        return [
          {
            system_id: "citibike-nyc",
            dataset_id: "gbfs.station_status",
            as_of_ts: new Date("2026-02-06T18:00:00Z"),
            max_observed_at: new Date("2026-02-06T17:59:30Z"),
          },
        ];
      },
    },
    config: {
      view_version: "sv.v1",
      ttl_seconds: 120,
      tile_schema_version: "tile.v1",
      severity_version: "sev.v1",
      severity_spec_sha256: "sev-hash",
      required_datasets: ["gbfs.station_status"],
      optional_datasets: ["gbfs.station_information"],
    },
    clock: () => new Date("2026-02-06T18:00:30Z"),
  },
  config: {
    bucket_size_seconds: 300,
    severity_version: "sev.v1",
    severity_legend_bins: [{ min: 0, max: 1, label: "all" }],
    map: {
      initial_center: { lon: -73.98, lat: 40.75 },
      initial_zoom: 12,
      max_bounds: { min_lon: -74.3, min_lat: 40.45, max_lon: -73.65, max_lat: 40.95 },
      min_zoom: 9,
      max_zoom: 18,
    },
    speed_presets: [1, 10, 60],
    cache_policy: { live_tile_max_age_s: 10 },
  },
  timeline: {
    tokens: {
      async validate() {
        return {
          ok: true as const,
          payload: { system_id: "citibike-nyc", view_id: 9, view_spec_sha256: "abc123" },
        };
      },
    },
    timelineStore: {
      async getRange() {
        return {
          min_observation_ts: "2026-02-06T00:00:00Z",
          max_observation_ts: "2026-02-06T18:00:00Z",
          live_edge_ts: "2026-02-06T18:00:00Z",
          gap_intervals: [],
        };
      },
      async getDensity() {
        return [];
      },
    },
    default_bucket_seconds: 300,
  },
  search: {
    allowlist: {
      async isAllowed() {
        return true;
      },
    },
    searchStore: {
      async searchStations() {
        return [];
      },
    },
  },
} as const;

describe("createControlPlaneHandler", () => {
  it("dispatches /api/time", async () => {
    const handler = createControlPlaneHandler(deps);
    const res = await handler(new Request("https://example.test/api/time?system_id=citibike-nyc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommended_live_sv).toBe("sv1.kid.payload.sig");
  });

  it("dispatches /api/config", async () => {
    const handler = createControlPlaneHandler(deps);
    const res = await handler(new Request("https://example.test/api/config?v=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bucket_size_seconds).toBe(300);
  });

  it("returns 404 for unknown paths", async () => {
    const handler = createControlPlaneHandler(deps);
    const res = await handler(new Request("https://example.test/api/unknown"));
    expect(res.status).toBe(404);
  });

  it("dispatches /api/timeline", async () => {
    const handler = createControlPlaneHandler(deps);
    const res = await handler(new Request("https://example.test/api/timeline?v=1&sv=abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bucket_size_seconds).toBe(300);
  });

  it("dispatches /api/search", async () => {
    const handler = createControlPlaneHandler(deps);
    const res = await handler(
      new Request("https://example.test/api/search?system_id=citibike-nyc&q=52")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
  });
});
