import { describe, expect, it } from "bun:test";

import { createTimelineRouteHandler } from "./timeline";

const validSv = {
  ok: true as const,
  payload: {
    system_id: "citibike-nyc",
    view_id: 11,
    view_spec_sha256: "abc",
  },
};

describe("createTimelineRouteHandler", () => {
  it("returns timeline metadata for /api/timeline", async () => {
    const handler = createTimelineRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      timelineStore: {
        async getRange() {
          return {
            min_observation_ts: "2026-02-06T00:00:00Z",
            max_observation_ts: "2026-02-06T18:00:00Z",
            live_edge_ts: "2026-02-06T18:00:00Z",
            gap_intervals: [{ start: "2026-02-06T03:00:00Z", end: "2026-02-06T03:10:00Z" }],
          };
        },
        async getDensity() {
          return [];
        },
      },
      default_bucket_seconds: 300,
    });

    const res = await handler(new Request("https://example.test/api/timeline?v=1&sv=abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available_range[0]).toBe("2026-02-06T00:00:00Z");
    expect(body.bucket_size_seconds).toBe(300);
  });

  it("returns density for /api/timeline/density", async () => {
    const handler = createTimelineRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      timelineStore: {
        async getRange() {
          throw new Error("not used");
        },
        async getDensity() {
          return [
            {
              bucket_ts: "2026-02-06T18:00:00Z",
              pct_serving_grade: 0.98,
              empty_rate: 0.05,
              full_rate: 0.02,
            },
          ];
        },
      },
      default_bucket_seconds: 300,
    });

    const res = await handler(new Request("https://example.test/api/timeline/density?v=1&sv=abc&bucket=300"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points.length).toBe(1);
  });

  it("returns 400 for invalid bucket", async () => {
    const handler = createTimelineRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      timelineStore: {
        async getRange() {
          throw new Error("not used");
        },
        async getDensity() {
          throw new Error("not used");
        },
      },
      default_bucket_seconds: 300,
    });

    const res = await handler(new Request("https://example.test/api/timeline/density?v=1&sv=abc&bucket=12"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_bucket");
  });

  it("returns 400 for unknown query params on /api/timeline", async () => {
    const handler = createTimelineRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      timelineStore: {
        async getRange() {
          return {
            min_observation_ts: "2026-02-06T00:00:00Z",
            max_observation_ts: "2026-02-06T18:00:00Z",
            live_edge_ts: "2026-02-06T18:00:00Z",
          };
        },
        async getDensity() {
          return [];
        },
      },
      default_bucket_seconds: 300,
    });

    const res = await handler(new Request("https://example.test/api/timeline?v=1&sv=abc&foo=bar"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });

  it("returns 400 for unknown query params on /api/timeline/density", async () => {
    const handler = createTimelineRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      timelineStore: {
        async getRange() {
          return {
            min_observation_ts: "2026-02-06T00:00:00Z",
            max_observation_ts: "2026-02-06T18:00:00Z",
            live_edge_ts: "2026-02-06T18:00:00Z",
          };
        },
        async getDensity() {
          return [];
        },
      },
      default_bucket_seconds: 300,
    });

    const res = await handler(
      new Request("https://example.test/api/timeline/density?v=1&sv=abc&bucket=300&foo=bar")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });

  it("returns 400 for unsupported version on timeline endpoints", async () => {
    const handler = createTimelineRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      },
      timelineStore: {
        async getRange() {
          return {
            min_observation_ts: "2026-02-06T00:00:00Z",
            max_observation_ts: "2026-02-06T18:00:00Z",
            live_edge_ts: "2026-02-06T18:00:00Z",
          };
        },
        async getDensity() {
          return [];
        },
      },
      default_bucket_seconds: 300,
    });

    const timelineRes = await handler(new Request("https://example.test/api/timeline?v=2&sv=abc"));
    expect(timelineRes.status).toBe(400);
    expect(timelineRes.headers.get("Cache-Control")).toBe("no-store");
    const timelineBody = await timelineRes.json();
    expect(timelineBody.error.code).toBe("unsupported_version");

    const densityRes = await handler(
      new Request("https://example.test/api/timeline/density?v=2&sv=abc&bucket=300")
    );
    expect(densityRes.status).toBe(400);
    expect(densityRes.headers.get("Cache-Control")).toBe("no-store");
    const densityBody = await densityRes.json();
    expect(densityBody.error.code).toBe("unsupported_version");
  });
});
