/// <reference path="./runtime-shims.d.ts" />

import { SQL } from "bun";

import { PgAllowlistStore } from "./allowlist/store";
import type { SqlExecutor, SqlQueryResult } from "./db/types";
import { createControlPlaneHandler } from "./http/control-plane";
import { PgJobQueue } from "./jobs/queue";
import { PgPolicyReadStore } from "./policy/store";
import { ServingViewService } from "./serving-views/service";
import { PgServingViewStore } from "./serving-views/store";
import { PgStationsStore } from "./stations/store";
import { ServingTokenService } from "./sv/service";
import { PgServingTokenStore, type ServingKeyMaterialProvider } from "./sv/store";
import { createCompositeTileStore } from "./tiles/composite";
import { createEpisodesTileStore } from "./tiles/episodes";
import { createPolicyMovesTileStore } from "./tiles/policy_moves";
import { FileReplayTileCache } from "./tiles/replay_cache";

type EnvConfig = {
  port: number;
  host: string;
  system_id: string;
  db_url: string;
  view_version: string;
  sv_ttl_seconds: number;
  sv_clock_skew_seconds: number;
  tile_schema_version: string;
  severity_version: string;
  severity_spec_sha256: string;
  required_datasets: string[];
  optional_datasets: string[];
  timeline_bucket_seconds: number;
  tile_max_features: number;
  tile_max_bytes: number;
  tile_live_max_age_s: number;
  tile_live_s_maxage_s: number;
  tile_live_swr_s: number;
  tile_replay_min_ttl_s: number;
  tile_replay_max_age_s: number;
  tile_replay_s_maxage_s: number;
  tile_replay_swr_s: number;
  tile_compare_max_window_s: number;
  policy_retry_after_ms: number;
  policy_default_version: string;
  policy_available_versions: string[];
  policy_default_horizon_steps: number;
  policy_max_moves: number;
  key_material_json: string;
  network_degrade_level: number | null;
  replay_tile_cache_dir: string | null;
  admin_token: string | null;
  admin_allowed_origins: string[];
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Invalid integer env ${name}: ${raw}`);
  }
  return n;
}

function parseCsv(raw: string | undefined, fallback: string[]): string[] {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseOptionalIntEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Invalid integer env ${name}: ${raw}`);
  }
  return n;
}

function loadConfig(): EnvConfig {
  const db_url = process.env.DATABASE_URL?.trim() ?? "";
  if (!db_url) {
    throw new Error("Missing DATABASE_URL");
  }

  return {
    port: parseIntEnv("API_PORT", 3000),
    host: process.env.API_HOST?.trim() || "0.0.0.0",
    system_id: process.env.SYSTEM_ID?.trim() || "citibike-nyc",
    db_url,
    view_version: process.env.SV_VIEW_VERSION?.trim() || "sv.v1",
    sv_ttl_seconds: parseIntEnv("SV_TTL_SECONDS", 1200),
    sv_clock_skew_seconds: parseIntEnv("SV_CLOCK_SKEW_SECONDS", 30),
    tile_schema_version: process.env.TILE_SCHEMA_VERSION?.trim() || "tile.v1",
    severity_version: process.env.SEVERITY_VERSION?.trim() || "sev.v1",
    severity_spec_sha256: process.env.SEVERITY_SPEC_SHA256?.trim() || "sev.v1.default",
    required_datasets: parseCsv(process.env.REQUIRED_DATASETS, ["gbfs.station_status"]),
    optional_datasets: parseCsv(process.env.OPTIONAL_DATASETS, ["gbfs.station_information"]),
    timeline_bucket_seconds: parseIntEnv("TIMELINE_BUCKET_SECONDS", 300),
    tile_max_features: parseIntEnv("TILE_MAX_FEATURES", 1500),
    tile_max_bytes: parseIntEnv("TILE_MAX_BYTES", 200000),
    tile_live_max_age_s: parseIntEnv("TILE_LIVE_MAX_AGE_S", 30),
    tile_live_s_maxage_s: parseIntEnv("TILE_LIVE_S_MAXAGE_S", 120),
    tile_live_swr_s: parseIntEnv("TILE_LIVE_SWR_S", 15),
    tile_replay_min_ttl_s: parseIntEnv("TILE_REPLAY_MIN_TTL_S", 86400),
    tile_replay_max_age_s: parseIntEnv("TILE_REPLAY_MAX_AGE_S", 600),
    tile_replay_s_maxage_s: parseIntEnv("TILE_REPLAY_S_MAXAGE_S", 3600),
    tile_replay_swr_s: parseIntEnv("TILE_REPLAY_SWR_S", 60),
    tile_compare_max_window_s: parseIntEnv("TILE_COMPARE_MAX_WINDOW_S", 7 * 24 * 60 * 60),
    policy_retry_after_ms: parseIntEnv("POLICY_RETRY_AFTER_MS", 2000),
    policy_default_version: process.env.POLICY_DEFAULT_VERSION?.trim() || "rebal.greedy.v1",
    policy_available_versions: parseCsv(process.env.POLICY_AVAILABLE_VERSIONS, ["rebal.greedy.v1"]),
    policy_default_horizon_steps: parseIntEnv("POLICY_DEFAULT_HORIZON_STEPS", 0),
    policy_max_moves: parseIntEnv("POLICY_MAX_MOVES", 80),
    key_material_json: process.env.SV_KEY_MATERIAL_JSON?.trim() || "{}",
    network_degrade_level: parseOptionalIntEnv("NETWORK_DEGRADE_LEVEL"),
    replay_tile_cache_dir: process.env.REPLAY_TILE_CACHE_DIR?.trim() || null,
    admin_token: process.env.ADMIN_TOKEN?.trim() || null,
    admin_allowed_origins: parseCsv(process.env.ADMIN_ALLOWED_ORIGINS, []),
  };
}

