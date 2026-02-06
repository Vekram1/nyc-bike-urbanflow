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
});
