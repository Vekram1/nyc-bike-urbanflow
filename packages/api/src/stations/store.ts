import type { SqlExecutor } from "../db/types";
import type { StationDetail, StationSeriesPoint, StationSnapshot } from "../http/stations";
import type {
  StationDrawerEpisode,
  StationDrawerPointInTime,
  StationDrawerResponse,
  StationDrawerSeriesPoint,
} from "../http/station-drawer";

type StationDetailRow = {
  station_key: string;
  name: string | null;
  capacity: number | null;
  bucket_ts: string | null;
  bikes_available: number | null;
  docks_available: number | null;
  bucket_quality: string | null;
  severity: number | null;
  pressure_score: number | null;
  pressure_delta_bikes_5m: number | null;
  pressure_delta_docks_5m: number | null;
  pressure_volatility_60m: number | null;
  pressure_rebalancing_suspected: boolean | null;
};

type StationSeriesRow = {
  bucket_ts: string;
  bikes_available: number;
  docks_available: number;
  bucket_quality: string;
  severity: number | null;
  pressure_score: number | null;
  pressure_delta_bikes_5m: number | null;
  pressure_delta_docks_5m: number | null;
  pressure_volatility_60m: number | null;
  pressure_rebalancing_suspected: boolean | null;
};

type StationSnapshotRow = {
  station_key: string;
  name: string | null;
  lat: number | string;
  lon: number | string;
  capacity: number | null;
  bucket_ts: string | null;
  bikes_available: number | null;
  docks_available: number | null;
  bucket_quality: string | null;
};

type StationDrawerPointRow = {
  station_key: string;
  name: string | null;
  capacity: number | null;
  bucket_ts: string | null;
  bikes_available: number | null;
  docks_available: number | null;
  bucket_quality: string | null;
  severity: number | null;
  pressure_score: number | null;
  pressure_delta_bikes_5m: number | null;
  pressure_delta_docks_5m: number | null;
  pressure_volatility_60m: number | null;
  pressure_rebalancing_suspected: boolean | null;
  severity_components: unknown;
};

type StationDrawerSeriesRow = {
  bucket_ts: string;
  bikes_available: number;
  docks_available: number;
  bucket_quality: string;
  severity: number | null;
  pressure_score: number | null;
};

type StationDrawerEpisodeRow = {
  bucket_ts: string;
  episode_type: "empty" | "full";
  duration_minutes: number;
  bucket_quality: string;
  episode_start_ts: string;
  episode_end_ts: string;
};

