import type { SqlExecutor } from "../db/types";

export type EpisodesTileArgs = {
  system_id: string;
  severity_version: string;
  t_bucket_epoch_s: number;
  z: number;
  x: number;
  y: number;
};

export type EpisodesTileResult =
  | {
      ok: true;
      mvt: Uint8Array;
      feature_count: number;
      bytes: number;
    }
  | {
      ok: false;
      status: 429 | 500;
      code: string;
      message: string;
      retry_after_s?: number;
    };

export type EpisodesTileSqlPlan = {
  text: string;
  params: Array<unknown>;
};

export function buildEpisodesTileSql(params: {
  system_id: string;
  severity_version: string;
  t_bucket_epoch_s: number;
  z: number;
  x: number;
  y: number;
  max_features: number;
  mvt_extent: number;
  mvt_buffer: number;
}): EpisodesTileSqlPlan {
  return {
    text: `
WITH bounds AS (
  SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS env_3857
),
base_stations AS (
  SELECT
    s.system_id,
    s.station_key,
    ST_Transform(ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326), 3857) AS geom_3857
  FROM stations_current s
  JOIN bounds b ON ST_Intersects(ST_Transform(ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326), 3857), b.env_3857)
  WHERE s.system_id = $4
),
active_episodes AS (
  SELECT
    em.station_key,
    em.episode_type,
    em.duration_minutes,
    em.bucket_quality,
    EXTRACT(EPOCH FROM em.episode_start_ts)::bigint AS episode_start_epoch_s,
    EXTRACT(EPOCH FROM em.episode_end_ts)::bigint AS episode_end_epoch_s,
    ST_AsMVTGeom(bs.geom_3857, (SELECT env_3857 FROM bounds), $8, $9, true) AS geom
  FROM episode_markers_15m em
  JOIN base_stations bs
    ON bs.system_id = em.system_id
   AND bs.station_key = em.station_key
  WHERE em.system_id = $4
    AND em.severity_version = $5
    AND em.bucket_ts = date_bin('15 minutes', TO_TIMESTAMP($6), TIMESTAMPTZ '1970-01-01 00:00:00+00')
  ORDER BY em.duration_minutes DESC, em.station_key ASC
  LIMIT $7
)
SELECT
  COALESCE(ST_AsMVT(active_episodes, 'episodes', $8, 'geom'), ''::bytea) AS mvt,
  COALESCE((SELECT COUNT(*) FROM active_episodes), 0) AS feature_count
FROM active_episodes;`.trim(),
    params: [
      params.z,
      params.x,
      params.y,
      params.system_id,
      params.severity_version,
      params.t_bucket_epoch_s,
      params.max_features,
      params.mvt_extent,
      params.mvt_buffer,
    ],
  };
}

type EpisodesTileRow = {
  mvt: Uint8Array | string | null;
  feature_count: number | string;
};

function asBytes(value: Uint8Array | string | null): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return value;
}

export function createEpisodesTileStore(deps: {
  db: SqlExecutor;
  max_features_per_tile: number;
  max_bytes_per_tile: number;
  mvt_extent?: number;
  mvt_buffer?: number;
}): {
  fetchEpisodesTile: (args: EpisodesTileArgs) => Promise<EpisodesTileResult>;
} {
  const extent = deps.mvt_extent ?? 4096;
  const buffer = deps.mvt_buffer ?? 64;

  return {
    async fetchEpisodesTile(args: EpisodesTileArgs): Promise<EpisodesTileResult> {
      const plan = buildEpisodesTileSql({
        system_id: args.system_id,
        severity_version: args.severity_version,
        t_bucket_epoch_s: args.t_bucket_epoch_s,
        z: args.z,
        x: args.x,
        y: args.y,
        max_features: deps.max_features_per_tile,
        mvt_extent: extent,
        mvt_buffer: buffer,
      });
      const out = await deps.db.query<EpisodesTileRow>(plan.text, plan.params);
      const row = out.rows[0];
      if (!row) {
        return {
          ok: false,
          status: 500,
          code: "episodes_tile_query_failed",
          message: "Episodes tile query returned no rows",
        };
      }
      const mvt = asBytes(row.mvt);
      if (mvt.byteLength > deps.max_bytes_per_tile) {
        return {
          ok: false,
          status: 429,
          code: "tile_overloaded",
          message: "Episodes tile exceeds max_bytes_per_tile",
          retry_after_s: 3,
        };
      }
      const featureCount = Number(row.feature_count);
      return {
        ok: true,
        mvt,
        feature_count: Number.isFinite(featureCount) ? featureCount : 0,
        bytes: mvt.byteLength,
      };
    },
  };
}
