import { describe, expect, it } from "bun:test";

import { createTimeRouteHandler } from "./time";

const baseConfig = {
  view_version: "sv.v1",
  ttl_seconds: 120,
  tile_schema_version: "tile.v1",
  severity_version: "sev.v1",
  severity_spec_sha256: "sev-hash",
  required_datasets: ["gbfs.station_status"],
  optional_datasets: ["gbfs.station_information"],
} as const;

describe("createTimeRouteHandler", () => {
  it("returns 405 for non-GET", async () => {
    const handler = createTimeRouteHandler({
      servingViews: {
        async mintLiveToken() {
          throw new Error("should not mint");
        },
      },
      viewStore: {
        async listWatermarks() {
          return [];
        },
      },
      config: baseConfig,
    });

    const res = await handler(new Request("https://example.test/api/time?system_id=citibike-nyc", { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
  });

  it("returns 400 for missing system_id", async () => {
    const handler = createTimeRouteHandler({
      servingViews: {
        async mintLiveToken() {
          throw new Error("should not mint");
        },
      },
      viewStore: {
        async listWatermarks() {
          return [];
        },
      },
      config: baseConfig,
    });

    const res = await handler(new Request("https://example.test/api/time", { method: "GET" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("missing_system_id");
  });

  it("returns 200 with recommended_live_sv", async () => {
    const handler = createTimeRouteHandler({
      servingViews: {
        async mintLiveToken() {
          return {
            ok: true as const,
            sv: "sv1.kid.payload.sig",
            view_spec_sha256: "abc123",
            view_id: 7,
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
      config: baseConfig,
      clock: () => new Date("2026-02-06T18:00:30Z"),
    });

    const res = await handler(new Request("https://example.test/api/time?system_id=citibike-nyc", { method: "GET" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.recommended_live_sv).toBe("sv1.kid.payload.sig");
    expect(body.datasets.length).toBe(1);
    expect(body.datasets[0].ingest_lag_s).toBe(60);
  });

  it("adds network summary with derived degrade signal", async () => {
    const handler = createTimeRouteHandler({
      servingViews: {
        async mintLiveToken() {
          return {
            ok: true as const,
            sv: "sv1.kid.payload.sig",
            view_spec_sha256: "abc123",
            view_id: 7,
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
      network: {
        async getSummary() {
          return {
            active_station_count: 100,
            empty_station_count: 28,
            full_station_count: 10,
            pct_serving_grade: 0.78,
            worst_5_station_keys_by_severity: ["A", "B", "C", "D", "E"],
            observed_bucket_ts: "2026-02-06T18:00:00Z",
          };
        },
      },
      config: baseConfig,
      clock: () => new Date("2026-02-06T18:00:30Z"),
    });

    const res = await handler(new Request("https://example.test/api/time?system_id=citibike-nyc", { method: "GET" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.network).toBeDefined();
    expect(body.network.active_station_count).toBe(100);
    expect(body.network.worst_5_station_keys_by_severity).toEqual(["A", "B", "C", "D", "E"]);
    expect(body.network.degrade_level).toBe(1);
    expect(body.network.client_should_throttle).toBe(true);
  });
});
