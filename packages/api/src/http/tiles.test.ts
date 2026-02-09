import { describe, expect, it } from "bun:test";

import { createCompositeTilesRouteHandler } from "./tiles";

const validSv = {
  ok: true as const,
  payload: {
    system_id: "citibike-nyc",
    view_id: 42,
    view_spec_sha256: "view-hash",
    issued_at_s: 1738872000,
    expires_at_s: 1738872600,
  },
};

describe("createCompositeTilesRouteHandler", () => {
  it("returns 400 for unknown query params", async () => {
    const handler = createCompositeTilesRouteHandler({
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
      tileStore: {
        async fetchCompositeTile() {
          throw new Error("not used");
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000&foo=bar"
      )
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });

  it("returns 400 for invalid tile coordinates", async () => {
    const handler = createCompositeTilesRouteHandler({
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
      tileStore: {
        async fetchCompositeTile() {
          throw new Error("not used");
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/3/99/1.mvt?sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 when sv is missing", async () => {
    const handler = createCompositeTilesRouteHandler({
      tokens: {
        async validate() {
          throw new Error("not used");
        },
      },
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      tileStore: {
        async fetchCompositeTile() {
          throw new Error("not used");
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("sv_missing");
  });

  it("returns 400 when required cache-key params are missing", async () => {
    const handler = createCompositeTilesRouteHandler({
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
      tileStore: {
        async fetchCompositeTile() {
          throw new Error("not used");
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?sv=abc&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("missing_tile_schema");
  });

  it("returns 200 and passes canonicalized tile args", async () => {
    let seenArgs: Record<string, unknown> | null = null;
    const handler = createCompositeTilesRouteHandler({
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
      tileStore: {
        async fetchCompositeTile(args) {
          seenArgs = args;
          return {
            ok: true as const,
            mvt: new Uint8Array([1, 2, 3]),
            feature_count: 18,
            bytes: 3,
          };
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=sev,inv,press&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.mapbox-vector-tile");
    expect(res.headers.get("X-Tile-Feature-Count")).toBe("18");
    expect(res.headers.get("X-Tile-Bytes")).toBe("3");
    expect(res.headers.get("Cache-Control")).toContain("max-age=30");
    expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate=15");
    expect(res.headers.get("Cache-Control")).not.toContain("immutable");
    expect(seenArgs).toBeTruthy();
    expect(seenArgs?.system_id).toBe("citibike-nyc");
    expect(seenArgs?.view_id).toBe(42);
    expect(seenArgs?.layers_set).toBe("inv,press,sev");
    expect(seenArgs?.pressure_source).toBe("live_proxy");
  });

  it("uses immutable replay cache policy for long-lived sv tokens", async () => {
    const handler = createCompositeTilesRouteHandler({
      tokens: {
        async validate() {
          return {
            ok: true as const,
            payload: {
              system_id: "citibike-nyc",
              view_id: 42,
              view_spec_sha256: "view-hash",
              issued_at_s: 1738872000,
              expires_at_s: 1739476800,
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
            mvt: new Uint8Array([1, 2, 3]),
            feature_count: 3,
            bytes: 3,
          };
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
        replay_max_age_s: 600,
        replay_s_maxage_s: 3600,
        replay_stale_while_revalidate_s: 60,
        replay_min_ttl_s: 86400,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(res.headers.get("Cache-Control")).toContain("max-age=600");
  });

  it("returns 429 with origin shield headers when tile store is overloaded", async () => {
    const handler = createCompositeTilesRouteHandler({
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
      tileStore: {
        async fetchCompositeTile() {
          return {
            ok: false as const,
            status: 429 as const,
            code: "tile_overloaded",
            message: "degraded",
            retry_after_s: 7,
          };
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(res.headers.get("X-Origin-Block-Reason")).toBe("tile_overloaded");
    const body = await res.json();
    expect(body.error.code).toBe("tile_overloaded");
  });

  it("returns 400 when system_id query param disagrees with sv", async () => {
    const handler = createCompositeTilesRouteHandler({
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
      tileStore: {
        async fetchCompositeTile() {
          throw new Error("not used");
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?sv=abc&system_id=other-system&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("system_id_mismatch");
  });

  it("binds trips baseline pressure source from serving view metadata", async () => {
    let seenArgs: Record<string, unknown> | null = null;
    const handler = createCompositeTilesRouteHandler({
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
      servingViews: {
        async getPressureBinding() {
          return {
            trips_baseline_id: "trips.2026-01",
            trips_baseline_sha256: "abcd",
          };
        },
      },
      tileStore: {
        async fetchCompositeTile(args) {
          seenArgs = args;
          return {
            ok: true as const,
            mvt: new Uint8Array([7]),
            feature_count: 1,
            bytes: 1,
          };
        },
      },
      cache: {
        max_age_s: 30,
        s_maxage_s: 120,
        stale_while_revalidate_s: 15,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,press&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    expect(seenArgs?.pressure_source).toBe("trips_baseline");
    expect(seenArgs?.trips_baseline_id).toBe("trips.2026-01");
    expect(seenArgs?.trips_baseline_sha256).toBe("abcd");
  });
});