class BunSqlExecutor implements SqlExecutor {
  private readonly sql: SQL;

  constructor(db_url: string) {
    this.sql = new SQL(db_url);
  }

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    const out = await this.sql.unsafe(text, params);
    return { rows: out as Row[] };
  }
}

class EnvServingKeyMaterialProvider implements ServingKeyMaterialProvider {
  private readonly secretsByKid = new Map<string, Uint8Array>();

  constructor(keyMaterialJson: string) {
    const parsed = JSON.parse(keyMaterialJson) as Record<string, string>;
    for (const [kid, rawSecret] of Object.entries(parsed)) {
      if (!kid || !rawSecret) {
        continue;
      }
      // Secret value is expected as plain UTF-8 string.
      this.secretsByKid.set(kid, new TextEncoder().encode(rawSecret));
    }
  }

  async getSecret(kid: string, _systemId: string): Promise<Uint8Array | null> {
    return this.secretsByKid.get(kid) ?? null;
  }
}

function buildTimelineStore(db: SqlExecutor) {
  return {
    async getRange(args: { system_id: string; view_id: number }) {
      const out = await db.query<{
        min_observation_ts: string | null;
        max_observation_ts: string | null;
      }>(
        `WITH bucket_counts AS (
           SELECT bucket_ts, COUNT(*)::int AS station_count
           FROM station_status_1m
           WHERE system_id = $1
           GROUP BY bucket_ts
         ),
         active_buckets AS (
           SELECT bucket_ts
           FROM bucket_counts
           WHERE station_count >= 100
         )
         SELECT
           MIN(bucket_ts)::text AS min_observation_ts,
           MAX(bucket_ts)::text AS max_observation_ts
         FROM active_buckets`,
        [args.system_id]
      );
      const row = out.rows[0];
      const minTs = row?.min_observation_ts ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const maxTs = row?.max_observation_ts ?? minTs;
      return {
        min_observation_ts: minTs,
        max_observation_ts: maxTs,
        live_edge_ts: maxTs,
        gap_intervals: [],
      };
    },

    async getDensity(args: { system_id: string; view_id: number; bucket_seconds: number }) {
      const out = await db.query<{
        bucket_ts: string;
        pct_serving_grade: number | string;
        empty_rate: number | string;
        full_rate: number | string;
        severity_p95: number | string | null;
      }>(
        `WITH bucketed AS (
           SELECT
             date_bin(($2::text || ' seconds')::interval, s.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket_ts,
             s.is_serving_grade,
             s.bikes_available = 0 AS is_empty,
             s.docks_available = 0 AS is_full
           FROM station_status_1m s
           WHERE s.system_id = $1
         ),
         sev AS (
           SELECT
             date_bin(($2::text || ' seconds')::interval, ss.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket_ts,
             PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ss.severity) AS severity_p95
           FROM station_severity_5m ss
           WHERE ss.system_id = $1
           GROUP BY 1
         )
         SELECT
           b.bucket_ts::text,
           AVG(CASE WHEN b.is_serving_grade THEN 1.0 ELSE 0.0 END) AS pct_serving_grade,
           AVG(CASE WHEN b.is_empty THEN 1.0 ELSE 0.0 END) AS empty_rate,
           AVG(CASE WHEN b.is_full THEN 1.0 ELSE 0.0 END) AS full_rate,
           s.severity_p95
         FROM bucketed b
         LEFT JOIN sev s ON s.bucket_ts = b.bucket_ts
         GROUP BY b.bucket_ts, s.severity_p95
         ORDER BY b.bucket_ts ASC`,
        [args.system_id, args.bucket_seconds]
      );
      return out.rows.map((row) => ({
        bucket_ts: row.bucket_ts,
        pct_serving_grade: Number(row.pct_serving_grade),
        empty_rate: Number(row.empty_rate),
        full_rate: Number(row.full_rate),
        severity_p95: row.severity_p95 === null ? undefined : Number(row.severity_p95),
      }));
    },
  };
}

