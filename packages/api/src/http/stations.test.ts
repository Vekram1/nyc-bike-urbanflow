import { describe, expect, it } from "bun:test";

import { createStationsRouteHandler } from "./stations";

const validSv = {
  ok: true as const,
  payload: {
    system_id: "citibike-nyc",
    view_id: 21,
    view_spec_sha256: "spec-hash",
  },
};

describe("createStationsRouteHandler", () => {
  it("returns station detail for /api/stations/{station_key}", async () => {
    const infoEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    const handler = createStationsRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      stationsStore: {
        async getStationDetail() {
          return {
            station_key: "STA-001",
            name: "W 52 St",
            capacity: 40,
            bikes_available: 12,
            docks_available: 28,
            bucket_quality: "ok",
          };
        },
        async getStationSeries() {
          return [];
        },
      },
      default_bucket_seconds: 300,
      max_series_window_s: 86400,
      max_series_points: 288,
      logger: {
        info(event, details) {
          infoEvents.push({ event, details });
        },
        warn() {},
      },
    });

    const res = await handler(new Request("https://example.test/api/stations/STA-001?sv=abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station_key).toBe("STA-001");
    expect(body.capacity).toBe(40);
    expect(infoEvents.length).toBe(1);
    expect(infoEvents[0]?.event).toBe("stations.detail.ok");
    expect(infoEvents[0]?.details.station_key).toBe("STA-001");
    expect(infoEvents[0]?.details.sv).toBe("abc");
    expect(Number(infoEvents[0]?.details.payload_bytes)).toBeGreaterThan(0);
  });

  it("returns 400 for invalid station_key", async () => {
    const handler = createStationsRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      stationsStore: {
        async getStationDetail() {
          return null;
        },
        async getStationSeries() {
          return [];
        },
      },
      default_bucket_seconds: 300,
      max_series_window_s: 86400,
      max_series_points: 288,
    });

    const res = await handler(new Request("https://example.test/api/stations/%20bad?sv=abc"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_station_key");
  });

  it("returns bounded series response", async () => {
    const infoEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    const handler = createStationsRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      stationsStore: {
        async getStationDetail() {
          return null;
        },
        async getStationSeries() {
          return [
            {
              bucket_ts: "2026-02-06T20:00:00Z",
              bikes_available: 10,
              docks_available: 20,
              bucket_quality: "ok",
              severity: 0.1,
            },
          ];
        },
      },
      default_bucket_seconds: 300,
      max_series_window_s: 86400,
      max_series_points: 288,
      logger: {
        info(event, details) {
          infoEvents.push({ event, details });
        },
        warn() {},
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/series?sv=abc&from=1738872000&to=1738875600&bucket=300"
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points.length).toBe(1);
    expect(body.bucket_seconds).toBe(300);
    expect(infoEvents.length).toBe(1);
    expect(infoEvents[0]?.event).toBe("stations.series.ok");
    expect(infoEvents[0]?.details.station_key).toBe("STA-001");
    expect(infoEvents[0]?.details.sv).toBe("abc");
    expect(Number(infoEvents[0]?.details.payload_bytes)).toBeGreaterThan(0);
  });

  it("accepts start/end aliases for series ranges", async () => {
    const handler = createStationsRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      stationsStore: {
        async getStationDetail() {
          return null;
        },
        async getStationSeries() {
          return [];
        },
      },
      default_bucket_seconds: 300,
      max_series_window_s: 86400,
      max_series_points: 288,
    });

    const res = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/series?sv=abc&start=1738872000&end=1738875600&bucket=300"
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from_epoch_s).toBe(1738872000);
    expect(body.to_epoch_s).toBe(1738875600);
  });

  it("returns 400 when series range is too large", async () => {
    const handler = createStationsRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      stationsStore: {
        async getStationDetail() {
          return null;
        },
        async getStationSeries() {
          return [];
        },
      },
      default_bucket_seconds: 300,
      max_series_window_s: 600,
      max_series_points: 288,
    });

    const res = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/series?sv=abc&from=1738872000&to=1738875600&bucket=300"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("range_too_large");
  });
});
