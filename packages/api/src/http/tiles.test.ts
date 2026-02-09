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

  it("returns 405 for non-GET requests", async () => {
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
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000",
        { method: "POST" }
      )
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("method_not_allowed");
  });

  it("returns 400 for unsupported version", async () => {
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
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=2&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("unsupported_version");
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

  it("returns 403 when sv token is revoked", async () => {
    const handler = createCompositeTilesRouteHandler({
      tokens: {
        async validate() {
          return { ok: false as const, reason: "token_revoked" };
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
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?sv=revoked&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("token_revoked");
  });

  it("returns 401 when sv token is invalid", async () => {
    const handler = createCompositeTilesRouteHandler({
      tokens: {
        async validate() {
          return { ok: false as const, reason: "token_invalid" };
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
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?sv=invalid&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("token_invalid");
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
    expect(seenArgs?.compare_mode).toBe("off");
    expect(seenArgs?.t2_bucket_epoch_s).toBeUndefined();
  });

  it("returns 400 for invalid compare_mode", async () => {
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
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000&compare_mode=weird"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_compare_mode");
  });

  it("returns 400 when compare_mode is delta without T2_bucket", async () => {
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
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000&compare_mode=delta"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("missing_t2_bucket");
  });

  it("returns 400 when compare_mode is off and T2_bucket is provided", async () => {
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
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000&T2_bucket=1738871400&compare_mode=off"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unexpected_t2_bucket");
  });

  it("returns 400 when compare window exceeds max_window_s", async () => {
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
      compare: {
        max_window_s: 60,
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000&T2_bucket=1738871400&compare_mode=delta"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("t2_bucket_out_of_range");
  });

  it("passes compare args to tile store for split mode", async () => {
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
            mvt: new Uint8Array([1]),
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
        "https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=abc&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000&T2_bucket=1738871700&compare_mode=split"
      )
    );
    expect(res.status).toBe(200);
    expect(seenArgs?.compare_mode).toBe("split");
    expect(seenArgs?.t2_bucket_epoch_s).toBe(1738871700);
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

  it("serves replay tile from write-through cache on hit", async () => {
    let storeCalled = false;
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
      replayCache: {
        async get() {
          return {
            mvt: new Uint8Array([9, 9]),
            feature_count: 4,
            bytes: 2,
            degrade_level: 0,
          };
        },
        async put() {
          throw new Error("should not write on cache hit");
        },
      },
      tileStore: {
        async fetchCompositeTile() {
          storeCalled = true;
          throw new Error("should not hit tile store on replay cache hit");
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
    expect(storeCalled).toBe(false);
    expect(res.headers.get("X-Replay-Tile-Source")).toBe("write-through-cache");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
  });

  it("writes replay tile to cache on miss", async () => {
    let putCount = 0;
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
      replayCache: {
        async get() {
          return null;
        },
        async put(_key, value) {
          putCount += 1;
          expect(value.feature_count).toBe(3);
          expect(value.bytes).toBe(3);
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
    expect(putCount).toBe(1);
    expect(res.headers.get("X-Replay-Tile-Source")).toBe("origin-write-through");
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
