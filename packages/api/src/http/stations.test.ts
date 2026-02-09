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

  it("returns 400 for unknown query params on detail route", async () => {
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

    const res = await handler(new Request("https://example.test/api/stations/STA-001?sv=abc&foo=bar"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
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

  it("returns 400 for unknown query params on series route", async () => {
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
        "https://example.test/api/stations/STA-001/series?sv=abc&from=1738872000&to=1738875600&bucket=300&foo=bar"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });

  it("enforces sv presence for detail and series routes", async () => {
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

    const detailRes = await handler(new Request("https://example.test/api/stations/STA-001"));
    expect(detailRes.status).toBe(401);
    expect(detailRes.headers.get("Cache-Control")).toBe("no-store");
    const detailBody = await detailRes.json();
    expect(detailBody.error.code).toBe("sv_missing");

    const seriesRes = await handler(
      new Request("https://example.test/api/stations/STA-001/series?from=1738872000&to=1738875600&bucket=300")
    );
    expect(seriesRes.status).toBe(401);
    expect(seriesRes.headers.get("Cache-Control")).toBe("no-store");
    const seriesBody = await seriesRes.json();
    expect(seriesBody.error.code).toBe("sv_missing");
  });

  it("returns 401 for invalid sv token on detail and series routes", async () => {
    const handler = createStationsRouteHandler({
      tokens: {
        async validate() {
          return { ok: false as const, reason: "token_invalid" };
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

    const detailRes = await handler(new Request("https://example.test/api/stations/STA-001?sv=bad"));
    expect(detailRes.status).toBe(401);
    expect(detailRes.headers.get("Cache-Control")).toBe("no-store");
    const detailBody = await detailRes.json();
    expect(detailBody.error.code).toBe("token_invalid");

    const seriesRes = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/series?sv=bad&from=1738872000&to=1738875600&bucket=300"
      )
    );
    expect(seriesRes.status).toBe(401);
    expect(seriesRes.headers.get("Cache-Control")).toBe("no-store");
    const seriesBody = await seriesRes.json();
    expect(seriesBody.error.code).toBe("token_invalid");
  });

  it("returns 403 for revoked sv token on detail and series routes", async () => {
    const handler = createStationsRouteHandler({
      tokens: {
        async validate() {
          return { ok: false as const, reason: "token_revoked" };
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

    const detailRes = await handler(new Request("https://example.test/api/stations/STA-001?sv=revoked"));
    expect(detailRes.status).toBe(403);
    expect(detailRes.headers.get("Cache-Control")).toBe("no-store");
    const detailBody = await detailRes.json();
    expect(detailBody.error.code).toBe("token_revoked");

    const seriesRes = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/series?sv=revoked&from=1738872000&to=1738875600&bucket=300"
      )
    );
    expect(seriesRes.status).toBe(403);
    expect(seriesRes.headers.get("Cache-Control")).toBe("no-store");
    const seriesBody = await seriesRes.json();
    expect(seriesBody.error.code).toBe("token_revoked");
  });

  it("returns 401 for expired sv token on detail and series routes", async () => {
    const handler = createStationsRouteHandler({
      tokens: {
        async validate() {
          return { ok: false as const, reason: "token_expired" };
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

    const detailRes = await handler(new Request("https://example.test/api/stations/STA-001?sv=expired"));
    expect(detailRes.status).toBe(401);
    expect(detailRes.headers.get("Cache-Control")).toBe("no-store");
    const detailBody = await detailRes.json();
    expect(detailBody.error.code).toBe("token_expired");

    const seriesRes = await handler(
      new Request(
        "https://example.test/api/stations/STA-001/series?sv=expired&from=1738872000&to=1738875600&bucket=300"
      )
    );
    expect(seriesRes.status).toBe(401);
    expect(seriesRes.headers.get("Cache-Control")).toBe("no-store");
    const seriesBody = await seriesRes.json();
    expect(seriesBody.error.code).toBe("token_expired");
  });

  it("returns 405 for non-GET detail and series routes", async () => {
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

    const detailRes = await handler(
      new Request("https://example.test/api/stations/STA-001?sv=abc", { method: "POST" })
    );
    expect(detailRes.status).toBe(405);
    expect(detailRes.headers.get("Cache-Control")).toBe("no-store");
    const detailBody = await detailRes.json();
    expect(detailBody.error.code).toBe("method_not_allowed");

    const seriesRes = await handler(
      new Request("https://example.test/api/stations/STA-001/series?sv=abc&from=1738872000&to=1738875600&bucket=300", {
        method: "POST",
      })
    );
    expect(seriesRes.status).toBe(405);
    expect(seriesRes.headers.get("Cache-Control")).toBe("no-store");
    const seriesBody = await seriesRes.json();
    expect(seriesBody.error.code).toBe("method_not_allowed");
  });
});
