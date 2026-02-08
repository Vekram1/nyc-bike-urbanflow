import type { SqlExecutor } from "../db/types";
import type { CompositeTileArgs, CompositeTileResult } from "../http/tiles";

export type CompositeTileSqlPlan = {
  text: string;
  params: Array<unknown>;
};

export function buildCompositeTileSql(params: {
  system_id: string;
  t_bucket_epoch_s: number;
  severity_version: string;
  pressure_source: "live_proxy" | "trips_baseline";
  trips_baseline_id?: string;
  trips_baseline_sha256?: string;
  include_inv: boolean;
  include_sev: boolean;
  include_press: boolean;
  include_epi: boolean;
  include_optional_props: boolean;
  z: number;
  x: number;
  y: number;
  max_features: number;
  mvt_extent: number;
  mvt_buffer: number;
}): CompositeTileSqlPlan {
  return {
    text: `
WITH bounds AS (
  SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS env_3857
),
base_stations AS (
  SELECT
    s.system_id,
    s.station_key,
    s.name,
    s.capacity,
    ST_Transform(ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326), 3857) AS geom_3857
  FROM stations_current s
  JOIN bounds b ON ST_Intersects(ST_Transform(ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326), 3857), b.env_3857)
  WHERE s.system_id = $4
  ORDER BY s.station_key ASC
  LIMIT $5
),
inv_rows AS (
  SELECT
    bs.station_key,
    COALESCE(ss.bikes_available, 0) AS bikes_available,
    COALESCE(ss.docks_available, 0) AS docks_available,
    EXTRACT(EPOCH FROM date_bin('1 minute', TO_TIMESTAMP($6), TIMESTAMPTZ '1970-01-01 00:00:00+00'))::bigint AS observation_ts_bucket,
    COALESCE(ss.bucket_quality, 'blocked') AS bucket_quality,
    CASE WHEN $7 THEN jsonb_build_object('name', bs.name, 'capacity', bs.capacity) ELSE NULL END AS flags,
    ST_AsMVTGeom(bs.geom_3857, (SELECT env_3857 FROM bounds), $8, $9, true) AS geom
  FROM base_stations bs
  LEFT JOIN station_status_1m ss
    ON ss.system_id = bs.system_id
   AND ss.station_key = bs.station_key
   AND ss.bucket_ts = date_bin('1 minute', TO_TIMESTAMP($6), TIMESTAMPTZ '1970-01-01 00:00:00+00')
),
sev_rows AS (
  SELECT
    bs.station_key,
    COALESCE(sev.severity, 0.0) AS severity,
    $10::text AS severity_version,
    EXTRACT(EPOCH FROM date_bin('5 minutes', TO_TIMESTAMP($6), TIMESTAMPTZ '1970-01-01 00:00:00+00'))::bigint AS observation_ts_bucket,
    CASE WHEN $7 THEN sev.severity_components_json ELSE NULL END AS severity_components_compact,
    ST_AsMVTGeom(bs.geom_3857, (SELECT env_3857 FROM bounds), $8, $9, true) AS geom
  FROM base_stations bs
  LEFT JOIN station_severity_5m sev
    ON sev.system_id = bs.system_id
   AND sev.station_key = bs.station_key
   AND sev.severity_version = $10
   AND sev.bucket_ts = date_bin('5 minutes', TO_TIMESTAMP($6), TIMESTAMPTZ '1970-01-01 00:00:00+00')
),
press_rows AS (
  SELECT
    bs.station_key,
    CASE
      WHEN $16::boolean
        THEN COALESCE(
          ((COALESCE(so.trips_out, 0) - COALESCE(si.trips_in, 0))::double precision / GREATEST(bs.capacity, 1)),
          0.0
        )
      ELSE COALESCE(pr.pressure_score, 0.0)
    END AS pressure,
    EXTRACT(EPOCH FROM date_bin('5 minutes', TO_TIMESTAMP($6), TIMESTAMPTZ '1970-01-01 00:00:00+00'))::bigint AS observation_ts_bucket,
    CASE
      WHEN $7
        THEN CASE
          WHEN $16::boolean
            THEN jsonb_build_object('source', 'trips_baseline', 'dataset_id', $15::text, 'checksum', $17::text)
          ELSE jsonb_build_object(
            'source', 'live_proxy',
            'proxy', pr.proxy_method,
            'delta_bikes_5m', pr.delta_bikes_5m,
            'delta_docks_5m', pr.delta_docks_5m,
            'volatility_60m', pr.volatility_60m,
            'rebalancing_suspected', pr.rebalancing_suspected
          )
        END
      ELSE NULL
    END AS pressure_components_compact,
    ST_AsMVTGeom(bs.geom_3857, (SELECT env_3857 FROM bounds), $8, $9, true) AS geom
  FROM base_stations bs
  LEFT JOIN station_outflows_monthly so
    ON so.system_id = bs.system_id
   AND so.station_key = bs.station_key
   AND so.dataset_id = $15::text
  LEFT JOIN station_inflows_monthly si
    ON si.system_id = bs.system_id
   AND si.station_key = bs.station_key
   AND si.dataset_id = $15::text
  LEFT JOIN station_pressure_now_5m pr
    ON pr.system_id = bs.system_id
   AND pr.station_key = bs.station_key
   AND pr.bucket_ts = date_bin('5 minutes', TO_TIMESTAMP($6), TIMESTAMPTZ '1970-01-01 00:00:00+00')
),
epi_rows AS (
  SELECT
    bs.station_key,
    'none'::text AS episode_status,
    EXTRACT(EPOCH FROM date_bin('5 minutes', TO_TIMESTAMP($6), TIMESTAMPTZ '1970-01-01 00:00:00+00'))::bigint AS observation_ts_bucket,
    CASE WHEN $7 THEN 0 ELSE NULL END AS episode_duration_s,
    ST_AsMVTGeom(bs.geom_3857, (SELECT env_3857 FROM bounds), $8, $9, true) AS geom
  FROM base_stations bs
),
layer_inv AS (
  SELECT COALESCE(ST_AsMVT(q, 'inv', $8, 'geom'), ''::bytea) AS tile
  FROM (SELECT * FROM inv_rows WHERE $11) q
),
layer_sev AS (
  SELECT COALESCE(ST_AsMVT(q, 'sev', $8, 'geom'), ''::bytea) AS tile
  FROM (SELECT * FROM sev_rows WHERE $12) q
),
layer_press AS (
  SELECT COALESCE(ST_AsMVT(q, 'press', $8, 'geom'), ''::bytea) AS tile
  FROM (SELECT * FROM press_rows WHERE $13) q
),
layer_epi AS (
  SELECT COALESCE(ST_AsMVT(q, 'epi', $8, 'geom'), ''::bytea) AS tile
  FROM (SELECT * FROM epi_rows WHERE $14) q
)
SELECT
  (SELECT tile FROM layer_inv) || (SELECT tile FROM layer_sev) || (SELECT tile FROM layer_press) || (SELECT tile FROM layer_epi) AS mvt,
  (SELECT COUNT(*) FROM base_stations) AS feature_count
;`.trim(),
    params: [
      params.z,
      params.x,
      params.y,
      params.system_id,
      params.max_features,
      params.t_bucket_epoch_s,
      params.include_optional_props,
      params.mvt_extent,
      params.mvt_buffer,
      params.severity_version,
      params.include_inv,
      params.include_sev,
      params.include_press,
      params.include_epi,
      params.trips_baseline_id ?? null,
      params.pressure_source === "trips_baseline",
      params.trips_baseline_sha256 ?? null,
    ],
  };
}

