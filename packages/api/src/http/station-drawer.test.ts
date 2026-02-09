import { describe, expect, it } from "bun:test";

import { createStationDrawerRouteHandler } from "./station-drawer";

const validSv = {
  ok: true as const,
  payload: {
    system_id: "citibike-nyc",
    view_id: 21,
    view_spec_sha256: "spec-hash",
  },
};

describe("createStationDrawerRouteHandler", () => {
  it("returns bounded drawer bundle response", async () => {
    const infoEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    const handler = createStationDrawerRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
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
      logger: {
        info(event, details) {
          infoEvents.push({ event, details });
        },
        warn() {},
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/drawer?v=1&sv=abc&T_bucket=1738872000&range=6h&severity_version=sev.v1&tile_schema=tile.v1"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age=30");
    const body = await res.json();
    expect(body.station_key).toBe("STA-001");
    expect(body.sv).toBe("abc");
    expect(body.range_s).toBe(21600);
    expect(infoEvents[0]?.event).toBe("stations.drawer.ok");
    expect(infoEvents[0]?.details.station_key).toBe("STA-001");
    expect(infoEvents[0]?.details.sv).toBe("abc");
    expect(typeof infoEvents[0]?.details.payload_bytes).toBe("number");
  });

  it("returns 400 for invalid range", async () => {
    const handler = createStationDrawerRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      stationsStore: {
        async getStationDrawer() {
          return null;
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
    });

    const res = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/drawer?v=1&sv=abc&T_bucket=1738872000&range=72h"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_range");
  });

  it("returns 400 for unknown query params", async () => {
    const handler = createStationDrawerRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      stationsStore: {
        async getStationDrawer() {
          return null;
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
    });

    const res = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/drawer?v=1&sv=abc&T_bucket=1738872000&range=6h&unknown_param=x"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });

  it("returns 400 for invalid T_bucket", async () => {
    const handler = createStationDrawerRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      stationsStore: {
        async getStationDrawer() {
          return null;
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
    });

    const res = await handler(
      new Request("https://example.test/api/stations/STA-001/drawer?v=1&sv=abc&T_bucket=not-an-epoch&range=6h")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_t_bucket");
  });
});
