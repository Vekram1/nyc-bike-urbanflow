import { describe, expect, it } from "bun:test";

import { createControlPlaneHandler } from "./control-plane";

type MutableState = {
  runReady: boolean;
  runId: number;
};

describe("policy e2e via control-plane", () => {
  it("covers pending -> ready for run/moves and policy-moves tile response", async () => {
    const state: MutableState = { runReady: false, runId: 71 };
    const queued: Array<{ type: string; dedupe_key?: string; payload: unknown }> = [];
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];

    const handler = createControlPlaneHandler({
      time: {
        servingViews: {
          async mintLiveToken() {
            return {
              ok: true as const,
              sv: "sv1.kid.payload.sig",
              view_spec_sha256: "view-hash",
              view_id: 9,
            };
          },
        },
        viewStore: {
          async listWatermarks() {
            return [
              {
                system_id: "citibike-nyc",
                dataset_id: "gbfs.station_status",
                as_of_ts: new Date("2026-02-06T18:00:00Z"),
                max_observed_at: new Date("2026-02-06T17:59:30Z"),
              },
            ];
          },
        },
        config: {
          view_version: "sv.v1",
          ttl_seconds: 120,
          tile_schema_version: "tile.v1",
          severity_version: "sev.v1",
          severity_spec_sha256: "sev-hash",
          required_datasets: ["gbfs.station_status"],
          optional_datasets: ["gbfs.station_information"],
        },
        clock: () => new Date("2026-02-06T18:00:30Z"),
      },
      config: {
        bucket_size_seconds: 300,
        severity_version: "sev.v1",
        severity_legend_bins: [{ min: 0, max: 1, label: "all" }],
        map: {
          initial_center: { lon: -73.98, lat: 40.75 },
          initial_zoom: 12,
          max_bounds: { min_lon: -74.3, min_lat: 40.45, max_lon: -73.65, max_lat: 40.95 },
          min_zoom: 9,
          max_zoom: 18,
        },
        speed_presets: [1, 10, 60],
        cache_policy: { live_tile_max_age_s: 10 },
      },
      timeline: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: { system_id: "citibike-nyc", view_id: 9, view_spec_sha256: "view-hash" },
            };
          },
        },
        timelineStore: {
          async getRange() {
            return {
              min_observation_ts: "2026-02-06T00:00:00Z",
              max_observation_ts: "2026-02-06T18:00:00Z",
              live_edge_ts: "2026-02-06T18:00:00Z",
              gap_intervals: [],
            };
          },
          async getDensity() {
            return [];
          },
        },
        default_bucket_seconds: 300,
      },
      search: {
        allowlist: {
          async isAllowed() {
            return true;
          },
        },
        searchStore: {
          async searchStations() {
            return [];
          },
        },
      },
      policy: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: {
                system_id: "citibike-nyc",
                view_id: 9,
                view_spec_sha256: "view-hash",
              },
            };
          },
        } as unknown as import("../sv/service").ServingTokenService,
        allowlist: {
          async isAllowed() {
            return true;
          },
        },
        policyStore: {
          async getRunSummary() {
            if (!state.runReady) {
              return null;
            }
            return {
              run_id: state.runId,
              system_id: "citibike-nyc",
              policy_version: "rebal.greedy.v1",
              policy_spec_sha256: "policy-hash",
              sv: "sv-live",
              decision_bucket_ts: "2026-02-06T18:00:00.000Z",
              horizon_steps: 0,
              input_quality: "ok",
              status: "success" as const,
              no_op: false,
              no_op_reason: null,
              error_reason: null,
              created_at: "2026-02-06T18:00:01.000Z",
              move_count: 1,
            };
          },
          async listMoves(args) {
            expect(args.run_id).toBe(state.runId);
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
          async enqueue(args) {
            queued.push(args);
            return { ok: true as const, job_id: 501 };
          },
        },
        config: {
          default_policy_version: "rebal.greedy.v1",
          available_policy_versions: ["rebal.greedy.v1"],
          default_horizon_steps: 0,
          retry_after_ms: 2000,
          max_moves: 50,
          budget_presets: [],
        },
        logger: {
          info(event, details) {
            events.push({ event, details });
          },
          warn(event, details) {
            events.push({ event, details });
          },
        },
      },
      policyTiles: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: {
                system_id: "citibike-nyc",
                view_id: 9,
                view_spec_sha256: "view-hash",
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
          async fetchPolicyMovesTile() {
            if (!state.runReady) {
              return {
                ok: false as const,
                status: 404 as const,
                code: "policy_run_not_found",
                message: "missing",
              };
            }
            return {
              ok: true as const,
              mvt: new Uint8Array([1, 2, 3, 4]),
              feature_count: 1,
              bytes: 4,
            };
          },
        },
        cache: {
          max_age_s: 30,
          s_maxage_s: 120,
          stale_while_revalidate_s: 15,
        },
      },
    });

    const pendingRun = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=sv-live&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(pendingRun.status).toBe(202);
    expect(pendingRun.headers.get("Retry-After")).toBe("2");
    const pendingRunBody = await pendingRun.json();
    expect(pendingRunBody.status).toBe("pending");
    expect(queued.length).toBe(1);
    expect(queued[0]?.type).toBe("policy.run_v1");
    expect(queued[0]?.dedupe_key).toBe("citibike-nyc:sv-live:1738872000:rebal.greedy.v1:0");

    const pendingMoves = await handler(
      new Request(
        "https://example.test/api/policy/moves?v=1&sv=sv-live&policy_version=rebal.greedy.v1&T_bucket=1738872000&top_n=1"
      )
    );
    expect(pendingMoves.status).toBe(202);

    const pendingTile = await handler(
      new Request(
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?v=1&sv=sv-live&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(pendingTile.status).toBe(404);

    state.runReady = true;

    const readyRun = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=sv-live&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(readyRun.status).toBe(200);
    const readyRunBody = await readyRun.json();
    expect(readyRunBody.status).toBe("ready");
    expect(readyRunBody.run.policy_version).toBe("rebal.greedy.v1");

    const readyMoves = await handler(
      new Request(
        "https://example.test/api/policy/moves?v=1&sv=sv-live&policy_version=rebal.greedy.v1&T_bucket=1738872000&top_n=1"
      )
    );
    expect(readyMoves.status).toBe(200);
    const readyMovesBody = await readyMoves.json();
    expect(readyMovesBody.status).toBe("ready");
    expect(readyMovesBody.moves.length).toBe(1);

    const readyTile = await handler(
      new Request(
        "https://example.test/api/tiles/policy_moves/12/1200/1530.mvt?v=1&sv=sv-live&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(readyTile.status).toBe(200);
    expect(readyTile.headers.get("Content-Type")).toBe("application/vnd.mapbox-vector-tile");
    expect(readyTile.headers.get("Cache-Control")).toContain("max-age=30");

    expect(events.some((e) => e.event === "policy.run.pending")).toBe(true);
    expect(events.some((e) => e.event === "policy.run.ok")).toBe(true);
    expect(events.some((e) => e.event === "policy.moves.ok")).toBe(true);
  });

  it("enforces bounded query params on policy routes", async () => {
    const handler = createControlPlaneHandler({
      time: {
        servingViews: {
          async mintLiveToken() {
            return {
              ok: true as const,
              sv: "sv1.kid.payload.sig",
              view_spec_sha256: "view-hash",
              view_id: 9,
            };
          },
        },
        viewStore: {
          async listWatermarks() {
            return [];
          },
        },
        config: {
          view_version: "sv.v1",
          ttl_seconds: 120,
          tile_schema_version: "tile.v1",
          severity_version: "sev.v1",
          severity_spec_sha256: "sev-hash",
          required_datasets: ["gbfs.station_status"],
          optional_datasets: [],
        },
        clock: () => new Date("2026-02-06T18:00:30Z"),
      },
      config: {
        bucket_size_seconds: 300,
        severity_version: "sev.v1",
        severity_legend_bins: [{ min: 0, max: 1, label: "all" }],
        map: {
          initial_center: { lon: -73.98, lat: 40.75 },
          initial_zoom: 12,
          max_bounds: { min_lon: -74.3, min_lat: 40.45, max_lon: -73.65, max_lat: 40.95 },
          min_zoom: 9,
          max_zoom: 18,
        },
        speed_presets: [1, 10, 60],
        cache_policy: { live_tile_max_age_s: 10 },
      },
      timeline: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: { system_id: "citibike-nyc", view_id: 9, view_spec_sha256: "view-hash" },
            };
          },
        },
        timelineStore: {
          async getRange() {
            return {
              min_observation_ts: "2026-02-06T00:00:00Z",
              max_observation_ts: "2026-02-06T18:00:00Z",
              live_edge_ts: "2026-02-06T18:00:00Z",
              gap_intervals: [],
            };
          },
          async getDensity() {
            return [];
          },
        },
        default_bucket_seconds: 300,
      },
      search: {
        allowlist: {
          async isAllowed() {
            return true;
          },
        },
        searchStore: {
          async searchStations() {
            return [];
          },
        },
      },
      policy: {
        tokens: {
          async validate() {
            return {
              ok: true as const,
              payload: {
                system_id: "citibike-nyc",
                view_id: 9,
                view_spec_sha256: "view-hash",
              },
            };
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
          retry_after_ms: 2000,
          max_moves: 50,
          budget_presets: [],
        },
      },
    });

    const res = await handler(
      new Request(
        "https://example.test/api/policy/run?v=1&sv=sv-live&policy_version=rebal.greedy.v1&T_bucket=1738872000&foo=bar"
      )
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("unknown_param");

    const unsupportedVersionRes = await handler(
      new Request(
        "https://example.test/api/policy/run?v=2&sv=sv-live&policy_version=rebal.greedy.v1&T_bucket=1738872000"
      )
    );
    expect(unsupportedVersionRes.status).toBe(400);
    expect(unsupportedVersionRes.headers.get("Cache-Control")).toBe("no-store");
    const unsupportedVersionBody = await unsupportedVersionRes.json();
    expect(unsupportedVersionBody.error.code).toBe("unsupported_version");
  });
});