function buildSearchStore(db: SqlExecutor) {
  return {
    async searchStations(args: {
      system_id: string;
      q: string;
      bbox?: { min_lon: number; min_lat: number; max_lon: number; max_lat: number };
      limit: number;
    }) {
      const hasBbox = Boolean(args.bbox);
      const out = await db.query<{
        station_key: string;
        name: string;
        short_name: string | null;
        lat: number | string;
        lon: number | string;
      }>(
        `SELECT
           station_key,
           name,
           short_name,
           lat,
           lon
         FROM stations_current
         WHERE system_id = $1
           AND (
             name ILIKE ('%' || $2 || '%')
             OR station_key ILIKE ('%' || $2 || '%')
             OR COALESCE(short_name, '') ILIKE ('%' || $2 || '%')
           )
           AND (
             $3::boolean = false
             OR (
               lon >= $4::double precision
               AND lat >= $5::double precision
               AND lon <= $6::double precision
               AND lat <= $7::double precision
             )
           )
         ORDER BY name ASC
         LIMIT $8`,
        [
          args.system_id,
          args.q,
          hasBbox,
          args.bbox?.min_lon ?? 0,
          args.bbox?.min_lat ?? 0,
          args.bbox?.max_lon ?? 0,
          args.bbox?.max_lat ?? 0,
          args.limit,
        ]
      );
      return out.rows.map((row) => ({
        station_key: row.station_key,
        name: row.name,
        short_name: row.short_name ?? undefined,
        lat: Number(row.lat),
        lon: Number(row.lon),
      }));
    },
  };
}

function buildServingViewBindings(db: SqlExecutor) {
  return {
    async getPressureBinding(args: { system_id: string; view_id: number; view_spec_sha256: string }) {
      const out = await db.query<{
        trips_baseline_id: string | null;
        trips_baseline_sha256: string | null;
      }>(
        `SELECT
           view_spec_json->>'trips_baseline_id' AS trips_baseline_id,
           view_spec_json->>'trips_baseline_sha256' AS trips_baseline_sha256
         FROM serving_views
         WHERE view_id = $1
           AND system_id = $2
           AND view_spec_sha256 = $3
         LIMIT 1`,
        [args.view_id, args.system_id, args.view_spec_sha256]
      );
      const row = out.rows[0];
      if (!row) {
        return null;
      }
      return {
        trips_baseline_id: row.trips_baseline_id ?? undefined,
        trips_baseline_sha256: row.trips_baseline_sha256 ?? undefined,
      };
    },

    async getEpisodeBinding(args: { system_id: string; view_id: number; view_spec_sha256: string }) {
      const out = await db.query<{ severity_version: string | null }>(
        `SELECT view_spec_json->>'severity_version' AS severity_version
         FROM serving_views
         WHERE view_id = $1
           AND system_id = $2
           AND view_spec_sha256 = $3
         LIMIT 1`,
        [args.view_id, args.system_id, args.view_spec_sha256]
      );
      const row = out.rows[0];
      if (!row) {
        return null;
      }
      return { severity_version: row.severity_version ?? undefined };
    },
  };
}

