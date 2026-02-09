import { describe, expect, it } from "bun:test";

import { PgAllowlistStore } from "../allowlist/store";
import type { SqlExecutor, SqlQueryResult } from "../db/types";
import { createControlPlaneHandler } from "./control-plane";
import { ServingTokenService } from "../sv/service";
import { PgServingTokenStore, type ServingKeyMaterialProvider } from "../sv/store";
import type { AuditEvent } from "../sv/types";
import { ServingViewService } from "../serving-views/service";
import { PgServingViewStore } from "../serving-views/store";

type NamespaceAllow = {
  kind: string;
  value: string;
  system_id: string | null;
  disabled_at: Date | null;
};

type DatasetWatermarkRow = {
  system_id: string;
  dataset_id: string;
  as_of_ts: string | null;
  as_of_text: string | null;
  max_observed_at: string | null;
  updated_at: string;
};

type ServingViewRow = {
  view_id: number;
  system_id: string;
  view_version: string;
  view_spec_sha256: string;
  view_spec_json: unknown;
};

type ServingKeyRow = {
  kid: string;
  system_id: string;
  algo: "HS256" | "HS512";
  status: "active" | "retiring" | "retired";
  valid_from: string;
  valid_to: string | null;
};

type ServingTokenRow = {
  token_sha256: string;
  system_id: string;
  view_id: number;
  view_spec_sha256: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  token_hmac_kid: string;
};

class FakeSqlDb implements SqlExecutor {
  private nextViewId = 1;
  private readonly namespaceAllowlist: NamespaceAllow[] = [];
  private readonly datasets = new Set<string>();
  private readonly datasetWatermarks = new Map<string, DatasetWatermarkRow>();
  private readonly servingViews = new Map<string, ServingViewRow>();
  private readonly servingKeys = new Map<string, ServingKeyRow>();
  private readonly servingTokens = new Map<string, ServingTokenRow>();
  private readonly audits: AuditEvent[] = [];

  seedAllowlist(kind: string, value: string, system_id: string | null): void {
    this.namespaceAllowlist.push({ kind, value, system_id, disabled_at: null });
  }

  seedWatermark(row: {
    system_id: string;
    dataset_id: string;
    as_of_ts?: string | null;
    as_of_text?: string | null;
    max_observed_at?: string | null;
    updated_at: string;
  }): void {
    const key = `${row.system_id}::${row.dataset_id}`;
    this.datasetWatermarks.set(key, {
      system_id: row.system_id,
      dataset_id: row.dataset_id,
      as_of_ts: row.as_of_ts ?? null,
      as_of_text: row.as_of_text ?? null,
      max_observed_at: row.max_observed_at ?? null,
      updated_at: row.updated_at,
    });
  }

  seedServingKey(row: ServingKeyRow): void {
    this.servingKeys.set(row.kid, row);
  }

  getAuditEvents(): AuditEvent[] {
    return this.audits;
  }

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    const sql = text.trim();

    if (sql.startsWith("SELECT allow_id") && sql.includes("FROM namespace_allowlist")) {
      const kind = params[0] as string;
      const value = params[1] as string;
      const systemId = (params[2] as string | null) ?? null;
      const allowed = this.namespaceAllowlist.some((row) => {
        if (row.kind !== kind || row.value !== value || row.disabled_at !== null) {
          return false;
        }
        if (systemId === null) {
          return row.system_id === null;
        }
        return row.system_id === null || row.system_id === systemId;
      });
      return { rows: (allowed ? [{ allow_id: 1 }] : []) as Row[] };
    }

    if (sql.startsWith("INSERT INTO datasets")) {
      const datasetId = params[0] as string;
      this.datasets.add(datasetId);
      return { rows: [] as Row[] };
    }

    if (
      sql.startsWith("SELECT system_id, dataset_id, as_of_ts, as_of_text, max_observed_at, updated_at")
      && sql.includes("FROM dataset_watermarks")
      && sql.includes("dataset_id = ANY")
    ) {
      const systemId = params[0] as string;
      const datasetIds = params[1] as string[];
      const rows: DatasetWatermarkRow[] = [];
      for (const datasetId of datasetIds) {
        const hit = this.datasetWatermarks.get(`${systemId}::${datasetId}`);
        if (hit) {
          rows.push(hit);
        }
      }
      rows.sort((a, b) => a.dataset_id.localeCompare(b.dataset_id));
      return { rows: rows as Row[] };
    }

    if (
      sql.startsWith("SELECT system_id, dataset_id, as_of_ts, as_of_text, max_observed_at, updated_at")
      && sql.includes("FROM dataset_watermarks")
      && sql.includes("dataset_id = $2")
    ) {
      const systemId = params[0] as string;
      const datasetId = params[1] as string;
      const hit = this.datasetWatermarks.get(`${systemId}::${datasetId}`);
      return { rows: (hit ? [hit] : []) as Row[] };
    }

