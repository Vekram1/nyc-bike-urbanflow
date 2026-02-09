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

    const unknownParamRes = await handler(
      new Request("https://example.test/api/time?system_id=citibike-nyc&foo=bar")
    );
    expect(unknownParamRes.status).toBe(400);
    expect(unknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const unknownParamBody = await unknownParamRes.json();
    expect(unknownParamBody.error.code).toBe("unknown_param");
  });

  it("dispatches /api/config", async () => {
    const handler = createControlPlaneHandler(deps);
    const res = await handler(new Request("https://example.test/api/config?v=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bucket_size_seconds).toBe(300);

    const unknownParamRes = await handler(new Request("https://example.test/api/config?v=1&foo=bar"));
    expect(unknownParamRes.status).toBe(400);
    expect(unknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const unknownParamBody = await unknownParamRes.json();
    expect(unknownParamBody.error.code).toBe("unknown_param");
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

    const unknownTimelineRes = await handler(
      new Request("https://example.test/api/timeline?v=1&sv=abc&foo=bar")
    );
    expect(unknownTimelineRes.status).toBe(400);
    expect(unknownTimelineRes.headers.get("Cache-Control")).toBe("no-store");
    const unknownTimelineBody = await unknownTimelineRes.json();
    expect(unknownTimelineBody.error.code).toBe("unknown_param");

    const unknownDensityRes = await handler(
      new Request("https://example.test/api/timeline/density?v=1&sv=abc&bucket=300&foo=bar")
    );
    expect(unknownDensityRes.status).toBe(400);
    expect(unknownDensityRes.headers.get("Cache-Control")).toBe("no-store");
    const unknownDensityBody = await unknownDensityRes.json();
    expect(unknownDensityBody.error.code).toBe("unknown_param");
  });

  it("dispatches /api/search", async () => {
    const handler = createControlPlaneHandler(deps);
    const res = await handler(
      new Request("https://example.test/api/search?system_id=citibike-nyc&q=52")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);

    const unknownParamRes = await handler(
      new Request("https://example.test/api/search?system_id=citibike-nyc&q=52&foo=bar")
    );
    expect(unknownParamRes.status).toBe(400);
    expect(unknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const unknownParamBody = await unknownParamRes.json();
    expect(unknownParamBody.error.code).toBe("unknown_param");
  });

  it("dispatches /api/pipeline_state when admin deps are configured", async () => {
    const handler = createControlPlaneHandler({
      ...deps,
      admin: {
        auth: {
          admin_token: "secret",
          allowed_origins: [],
        },
        config: {
          default_system_id: "citibike-nyc",
        },
        store: {
          async getPipelineState() {
            return {
              queue_depth: 0,
              dlq_depth: 0,
              feeds: [],
              degrade_history: [],
            };
          },
          async listDlq() {
            return [];
          },
          async resolveDlq() {
            return true;
          },
        },
      },
    });
    const res = await handler(
      new Request("https://example.test/api/pipeline_state?v=1", {
        headers: { "X-Admin-Token": "secret" },
      })
    );
    expect(res.status).toBe(200);

    const unknownParamRes = await handler(
      new Request("https://example.test/api/pipeline_state?v=1&foo=bar", {
        headers: { "X-Admin-Token": "secret" },
      })
    );
    expect(unknownParamRes.status).toBe(400);
    expect(unknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const unknownParamBody = await unknownParamRes.json();
    expect(unknownParamBody.error.code).toBe("unknown_param");
  });

  it("dispatches /api/tiles/composite when tile deps are configured", async () => {
    const handler = createControlPlaneHandler({
      ...deps,
      tiles: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: {
                system_id: "citibike-nyc",
                view_id: 10,
                view_spec_sha256: "abc",
              },
            };
          },
        } as unknown as import("../sv/service").ServingTokenService,
        allowlist: {
          async isAllowed() {
            return true;
          },
        },
        tileStore: {
          async fetchCompositeTile() {
            return {
              ok: true as const,
              mvt: new Uint8Array([1, 2, 3, 4]),
              feature_count: 2,
              bytes: 4,
            };
          },
        },
        cache: {
          max_age_s: 30,
          s_maxage_s: 120,
          stale_while_revalidate_s: 15,
        },
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.mapbox-vector-tile");
  });

  it("dispatches /api/stations/{station_key} when station deps are configured", async () => {
    const handler = createControlPlaneHandler({
      ...deps,
      stations: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: {
                system_id: "citibike-nyc",
                view_id: 10,
                view_spec_sha256: "abc",
              },
            };
          },
        } as unknown as import("../sv/service").ServingTokenService,
        stationsStore: {
          async getStationsSnapshot() {
            return [
              {
                station_key: "STA-001",
                name: "W 52 St",
                lat: 40.75,
                lon: -73.98,
                capacity: 30,
                bucket_ts: "2026-02-06T20:00:00Z",
                bikes_available: 12,
                docks_available: 18,
                bucket_quality: "ok",
              },
            ];
          },
          async getStationDetail() {
            return {
              station_key: "STA-001",
              name: "W 52 St",
              bikes_available: 12,
              docks_available: 18,
            };
          },
          async getStationSeries() {
            return [];
          },
        },
        default_bucket_seconds: 300,
        max_series_window_s: 86400,
        max_series_points: 288,
      },
    });

    const res = await handler(
      new Request("https://example.test/api/stations/STA-001?sv=abc")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station_key).toBe("STA-001");

    const snapshotRes = await handler(
      new Request("https://example.test/api/stations?v=1&sv=abc&T_bucket=1738872000")
    );
    expect(snapshotRes.status).toBe(200);
    expect(snapshotRes.headers.get("Cache-Control")).toBe("no-store");
    const snapshotBody = await snapshotRes.json();
    expect(snapshotBody.type).toBe("FeatureCollection");
    expect(Array.isArray(snapshotBody.features)).toBe(true);
    expect(snapshotBody.features[0]?.id).toBe("STA-001");

    const seriesRes = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/series?sv=abc&from=1738872000&to=1738875600&bucket=300"
      )
    );
    expect(seriesRes.status).toBe(200);
    expect(seriesRes.headers.get("Cache-Control")).toBe("no-store");
    const seriesBody = await seriesRes.json();
    expect(seriesBody.station_key).toBe("STA-001");
    expect(seriesBody.bucket_seconds).toBe(300);
    expect(Array.isArray(seriesBody.points)).toBe(true);

    const unknownDetailParamRes = await handler(
      new Request("https://example.test/api/stations/STA-001?sv=abc&foo=bar")
    );
    expect(unknownDetailParamRes.status).toBe(400);
    expect(unknownDetailParamRes.headers.get("Cache-Control")).toBe("no-store");
    const unknownDetailParamBody = await unknownDetailParamRes.json();
    expect(unknownDetailParamBody.error.code).toBe("unknown_param");

    const unknownSeriesParamRes = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/series?sv=abc&from=1738872000&to=1738875600&bucket=300&foo=bar"
      )
    );
    expect(unknownSeriesParamRes.status).toBe(400);
    expect(unknownSeriesParamRes.headers.get("Cache-Control")).toBe("no-store");
    const unknownSeriesParamBody = await unknownSeriesParamRes.json();
    expect(unknownSeriesParamBody.error.code).toBe("unknown_param");

    const methodNotAllowedRes = await handler(
      new Request("https://example.test/api/stations/STA-001?sv=abc", { method: "POST" })
    );
    expect(methodNotAllowedRes.status).toBe(405);
    expect(methodNotAllowedRes.headers.get("Cache-Control")).toBe("no-store");
    const methodNotAllowedBody = await methodNotAllowedRes.json();
    expect(methodNotAllowedBody.error.code).toBe("method_not_allowed");

    const seriesMethodNotAllowedRes = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/series?sv=abc&from=1738872000&to=1738875600&bucket=300",
        { method: "POST" }
      )
    );
    expect(seriesMethodNotAllowedRes.status).toBe(405);
    expect(seriesMethodNotAllowedRes.headers.get("Cache-Control")).toBe("no-store");
    const seriesMethodNotAllowedBody = await seriesMethodNotAllowedRes.json();
    expect(seriesMethodNotAllowedBody.error.code).toBe("method_not_allowed");
  });

  it("dispatches /api/stations/{station_key}/drawer when drawer deps are configured", async () => {
    const handler = createControlPlaneHandler({
      ...deps,
      stationDrawer: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: {
                system_id: "citibike-nyc",
                view_id: 10,
                view_spec_sha256: "abc",
              },
            };
          },
        } as unknown as import("../sv/service").ServingTokenService,
        allowlist: {
          async isAllowed() {
            return true;
          },
        },
        stationsStore: {
          async getStationDrawer() {
            return {
              station_key: "STA-001",
              sv: null,
              t_bucket_epoch_s: 1738872000,
              range_s: 21600,
              bucket_seconds: 300,
              severity_version: "sev.v1",
              tile_schema: "tile.v1",
              metadata: { name: "W 52 St", capacity: 40 },
              point_in_time: {
                bucket_ts: "2026-02-06T20:00:00Z",
                bikes_available: 12,
                docks_available: 28,
                bucket_quality: "ok",
                severity: 0.2,
                pressure_score: 0.4,
              },
              series: { points: [], truncated: false },
              episodes: { items: [], truncated: false },
            };
          },
        },
        defaults: {
          severity_version: "sev.v1",
          tile_schema: "tile.v1",
          range_s: 21600,
          bucket_seconds: 300,
        },
        limits: {
          max_range_s: 172800,
          max_series_points: 360,
          max_episodes: 50,
        },
        cache: {
          max_age_s: 30,
          s_maxage_s: 120,
          stale_while_revalidate_s: 15,
        },
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/drawer?v=1&sv=abc&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station_key).toBe("STA-001");

    const unknownParamRes = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/drawer?v=1&sv=abc&T_bucket=1738872000&foo=bar"
      )
    );
    expect(unknownParamRes.status).toBe(400);
    expect(unknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const unknownParamBody = await unknownParamRes.json();
    expect(unknownParamBody.error.code).toBe("unknown_param");

    const methodNotAllowedRes = await handler(
      new Request("https://example.test/api/stations/STA-001/drawer?v=1&sv=abc&T_bucket=1738872000", {
        method: "POST",
      })
    );
    expect(methodNotAllowedRes.status).toBe(405);
    expect(methodNotAllowedRes.headers.get("Cache-Control")).toBe("no-store");
    const methodNotAllowedBody = await methodNotAllowedRes.json();
    expect(methodNotAllowedBody.error.code).toBe("method_not_allowed");
  });

  it("dispatches /api/policy/run when policy deps are configured", async () => {
    const handler = createControlPlaneHandler({
      ...deps,
      policy: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: {
                system_id: "citibike-nyc",
                view_id: 10,
                view_spec_sha256: "abc",
              },
            };
          },
        } as unknown as import("../sv/service").ServingTokenService,
        allowlist: {
          async isAllowed() {
            return true;
          },
        },
        policyStore: {
          async getRunSummary() {
            return null;
          },
          async listMoves() {
            return [];
          },
        },
        queue: {
          async enqueue() {
            return { ok: true as const, job_id: 1 };
          },
        },
        config: {
          default_policy_version: "rebal.greedy.v1",
          available_policy_versions: ["rebal.greedy.v1"],
          default_horizon_steps: 0,
          retry_after_ms: 2000,
          max_moves: 50,
          budget_presets: [],
        },
        logger: { info() {}, warn() {} },
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("pending");
  });

  it("dispatches /api/tiles/policy_moves when policy tile deps are configured", async () => {
    const handler = createControlPlaneHandler({
      ...deps,
      policyTiles: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: {
                system_id: "citibike-nyc",
                view_id: 10,
                view_spec_sha256: "abc",
              },
            };
          },
        } as unknown as import("../sv/service").ServingTokenService,
        allowlist: {
          async isAllowed() {
            return true;
          },
        },
        tileStore: {
          async fetchPolicyMovesTile() {
            return {
              ok: true as const,
              mvt: new Uint8Array([1, 2, 3]),
              feature_count: 1,
              bytes: 3,
            };
          },
        },
        cache: {
          max_age_s: 30,
          s_maxage_s: 120,
          stale_while_revalidate_s: 15,
        },
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.mapbox-vector-tile");
  });

  it("dispatches /api/tiles/episodes when episode tile deps are configured", async () => {
    const handler = createControlPlaneHandler({
      ...deps,
      episodesTiles: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: {
                system_id: "citibike-nyc",
                view_id: 10,
                view_spec_sha256: "abc",
              },
            };
          },
        } as unknown as import("../sv/service").ServingTokenService,
        allowlist: {
          async isAllowed() {
            return true;
          },
        },
        default_severity_version: "sev.v1",
        tileStore: {
          async fetchEpisodesTile() {
            return {
              ok: true as const,
              mvt: new Uint8Array([1, 2]),
              feature_count: 1,
              bytes: 2,
            };
          },
        },
        cache: {
          max_age_s: 30,
          s_maxage_s: 120,
          stale_while_revalidate_s: 15,
        },
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/episodes/12/1200/1530.mvt?v=1&sv=abc&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.mapbox-vector-tile");
  });
});
