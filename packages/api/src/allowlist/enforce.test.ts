import { describe, expect, it } from "bun:test";

import { enforceAllowlist } from "./enforce";

describe("enforceAllowlist", () => {
  it("rejects missing values with no-store", async () => {
    const result = await enforceAllowlist(
      {
        async isAllowed() {
          return true;
        },
      },
      [{ kind: "policy_version", value: "" }]
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe("param_not_allowlisted");
      expect(result.headers["Cache-Control"]).toBe("no-store");
    }
  });

  it("logs allowlist_reject and returns 400 when value is not allowlisted", async () => {
    const events: Array<{ level: "info" | "warn"; event: string; data: Record<string, unknown> }> = [];
    const result = await enforceAllowlist(
      {
        async isAllowed() {
          return false;
        },
      },
      [{ kind: "tile_schema", value: "tile.v999", system_id: "citibike-nyc" }],
      {
        path: "/api/tiles/composite/12/1200/1530.mvt",
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
      expect(result.status).toBe(400);
      expect(result.code).toBe("param_not_allowlisted");
      expect(result.kind).toBe("tile_schema");
      expect(result.headers["Cache-Control"]).toBe("no-store");
    }
    expect(events.some((e) => e.level === "warn" && e.event === "allowlist_reject")).toBe(true);
  });

  it("logs allowlist_ok when all checks pass", async () => {
    const events: string[] = [];
    const result = await enforceAllowlist(
      {
        async isAllowed() {
          return true;
        },
      },
      [
        { kind: "system_id", value: "citibike-nyc" },
        { kind: "policy_version", value: "rebal.greedy.v1", system_id: "citibike-nyc" },
      ],
      {
        path: "/api/policy/run",
        logger: {
          info(event) {
            events.push(event);
          },
          warn() {},
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(events.includes("allowlist_ok")).toBe(true);
  });
});