function buildNetworkHealthStore(db: SqlExecutor, degradeLevelOverride: number | null) {
  return {
    async getSummary(args: { system_id: string }) {
      const counts = await db.query<{
        bucket_ts: string | null;
        active_station_count: number | string;
        empty_station_count: number | string;
        full_station_count: number | string;
        pct_serving_grade: number | string | null;
      }>(
        `WITH latest AS (
           SELECT MAX(bucket_ts) AS bucket_ts
           FROM station_status_1m
           WHERE system_id = $1
         )
         SELECT
           l.bucket_ts::text AS bucket_ts,
           COUNT(*) AS active_station_count,
           COUNT(*) FILTER (WHERE s.bikes_available = 0) AS empty_station_count,
           COUNT(*) FILTER (WHERE s.docks_available = 0) AS full_station_count,
           AVG(CASE WHEN s.is_serving_grade THEN 1.0 ELSE 0.0 END) AS pct_serving_grade
         FROM latest l
         JOIN station_status_1m s
           ON s.system_id = $1
          AND s.bucket_ts = l.bucket_ts
         GROUP BY l.bucket_ts`,
        [args.system_id]
      );
      const row = counts.rows[0];
      const activeStationCount = row ? Number(row.active_station_count) : 0;
      const emptyStationCount = row ? Number(row.empty_station_count) : 0;
      const fullStationCount = row ? Number(row.full_station_count) : 0;
      const pctServingGrade = row && row.pct_serving_grade !== null ? Number(row.pct_serving_grade) : 0;

      const worst = await db.query<{ station_key: string }>(
        `WITH latest AS (
           SELECT MAX(bucket_ts) AS bucket_ts
           FROM station_severity_5m
           WHERE system_id = $1
         )
         SELECT s.station_key
         FROM latest l
         JOIN station_severity_5m s
           ON s.system_id = $1
          AND s.bucket_ts = l.bucket_ts
         ORDER BY s.severity DESC, s.station_key ASC
         LIMIT 5`,
        [args.system_id]
      );

      return {
        active_station_count: activeStationCount,
        empty_station_count: emptyStationCount,
        full_station_count: fullStationCount,
        pct_serving_grade: pctServingGrade,
        worst_5_station_keys_by_severity: worst.rows.map((r) => r.station_key),
        observed_bucket_ts: row?.bucket_ts ?? null,
        degrade_level: degradeLevelOverride ?? undefined,
        client_should_throttle: degradeLevelOverride === null ? undefined : degradeLevelOverride >= 1,
      };
    },
  };
}

function deriveDegradeLevelFromSummary(summary: {
  active_station_count: number;
  empty_station_count: number;
  full_station_count: number;
  pct_serving_grade: number;
}): number {
  if (summary.active_station_count <= 0) {
    return 3;
  }
  const serving = Math.max(0, Math.min(1, summary.pct_serving_grade));
  const pressure = Math.max(
    0,
    Math.min(1, (summary.empty_station_count + summary.full_station_count) / summary.active_station_count)
  );
  if (serving < 0.5 || pressure > 0.7) {
    return 3;
  }
  if (serving < 0.7 || pressure > 0.5) {
    return 2;
  }
  if (serving < 0.85 || pressure > 0.35) {
    return 1;
  }
  return 0;
}

