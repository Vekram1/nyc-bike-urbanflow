import { describe, expect, it } from "bun:test";

import { createControlPlaneHandler } from "./control-plane";

describe("station endpoints e2e", () => {
  it("mints sv via /api/time and serves /api/stations detail + drawer with bounded responses", async () => {
    const issuedSv = "sv-live-e2e-token";
    const validateSv = async (token: string) => {
      if (token !== issuedSv) {
        return { ok: false as const, reason: "invalid" };
      }
      return {
        ok: true as const,
        payload: { system_id: "citibike-nyc", view_id: 42, view_spec_sha256: "spec-hash" },
      };
    };

    const handler = createControlPlaneHandler({
      time: {
        servingViews: {
          async mintLiveToken() {
            return {
              ok: true as const,
              sv: issuedSv,
              view_spec_sha256: "spec-hash",
              view_id: 42,
            };
          },
        },
        viewStore: {
          async listWatermarks() {
            return [
              {
                system_id: "citibike-nyc",
                dataset_id: "gbfs.station_status",
                as_of_ts: new Date("2026-02-06T18:30:00.000Z"),
                max_observed_at: new Date("2026-02-06T18:29:30.000Z"),
              },
            ];
          },
        },
        config: {
          view_version: "sv.v1",
          ttl_seconds: 120,
          tile_schema_version: "tile.v1",
          severity_version: "sev.v1",
          severity_spec_sha256: "sev-spec-hash",
          required_datasets: ["gbfs.station_status"],
          optional_datasets: [],
        },
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
        tokens: { validate: validateSv },
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
      stations: {
        tokens: { validate: validateSv },
        stationsStore: {
          async getStationDetail() {
            return {
              station_key: "STA-001",
              name: "W 52 St",
              capacity: 40,
              bucket_ts: "2026-02-06T20:00:00Z",
              bikes_available: 12,
              docks_available: 28,
              bucket_quality: "ok",
              severity: 0.2,
              pressure_score: 0.4,
            };
          },
          async getStationSeries() {
            return [];
          },
        },
        default_bucket_seconds: 300,
        max_series_window_s: 172800,
        max_series_points: 360,
      },
      stationDrawer: {
        tokens: { validate: validateSv },
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
              series: {
                points: [
                  {
                    bucket_ts: "2026-02-06T19:55:00Z",
                    bikes_available: 11,
                    docks_available: 29,
                    bucket_quality: "ok",
                  },
                  {
                    bucket_ts: "2026-02-06T20:00:00Z",
                    bikes_available: 12,
                    docks_available: 28,
                    bucket_quality: "ok",
                  },
                ],
                truncated: false,
              },
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

    const timeRes = await handler(new Request("https://example.test/api/time?system_id=citibike-nyc"));
    expect(timeRes.status).toBe(200);
    const timeBody = await timeRes.json();
    expect(timeBody.recommended_live_sv).toBe(issuedSv);

    const detailRes = await handler(
      new Request(`https://example.test/api/stations/STA-001?sv=${encodeURIComponent(issuedSv)}`)
    );
    expect(detailRes.status).toBe(200);
    expect(detailRes.headers.get("Cache-Control")).toBe("no-store");
    const detailBody = await detailRes.json();
    expect(detailBody.station_key).toBe("STA-001");
    expect(detailBody.bucket_quality).toBe("ok");

    const drawerRes = await handler(
      new Request(
        `https://example.test/api/stations/STA-001/drawer?v=1&sv=${encodeURIComponent(issuedSv)}&T_bucket=1738872000&range=6h&severity_version=sev.v1&tile_schema=tile.v1`
      )
    );
    expect(drawerRes.status).toBe(200);
    expect(drawerRes.headers.get("Cache-Control")).toContain("max-age=30");
    const drawerBody = await drawerRes.json();
    expect(drawerBody.station_key).toBe("STA-001");
    expect(drawerBody.point_in_time.bucket_quality).toBe("ok");
    expect(drawerBody.series.points.length).toBe(2);
    expect(drawerBody.range_s).toBe(21600);

    const mismatchRes = await handler(
      new Request(
        `https://example.test/api/stations/STA-001/drawer?v=1&sv=${encodeURIComponent(issuedSv)}&system_id=other&T_bucket=1738872000&range=6h`
      )
    );
    expect(mismatchRes.status).toBe(400);
    const mismatchBody = await mismatchRes.json();
    expect(mismatchBody.error.code).toBe("system_id_mismatch");
  });
});
