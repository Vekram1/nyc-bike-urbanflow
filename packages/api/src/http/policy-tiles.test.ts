import { describe, expect, it } from "bun:test";

import { createPolicyMovesTilesRouteHandler } from "./policy-tiles";

const validSv = {
  ok: true as const,
  payload: {
    system_id: "citibike-nyc",
    view_id: 42,
    view_spec_sha256: "view-hash",
  },
};

describe("createPolicyMovesTilesRouteHandler", () => {
  it("returns 400 for unknown query params", async () => {
    const handler = createPolicyMovesTilesRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      } as unknown as import("../sv/service").ServingTokenService,
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      tileStore: {
        async fetchPolicyMovesTile() {
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
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&foo=bar"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });

  it("returns 405 for non-GET requests", async () => {
    const handler = createPolicyMovesTilesRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      } as unknown as import("../sv/service").ServingTokenService,
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      tileStore: {
        async fetchPolicyMovesTile() {
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
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000",
        { method: "POST" }
      )
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("method_not_allowed");
  });

  it("returns 401 when sv is missing", async () => {
    const handler = createPolicyMovesTilesRouteHandler({
      tokens: {
        async validate() {
          throw new Error("not used");
        },
      } as unknown as import("../sv/service").ServingTokenService,
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      tileStore: {
        async fetchPolicyMovesTile() {
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
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?v=1&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("sv_missing");
  });

  it("returns 400 for unsupported version", async () => {
    const handler = createPolicyMovesTilesRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      } as unknown as import("../sv/service").ServingTokenService,
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      tileStore: {
        async fetchPolicyMovesTile() {
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
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?v=2&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("unsupported_version");
  });

  it("returns 403 when sv token is revoked", async () => {
    const handler = createPolicyMovesTilesRouteHandler({
      tokens: {
        async validate() {
          return { ok: false as const, reason: "token_revoked" };
        },
      } as unknown as import("../sv/service").ServingTokenService,
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      tileStore: {
        async fetchPolicyMovesTile() {
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
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?v=1&sv=revoked&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("token_revoked");
  });

  it("returns 401 when sv token is invalid", async () => {
    const handler = createPolicyMovesTilesRouteHandler({
      tokens: {
        async validate() {
          return { ok: false as const, reason: "token_invalid" };
        },
      } as unknown as import("../sv/service").ServingTokenService,
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      tileStore: {
        async fetchPolicyMovesTile() {
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
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?v=1&sv=invalid&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("token_invalid");
  });

  it("returns 200 and mvt headers on success", async () => {
    const handler = createPolicyMovesTilesRouteHandler({
      tokens: {
        async validate() {
          return validSv;
        },
      } as unknown as import("../sv/service").ServingTokenService,
      allowlist: {
        async isAllowed() {
          return true;
        },
      },
      tileStore: {
        async fetchPolicyMovesTile(args) {
          expect(args.policy_version).toBe("rebal.greedy.v1");
          return {
            ok: true as const,
            mvt: new Uint8Array([1, 2, 3]),
            feature_count: 2,
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
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.mapbox-vector-tile");
    expect(res.headers.get("X-Tile-Feature-Count")).toBe("2");
    expect(res.headers.get("Cache-Control")).toContain("max-age=30");
    expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate=15");
  });

  it("returns 404 when policy run is missing", async () => {
    const handler = createPolicyMovesTilesRouteHandler({
      tokens: {
        async validate() {
          return validSv;
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
            ok: false as const,
            status: 404 as const,
            code: "policy_run_not_found",
            message: "missing",
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
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("policy_run_not_found");
  });

  it("returns 429 with origin shield headers when store overloads", async () => {
    const handler = createPolicyMovesTilesRouteHandler({
      tokens: {
        async validate() {
          return validSv;
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
            ok: false as const,
            status: 429 as const,
            code: "tile_overloaded",
            message: "degraded",
            retry_after_s: 6,
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
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("6");
    expect(res.headers.get("X-Origin-Block-Reason")).toBe("tile_overloaded");
  });
});