function buildAdminOpsStore(db: SqlExecutor, degradeLevelOverride: number | null) {
  return {
    async getPipelineState(args: { system_id: string }) {
      const queue = await db.query<{
        queue_depth: number | string;
        dlq_depth: number | string;
      }>(
        `WITH q AS (
           SELECT COUNT(*) AS queue_depth FROM job_queue
         ),
         d AS (
           SELECT COUNT(*) AS dlq_depth
           FROM job_dlq d
           LEFT JOIN job_dlq_resolution r ON r.dlq_id = d.dlq_id
           WHERE r.dlq_id IS NULL
         )
         SELECT q.queue_depth, d.dlq_depth
         FROM q, d`,
        []
      );
      const feeds = await db.query<{ dataset_id: string; last_success_at: string }>(
        `SELECT dataset_id, MAX(updated_at)::text AS last_success_at
         FROM dataset_watermarks
         WHERE system_id = $1
         GROUP BY dataset_id
         ORDER BY dataset_id`,
        [args.system_id]
      );
      const history = await db.query<{
        bucket_ts: string;
        active_station_count: number | string;
        empty_station_count: number | string;
        full_station_count: number | string;
        pct_serving_grade: number | string;
      }>(
        `SELECT
           date_bin('5 minutes'::interval, s.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')::text AS bucket_ts,
           COUNT(*) AS active_station_count,
           COUNT(*) FILTER (WHERE s.bikes_available = 0) AS empty_station_count,
           COUNT(*) FILTER (WHERE s.docks_available = 0) AS full_station_count,
           AVG(CASE WHEN s.is_serving_grade THEN 1.0 ELSE 0.0 END) AS pct_serving_grade
         FROM station_status_1m s
         WHERE s.system_id = $1
           AND s.bucket_ts >= NOW() - INTERVAL '1 hour'
         GROUP BY 1
         ORDER BY 1`,
        [args.system_id]
      );
      return {
        queue_depth: Number(queue.rows[0]?.queue_depth ?? 0),
        dlq_depth: Number(queue.rows[0]?.dlq_depth ?? 0),
        feeds: feeds.rows.map((row) => ({
          dataset_id: row.dataset_id,
          last_success_at: row.last_success_at,
        })),
        degrade_history: history.rows.map((row) => {
          const summary = {
            active_station_count: Number(row.active_station_count),
            empty_station_count: Number(row.empty_station_count),
            full_station_count: Number(row.full_station_count),
            pct_serving_grade: Number(row.pct_serving_grade),
          };
          const degradeLevel =
            degradeLevelOverride === null ? deriveDegradeLevelFromSummary(summary) : degradeLevelOverride;
          return {
            bucket_ts: row.bucket_ts,
            degrade_level: degradeLevel,
            client_should_throttle: degradeLevel >= 1,
          };
        }),
      };
    },

    async listDlq(args: { limit: number; include_resolved: boolean }) {
      const out = await db.query<{
        dlq_id: number;
        job_id: number;
        type: string;
        reason_code: string;
        failed_at: string;
        attempts: number | string;
        max_attempts: number | string;
        payload_json: unknown;
        resolved_at: string | null;
        resolution_note: string | null;
        resolved_by: string | null;
      }>(
        `SELECT
           d.dlq_id,
           d.job_id,
           d.type,
           d.reason_code,
           d.failed_at::text,
           d.attempts,
           d.max_attempts,
           d.payload_json,
           r.resolved_at::text AS resolved_at,
           r.resolution_note,
           r.resolved_by
         FROM job_dlq d
         LEFT JOIN job_dlq_resolution r ON r.dlq_id = d.dlq_id
         WHERE ($1::boolean = true OR r.dlq_id IS NULL)
         ORDER BY d.failed_at DESC
         LIMIT $2`,
        [args.include_resolved, args.limit]
      );
      return out.rows.map((row) => ({
        dlq_id: row.dlq_id,
        job_id: row.job_id,
        type: row.type,
        reason_code: row.reason_code,
        failed_at: row.failed_at,
        attempts: Number(row.attempts),
        max_attempts: Number(row.max_attempts),
        payload_summary: JSON.stringify(row.payload_json),
        resolved_at: row.resolved_at,
        resolution_note: row.resolution_note,
        resolved_by: row.resolved_by,
      }));
    },

    async resolveDlq(args: { dlq_id: number; resolution_note: string; resolved_by?: string | null }) {
      const exists = await db.query<{ dlq_id: number }>(
        `SELECT dlq_id
         FROM job_dlq
         WHERE dlq_id = $1
         LIMIT 1`,
        [args.dlq_id]
      );
      if (!exists.rows[0]) {
        return false;
      }
      await db.query(
        `INSERT INTO job_dlq_resolution (dlq_id, resolution_note, resolved_by, resolved_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (dlq_id) DO UPDATE
           SET resolution_note = EXCLUDED.resolution_note,
               resolved_by = EXCLUDED.resolved_by,
               resolved_at = NOW()`,
        [args.dlq_id, args.resolution_note, args.resolved_by ?? null]
      );
      return true;
    },
  };
}

