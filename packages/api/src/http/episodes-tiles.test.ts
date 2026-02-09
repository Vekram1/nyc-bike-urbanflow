import { describe, expect, it } from "bun:test";

import { createEpisodesTilesRouteHandler } from "./episodes-tiles";

const validSv = {
  ok: true as const,
  payload: {
    system_id: "citibike-nyc",
    view_id: 42,
    view_spec_sha256: "view-hash",
  },
};

describe("createEpisodesTilesRouteHandler", () => {
  it("returns 400 for unknown query params", async () => {
    const handler = createEpisodesTilesRouteHandler({
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
      default_severity_version: "sev.v1",
      tileStore: {
        async fetchEpisodesTile() {
          throw new Error("not used");
        },
      },
      cache: { max_age_s: 30, s_maxage_s: 120, stale_while_revalidate_s: 15 },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/episodes/12/1200/1530.mvt?sv=abc&T_bucket=1738872000&foo=bar"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });

  it("returns 400 for unsupported version", async () => {
    const handler = createEpisodesTilesRouteHandler({
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
      default_severity_version: "sev.v1",
      tileStore: {
        async fetchEpisodesTile() {
          throw new Error("not used");
        },
      },
      cache: { max_age_s: 30, s_maxage_s: 120, stale_while_revalidate_s: 15 },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/episodes/12/1200/1530.mvt?v=2&sv=abc&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("unsupported_version");
  });

  it("returns 200 and passes sv-bound severity version", async () => {
    let seen: Record<string, unknown> | null = null;
    const handler = createEpisodesTilesRouteHandler({
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
      default_severity_version: "sev.v1",
      servingViews: {
        async getEpisodeBinding() {
          return { severity_version: "sev.v2" };
        },
      },
      tileStore: {
        async fetchEpisodesTile(args) {
          seen = args;
          return {
            ok: true as const,
            mvt: new Uint8Array([1]),
            feature_count: 1,
            bytes: 1,
          };
        },
      },
      cache: { max_age_s: 30, s_maxage_s: 120, stale_while_revalidate_s: 15 },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/episodes/12/1200/1530.mvt?v=1&sv=abc&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age=30");
    expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate=15");
    expect(seen?.system_id).toBe("citibike-nyc");
    expect(seen?.severity_version).toBe("sev.v2");
  });

  it("returns 429 with origin shield headers when store overloads", async () => {
    const handler = createEpisodesTilesRouteHandler({
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
      default_severity_version: "sev.v1",
      tileStore: {
        async fetchEpisodesTile() {
          return {
            ok: false as const,
            status: 429 as const,
            code: "tile_overloaded",
            message: "degraded",
            retry_after_s: 9,
          };
        },
      },
      cache: { max_age_s: 30, s_maxage_s: 120, stale_while_revalidate_s: 15 },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/tiles/episodes/12/1200/1530.mvt?sv=abc&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("9");
    expect(res.headers.get("X-Origin-Block-Reason")).toBe("tile_overloaded");
  });
});
