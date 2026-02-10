import { describe, expect, it } from "bun:test";

import { createPolicyRouteHandler, type PolicyRouteDeps } from "./policy";

const validSv = {
  ok: true as const,
  payload: {
    system_id: "citibike-nyc",
    view_id: 42,
    view_spec_sha256: "view-hash",
  },
};

function buildDeps(overrides?: Partial<PolicyRouteDeps>): PolicyRouteDeps {
  return {
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
    policyStore: {
      async getRunSummary() {
        return null;
      },
      async listMoves() {
        return [];
      },
    },
    stationsStore: {
      async getStationsSnapshot() {
        return [
          {
            station_key: "STA-001",
            name: "W 52 St",
            lat: 40.75,
            lon: -73.98,
            capacity: 40,
            bucket_ts: "2026-02-06T20:00:00Z",
            bikes_available: 12,
            docks_available: 28,
            bucket_quality: "ok",
          },
        ];
      },
    },
    queue: {
      async enqueue() {
        return { ok: true as const, job_id: 77 };
      },
      async getPendingByDedupeKey() {
        return { job_id: 77 };
      },
      async cancelByDedupeKey() {
        return true;
      },
    },
    config: {
      default_policy_version: "rebal.greedy.v1",
      available_policy_versions: ["rebal.greedy.v1", "rebal.global.v1"],
      default_horizon_steps: 0,
      retry_after_ms: 2500,
      max_moves: 50,
      budget_presets: [],
    },
    ...(overrides ?? {}),
  };
}

describe("policy API contract", () => {
  it("returns 400 unknown_param with no-store semantics", async () => {
    const handler = createPolicyRouteHandler(buildDeps());
    const res = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&foo=bar"
      )
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
    expect(body.error.category).toBe("invalid_request");
    expect(body.error.retryable).toBe(false);
  });

  it("returns deterministic 409 snapshot mismatch shape", async () => {
    const handler = createPolicyRouteHandler(buildDeps());
    const res = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&view_snapshot_id=bad&view_snapshot_sha256=bad"
      )
    );
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("view_snapshot_mismatch");
    expect(body.error.category).toBe("view_snapshot_mismatch");
    expect(body.error.retryable).toBe(true);
    expect(typeof body.requested_view_snapshot_id).toBe("string");
    expect(typeof body.current_view_snapshot_id).toBe("string");
    expect(typeof body.requested_view_snapshot_sha256).toBe("string");
    expect(typeof body.current_view_snapshot_sha256).toBe("string");
  });

  it("echoes run_key in pending status contract responses", async () => {
    const handler = createPolicyRouteHandler(buildDeps());
    const res = await handler(
      new Request(
        "https://example.test/api/policy/status?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(typeof body.computed_at).toBe("string");
    expect(body.run_key.system_id).toBe("citibike-nyc");
    expect(body.run_key.policy_version).toBe("rebal.greedy.v1");
    expect(body.run_key.strategy).toBe("greedy.v1");
    expect(body.run_key.decision_bucket_epoch_s).toBe(1738872000);
    expect(body.run_key.policy_spec_sha256).toBeNull();
  });

  it("returns 200 canceled contract shape from cancel endpoint", async () => {
    const handler = createPolicyRouteHandler(
      buildDeps({
        policyStore: {
          async getRunSummary() {
            return null;
          },
          async listMoves() {
            return [];
          },
        },
      })
    );
    const res = await handler(
      new Request(
        "https://example.test/api/policy/cancel?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000",
        { method: "POST" }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("canceled");
    expect(body.canceled).toBe(true);
    expect(body.run_key.strategy).toBe("greedy.v1");
    expect(body.run_key.policy_spec_sha256).toBeNull();
  });
});
