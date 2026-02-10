import { describe, expect, it } from "bun:test";

import { createPolicyRouteHandler } from "./policy";

const validSv = {
  ok: true as const,
  payload: {
    system_id: "citibike-nyc",
    view_id: 42,
    view_spec_sha256: "view-hash",
  },
};

describe("createPolicyRouteHandler", () => {
  it("returns pending/ready via /api/policy/status and supports /api/policy/cancel", async () => {
    let pending = true;
    const handler = createPolicyRouteHandler({
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
          if (pending) return null;
          return {
            run_id: 501,
            system_id: "citibike-nyc",
            policy_version: "rebal.greedy.v1",
            policy_spec_sha256: "abc",
            sv: "abc",
            decision_bucket_ts: "2026-02-06T18:00:00.000Z",
            horizon_steps: 0,
            input_quality: "ok",
            status: "success",
            no_op: false,
            no_op_reason: null,
            error_reason: null,
            created_at: "2026-02-06T18:00:00.000Z",
            move_count: 2,
          };
        },
        async listMoves() {
          return [];
        },
      },
      queue: {
        async enqueue() {
          return { ok: true as const, job_id: 77 };
        },
        async getPendingByDedupeKey() {
          return pending ? { job_id: 77 } : null;
        },
        async cancelByDedupeKey() {
          if (!pending) return false;
          pending = false;
          return true;
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const statusPending = await handler(
      new Request(
        "https://example.test/api/policy/status?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(statusPending.status).toBe(202);
    const pendingBody = await statusPending.json();
    expect(pendingBody.status).toBe("pending");

    const cancelRes = await handler(
      new Request(
        "https://example.test/api/policy/cancel?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000",
        { method: "POST" }
      )
    );
    expect(cancelRes.status).toBe(200);
    const cancelBody = await cancelRes.json();
    expect(cancelBody.status).toBe("canceled");

    const statusReady = await handler(
      new Request(
        "https://example.test/api/policy/status?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(statusReady.status).toBe(200);
    const readyBody = await statusReady.json();
    expect(readyBody.status).toBe("ready");
    expect(readyBody.run.run_id).toBe(501);
  });

  it("requires POST for /api/policy/cancel", async () => {
    const handler = createPolicyRouteHandler({
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
      queue: {
        async enqueue() {
          return { ok: true as const, job_id: 1 };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/policy/cancel?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error.code).toBe("method_not_allowed");
  });

  it("returns 409 view_snapshot_mismatch when snapshot precondition does not match", async () => {
    const handler = createPolicyRouteHandler({
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
          return { ok: true as const, job_id: 1 };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

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
    expect(typeof body.current_view_snapshot_id).toBe("string");
    expect(typeof body.current_view_snapshot_sha256).toBe("string");
  });

  it("returns 400 when only one snapshot precondition field is provided", async () => {
    const handler = createPolicyRouteHandler({
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
          return [];
        },
      },
      queue: {
        async enqueue() {
          return { ok: true as const, job_id: 1 };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&view_snapshot_id=only-one"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_snapshot_precondition");
    expect(body.error.category).toBe("invalid_request");
    expect(body.error.retryable).toBe(false);
  });

  it("returns policy config payload", async () => {
    const handler = createPolicyRouteHandler({
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
      policyStore: {
        async getRunSummary() {
          return null;
        },
        async listMoves() {
          return [];
        },
      },
      queue: {
        async enqueue() {
          return { ok: true as const, job_id: 1 };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2000,
        max_moves: 50,
        budget_presets: [
          {
            key: "default",
            max_bikes_per_move: 5,
            max_total_bikes_moved: 60,
            max_stations_touched: 24,
            max_total_distance_m: 12000,
          },
        ],
      },
    });

    const res = await handler(new Request("https://example.test/api/policy/config?v=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.default_policy_version).toBe("rebal.greedy.v1");
    expect(body.default_strategy).toBe("greedy.v1");
    expect(Array.isArray(body.available_strategies)).toBe(true);
    expect(Array.isArray(body.available_policy_versions)).toBe(true);
  });

  it("returns 202 and enqueues when run is missing", async () => {
    let seenDedupe: string | null = null;
    const handler = createPolicyRouteHandler({
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
      queue: {
        async enqueue(params) {
          seenDedupe = params.dedupe_key ?? null;
          return { ok: true as const, job_id: 11 };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
      logger: { info() {}, warn() {} },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(typeof body.computed_at).toBe("string");
    expect(body.run_key.system_id).toBe("citibike-nyc");
    expect(body.run_key.decision_bucket_epoch_s).toBe(1738872000);
    expect(body.run_key.policy_version).toBe("rebal.greedy.v1");
    expect(body.run_key.strategy).toBe("greedy.v1");
    expect(body.run_key.policy_spec_sha256).toBeNull();
    expect(seenDedupe).toBe("citibike-nyc:abc:1738872000:rebal.greedy.v1:0");
  });

  it("returns run summary when cache exists", async () => {
    const handler = createPolicyRouteHandler({
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
          return {
            run_id: 99,
            system_id: "citibike-nyc",
            policy_version: "rebal.greedy.v1",
            policy_spec_sha256: "abc",
            sv: "abc",
            decision_bucket_ts: "2026-02-06T18:00:00.000Z",
            horizon_steps: 0,
            input_quality: "ok",
            status: "success",
            no_op: false,
            no_op_reason: null,
            error_reason: null,
            created_at: "2026-02-06T18:00:00.000Z",
            move_count: 2,
          };
        },
        async listMoves() {
          return [];
        },
      },
      queue: {
        async enqueue() {
          throw new Error("not used");
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
      logger: { info() {}, warn() {} },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(typeof body.computed_at).toBe("string");
    expect(body.run_key.system_id).toBe("citibike-nyc");
    expect(body.run_key.strategy).toBe("greedy.v1");
    expect(body.run_key.policy_spec_sha256).toBe("abc");
    expect(body.run.run_id).toBe(99);
  });

  it("returns top-n moves when run exists", async () => {
    const handler = createPolicyRouteHandler({
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
          return {
            run_id: 7,
            system_id: "citibike-nyc",
            policy_version: "rebal.greedy.v1",
            policy_spec_sha256: "abc",
            sv: "abc",
            decision_bucket_ts: "2026-02-06T18:00:00.000Z",
            horizon_steps: 0,
            input_quality: "ok",
            status: "success",
            no_op: false,
            no_op_reason: null,
            error_reason: null,
            created_at: "2026-02-06T18:00:00.000Z",
            move_count: 2,
          };
        },
        async listMoves(args) {
          expect(args.limit).toBe(1);
          return [
            {
              move_rank: 1,
              from_station_key: "A",
              to_station_key: "B",
              bikes_moved: 2,
              dist_m: 120,
              budget_exhausted: false,
              neighbor_exhausted: false,
              reason_codes: ["min_distance_then_max_transfer"],
            },
          ];
        },
      },
      queue: {
        async enqueue() {
          throw new Error("not used");
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
      logger: { info() {}, warn() {} },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/policy/moves?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&top_n=1"
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(typeof body.computed_at).toBe("string");
    expect(body.run_key.strategy).toBe("greedy.v1");
    expect(body.run_key.policy_spec_sha256).toBe("abc");
    expect(body.top_n).toBe(1);
    expect(body.moves.length).toBe(1);
  });

  it("echoes snapshot metadata in run_key when provided and validated", async () => {
    const handler = createPolicyRouteHandler({
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
          return { ok: true as const, job_id: 1 };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const mismatchRes = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&view_snapshot_id=bad&view_snapshot_sha256=bad"
      )
    );
    const mismatchBody = await mismatchRes.json();
    const snapshotId = mismatchBody.current_view_snapshot_id as string;
    const snapshotSha = mismatchBody.current_view_snapshot_sha256 as string;

    const okRes = await handler(
      new Request(
        `https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&view_snapshot_id=${encodeURIComponent(snapshotId)}&view_snapshot_sha256=${encodeURIComponent(snapshotSha)}`
      )
    );
    expect(okRes.status).toBe(202);
    const okBody = await okRes.json();
    expect(okBody.run_key.view_snapshot_id).toBe(snapshotId);
    expect(okBody.run_key.view_snapshot_sha256).toBe(snapshotSha);
  });

  it("returns 400 for unknown query params", async () => {
    const handler = createPolicyRouteHandler({
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
      queue: {
        async enqueue() {
          return { ok: false as const, reason: "deduped" };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&foo=bar"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");
    expect(body.error.category).toBe("invalid_request");
  });

  it("validates strategy and policy_version consistency", async () => {
    const handler = createPolicyRouteHandler({
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
      queue: {
        async enqueue() {
          return { ok: true as const, job_id: 1 };
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
    });

    const invalidStrategy = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&strategy=bad&T_bucket=1738872000"
      )
    );
    expect(invalidStrategy.status).toBe(400);
    const invalidStrategyBody = await invalidStrategy.json();
    expect(invalidStrategyBody.error.code).toBe("invalid_strategy");

    const mismatch = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&strategy=global.v1&T_bucket=1738872000"
      )
    );
    expect(mismatch.status).toBe(400);
    const mismatchBody = await mismatch.json();
    expect(mismatchBody.error.code).toBe("strategy_policy_mismatch");
  });

  it("accepts global strategy and echoes it in run_key", async () => {
    const handler = createPolicyRouteHandler({
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
      queue: {
        async enqueue() {
          return { ok: true as const, job_id: 1 };
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
    });

    const res = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.global.v1&strategy=global.v1&T_bucket=1738872000"
      )
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.run_key.strategy).toBe("global.v1");
  });

  it("returns 400 for unsupported version on policy endpoints", async () => {
    const handler = createPolicyRouteHandler({
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
      queue: {
        async enqueue() {
          return { ok: true as const, job_id: 1 };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const configRes = await handler(new Request("https://example.test/api/policy/config?v=2"));
    expect(configRes.status).toBe(400);
    expect(configRes.headers.get("Cache-Control")).toBe("no-store");
    const configBody = await configRes.json();
    expect(configBody.error.code).toBe("unsupported_version");

    const runRes = await handler(
      new Request(
        "https://example.test/api/policy/run?v=2&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(runRes.status).toBe(400);
    expect(runRes.headers.get("Cache-Control")).toBe("no-store");
    const runBody = await runRes.json();
    expect(runBody.error.code).toBe("unsupported_version");

    const movesRes = await handler(
      new Request(
        "https://example.test/api/policy/moves?v=2&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(movesRes.status).toBe(400);
    expect(movesRes.headers.get("Cache-Control")).toBe("no-store");
    const movesBody = await movesRes.json();
    expect(movesBody.error.code).toBe("unsupported_version");
  });

  it("returns 405 for non-GET on policy endpoints", async () => {
    const handler = createPolicyRouteHandler({
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
      queue: {
        async enqueue() {
          return { ok: true as const, job_id: 1 };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const configRes = await handler(new Request("https://example.test/api/policy/config?v=1", { method: "POST" }));
    expect(configRes.status).toBe(405);
    expect(configRes.headers.get("Cache-Control")).toBe("no-store");
    const configBody = await configRes.json();
    expect(configBody.error.code).toBe("method_not_allowed");

    const runRes = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000",
        { method: "POST" }
      )
    );
    expect(runRes.status).toBe(405);
    expect(runRes.headers.get("Cache-Control")).toBe("no-store");
    const runBody = await runRes.json();
    expect(runBody.error.code).toBe("method_not_allowed");

    const movesRes = await handler(
      new Request(
        "https://example.test/api/policy/moves?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000",
        { method: "POST" }
      )
    );
    expect(movesRes.status).toBe(405);
    expect(movesRes.headers.get("Cache-Control")).toBe("no-store");
    const movesBody = await movesRes.json();
    expect(movesBody.error.code).toBe("method_not_allowed");
  });

  it("validates required/typed run params", async () => {
    const handler = createPolicyRouteHandler({
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
      queue: {
        async enqueue() {
          return { ok: false as const, reason: "deduped" };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const missingPolicyVersion = await handler(
      new Request("https://example.test/api/policy/run?v=1&sv=abc&T_bucket=1738872000")
    );
    expect(missingPolicyVersion.status).toBe(400);
    expect(missingPolicyVersion.headers.get("Cache-Control")).toBe("no-store");
    const missingPolicyVersionBody = await missingPolicyVersion.json();
    expect(missingPolicyVersionBody.error.code).toBe("missing_policy_version");

    const invalidBucket = await handler(
      new Request("https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=bad")
    );
    expect(invalidBucket.status).toBe(400);
    expect(invalidBucket.headers.get("Cache-Control")).toBe("no-store");
    const invalidBucketBody = await invalidBucket.json();
    expect(invalidBucketBody.error.code).toBe("invalid_t_bucket");

    const invalidHorizonSteps = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&horizon_steps=999"
      )
    );
    expect(invalidHorizonSteps.status).toBe(400);
    expect(invalidHorizonSteps.headers.get("Cache-Control")).toBe("no-store");
    const invalidHorizonStepsBody = await invalidHorizonSteps.json();
    expect(invalidHorizonStepsBody.error.code).toBe("invalid_horizon_steps");
  });

  it("validates top_n for moves responses", async () => {
    const handler = createPolicyRouteHandler({
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
          return {
            run_id: 7,
            system_id: "citibike-nyc",
            policy_version: "rebal.greedy.v1",
            policy_spec_sha256: "abc",
            sv: "abc",
            decision_bucket_ts: "2026-02-06T18:00:00.000Z",
            horizon_steps: 0,
            input_quality: "ok",
            status: "success",
            no_op: false,
            no_op_reason: null,
            error_reason: null,
            created_at: "2026-02-06T18:00:00.000Z",
            move_count: 2,
          };
        },
        async listMoves() {
          return [];
        },
      },
      queue: {
        async enqueue() {
          return { ok: true as const, job_id: 1 };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const invalidTopN = await handler(
      new Request(
        "https://example.test/api/policy/moves?v=1&sv=abc&policy_version=rebal.greedy.v1&T_bucket=1738872000&top_n=0"
      )
    );
    expect(invalidTopN.status).toBe(400);
    expect(invalidTopN.headers.get("Cache-Control")).toBe("no-store");
    const invalidTopNBody = await invalidTopN.json();
    expect(invalidTopNBody.error.code).toBe("invalid_top_n");
  });

  it("enforces sv presence and system_id binding", async () => {
    const handler = createPolicyRouteHandler({
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
      queue: {
        async enqueue() {
          return { ok: false as const, reason: "deduped" };
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const missingSv = await handler(
      new Request("https://example.test/api/policy/run?v=1&policy_version=rebal.greedy.v1&T_bucket=1738872000")
    );
    expect(missingSv.status).toBe(401);
    expect(missingSv.headers.get("Cache-Control")).toBe("no-store");
    const missingSvBody = await missingSv.json();
    expect(missingSvBody.error.code).toBe("sv_missing");

    const mismatchSystem = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=abc&system_id=other&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(mismatchSystem.status).toBe(400);
    expect(mismatchSystem.headers.get("Cache-Control")).toBe("no-store");
    const mismatchSystemBody = await mismatchSystem.json();
    expect(mismatchSystemBody.error.code).toBe("system_id_mismatch");
  });

  it("returns 403 for revoked sv token on run and moves routes", async () => {
    const handler = createPolicyRouteHandler({
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
      policyStore: {
        async getRunSummary() {
          return null;
        },
        async listMoves() {
          return [];
        },
      },
      queue: {
        async enqueue() {
          throw new Error("not used");
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const runRes = await handler(
      new Request("https://example.test/api/policy/run?v=1&sv=revoked&policy_version=rebal.greedy.v1&T_bucket=1738872000")
    );
    expect(runRes.status).toBe(403);
    expect(runRes.headers.get("Cache-Control")).toBe("no-store");
    const runBody = await runRes.json();
    expect(runBody.error.code).toBe("token_revoked");

    const movesRes = await handler(
      new Request(
        "https://example.test/api/policy/moves?v=1&sv=revoked&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(movesRes.status).toBe(403);
    expect(movesRes.headers.get("Cache-Control")).toBe("no-store");
    const movesBody = await movesRes.json();
    expect(movesBody.error.code).toBe("token_revoked");
  });

  it("returns 401 for invalid sv token on run and moves routes", async () => {
    const handler = createPolicyRouteHandler({
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
      policyStore: {
        async getRunSummary() {
          return null;
        },
        async listMoves() {
          return [];
        },
      },
      queue: {
        async enqueue() {
          throw new Error("not used");
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const runRes = await handler(
      new Request("https://example.test/api/policy/run?v=1&sv=invalid&policy_version=rebal.greedy.v1&T_bucket=1738872000")
    );
    expect(runRes.status).toBe(401);
    expect(runRes.headers.get("Cache-Control")).toBe("no-store");
    const runBody = await runRes.json();
    expect(runBody.error.code).toBe("token_invalid");

    const movesRes = await handler(
      new Request(
        "https://example.test/api/policy/moves?v=1&sv=invalid&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(movesRes.status).toBe(401);
    expect(movesRes.headers.get("Cache-Control")).toBe("no-store");
    const movesBody = await movesRes.json();
    expect(movesBody.error.code).toBe("token_invalid");
  });

  it("returns 401 for expired sv token on run and moves routes", async () => {
    const handler = createPolicyRouteHandler({
      tokens: {
        async validate() {
          return { ok: false as const, reason: "token_expired" };
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
      queue: {
        async enqueue() {
          throw new Error("not used");
        },
      },
      config: {
        default_policy_version: "rebal.greedy.v1",
        available_policy_versions: ["rebal.greedy.v1"],
        default_horizon_steps: 0,
        retry_after_ms: 2500,
        max_moves: 50,
        budget_presets: [],
      },
    });

    const runRes = await handler(
      new Request("https://example.test/api/policy/run?v=1&sv=expired&policy_version=rebal.greedy.v1&T_bucket=1738872000")
    );
    expect(runRes.status).toBe(401);
    expect(runRes.headers.get("Cache-Control")).toBe("no-store");
    const runBody = await runRes.json();
    expect(runBody.error.code).toBe("token_expired");

    const movesRes = await handler(
      new Request(
        "https://example.test/api/policy/moves?v=1&sv=expired&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(movesRes.status).toBe(401);
    expect(movesRes.headers.get("Cache-Control")).toBe("no-store");
    const movesBody = await movesRes.json();
    expect(movesBody.error.code).toBe("token_expired");
  });
});
