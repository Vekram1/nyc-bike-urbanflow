import { describe, expect, it } from "bun:test";

import { createSearchRouteHandler } from "./search";

describe("createSearchRouteHandler", () => {
  it("returns results when input is valid", async () => {
    const handler = createSearchRouteHandler({
      allowlist: {
        async isAllowed(query) {
          return query.kind === "system_id" && query.value === "citibike-nyc";
        },
      },
      searchStore: {
        async searchStations() {
          return [
            {
              station_key: "abc",
              name: "W 52 St",
              short_name: "52 St",
              lat: 40.75,
              lon: -73.98,
            },
          ];
        },
      },
    });

    const res = await handler(
      new Request("https://example.test/api/search?system_id=citibike-nyc&q=52&bbox=-74,40,-73,41&limit=10")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.length).toBe(1);
  });

  it("returns 400 for invalid q", async () => {
    const handler = createSearchRouteHandler({
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
    });

    const res = await handler(new Request("https://example.test/api/search?system_id=citibike-nyc&q=a"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_q");
  });

  it("returns 400 for invalid bbox", async () => {
    const handler = createSearchRouteHandler({
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
    });

    const res = await handler(
      new Request("https://example.test/api/search?system_id=citibike-nyc&q=52&bbox=bad")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_bbox");
  });

  it("returns 400 for unknown query params", async () => {
    const handler = createSearchRouteHandler({
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
    });

    const res = await handler(
      new Request("https://example.test/api/search?system_id=citibike-nyc&q=52&foo=bar")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
    expect(body.error.message).toContain("foo");
  });
});
