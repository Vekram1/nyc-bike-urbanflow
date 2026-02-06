import { describe, expect, it } from "bun:test";

import { originShieldHeaders, validateSvQuery } from "./http";

describe("originShieldHeaders", () => {
  it("includes no-store and retry-after when provided", () => {
    const headers = originShieldHeaders("tile_overloaded", 7);
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["X-Origin-Block-Reason"]).toBe("tile_overloaded");
    expect(headers["Retry-After"]).toBe("7");
  });
});

describe("validateSvQuery", () => {
  it("returns sv_missing with no-store headers and warning log", async () => {
    const events: Array<{ level: "info" | "warn"; event: string; data: Record<string, unknown> }> = [];
    const result = await validateSvQuery(
      {
        async validate() {
          throw new Error("not used");
        },
      } as unknown as import("./service").ServingTokenService,
      new URLSearchParams(),
      {
        ctx: { path: "/api/tiles/composite/1/1/1.mvt" },
        logger: {
          info(event, data) {
            events.push({ level: "info", event, data });
          },
          warn(event, data) {
            events.push({ level: "warn", event, data });
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.code).toBe("sv_missing");
      expect(result.headers["Cache-Control"]).toBe("no-store");
    }
    expect(events.some((e) => e.level === "warn" && e.event === "sv.missing")).toBe(true);
  });

  it("maps token_revoked to 403 and logs sv.invalid", async () => {
    const events: string[] = [];
    const result = await validateSvQuery(
      {
        async validate() {
          return { ok: false as const, reason: "token_revoked" };
        },
      } as unknown as import("./service").ServingTokenService,
      new URLSearchParams("sv=abc"),
      {
        logger: {
          info() {},
          warn(event) {
            events.push(event);
          },
        },
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe("token_revoked");
      expect(result.headers["X-Origin-Block-Reason"]).toBe("token_revoked");
    }
    expect(events.includes("sv.invalid")).toBe(true);
  });

  it("returns normalized sv payload and logs sv.ok", async () => {
    const events: string[] = [];
    const result = await validateSvQuery(
      {
        async validate(token: string) {
          expect(token).toBe("sv-live");
          return {
            ok: true as const,
            payload: {
              system_id: "citibike-nyc",
              view_id: 42,
              view_spec_sha256: "hash",
            },
          };
        },
      } as unknown as import("./service").ServingTokenService,
      new URLSearchParams("sv=sv-live"),
      {
        ctx: { path: "/api/policy/run" },
        logger: {
          info(event) {
            events.push(event);
          },
          warn() {},
        },
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sv).toBe("sv-live");
      expect(result.system_id).toBe("citibike-nyc");
      expect(result.view_id).toBe(42);
      expect(result.view_spec_sha256).toBe("hash");
    }
    expect(events.includes("sv.ok")).toBe(true);
  });
});
