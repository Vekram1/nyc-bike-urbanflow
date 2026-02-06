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
    const timeBody = await timeRes.json();
    expect(typeof timeBody.recommended_live_sv).toBe("string");
    const sv = timeBody.recommended_live_sv as string;

    const configRes = await handler(new Request("https://example.test/api/config?v=1"));
    expect(configRes.status).toBe(200);
    expect(configRes.headers.get("Cache-Control")).toBe("no-store");

    const timelineRes = await handler(
      new Request(`https://example.test/api/timeline?v=1&sv=${encodeURIComponent(sv)}`)
    );
    expect(timelineRes.status).toBe(200);
    expect(timelineRes.headers.get("Cache-Control")).toBe("no-store");

    const densityRes = await handler(
      new Request(`https://example.test/api/timeline/density?v=1&bucket=300&sv=${encodeURIComponent(sv)}`)
    );
    expect(densityRes.status).toBe(200);
    const densityBody = await densityRes.json();
    expect(densityBody.points.length).toBe(1);

    const searchRes = await handler(
      new Request("https://example.test/api/search?system_id=citibike-nyc&q=52")
    );
    expect(searchRes.status).toBe(200);
    expect(searchRes.headers.get("Cache-Control")).toBe("no-store");
    const searchBody = await searchRes.json();
    expect(searchBody.results.length).toBe(1);

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
});