    if (sql.startsWith("INSERT INTO serving_views")) {
      const systemId = params[0] as string;
      const viewVersion = params[1] as string;
      const viewSpecJson = JSON.parse(params[2] as string);
      const viewSpecSha = params[3] as string;
      const key = `${systemId}::${viewVersion}::${viewSpecSha}`;
      const existing = this.servingViews.get(key);
      if (existing) {
        return { rows: [existing as unknown as Row] };
      }
      const row: ServingViewRow = {
        view_id: this.nextViewId++,
        system_id: systemId,
        view_version: viewVersion,
        view_spec_sha256: viewSpecSha,
        view_spec_json: viewSpecJson,
      };
      this.servingViews.set(key, row);
      return { rows: [row as unknown as Row] };
    }

    if (
      sql.startsWith("SELECT kid, system_id, algo, status, valid_from, valid_to")
      && sql.includes("FROM serving_keys")
      && sql.includes("status = 'active'")
    ) {
      const systemId = params[0] as string;
      const now = Date.now();
      const matches = Array.from(this.servingKeys.values())
        .filter((row) => row.system_id === systemId && row.status === "active")
        .filter((row) => new Date(row.valid_from).getTime() <= now)
        .filter((row) => row.valid_to === null || new Date(row.valid_to).getTime() > now)
        .sort((a, b) => new Date(b.valid_from).getTime() - new Date(a.valid_from).getTime());
      return { rows: (matches.slice(0, 1) as unknown) as Row[] };
    }

    if (
      sql.startsWith("SELECT kid, system_id, algo, status, valid_from, valid_to")
      && sql.includes("FROM serving_keys")
      && sql.includes("WHERE kid = $1")
    ) {
      const kid = params[0] as string;
      const hit = this.servingKeys.get(kid);
      return { rows: (hit ? [hit] : []) as Row[] };
    }

    if (sql.startsWith("INSERT INTO serving_tokens")) {
      const row: ServingTokenRow = {
        token_sha256: params[0] as string,
        system_id: params[1] as string,
        view_id: params[2] as number,
        view_spec_sha256: params[3] as string,
        issued_at: new Date(params[4] as Date).toISOString(),
        expires_at: new Date(params[5] as Date).toISOString(),
        token_hmac_kid: params[6] as string,
        revoked_at: params[7] ? new Date(params[7] as Date).toISOString() : null,
      };
      if (!this.servingTokens.has(row.token_sha256)) {
        this.servingTokens.set(row.token_sha256, row);
      }
      return { rows: [] as Row[] };
    }

    if (
      sql.startsWith("SELECT token_sha256, system_id, view_id, view_spec_sha256")
      && sql.includes("FROM serving_tokens")
    ) {
      const tokenSha = params[0] as string;
      const hit = this.servingTokens.get(tokenSha);
      return { rows: (hit ? [hit] : []) as Row[] };
    }

    if (sql.startsWith("INSERT INTO serving_token_audit")) {
      this.audits.push({
        event_ts: params[0] as Date,
        event_type: params[1] as AuditEvent["event_type"],
        system_id: (params[2] as string | null) ?? undefined,
        token_hmac_kid: (params[3] as string | null) ?? undefined,
        token_sha256: (params[4] as string | null) ?? undefined,
        reason_code: (params[5] as string | null) ?? undefined,
        details: params[6] ? JSON.parse(params[6] as string) : undefined,
      });
      return { rows: [] as Row[] };
    }

    throw new Error(`Unhandled SQL in fake DB: ${sql}`);
  }
}

