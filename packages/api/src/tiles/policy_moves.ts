import type { SqlExecutor } from "../db/types";

export type PolicyMovesTileArgs = {
  system_id: string;
  sv: string;
  policy_version: string;
  t_bucket_epoch_s: number;
  z: number;
  x: number;
  y: number;
};

export type PolicyMovesTileResult =
  | {
      ok: true;
      mvt: Uint8Array;
      feature_count: number;
      bytes: number;
    }
  | {
      ok: false;
      status: 404 | 429 | 500;
      code: string;
      message: string;
      retry_after_s?: number;
    };

export type PolicyMovesTileSqlPlan = {
  text: string;
  params: Array<unknown>;
};

export function buildPolicyMovesTileSql(params: {
  system_id: string;
  sv: string;
  policy_version: string;
  t_bucket_epoch_s: number;
  z: number;
  x: number;
  y: number;
  top_n: number;
  mvt_extent: number;
  mvt_buffer: number;
}): PolicyMovesTileSqlPlan {
  return {
    text: `
WITH bounds AS (
  SELECT ST_TileEnvelope($1::int, $2::int, $3::int) AS env_3857
),
selected_run AS (
  SELECT r.run_id
  FROM policy_runs r
  WHERE r.system_id = $4
    AND r.sv = $5
    AND r.policy_version = $6
    AND r.decision_bucket_ts = TO_TIMESTAMP($7)
    AND r.status = 'success'
  ORDER BY r.created_at DESC
  LIMIT 1
),
moves AS (
  SELECT
    m.move_rank,
    m.from_station_key,
    m.to_station_key,
    m.bikes_moved,
    m.dist_m,
    ST_Transform(ST_SetSRID(ST_MakePoint(sf.lon, sf.lat), 4326), 3857) AS from_geom_3857,
    ST_Transform(ST_SetSRID(ST_MakePoint(st.lon, st.lat), 4326), 3857) AS to_geom_3857
  FROM policy_moves m
  JOIN selected_run r ON r.run_id = m.run_id
  JOIN stations_current sf ON sf.system_id = $4 AND sf.station_key = m.from_station_key
  JOIN stations_current st ON st.system_id = $4 AND st.station_key = m.to_station_key
  ORDER BY m.move_rank ASC
  LIMIT $8
),
lines AS (
  SELECT
    move_rank,
    from_station_key,
    to_station_key,
    bikes_moved,
    dist_m,
    ST_AsMVTGeom(
      ST_MakeLine(from_geom_3857, to_geom_3857),
      (SELECT env_3857 FROM bounds),
      $9,
      $10,
      true
    ) AS geom
  FROM moves
)
SELECT
  COALESCE(ST_AsMVT(lines, 'policy_moves', $9, 'geom'), ''::bytea) AS mvt,
  COALESCE((SELECT COUNT(*) FROM moves), 0) AS feature_count
FROM lines;`.trim(),
    params: [
      params.z,
      params.x,
      params.y,
      params.system_id,
      params.sv,
      params.policy_version,
      params.t_bucket_epoch_s,
      params.top_n,
      params.mvt_extent,
      params.mvt_buffer,
    ],
  };
}

type PolicyMovesTileRow = {
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

export function createPolicyMovesTileStore(deps: {
  db: SqlExecutor;
  max_moves_per_tile: number;
  max_bytes_per_tile: number;
  mvt_extent?: number;
  mvt_buffer?: number;
}): {
  fetchPolicyMovesTile: (args: PolicyMovesTileArgs) => Promise<PolicyMovesTileResult>;
} {
  const extent = deps.mvt_extent ?? 4096;
  const buffer = deps.mvt_buffer ?? 64;

  return {
    async fetchPolicyMovesTile(args: PolicyMovesTileArgs): Promise<PolicyMovesTileResult> {
      const plan = buildPolicyMovesTileSql({
        system_id: args.system_id,
        sv: args.sv,
        policy_version: args.policy_version,
        t_bucket_epoch_s: args.t_bucket_epoch_s,
        z: args.z,
        x: args.x,
        y: args.y,
        top_n: deps.max_moves_per_tile,
        mvt_extent: extent,
        mvt_buffer: buffer,
      });
      const out = await deps.db.query<PolicyMovesTileRow>(plan.text, plan.params);
      const row = out.rows[0];
      if (!row) {
        return {
          ok: false,
          status: 404,
          code: "policy_run_not_found",
          message: "No policy run found for requested key",
        };
      }
      const mvt = asBytes(row.mvt);
      const featureCount = Number(row.feature_count);
      if (featureCount === 0) {
        return {
          ok: false,
          status: 404,
          code: "policy_run_not_found",
          message: "No policy moves found for requested key",
        };
      }
      if (mvt.byteLength > deps.max_bytes_per_tile) {
        return {
          ok: false,
          status: 429,
          code: "tile_overloaded",
          message: "Policy moves tile exceeds max_bytes_per_tile",
          retry_after_s: 3,
        };
      }
      return {
        ok: true,
        mvt,
        feature_count: featureCount,
        bytes: mvt.byteLength,
      };
    },
  };
}