export class PgStationsStore {
  private readonly db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.db = db;
  }

  async getStationDetail(args: {
    system_id: string;
    view_id: number;
    station_key: string;
  }): Promise<StationDetail | null> {
    const rows = await this.db.query<StationDetailRow>(
      `SELECT
         sc.station_key,
         sc.name,
         sc.capacity,
         ss.bucket_ts::text AS bucket_ts,
         ss.bikes_available,
         ss.docks_available,
         ss.bucket_quality,
         sev.severity,
         pr.pressure_score,
         pr.delta_bikes_5m AS pressure_delta_bikes_5m,
         pr.delta_docks_5m AS pressure_delta_docks_5m,
         pr.volatility_60m AS pressure_volatility_60m,
         pr.rebalancing_suspected AS pressure_rebalancing_suspected
       FROM stations_current sc
       LEFT JOIN station_status_1m ss
         ON ss.system_id = sc.system_id
        AND ss.station_key = sc.station_key
       LEFT JOIN station_severity_5m sev
         ON sev.system_id = sc.system_id
        AND sev.station_key = sc.station_key
        AND sev.bucket_ts = date_bin('5 minutes', ss.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
       LEFT JOIN station_pressure_now_5m pr
         ON pr.system_id = sc.system_id
        AND pr.station_key = sc.station_key
        AND pr.bucket_ts = date_bin('5 minutes', ss.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
       WHERE sc.system_id = $1
         AND sc.station_key = $2
       ORDER BY ss.bucket_ts DESC NULLS LAST
       LIMIT 1`,
      [args.system_id, args.station_key]
    );
    if (rows.rows.length === 0) {
      return null;
    }
    const row = rows.rows[0];
    return {
      station_key: row.station_key,
      name: row.name,
      capacity: row.capacity,
      bucket_ts: row.bucket_ts,
      bikes_available: row.bikes_available,
      docks_available: row.docks_available,
      bucket_quality: row.bucket_quality,
      severity: row.severity,
      pressure_score: row.pressure_score,
      pressure_delta_bikes_5m: row.pressure_delta_bikes_5m,
      pressure_delta_docks_5m: row.pressure_delta_docks_5m,
      pressure_volatility_60m: row.pressure_volatility_60m,
      pressure_rebalancing_suspected: row.pressure_rebalancing_suspected,
    };
  }

  async getStationSeries(args: {
    system_id: string;
    view_id: number;
    station_key: string;
    from_epoch_s: number;
    to_epoch_s: number;
    bucket_seconds: number;
    limit: number;
  }): Promise<StationSeriesPoint[]> {
    const rows = await this.db.query<StationSeriesRow>(
      `WITH bucketed AS (
         SELECT
           date_bin(($3::text || ' seconds')::interval, ss.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket_ts,
           ss.bikes_available,
           ss.docks_available,
           ss.bucket_quality,
           sev.severity,
           pr.pressure_score,
           pr.delta_bikes_5m AS pressure_delta_bikes_5m,
           pr.delta_docks_5m AS pressure_delta_docks_5m,
           pr.volatility_60m AS pressure_volatility_60m,
           pr.rebalancing_suspected AS pressure_rebalancing_suspected
         FROM station_status_1m ss
         LEFT JOIN station_severity_5m sev
           ON sev.system_id = ss.system_id
          AND sev.station_key = ss.station_key
          AND sev.bucket_ts = date_bin('5 minutes', ss.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
         LEFT JOIN station_pressure_now_5m pr
           ON pr.system_id = ss.system_id
          AND pr.station_key = ss.station_key
          AND pr.bucket_ts = date_bin('5 minutes', ss.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
         WHERE ss.system_id = $1
           AND ss.station_key = $2
           AND ss.bucket_ts >= TO_TIMESTAMP($4)
           AND ss.bucket_ts <= TO_TIMESTAMP($5)
       )
       SELECT
         b.bucket_ts::text,
         AVG(b.bikes_available)::int AS bikes_available,
         AVG(b.docks_available)::int AS docks_available,
         MIN(b.bucket_quality) AS bucket_quality,
         MAX(b.severity) AS severity,
         MAX(b.pressure_score) AS pressure_score,
         MAX(b.pressure_delta_bikes_5m) AS pressure_delta_bikes_5m,
         MAX(b.pressure_delta_docks_5m) AS pressure_delta_docks_5m,
         MAX(b.pressure_volatility_60m) AS pressure_volatility_60m,
         BOOL_OR(COALESCE(b.pressure_rebalancing_suspected, false)) AS pressure_rebalancing_suspected
       FROM bucketed b
       GROUP BY b.bucket_ts
       ORDER BY b.bucket_ts ASC
       LIMIT $6`,
      [
        args.system_id,
        args.station_key,
        args.bucket_seconds,
        args.from_epoch_s,
        args.to_epoch_s,
        args.limit,
      ]
    );
    return rows.rows.map((row) => ({
      bucket_ts: row.bucket_ts,
      bikes_available: row.bikes_available,
      docks_available: row.docks_available,
      bucket_quality: row.bucket_quality,
      severity: row.severity ?? undefined,
      pressure_score: row.pressure_score ?? undefined,
      pressure_delta_bikes_5m: row.pressure_delta_bikes_5m ?? undefined,
      pressure_delta_docks_5m: row.pressure_delta_docks_5m ?? undefined,
      pressure_volatility_60m: row.pressure_volatility_60m ?? undefined,
      pressure_rebalancing_suspected: row.pressure_rebalancing_suspected ?? undefined,
    }));
  }

  async getStationsSnapshot(args: {
    system_id: string;
    view_id: number;
    t_bucket_epoch_s: number | null;
    limit: number;
  }): Promise<StationSnapshot[]> {
    const rows = await this.db.query<StationSnapshotRow>(
      `SELECT
         sc.station_key,
         sc.name,
         sc.lat,
         sc.lon,
         sc.capacity,
         ss.bucket_ts::text AS bucket_ts,
         ss.bikes_available,
         ss.docks_available,
         ss.bucket_quality
       FROM stations_current sc
       LEFT JOIN LATERAL (
         (
           SELECT
             s.bucket_ts,
             s.bikes_available,
             s.docks_available,
             s.bucket_quality
           FROM station_status_1m s
           WHERE s.system_id = sc.system_id
             AND s.station_key = sc.station_key
             AND ($2::bigint IS NULL OR s.bucket_ts <= TO_TIMESTAMP($2))
           ORDER BY s.bucket_ts DESC
           LIMIT 1
         )
         UNION ALL
         (
           -- If requested T_bucket predates available history, fall back to earliest sample.
           SELECT
             s.bucket_ts,
             s.bikes_available,
             s.docks_available,
             s.bucket_quality
           FROM station_status_1m s
           WHERE s.system_id = sc.system_id
             AND s.station_key = sc.station_key
             AND $2::bigint IS NOT NULL
           ORDER BY s.bucket_ts ASC
           LIMIT 1
         )
         LIMIT 1
       ) ss ON TRUE
       WHERE sc.system_id = $1
       ORDER BY sc.name ASC
       LIMIT $3`,
      [args.system_id, args.t_bucket_epoch_s, args.limit]
    );
    return rows.rows.map((row) => ({
      station_key: row.station_key,
      name: row.name,
      lat: Number(row.lat),
      lon: Number(row.lon),
      capacity: row.capacity,
      bucket_ts: row.bucket_ts,
      bikes_available: row.bikes_available,
      docks_available: row.docks_available,
      bucket_quality: row.bucket_quality,
    }));
  }

  async getStationDrawer(args: {
    system_id: string;
    view_id: number;
    station_key: string;
    t_bucket_epoch_s: number;
    range_s: number;
    bucket_seconds: number;
    max_series_points: number;
    max_episodes: number;
    severity_version: string;
  }): Promise<StationDrawerResponse | null> {
    const pointRows = await this.db.query<StationDrawerPointRow>(
      `SELECT
         sc.station_key,
         sc.name,
         sc.capacity,
         ss.bucket_ts::text AS bucket_ts,
         ss.bikes_available,
         ss.docks_available,
         ss.bucket_quality,
         sev.severity,
         pr.pressure_score,
         pr.delta_bikes_5m AS pressure_delta_bikes_5m,
         pr.delta_docks_5m AS pressure_delta_docks_5m,
         pr.volatility_60m AS pressure_volatility_60m,
         pr.rebalancing_suspected AS pressure_rebalancing_suspected,
         sev.severity_components_json AS severity_components
       FROM stations_current sc
       LEFT JOIN station_status_1m ss
         ON ss.system_id = sc.system_id
        AND ss.station_key = sc.station_key
        AND ss.bucket_ts = date_bin('1 minute', TO_TIMESTAMP($3), TIMESTAMPTZ '1970-01-01 00:00:00+00')
       LEFT JOIN station_severity_5m sev
         ON sev.system_id = sc.system_id
        AND sev.station_key = sc.station_key
        AND sev.severity_version = $4
        AND sev.bucket_ts = date_bin('5 minutes', TO_TIMESTAMP($3), TIMESTAMPTZ '1970-01-01 00:00:00+00')
       LEFT JOIN station_pressure_now_5m pr
         ON pr.system_id = sc.system_id
        AND pr.station_key = sc.station_key
        AND pr.bucket_ts = date_bin('5 minutes', TO_TIMESTAMP($3), TIMESTAMPTZ '1970-01-01 00:00:00+00')
       WHERE sc.system_id = $1
         AND sc.station_key = $2
       LIMIT 1`,
      [args.system_id, args.station_key, args.t_bucket_epoch_s, args.severity_version]
    );
    const point = pointRows.rows[0];
    if (!point) {
      return null;
    }

    const fromEpochS = Math.max(0, args.t_bucket_epoch_s - args.range_s);
    const seriesRows = await this.db.query<StationDrawerSeriesRow>(
      `WITH bucketed AS (
         SELECT
           date_bin(($3::text || ' seconds')::interval, ss.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket_ts,
           ss.bikes_available,
           ss.docks_available,
           ss.bucket_quality,
           sev.severity,
           pr.pressure_score
         FROM station_status_1m ss
         LEFT JOIN station_severity_5m sev
           ON sev.system_id = ss.system_id
          AND sev.station_key = ss.station_key
          AND sev.severity_version = $7
          AND sev.bucket_ts = date_bin('5 minutes', ss.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
         LEFT JOIN station_pressure_now_5m pr
           ON pr.system_id = ss.system_id
          AND pr.station_key = ss.station_key
          AND pr.bucket_ts = date_bin('5 minutes', ss.bucket_ts, TIMESTAMPTZ '1970-01-01 00:00:00+00')
         WHERE ss.system_id = $1
           AND ss.station_key = $2
           AND ss.bucket_ts >= TO_TIMESTAMP($4)
           AND ss.bucket_ts <= TO_TIMESTAMP($5)
       )
       SELECT
         b.bucket_ts::text,
         AVG(b.bikes_available)::int AS bikes_available,
         AVG(b.docks_available)::int AS docks_available,
         MIN(b.bucket_quality) AS bucket_quality,
         MAX(b.severity) AS severity,
         MAX(b.pressure_score) AS pressure_score
       FROM bucketed b
       GROUP BY b.bucket_ts
       ORDER BY b.bucket_ts ASC
       LIMIT $6`,
      [
        args.system_id,
        args.station_key,
        args.bucket_seconds,
        fromEpochS,
        args.t_bucket_epoch_s,
        args.max_series_points + 1,
        args.severity_version,
      ]
    );

    const episodeRows = await this.db.query<StationDrawerEpisodeRow>(
      `SELECT
         em.bucket_ts::text,
         em.episode_type,
         em.duration_minutes,
         em.bucket_quality,
         em.episode_start_ts::text,
         em.episode_end_ts::text
       FROM episode_markers_15m em
       WHERE em.system_id = $1
         AND em.station_key = $2
         AND em.severity_version = $3
         AND em.bucket_ts >= TO_TIMESTAMP($4)
         AND em.bucket_ts <= TO_TIMESTAMP($5)
       ORDER BY em.bucket_ts DESC
       LIMIT $6`,
      [
        args.system_id,
        args.station_key,
        args.severity_version,
        fromEpochS,
        args.t_bucket_epoch_s,
        args.max_episodes + 1,
      ]
    );

    const seriesTruncated = seriesRows.rows.length > args.max_series_points;
    const episodeTruncated = episodeRows.rows.length > args.max_episodes;
    const pointInTime: StationDrawerPointInTime = {
      bucket_ts: point.bucket_ts,
      bikes_available: point.bikes_available,
      docks_available: point.docks_available,
      bucket_quality: point.bucket_quality,
      severity: point.severity,
      pressure_score: point.pressure_score,
      pressure_delta_bikes_5m: point.pressure_delta_bikes_5m,
      pressure_delta_docks_5m: point.pressure_delta_docks_5m,
      pressure_volatility_60m: point.pressure_volatility_60m,
      pressure_rebalancing_suspected: point.pressure_rebalancing_suspected,
      severity_components: point.severity_components,
    };
    const seriesPoints: StationDrawerSeriesPoint[] = seriesRows.rows.slice(0, args.max_series_points).map((row) => ({
      bucket_ts: row.bucket_ts,
      bikes_available: row.bikes_available,
      docks_available: row.docks_available,
      bucket_quality: row.bucket_quality,
      severity: row.severity ?? undefined,
      pressure_score: row.pressure_score ?? undefined,
    }));
    const episodes: StationDrawerEpisode[] = episodeRows.rows.slice(0, args.max_episodes).map((row) => ({
      bucket_ts: row.bucket_ts,
      episode_type: row.episode_type,
      duration_minutes: row.duration_minutes,
      bucket_quality: row.bucket_quality,
      episode_start_ts: row.episode_start_ts,
      episode_end_ts: row.episode_end_ts,
    }));

    return {
      station_key: point.station_key,
      sv: null,
      t_bucket_epoch_s: args.t_bucket_epoch_s,
      range_s: args.range_s,
      bucket_seconds: args.bucket_seconds,
      severity_version: args.severity_version,
      tile_schema: "tile.v1",
      metadata: {
        name: point.name,
        capacity: point.capacity,
      },
      point_in_time: pointInTime,
      series: {
        points: seriesPoints,
        truncated: seriesTruncated,
      },
      episodes: {
        items: episodes,
        truncated: episodeTruncated,
      },
    };
  }
}