describe("control-plane e2e", () => {
  it("issues sv on /api/time and uses it for /api/timeline and /api/timeline/density", async () => {
    const db = new FakeSqlDb();
    db.seedAllowlist("system_id", "citibike-nyc", null);
    db.seedAllowlist("tile_schema", "tile.v1", "citibike-nyc");
    db.seedAllowlist("severity_version", "sev.v1", "citibike-nyc");
    db.seedWatermark({
      system_id: "citibike-nyc",
      dataset_id: "gbfs.station_status",
      as_of_ts: "2026-02-06T18:30:00.000Z",
      max_observed_at: "2026-02-06T18:29:30.000Z",
      updated_at: "2026-02-06T18:30:05.000Z",
    });
    db.seedServingKey({
      kid: "kid-1",
      system_id: "citibike-nyc",
      algo: "HS256",
      status: "active",
      valid_from: "2026-02-01T00:00:00.000Z",
      valid_to: null,
    });

    const keyMaterial: ServingKeyMaterialProvider = {
      async getSecret(kid, systemId) {
        if (kid === "kid-1" && systemId === "citibike-nyc") {
          return new TextEncoder().encode("test-secret");
        }
        return null;
      },
    };

    const allowlist = new PgAllowlistStore(db);
    const tokenStore = new PgServingTokenStore(db, keyMaterial);
    const tokenService = new ServingTokenService(tokenStore, () => new Date("2026-02-06T18:30:10.000Z"));
    const viewStore = new PgServingViewStore(db);
    const viewService = new ServingViewService({
      views: viewStore,
      allowlist,
      tokens: tokenService,
      tokenStore,
    });

    const handler = createControlPlaneHandler({
      time: {
        servingViews: viewService,
        viewStore,
        network: {
          async getSummary() {
            return {
              active_station_count: 100,
              empty_station_count: 12,
              full_station_count: 8,
              pct_serving_grade: 0.92,
              worst_5_station_keys_by_severity: ["s1", "s2", "s3", "s4", "s5"],
              observed_bucket_ts: "2026-02-06T18:30:00.000Z",
            };
          },
        },
        config: {
          view_version: "sv.v1",
          ttl_seconds: 120,
          tile_schema_version: "tile.v1",
          severity_version: "sev.v1",
          severity_spec_sha256: "sev-spec-hash",
          required_datasets: ["gbfs.station_status"],
          optional_datasets: [],
        },
        clock: () => new Date("2026-02-06T18:30:20.000Z"),
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
        tokens: tokenService,
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
            return [
              {
                bucket_ts: "2026-02-06T18:00:00Z",
                pct_serving_grade: 1,
                empty_rate: 0.1,
                full_rate: 0.2,
                severity_p95: 0.5,
              },
            ];
          },
        },
        default_bucket_seconds: 300,
      },
      search: {
        allowlist,
        searchStore: {
          async searchStations() {
            return [
              {
                station_key: "STA-001",
                name: "W 52 St",
                short_name: "W52",
                lat: 40.1,
                lon: -73.9,
              },
            ];
          },
        },
      },
    });

    const timeRes = await handler(new Request("https://example.test/api/time?system_id=citibike-nyc"));
    expect(timeRes.status).toBe(200);
    expect(timeRes.headers.get("Cache-Control")).toBe("no-store");
    const timeUnknownParamRes = await handler(
      new Request("https://example.test/api/time?system_id=citibike-nyc&foo=bar")
    );
    expect(timeUnknownParamRes.status).toBe(400);
    expect(timeUnknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const timeUnknownParamBody = await timeUnknownParamRes.json();
    expect(timeUnknownParamBody.error.code).toBe("unknown_param");
    const timeBody = await timeRes.json();
    expect(typeof timeBody.recommended_live_sv).toBe("string");
    expect(timeBody.network.active_station_count).toBe(100);
    expect(timeBody.network.worst_5_station_keys_by_severity).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(timeBody.network.degrade_level).toBe(0);
    expect(timeBody.network.client_should_throttle).toBe(false);
    const sv = timeBody.recommended_live_sv as string;

    const configRes = await handler(new Request("https://example.test/api/config?v=1"));
    expect(configRes.status).toBe(200);
    expect(configRes.headers.get("Cache-Control")).toBe("no-store");
    const configUnknownParamRes = await handler(new Request("https://example.test/api/config?v=1&foo=bar"));
    expect(configUnknownParamRes.status).toBe(400);
    expect(configUnknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const configUnknownParamBody = await configUnknownParamRes.json();
    expect(configUnknownParamBody.error.code).toBe("unknown_param");

    const timelineRes = await handler(
      new Request(`https://example.test/api/timeline?v=1&sv=${encodeURIComponent(sv)}`)
    );
    expect(timelineRes.status).toBe(200);
    expect(timelineRes.headers.get("Cache-Control")).toBe("no-store");
    const timelineUnknownParamRes = await handler(
      new Request(`https://example.test/api/timeline?v=1&sv=${encodeURIComponent(sv)}&foo=bar`)
    );
    expect(timelineUnknownParamRes.status).toBe(400);
    expect(timelineUnknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const timelineUnknownParamBody = await timelineUnknownParamRes.json();
    expect(timelineUnknownParamBody.error.code).toBe("unknown_param");

    const densityRes = await handler(
      new Request(`https://example.test/api/timeline/density?v=1&bucket=300&sv=${encodeURIComponent(sv)}`)
    );
    expect(densityRes.status).toBe(200);
    const densityBody = await densityRes.json();
    expect(densityBody.points.length).toBe(1);
    const densityUnknownParamRes = await handler(
      new Request(`https://example.test/api/timeline/density?v=1&bucket=300&sv=${encodeURIComponent(sv)}&foo=bar`)
    );
    expect(densityUnknownParamRes.status).toBe(400);
    expect(densityUnknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const densityUnknownParamBody = await densityUnknownParamRes.json();
    expect(densityUnknownParamBody.error.code).toBe("unknown_param");

    const searchRes = await handler(
      new Request("https://example.test/api/search?system_id=citibike-nyc&q=52")
    );
    expect(searchRes.status).toBe(200);
    expect(searchRes.headers.get("Cache-Control")).toBe("no-store");
    const searchBody = await searchRes.json();
    expect(searchBody.results.length).toBe(1);

    const searchUnknownParamRes = await handler(
      new Request("https://example.test/api/search?system_id=citibike-nyc&q=52&foo=bar")
    );
    expect(searchUnknownParamRes.status).toBe(400);
    expect(searchUnknownParamRes.headers.get("Cache-Control")).toBe("no-store");
    const searchUnknownParamBody = await searchUnknownParamRes.json();
    expect(searchUnknownParamBody.error.code).toBe("unknown_param");

    const auditEvents = db.getAuditEvents();
    expect(auditEvents.some((event) => event.event_type === "mint")).toBe(true);
    expect(auditEvents.some((event) => event.event_type === "validate_ok")).toBe(true);
  });

  it("rejects non-allowlisted search system_id with 400 + no-store", async () => {
    const handler = createControlPlaneHandler({
      time: {
        servingViews: {
          async mintLiveToken() {
            return {
              ok: true as const,
              sv: "sv1.kid.payload.sig",
              view_spec_sha256: "abc",
              view_id: 1,
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
              payload: { system_id: "citibike-nyc", view_id: 1, view_spec_sha256: "abc" },
            };
          },
        },
        timelineStore: {
          async getRange() {
            return {
              min_observation_ts: "2026-02-06T00:00:00Z",
              max_observation_ts: "2026-02-06T18:00:00Z",
              live_edge_ts: "2026-02-06T18:00:00Z",
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
            return false;
          },
        },
        searchStore: {
          async searchStations() {
            return [];
          },
        },
      },
    });

    const res = await handler(new Request("https://example.test/api/search?system_id=other&q=52"));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error.code).toBe("param_not_allowlisted");
  });

  it("covers composite tile headers and overload degrade responses", async () => {
    const db = new FakeSqlDb();
    db.seedAllowlist("system_id", "citibike-nyc", null);
    db.seedAllowlist("tile_schema", "tile.v1", "citibike-nyc");
    db.seedAllowlist("severity_version", "sev.v1", "citibike-nyc");
    db.seedAllowlist("layers_set", "inv,sev", "citibike-nyc");
    db.seedWatermark({
      system_id: "citibike-nyc",
      dataset_id: "gbfs.station_status",
      as_of_ts: "2026-02-06T18:30:00.000Z",
      max_observed_at: "2026-02-06T18:29:30.000Z",
      updated_at: "2026-02-06T18:30:05.000Z",
    });
    db.seedServingKey({
      kid: "kid-1",
      system_id: "citibike-nyc",
      algo: "HS256",
      status: "active",
      valid_from: "2026-02-01T00:00:00.000Z",
      valid_to: null,
    });

    const keyMaterial: ServingKeyMaterialProvider = {
      async getSecret(kid, systemId) {
        if (kid === "kid-1" && systemId === "citibike-nyc") {
          return new TextEncoder().encode("test-secret");
        }
        return null;
      },
    };

    const allowlist = new PgAllowlistStore(db);
    const tokenStore = new PgServingTokenStore(db, keyMaterial);
    const tokenService = new ServingTokenService(tokenStore, () => new Date("2026-02-06T18:30:10.000Z"));
    const viewStore = new PgServingViewStore(db);
    const viewService = new ServingViewService({
      views: viewStore,
      allowlist,
      tokens: tokenService,
      tokenStore,
    });

    let mode: "ok" | "overload" = "ok";
    const handler = createControlPlaneHandler({
      time: {
        servingViews: viewService,
        viewStore,
        network: {
          async getSummary() {
            return {
              active_station_count: 100,
              empty_station_count: 52,
              full_station_count: 5,
              pct_serving_grade: 0.62,
              worst_5_station_keys_by_severity: ["s1", "s2", "s3", "s4", "s5"],
              observed_bucket_ts: "2026-02-06T18:30:00.000Z",
            };
          },
        },
        config: {
          view_version: "sv.v1",
          ttl_seconds: 120,
          tile_schema_version: "tile.v1",
          severity_version: "sev.v1",
          severity_spec_sha256: "sev-spec-hash",
          required_datasets: ["gbfs.station_status"],
          optional_datasets: [],
        },
        clock: () => new Date("2026-02-06T18:30:20.000Z"),
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
        tokens: tokenService,
        timelineStore: {
          async getRange() {
            return {
              min_observation_ts: "2026-02-06T00:00:00Z",
              max_observation_ts: "2026-02-06T18:00:00Z",
              live_edge_ts: "2026-02-06T18:00:00Z",
            };
          },
          async getDensity() {
            return [];
          },
        },
        default_bucket_seconds: 300,
      },
      search: {
        allowlist,
        searchStore: {
          async searchStations() {
            return [];
          },
        },
      },
      tiles: {
        tokens: tokenService,
        allowlist,
        tileStore: {
          async fetchCompositeTile() {
            if (mode === "overload") {
              return {
                ok: false as const,
                status: 429 as const,
                code: "tile_overloaded",
                message: "degraded",
                retry_after_s: 5,
              };
            }
            return {
              ok: true as const,
              mvt: new Uint8Array([1, 2, 3]),
              feature_count: 7,
              bytes: 3,
              degrade_level: 1,
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

    const timeRes = await handler(new Request("https://example.test/api/time?system_id=citibike-nyc"));
    expect(timeRes.status).toBe(200);
    const timeBody = await timeRes.json();
    expect(timeBody.network.degrade_level).toBe(2);
    expect(timeBody.network.client_should_throttle).toBe(true);
    const sv = timeBody.recommended_live_sv as string;

    const okTile = await handler(
      new Request(
        `https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=${encodeURIComponent(sv)}&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000`
      )
    );
    expect(okTile.status).toBe(200);
    expect(okTile.headers.get("Content-Type")).toBe("application/vnd.mapbox-vector-tile");
    expect(okTile.headers.get("X-Tile-Feature-Count")).toBe("7");
    expect(okTile.headers.get("X-Tile-Bytes")).toBe("3");
    expect(okTile.headers.get("X-Tile-Degrade-Level")).toBe("1");
    expect(okTile.headers.get("Cache-Control")).toContain("max-age=30");

    mode = "overload";
    const overloaded = await handler(
      new Request(
        `https://example.test/api/tiles/composite/12/1200/1530.mvt?v=1&sv=${encodeURIComponent(sv)}&tile_schema=tile.v1&severity_version=sev.v1&layers=inv,sev&T_bucket=1738872000`
      )
    );
    expect(overloaded.status).toBe(429);
    expect(overloaded.headers.get("Retry-After")).toBe("5");
    expect(overloaded.headers.get("X-Origin-Block-Reason")).toBe("tile_overloaded");
    const body = await overloaded.json();
    expect(body.error.code).toBe("tile_overloaded");

    const configWhileOverloaded = await handler(new Request("https://example.test/api/config?v=1"));
    expect(configWhileOverloaded.status).toBe(200);
    expect(configWhileOverloaded.headers.get("Cache-Control")).toBe("no-store");
  });

  it("serves station drawer bundle with sv-bound bounded params", async () => {
    const db = new FakeSqlDb();
    db.seedAllowlist("system_id", "citibike-nyc", null);
    db.seedAllowlist("tile_schema", "tile.v1", "citibike-nyc");
    db.seedAllowlist("severity_version", "sev.v1", "citibike-nyc");
    db.seedWatermark({
      system_id: "citibike-nyc",
      dataset_id: "gbfs.station_status",
      as_of_ts: "2026-02-06T18:30:00.000Z",
      max_observed_at: "2026-02-06T18:29:30.000Z",
      updated_at: "2026-02-06T18:30:05.000Z",
    });
    db.seedServingKey({
      kid: "kid-1",
      system_id: "citibike-nyc",
      algo: "HS256",
      status: "active",
      valid_from: "2026-02-01T00:00:00.000Z",
      valid_to: null,
    });

    const keyMaterial: ServingKeyMaterialProvider = {
      async getSecret(kid, systemId) {
        if (kid === "kid-1" && systemId === "citibike-nyc") {
          return new TextEncoder().encode("test-secret");
        }
        return null;
      },
    };

    const allowlist = new PgAllowlistStore(db);
    const tokenStore = new PgServingTokenStore(db, keyMaterial);
    const tokenService = new ServingTokenService(tokenStore, () => new Date("2026-02-06T18:30:10.000Z"));
    const viewStore = new PgServingViewStore(db);
    const viewService = new ServingViewService({
      views: viewStore,
      allowlist,
      tokens: tokenService,
      tokenStore,
    });

    const drawerInfoEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    const handler = createControlPlaneHandler({
      time: {
        servingViews: viewService,
        viewStore,
        network: {
          async getSummary() {
            return {
              active_station_count: 100,
              empty_station_count: 12,
              full_station_count: 8,
              pct_serving_grade: 0.92,
              worst_5_station_keys_by_severity: ["s1", "s2", "s3", "s4", "s5"],
              observed_bucket_ts: "2026-02-06T18:30:00.000Z",
            };
          },
        },
        config: {
          view_version: "sv.v1",
          ttl_seconds: 120,
          tile_schema_version: "tile.v1",
          severity_version: "sev.v1",
          severity_spec_sha256: "sev-spec-hash",
          required_datasets: ["gbfs.station_status"],
          optional_datasets: [],
        },
        clock: () => new Date("2026-02-06T18:30:20.000Z"),
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
        tokens: tokenService,
        timelineStore: {
          async getRange() {
            return {
              min_observation_ts: "2026-02-06T00:00:00Z",
              max_observation_ts: "2026-02-06T18:00:00Z",
              live_edge_ts: "2026-02-06T18:00:00Z",
            };
          },
          async getDensity() {
            return [];
          },
        },
        default_bucket_seconds: 300,
      },
      search: {
        allowlist,
        searchStore: {
          async searchStations() {
            return [];
          },
        },
      },
      stationDrawer: {
        tokens: tokenService,
        allowlist,
        stationsStore: {
          async getStationDrawer() {
            return {
              station_key: "STA-001",
              sv: null,
              t_bucket_epoch_s: 1738872000,
              range_s: 21600,
              bucket_seconds: 300,
              severity_version: "sev.v1",
              tile_schema: "tile.v1",
              metadata: {
                name: "W 52 St",
                capacity: 40,
              },
              point_in_time: {
                bucket_ts: "2026-02-06T20:00:00Z",
                bikes_available: 12,
                docks_available: 28,
                bucket_quality: "ok",
                severity: 0.2,
                pressure_score: 0.4,
              },
              series: {
                points: [
                  {
                    bucket_ts: "2026-02-06T19:55:00Z",
                    bikes_available: 10,
                    docks_available: 30,
                    bucket_quality: "ok",
                    severity: 0.1,
                    pressure_score: 0.2,
                  },
                ],
                truncated: true,
              },
              episodes: {
                items: [
                  {
                    bucket_ts: "2026-02-06T19:45:00Z",
                    episode_type: "empty",
                    duration_minutes: 15,
                    bucket_quality: "ok",
                    episode_start_ts: "2026-02-06T19:30:00Z",
                    episode_end_ts: "2026-02-06T19:45:00Z",
                  },
                ],
                truncated: true,
              },
            };
          },
        },
        defaults: {
          severity_version: "sev.v1",
          tile_schema: "tile.v1",
          range_s: 21600,
          bucket_seconds: 300,
        },
        limits: {
          max_range_s: 172800,
          max_series_points: 360,
          max_episodes: 50,
        },
        cache: {
          max_age_s: 30,
          s_maxage_s: 120,
          stale_while_revalidate_s: 15,
        },
        logger: {
          info(event, details) {
            drawerInfoEvents.push({ event, details });
          },
          warn() {},
        },
      },
    });

    const timeRes = await handler(new Request("https://example.test/api/time?system_id=citibike-nyc"));
    expect(timeRes.status).toBe(200);
    const timeBody = await timeRes.json();
    const sv = timeBody.recommended_live_sv as string;

    const drawerRes = await handler(
      new Request(
        `https://example.test/api/stations/STA-001/drawer?v=1&sv=${encodeURIComponent(sv)}&T_bucket=1738872000&range=6h&severity_version=sev.v1&tile_schema=tile.v1`
      )
    );
    expect(drawerRes.status).toBe(200);
    expect(drawerRes.headers.get("Cache-Control")).toContain("max-age=30");
    const drawerBody = await drawerRes.json();
    expect(drawerBody.station_key).toBe("STA-001");
    expect(drawerBody.sv).toBe(sv);
    expect(drawerBody.range_s).toBe(21600);
    expect(drawerBody.point_in_time.bucket_quality).toBe("ok");
    expect(drawerBody.series.points.length).toBe(1);
    expect(drawerBody.series.points[0]?.bucket_quality).toBe("ok");
    expect(drawerBody.series.truncated).toBe(true);
    expect(drawerBody.episodes.items.length).toBe(1);
    expect(drawerBody.episodes.items[0]?.bucket_quality).toBe("ok");
    expect(drawerBody.episodes.truncated).toBe(true);
    expect(drawerInfoEvents.some((evt) => evt.event === "stations.drawer.ok")).toBe(true);
    const drawerOk = drawerInfoEvents.find((evt) => evt.event === "stations.drawer.ok");
    expect(drawerOk?.details.station_key).toBe("STA-001");
    expect(drawerOk?.details.sv).toBe(sv);
    expect(Number(drawerOk?.details.payload_bytes)).toBeGreaterThan(0);

    const tooWideRes = await handler(
      new Request(
        `https://example.test/api/stations/STA-001/drawer?v=1&sv=${encodeURIComponent(sv)}&T_bucket=1738872000&range=72h&severity_version=sev.v1&tile_schema=tile.v1`
      )
    );
    expect(tooWideRes.status).toBe(400);
    const tooWideBody = await tooWideRes.json();
    expect(tooWideBody.error.code).toBe("invalid_range");
    expect(tooWideRes.headers.get("Cache-Control")).toBe("no-store");

    const unknownParamRes = await handler(
      new Request(
        `https://example.test/api/stations/STA-001/drawer?v=1&sv=${encodeURIComponent(sv)}&T_bucket=1738872000&range=6h&severity_version=sev.v1&tile_schema=tile.v1&extra=x`
      )
    );
    expect(unknownParamRes.status).toBe(400);
    const unknownParamBody = await unknownParamRes.json();
    expect(unknownParamBody.error.code).toBe("unknown_param");
    expect(unknownParamRes.headers.get("Cache-Control")).toBe("no-store");

    const invalidBucketRes = await handler(
      new Request(
        `https://example.test/api/stations/STA-001/drawer?v=1&sv=${encodeURIComponent(sv)}&T_bucket=not-an-int&range=6h&severity_version=sev.v1&tile_schema=tile.v1`
      )
    );
    expect(invalidBucketRes.status).toBe(400);
    const invalidBucketBody = await invalidBucketRes.json();
    expect(invalidBucketBody.error.code).toBe("invalid_t_bucket");
    expect(invalidBucketRes.headers.get("Cache-Control")).toBe("no-store");

    const drawerMethodRes = await handler(
      new Request(
        `https://example.test/api/stations/STA-001/drawer?v=1&sv=${encodeURIComponent(sv)}&T_bucket=1738872000&range=6h&severity_version=sev.v1&tile_schema=tile.v1`,
        { method: "POST" }
      )
    );
    expect(drawerMethodRes.status).toBe(405);
    expect(drawerMethodRes.headers.get("Cache-Control")).toBe("no-store");
    const drawerMethodBody = await drawerMethodRes.json();
    expect(drawerMethodBody.error.code).toBe("method_not_allowed");
  });

  it("serves station detail and series endpoints with sv-bound params", async () => {
    const db = new FakeSqlDb();
    db.seedAllowlist("system_id", "citibike-nyc", null);
    db.seedAllowlist("tile_schema", "tile.v1", "citibike-nyc");
    db.seedAllowlist("severity_version", "sev.v1", "citibike-nyc");
    db.seedWatermark({
      system_id: "citibike-nyc",
      dataset_id: "gbfs.station_status",
      as_of_ts: "2026-02-06T18:30:00.000Z",
      max_observed_at: "2026-02-06T18:29:30.000Z",
      updated_at: "2026-02-06T18:30:05.000Z",
    });
    db.seedServingKey({
      kid: "kid-1",
      system_id: "citibike-nyc",
      algo: "HS256",
      status: "active",
      valid_from: "2026-02-01T00:00:00.000Z",
      valid_to: null,
    });

    const keyMaterial: ServingKeyMaterialProvider = {
      async getSecret(kid, systemId) {
        if (kid === "kid-1" && systemId === "citibike-nyc") {
          return new TextEncoder().encode("test-secret");
        }
        return null;
      },
    };

    const allowlist = new PgAllowlistStore(db);
    const tokenStore = new PgServingTokenStore(db, keyMaterial);
    const tokenService = new ServingTokenService(tokenStore, () => new Date("2026-02-06T18:30:10.000Z"));
    const viewStore = new PgServingViewStore(db);
    const viewService = new ServingViewService({
      views: viewStore,
      allowlist,
      tokens: tokenService,
      tokenStore,
    });

    const stationInfoEvents: Array<{ event: string; details: Record<string, unknown> }> = [];
    const handler = createControlPlaneHandler({
      time: {
        servingViews: viewService,
        viewStore,
        network: {
          async getSummary() {
            return {
              active_station_count: 100,
              empty_station_count: 12,
              full_station_count: 8,
              pct_serving_grade: 0.92,
              worst_5_station_keys_by_severity: ["s1", "s2", "s3", "s4", "s5"],
              observed_bucket_ts: "2026-02-06T18:30:00.000Z",
            };
          },
        },
        config: {
          view_version: "sv.v1",
          ttl_seconds: 120,
          tile_schema_version: "tile.v1",
          severity_version: "sev.v1",
          severity_spec_sha256: "sev-spec-hash",
          required_datasets: ["gbfs.station_status"],
          optional_datasets: [],
        },
        clock: () => new Date("2026-02-06T18:30:20.000Z"),
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
        tokens: tokenService,
        timelineStore: {
          async getRange() {
            return {
              min_observation_ts: "2026-02-06T00:00:00Z",
              max_observation_ts: "2026-02-06T18:00:00Z",
              live_edge_ts: "2026-02-06T18:00:00Z",
            };
          },
          async getDensity() {
            return [];
          },
        },
        default_bucket_seconds: 300,
      },
      search: {
        allowlist,
        searchStore: {
          async searchStations() {
            return [];
          },
        },
      },
      stations: {
        tokens: tokenService,
        stationsStore: {
          async getStationDetail() {
            return {
              station_key: "STA-001",
              name: "W 52 St",
              capacity: 40,
              bikes_available: 12,
              docks_available: 28,
              bucket_quality: "ok",
            };
          },
          async getStationSeries() {
            return [
              {
                bucket_ts: "2026-02-06T20:00:00Z",
                bikes_available: 12,
                docks_available: 28,
                bucket_quality: "ok",
                severity: 0.2,
                pressure_score: 0.4,
              },
            ];
          },
        },
        default_bucket_seconds: 300,
        max_series_window_s: 7 * 24 * 60 * 60,
        max_series_points: 1000,
        logger: {
          info(event, details) {
            stationInfoEvents.push({ event, details });
          },
          warn() {},
        },
      },
    });

    const timeRes = await handler(new Request("https://example.test/api/time?system_id=citibike-nyc"));
    expect(timeRes.status).toBe(200);
    const sv = (await timeRes.json()).recommended_live_sv as string;

    const detailRes = await handler(
      new Request(`https://example.test/api/stations/STA-001?sv=${encodeURIComponent(sv)}`)
    );
    expect(detailRes.status).toBe(200);
    expect(detailRes.headers.get("Cache-Control")).toBe("no-store");
    const detailBody = await detailRes.json();
    expect(detailBody.station_key).toBe("STA-001");
    expect(detailBody.bucket_quality).toBe("ok");

    const seriesRes = await handler(
      new Request(
        `https://example.test/api/stations/STA-001/series?sv=${encodeURIComponent(sv)}&from=1738872000&to=1738875600&bucket=300`
      )
    );
    expect(seriesRes.status).toBe(200);
    expect(seriesRes.headers.get("Cache-Control")).toBe("no-store");
    const seriesBody = await seriesRes.json();
    expect(seriesBody.station_key).toBe("STA-001");
    expect(seriesBody.points.length).toBe(1);
    expect(seriesBody.points[0]?.bucket_quality).toBe("ok");
    const detailOk = stationInfoEvents.find((evt) => evt.event === "stations.detail.ok");
    const seriesOk = stationInfoEvents.find((evt) => evt.event === "stations.series.ok");
    expect(detailOk).toBeTruthy();
    expect(seriesOk).toBeTruthy();
    expect(detailOk?.details.station_key).toBe("STA-001");
    expect(seriesOk?.details.station_key).toBe("STA-001");
    expect(detailOk?.details.sv).toBe(sv);
    expect(seriesOk?.details.sv).toBe(sv);
    expect(Number(detailOk?.details.payload_bytes)).toBeGreaterThan(0);
    expect(Number(seriesOk?.details.payload_bytes)).toBeGreaterThan(0);

    const detailMethodRes = await handler(
      new Request(`https://example.test/api/stations/STA-001?sv=${encodeURIComponent(sv)}`, {
        method: "POST",
      })
    );
    expect(detailMethodRes.status).toBe(405);
    expect(detailMethodRes.headers.get("Cache-Control")).toBe("no-store");
    const detailMethodBody = await detailMethodRes.json();
    expect(detailMethodBody.error.code).toBe("method_not_allowed");

    const seriesMethodRes = await handler(
      new Request(
        `https://example.test/api/stations/STA-001/series?sv=${encodeURIComponent(sv)}&from=1738872000&to=1738875600&bucket=300`,
        { method: "POST" }
      )
    );
    expect(seriesMethodRes.status).toBe(405);
    expect(seriesMethodRes.headers.get("Cache-Control")).toBe("no-store");
    const seriesMethodBody = await seriesMethodRes.json();
    expect(seriesMethodBody.error.code).toBe("method_not_allowed");
  });

  it("rejects unknown query params on admin endpoints with 400 + no-store", async () => {
    const handler = createControlPlaneHandler({
      time: {
        servingViews: {
          async mintLiveToken() {
            return {
              ok: true as const,
              sv: "sv1.kid.payload.sig",
              view_spec_sha256: "abc",
              view_id: 1,
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
              payload: { system_id: "citibike-nyc", view_id: 1, view_spec_sha256: "abc" },
            };
          },
        },
        timelineStore: {
          async getRange() {
            return {
              min_observation_ts: "2026-02-06T00:00:00Z",
              max_observation_ts: "2026-02-06T18:00:00Z",
              live_edge_ts: "2026-02-06T18:00:00Z",
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
      admin: {
        auth: {
          admin_token: "secret-token",
          allowed_origins: [],
        },
        config: {
          default_system_id: "citibike-nyc",
        },
        store: {
          async getPipelineState() {
            return {
              queue_depth: 0,
              dlq_depth: 0,
              feeds: [],
              degrade_history: [],
            };
          },
          async listDlq() {
            return [];
          },
          async resolveDlq() {
            return true;
          },
        },
      },
    });

    const pipelineUnknownRes = await handler(
      new Request("https://example.test/api/pipeline_state?v=1&foo=bar", {
        headers: { "X-Admin-Token": "secret-token" },
      })
    );
    expect(pipelineUnknownRes.status).toBe(400);
    expect(pipelineUnknownRes.headers.get("Cache-Control")).toBe("no-store");
    const pipelineUnknownBody = await pipelineUnknownRes.json();
    expect(pipelineUnknownBody.error.code).toBe("unknown_param");

    const dlqUnknownRes = await handler(
      new Request("https://example.test/api/admin/dlq?v=1&limit=20&foo=bar", {
        headers: { "X-Admin-Token": "secret-token" },
      })
    );
    expect(dlqUnknownRes.status).toBe(400);
    expect(dlqUnknownRes.headers.get("Cache-Control")).toBe("no-store");
    const dlqUnknownBody = await dlqUnknownRes.json();
    expect(dlqUnknownBody.error.code).toBe("unknown_param");

    const resolveUnknownRes = await handler(
      new Request("https://example.test/api/admin/dlq/resolve?v=1&foo=bar", {
        method: "POST",
        headers: { "X-Admin-Token": "secret-token", "Content-Type": "application/json" },
        body: JSON.stringify({ dlq_id: 1, resolution_note: "ok" }),
      })
    );
    expect(resolveUnknownRes.status).toBe(400);
    expect(resolveUnknownRes.headers.get("Cache-Control")).toBe("no-store");
    const resolveUnknownBody = await resolveUnknownRes.json();
    expect(resolveUnknownBody.error.code).toBe("unknown_param");
  });
});