function parseBudgetPresets(jsonRaw: string | undefined) {
  if (!jsonRaw || jsonRaw.trim().length === 0) {
    return [];
  }
  return JSON.parse(jsonRaw) as Array<{
    key: string;
    max_bikes_per_move: number;
    max_total_bikes_moved: number;
    max_stations_touched: number;
    max_total_distance_m: number;
  }>;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = new BunSqlExecutor(cfg.db_url);
  const allowlist = new PgAllowlistStore(db);
  const keyMaterial = new EnvServingKeyMaterialProvider(cfg.key_material_json);
  const tokenStore = new PgServingTokenStore(db, keyMaterial);
  const tokenService = new ServingTokenService(tokenStore, () => new Date(), {
    clockSkewSeconds: cfg.sv_clock_skew_seconds,
  });
  const viewStore = new PgServingViewStore(db);
  const viewService = new ServingViewService({
    views: viewStore,
    allowlist,
    tokens: tokenService,
    tokenStore,
  });

  const bindings = buildServingViewBindings(db);
  const timelineStore = buildTimelineStore(db);
  const searchStore = buildSearchStore(db);
  const networkStore = buildNetworkHealthStore(db, cfg.network_degrade_level);
  const adminStore = buildAdminOpsStore(db, cfg.network_degrade_level);
  const stationsStore = new PgStationsStore(db);
  const policyStore = new PgPolicyReadStore(db);
  const queue = new PgJobQueue(db);
  const tileStore = createCompositeTileStore({
    db,
    max_features_per_tile: cfg.tile_max_features,
    max_bytes_per_tile: cfg.tile_max_bytes,
  });
  const policyTileStore = createPolicyMovesTileStore({
    db,
    max_moves_per_tile: cfg.policy_max_moves,
    max_bytes_per_tile: cfg.tile_max_bytes,
  });
  const episodesTileStore = createEpisodesTileStore({
    db,
    max_features_per_tile: cfg.tile_max_features,
    max_bytes_per_tile: cfg.tile_max_bytes,
  });
  const replayTileCache = cfg.replay_tile_cache_dir ? new FileReplayTileCache(cfg.replay_tile_cache_dir) : undefined;

  const handler = createControlPlaneHandler({
    time: {
      servingViews: viewService,
      viewStore,
      network: networkStore,
      config: {
        view_version: cfg.view_version,
        ttl_seconds: cfg.sv_ttl_seconds,
        tile_schema_version: cfg.tile_schema_version,
        severity_version: cfg.severity_version,
        severity_spec_sha256: cfg.severity_spec_sha256,
        required_datasets: cfg.required_datasets,
        optional_datasets: cfg.optional_datasets,
      },
    },
    config: {
      bucket_size_seconds: cfg.timeline_bucket_seconds,
      severity_version: cfg.severity_version,
      severity_legend_bins: [{ min: 0, max: 1, label: "all" }],
      map: {
        initial_center: { lon: -73.98, lat: 40.75 },
        initial_zoom: 12,
        max_bounds: { min_lon: -74.3, min_lat: 40.45, max_lon: -73.65, max_lat: 40.95 },
        min_zoom: 9,
        max_zoom: 18,
      },
      speed_presets: [1, 10, 60],
      cache_policy: { live_tile_max_age_s: cfg.tile_live_max_age_s },
      allowlist_provider: {
        system_id: cfg.system_id,
        list_allowed_values: ({ kind, system_id }) => allowlist.listAllowedValues({ kind, system_id }),
      },
    },
    timeline: {
      tokens: tokenService,
      timelineStore,
      default_bucket_seconds: cfg.timeline_bucket_seconds,
    },
    search: {
      allowlist,
      searchStore,
    },
    stations: {
      tokens: tokenService,
      stationsStore,
      default_bucket_seconds: cfg.timeline_bucket_seconds,
      max_series_window_s: 7 * 24 * 60 * 60,
      max_series_points: 1000,
    },
    stationDrawer: {
      tokens: tokenService,
      allowlist,
      stationsStore,
      defaults: {
        severity_version: cfg.severity_version,
        tile_schema: cfg.tile_schema_version,
        range_s: 6 * 60 * 60,
        bucket_seconds: cfg.timeline_bucket_seconds,
      },
      limits: {
        max_range_s: 48 * 60 * 60,
        max_series_points: 360,
        max_episodes: 50,
      },
      cache: {
        max_age_s: cfg.tile_live_max_age_s,
        s_maxage_s: cfg.tile_live_s_maxage_s,
        stale_while_revalidate_s: cfg.tile_live_swr_s,
      },
    },
    tiles: {
      tokens: tokenService,
      allowlist,
      servingViews: bindings,
      tileStore,
      replayCache: replayTileCache,
      cache: {
        max_age_s: cfg.tile_live_max_age_s,
        s_maxage_s: cfg.tile_live_s_maxage_s,
        stale_while_revalidate_s: cfg.tile_live_swr_s,
        replay_min_ttl_s: cfg.tile_replay_min_ttl_s,
        replay_max_age_s: cfg.tile_replay_max_age_s,
        replay_s_maxage_s: cfg.tile_replay_s_maxage_s,
        replay_stale_while_revalidate_s: cfg.tile_replay_swr_s,
      },
      compare: {
        max_window_s: cfg.tile_compare_max_window_s,
      },
    },
    episodesTiles: {
      tokens: tokenService,
      allowlist,
      default_severity_version: cfg.severity_version,
      servingViews: bindings,
      tileStore: episodesTileStore,
      cache: {
        max_age_s: cfg.tile_live_max_age_s,
        s_maxage_s: cfg.tile_live_s_maxage_s,
        stale_while_revalidate_s: cfg.tile_live_swr_s,
      },
    },
    policyTiles: {
      tokens: tokenService,
      allowlist,
      tileStore: policyTileStore,
      cache: {
        max_age_s: cfg.tile_live_max_age_s,
        s_maxage_s: cfg.tile_live_s_maxage_s,
        stale_while_revalidate_s: cfg.tile_live_swr_s,
      },
    },
    policy: {
      tokens: tokenService,
      allowlist,
      policyStore,
      queue,
      config: {
        default_policy_version: cfg.policy_default_version,
        available_policy_versions: cfg.policy_available_versions,
        default_horizon_steps: cfg.policy_default_horizon_steps,
        retry_after_ms: cfg.policy_retry_after_ms,
        max_moves: cfg.policy_max_moves,
        budget_presets: parseBudgetPresets(process.env.POLICY_BUDGET_PRESETS_JSON),
      },
    },
    admin: cfg.admin_token
      ? {
          auth: {
            admin_token: cfg.admin_token,
            allowed_origins: cfg.admin_allowed_origins,
          },
          store: adminStore,
          config: {
            default_system_id: cfg.system_id,
          },
        }
      : undefined,
  });

  Bun.serve({
    hostname: cfg.host,
    port: cfg.port,
    fetch(request: Request): Promise<Response> {
      return handler(request);
    },
  });

  console.info(
    JSON.stringify({
      level: "info",
      event: "api_server_started",
      ts: new Date().toISOString(),
      host: cfg.host,
      port: cfg.port,
      system_id: cfg.system_id,
      view_version: cfg.view_version,
    })
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "api_server_bootstrap_failed",
      ts: new Date().toISOString(),
      message: error instanceof Error ? error.message : "unknown_error",
    })
  );
  process.exit(1);
});