type CompositeTileRow = {
  mvt: Uint8Array | string | null;
  feature_count: number | string;
};

function layersFlags(layersSet: string): {
  include_inv: boolean;
  include_sev: boolean;
  include_press: boolean;
  include_epi: boolean;
} {
  const layers = new Set(
    layersSet
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
  return {
    include_inv: layers.has("inv"),
    include_sev: layers.has("sev"),
    include_press: layers.has("press"),
    include_epi: layers.has("epi"),
  };
}

function asBytes(value: Uint8Array | string | null): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return value;
}

export function createCompositeTileStore(deps: {
  db: SqlExecutor;
  max_features_per_tile: number;
  max_bytes_per_tile: number;
  mvt_extent?: number;
  mvt_buffer?: number;
  logger?: {
    info: (event: string, details: Record<string, unknown>) => void;
  };
}): {
  fetchCompositeTile: (args: CompositeTileArgs) => Promise<CompositeTileResult>;
} {
  const extent = deps.mvt_extent ?? 4096;
  const buffer = deps.mvt_buffer ?? 64;

  async function runQuery(args: CompositeTileArgs, includeOptionalProps: boolean): Promise<CompositeTileResult> {
    const flags = layersFlags(args.layers_set);
    const plan = buildCompositeTileSql({
      system_id: args.system_id,
      t_bucket_epoch_s: args.t_bucket_epoch_s,
      severity_version: args.severity_version,
      pressure_source: args.pressure_source,
      trips_baseline_id: args.trips_baseline_id,
      trips_baseline_sha256: args.trips_baseline_sha256,
      include_inv: flags.include_inv,
      include_sev: flags.include_sev,
      include_press: flags.include_press,
      include_epi: flags.include_epi,
      include_optional_props: includeOptionalProps,
      z: args.z,
      x: args.x,
      y: args.y,
      max_features: deps.max_features_per_tile,
      mvt_extent: extent,
      mvt_buffer: buffer,
    });

    const startedAt = Date.now();
    const result = await deps.db.query<CompositeTileRow>(plan.text, plan.params);
    const row = result.rows[0];
    if (!row) {
      deps.logger?.info("composite_tile.query", {
        system_id: args.system_id,
        z: args.z,
        x: args.x,
        y: args.y,
        severity_version: args.severity_version,
        layers_set: args.layers_set,
        include_optional_props: includeOptionalProps,
        duration_ms: Date.now() - startedAt,
        row_found: false,
      });
      return {
        ok: false,
        status: 404,
        code: "tile_not_found",
        message: "No tile data",
      };
    }
    const mvt = asBytes(row.mvt);
    const featureCount = Number(row.feature_count);
    deps.logger?.info("composite_tile.query", {
      system_id: args.system_id,
      z: args.z,
      x: args.x,
      y: args.y,
      severity_version: args.severity_version,
      layers_set: args.layers_set,
      include_optional_props: includeOptionalProps,
      duration_ms: Date.now() - startedAt,
      feature_count: Number.isFinite(featureCount) ? featureCount : 0,
      bytes: mvt.byteLength,
      row_found: true,
    });
    return {
      ok: true,
      mvt,
      feature_count: Number.isFinite(featureCount) ? featureCount : 0,
      bytes: mvt.byteLength,
    };
  }

  return {
    async fetchCompositeTile(args: CompositeTileArgs): Promise<CompositeTileResult> {
      const primary = await runQuery(args, true);
      if (!primary.ok) {
        return primary;
      }
      if (primary.bytes <= deps.max_bytes_per_tile) {
        return primary;
      }

      const trimmed = await runQuery(args, false);
      if (!trimmed.ok) {
        return trimmed;
      }
      if (trimmed.bytes > deps.max_bytes_per_tile) {
        deps.logger?.info("composite_tile.degrade", {
          system_id: args.system_id,
          z: args.z,
          x: args.x,
          y: args.y,
          severity_version: args.severity_version,
          layers_set: args.layers_set,
          action: "reject_overloaded",
          bytes_after_trim: trimmed.bytes,
          max_bytes_per_tile: deps.max_bytes_per_tile,
        });
        return {
          ok: false,
          status: 429,
          code: "tile_overloaded",
          message: "Tile exceeds max_bytes_per_tile after optional property drop",
          retry_after_s: 3,
        };
      }
      return {
        ...trimmed,
        degrade_level: 1,
        dropped_optional_props: [
          "inv.flags",
          "sev.severity_components_compact",
          "press.pressure_components_compact",
          "epi.episode_duration_s",
        ],
      };
    },
  };
}
