import { describe, expect, it } from "bun:test";

import { createAdminRouteHandler } from "./admin";

const deps = {
  auth: {
    admin_token: "secret-token",
    allowed_origins: ["https://ops.example.test"],
  },
  config: {
    default_system_id: "citibike-nyc",
  },
  store: {
    async getPipelineState() {
      return {
        queue_depth: 1,
        dlq_depth: 2,
        feeds: [{ dataset_id: "gbfs.station_status", last_success_at: "2026-02-09T00:00:00Z" }],
        degrade_history: [{ bucket_ts: "2026-02-09T00:00:00Z", degrade_level: 1, client_should_throttle: true }],
      };
    },
    async listDlq() {
      return [
        {
          dlq_id: 1,
          job_id: 99,
          type: "policy.run_v1",
          reason_code: "timeout",
          failed_at: "2026-02-09T00:00:00Z",
          attempts: 10,
          max_attempts: 10,
          payload_summary: "payload",
        },
      ];
    },
    async resolveDlq(args: { dlq_id: number }) {
      return args.dlq_id === 1;
    },
  },
};

describe("createAdminRouteHandler", () => {
  it("serves static ops page", async () => {
    const handler = createAdminRouteHandler(deps);
    const res = await handler(new Request("https://example.test/admin/ops"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("requires admin token for admin API", async () => {
    const handler = createAdminRouteHandler(deps);
    const res = await handler(new Request("https://example.test/api/pipeline_state?v=1"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("missing_admin_token");
  });

  it("enforces strict origin allowlist", async () => {
    const handler = createAdminRouteHandler(deps);
    const res = await handler(
      new Request("https://example.test/api/pipeline_state?v=1", {
        headers: {
          Origin: "https://evil.example.test",
          "X-Admin-Token": "secret-token",
        },
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden_origin");
  });

  it("returns pipeline state with CORS header for allowed origin", async () => {
    const handler = createAdminRouteHandler(deps);
    const res = await handler(
      new Request("https://example.test/api/pipeline_state?v=1", {
        headers: {
          Origin: "https://ops.example.test",
          "X-Admin-Token": "secret-token",
        },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ops.example.test");
    const body = await res.json();
    expect(body.queue_depth).toBe(1);
  });

  it("returns 400 for unknown query params on pipeline state", async () => {
    const handler = createAdminRouteHandler(deps);
    const res = await handler(
      new Request("https://example.test/api/pipeline_state?v=1&foo=bar", {
        headers: { "X-Admin-Token": "secret-token" },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });

  it("lists dlq with bounded limit parsing", async () => {
    const handler = createAdminRouteHandler(deps);
    const res = await handler(
      new Request("https://example.test/api/admin/dlq?v=1&limit=20", {
        headers: { "X-Admin-Token": "secret-token" },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(1);
  });

  it("returns 400 for unknown query params on dlq list", async () => {
    const handler = createAdminRouteHandler(deps);
    const res = await handler(
      new Request("https://example.test/api/admin/dlq?v=1&limit=20&foo=bar", {
        headers: { "X-Admin-Token": "secret-token" },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });

  it("resolves dlq entries", async () => {
    const handler = createAdminRouteHandler(deps);
    const ok = await handler(
      new Request("https://example.test/api/admin/dlq/resolve?v=1", {
        method: "POST",
        headers: { "X-Admin-Token": "secret-token", "Content-Type": "application/json" },
        body: JSON.stringify({ dlq_id: 1, resolution_note: "investigated and ignored" }),
      })
    );
    expect(ok.status).toBe(200);
    const miss = await handler(
      new Request("https://example.test/api/admin/dlq/resolve?v=1", {
        method: "POST",
        headers: { "X-Admin-Token": "secret-token", "Content-Type": "application/json" },
        body: JSON.stringify({ dlq_id: 999, resolution_note: "missing" }),
      })
    );
    expect(miss.status).toBe(404);
  });

  it("returns 400 for unknown query params on dlq resolve", async () => {
    const handler = createAdminRouteHandler(deps);
    const res = await handler(
      new Request("https://example.test/api/admin/dlq/resolve?v=1&foo=bar", {
        method: "POST",
        headers: { "X-Admin-Token": "secret-token", "Content-Type": "application/json" },
        body: JSON.stringify({ dlq_id: 1, resolution_note: "note" }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
  });
});
