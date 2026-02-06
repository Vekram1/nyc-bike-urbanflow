import type { SqlExecutor } from "../db/types";
import type { StationDetail, StationSeriesPoint } from "../http/stations";

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
};

type StationSeriesRow = {
  bucket_ts: string;
  bikes_available: number;
  docks_available: number;
  bucket_quality: string;
  severity: number | null;
  pressure_score: number | null;
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
         pr.pressure_score
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
           pr.pressure_score
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
         MAX(b.pressure_score) AS pressure_score
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
    }));
  }
}
