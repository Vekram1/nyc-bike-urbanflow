import crypto from "crypto";
import fs from "fs/promises";

import type { SqlExecutor } from "../db/types";
import type { GbfsFeedName, GbfsManifest } from "./types";

type StationInformationRow = {
  station_key: string;
  station_id: string | null;
  name: string | null;
  short_name: string | null;
  region_id: string | null;
  lat: number;
  lon: number;
  capacity: number | null;
};

type StationStatusRow = {
  station_key: string;
  station_id: string | null;
  bikes_available: number;
  docks_available: number;
  is_installed: boolean | null;
  is_renting: boolean | null;
  is_returning: boolean | null;
  last_reported: string | null;
  observation_ts_raw: string;
  observation_ts: string;
  quality_flags_literal: string;
  is_serving_grade: boolean;
};

type LoadResult = {
  logical_snapshot_id: number;
  feed_name: GbfsFeedName;
  deduped: boolean;
  conflict: boolean;
  conflict_reason?: string;
  station_rows_written: number;
  station_rows_skipped: number;
  scd_opened: number;
  scd_closed: number;
  lifecycle_upserts: number;
};

type LoaderOptions = {
  manifest_path: string;
};

type StationPayload = {
  data?: {
    stations?: Array<Record<string, unknown>>;
  };
  last_updated?: number;
  ttl?: number;
};

function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  data: Record<string, unknown>
): void {
  const payload = { level, event, ts: new Date().toISOString(), ...data };
  if (level === "error") {
    console.error(JSON.stringify(payload));
  } else if (level === "warn") {
    console.warn(JSON.stringify(payload));
  } else {
    console.info(JSON.stringify(payload));
  }
}

function sha256Hex(input: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(input);
  return hash.digest("hex");
}

function stationKeyFor(systemId: string, stationId: string): string {
  return sha256Hex(`station_key:${systemId}:${stationId}`);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return null;
  }
  return String(value);
}

function toIsoSeconds(epochSeconds: number | null): string | null {
  if (epochSeconds == null) {
    return null;
  }
  return new Date(epochSeconds * 1000).toISOString();
}

function parsePayload(raw: string): StationPayload {
  try {
    return JSON.parse(raw) as StationPayload;
  } catch {
    return {};
  }
}

function parseStationInformation(
  systemId: string,
  payload: StationPayload
): StationInformationRow[] {
  const stations = payload.data?.stations;
  if (!Array.isArray(stations)) {
    return [];
  }
  const rows: StationInformationRow[] = [];
  for (const station of stations) {
    const stationId = asString(station.station_id);
    const lat = asNumber(station.lat);
    const lon = asNumber(station.lon);
    if (!stationId || lat == null || lon == null) {
      continue;
    }
    rows.push({
      station_key: stationKeyFor(systemId, stationId),
      station_id: stationId,
      name: asString(station.name),
      short_name: asString(station.short_name),
      region_id: asString(station.region_id),
      lat,
      lon,
      capacity: asNumber(station.capacity),
    });
  }
  return rows;
}

function parseStationStatus(
  systemId: string,
  payload: StationPayload,
  publisherLastUpdated: string,
  collectedAt: string
): StationStatusRow[] {
  const stations = payload.data?.stations;
  if (!Array.isArray(stations)) {
    return [];
  }
  const rows: StationStatusRow[] = [];
  for (const station of stations) {
    const stationId = asString(station.station_id);
    const bikes = asNumber(station.num_bikes_available);
    const docks = asNumber(station.num_docks_available);
    if (!stationId || bikes == null || docks == null) {
      continue;
    }
    const lastReported = toIsoSeconds(asNumber(station.last_reported));
    const observationRaw = lastReported ?? publisherLastUpdated ?? collectedAt;
    const observation = observationRaw >= publisherLastUpdated
      ? observationRaw
      : publisherLastUpdated;

    const flags: string[] = [];
    if (bikes < 0 || docks < 0) {
      flags.push("NEGATIVE_INVENTORY");
    }
    if (!Number.isFinite(bikes) || !Number.isFinite(docks)) {
      flags.push("MISSING_COUNTS");
    }
    const isServingGrade = flags.length === 0;
    const flagsLiteral = flags.length > 0 ? `{${flags.join(",")}}` : "{}";

    rows.push({
      station_key: stationKeyFor(systemId, stationId),
      station_id: stationId,
      bikes_available: Math.max(0, Math.trunc(bikes)),
      docks_available: Math.max(0, Math.trunc(docks)),
      is_installed: typeof station.is_installed === "number"
        ? station.is_installed === 1
        : (typeof station.is_installed === "boolean" ? station.is_installed : null),
      is_renting: typeof station.is_renting === "number"
        ? station.is_renting === 1
        : (typeof station.is_renting === "boolean" ? station.is_renting : null),
      is_returning: typeof station.is_returning === "number"
        ? station.is_returning === 1
        : (typeof station.is_returning === "boolean" ? station.is_returning : null),
      last_reported: lastReported,
      observation_ts_raw: observationRaw,
      observation_ts: observation,
      quality_flags_literal: flagsLiteral,
      is_serving_grade: isServingGrade,
    });
  }
  return rows;
}

async function readManifest(path: string): Promise<GbfsManifest> {
  const raw = await fs.readFile(path, "utf-8");
  return JSON.parse(raw) as GbfsManifest;
}

async function readRawObject(path: string): Promise<string> {
  const raw = await fs.readFile(path, "utf-8");
  return raw.toString();
}

async function insertLogicalSnapshot(
  db: SqlExecutor,
  manifest: GbfsManifest,
  publisherLastUpdated: string
): Promise<{ logical_snapshot_id: number; deduped: boolean; conflict: boolean } > {
  const insertResult = await db.query<{ logical_snapshot_id: number; raw_object_sha256: string }>(
    `INSERT INTO logical_snapshots (
      system_id,
      feed_name,
      collected_at,
      publisher_last_updated,
      parse_schema_id,
      parser_fingerprint,
      loader_schema_version,
      raw_object_sha256,
      manifest_path,
      parquet_path
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (system_id, feed_name, publisher_last_updated, loader_schema_version)
    DO NOTHING
    RETURNING logical_snapshot_id, raw_object_sha256`,
    [
      manifest.system_id,
      manifest.feed_name,
      manifest.collected_at,
      publisherLastUpdated,
      manifest.parse_schema_id,
      manifest.parser_fingerprint,
      manifest.loader_schema_version,
      manifest.raw_object_sha256,
      manifest.manifest_path,
      null,
    ]
  );

  if (insertResult.rows.length > 0) {
    return {
      logical_snapshot_id: insertResult.rows[0].logical_snapshot_id,
      deduped: false,
      conflict: false,
    };
  }

  const existing = await db.query<{ logical_snapshot_id: number; raw_object_sha256: string }>(
    `SELECT logical_snapshot_id, raw_object_sha256
     FROM logical_snapshots
     WHERE system_id = $1 AND feed_name = $2 AND publisher_last_updated = $3 AND loader_schema_version = $4`,
    [
      manifest.system_id,
      manifest.feed_name,
      publisherLastUpdated,
      manifest.loader_schema_version,
    ]
  );

  if (existing.rows.length === 0) {
    throw new Error("logical_snapshot_missing_after_conflict");
  }

  const row = existing.rows[0];
  const conflict = row.raw_object_sha256 !== manifest.raw_object_sha256;
  return {
    logical_snapshot_id: row.logical_snapshot_id,
    deduped: true,
    conflict,
  };
}

async function insertRawManifest(db: SqlExecutor, manifest: GbfsManifest, publisherLastUpdated: string): Promise<void> {
  await db.query(
    `INSERT INTO raw_manifests (
      system_id,
      feed_name,
      collected_at,
      publisher_last_updated,
      parse_schema_id,
      parser_fingerprint,
      loader_schema_version,
      raw_object_sha256,
      manifest_path,
      object_path,
      content_type,
      bytes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT DO NOTHING`,
    [
      manifest.system_id,
      manifest.feed_name,
      manifest.collected_at,
      publisherLastUpdated,
      manifest.parse_schema_id,
      manifest.parser_fingerprint,
      manifest.loader_schema_version,
      manifest.raw_object_sha256,
      manifest.manifest_path,
      manifest.object_path,
      manifest.content_type,
      manifest.content_length,
    ]
  );
}

async function insertStationInformationRows(
  db: SqlExecutor,
  logicalSnapshotId: number,
  systemId: string,
  publisherLastUpdated: string,
  rows: StationInformationRow[]
): Promise<{ scd_opened: number; scd_closed: number; lifecycle_upserts: number; station_rows_written: number }> {
  if (rows.length === 0) {
    return { scd_opened: 0, scd_closed: 0, lifecycle_upserts: 0, station_rows_written: 0 };
  }

  const stationKeys = rows.map((row) => row.station_key);
  const stationIds = rows.map((row) => row.station_id);
  const names = rows.map((row) => row.name);
  const shortNames = rows.map((row) => row.short_name);
  const regionIds = rows.map((row) => row.region_id);
  const lats = rows.map((row) => row.lat);
  const lons = rows.map((row) => row.lon);
  const capacities = rows.map((row) => row.capacity);

  const insertResult = await db.query(
    `WITH incoming AS (
      SELECT * FROM UNNEST(
        $1::text[],
        $2::text[],
        $3::text[],
        $4::text[],
        $5::text[],
        $6::double precision[],
        $7::double precision[],
        $8::int[]
      ) AS t(station_key, station_id, name, short_name, region_id, lat, lon, capacity)
    )
    INSERT INTO snapshot_station_information (
      logical_snapshot_id,
      system_id,
      station_key,
      station_id,
      name,
      short_name,
      region_id,
      lat,
      lon,
      capacity
    )
    SELECT $9, $10, station_key, station_id, name, short_name, region_id, lat, lon, capacity
    FROM incoming
    ON CONFLICT (logical_snapshot_id, station_key) DO NOTHING
    RETURNING 1`,
    [
      stationKeys,
      stationIds,
      names,
      shortNames,
      regionIds,
      lats,
      lons,
      capacities,
      logicalSnapshotId,
      systemId,
    ]
  );

  const scdResult = await db.query<{ scd_closed: number; scd_opened: number }>(
    `WITH incoming AS (
      SELECT * FROM UNNEST(
        $1::text[],
        $2::text[],
        $3::text[],
        $4::text[],
        $5::text[],
        $6::double precision[],
        $7::double precision[],
        $8::int[]
      ) AS t(station_key, station_id, name, short_name, region_id, lat, lon, capacity)
    ),
    current AS (
      SELECT s.station_key, s.station_id, s.name, s.short_name, s.region_id, s.lat, s.lon, s.capacity
      FROM stations_scd s
      JOIN incoming i ON s.system_id = $9 AND s.station_key = i.station_key
      WHERE s.valid_to IS NULL
    ),
    changed AS (
      SELECT i.*
      FROM incoming i
      LEFT JOIN current c ON c.station_key = i.station_key
      WHERE c.station_key IS NULL
         OR c.station_id IS DISTINCT FROM i.station_id
         OR c.name IS DISTINCT FROM i.name
         OR c.short_name IS DISTINCT FROM i.short_name
         OR c.region_id IS DISTINCT FROM i.region_id
         OR c.lat IS DISTINCT FROM i.lat
         OR c.lon IS DISTINCT FROM i.lon
         OR c.capacity IS DISTINCT FROM i.capacity
    ),
    closed AS (
      UPDATE stations_scd s
      SET valid_to = $10, is_active = FALSE
      WHERE s.system_id = $9
        AND s.valid_to IS NULL
        AND s.station_key IN (SELECT station_key FROM changed)
      RETURNING s.station_key
    ),
    opened AS (
      INSERT INTO stations_scd (
        system_id,
        station_key,
        station_id,
        name,
        short_name,
        region_id,
        lat,
        lon,
        capacity,
        valid_from,
        valid_to,
        is_active,
        source_logical_snapshot_id
      )
      SELECT $9, station_key, station_id, name, short_name, region_id, lat, lon, capacity,
             $10, NULL, TRUE, $11
      FROM changed
      ON CONFLICT (system_id, station_key, valid_from) DO NOTHING
      RETURNING station_key
    )
    SELECT (SELECT COUNT(*) FROM closed) AS scd_closed,
           (SELECT COUNT(*) FROM opened) AS scd_opened`,
    [
      stationKeys,
      stationIds,
      names,
      shortNames,
      regionIds,
      lats,
      lons,
      capacities,
      systemId,
      publisherLastUpdated,
      logicalSnapshotId,
    ]
  );

  const lifecycleResult = await db.query<{ lifecycle_upserts: number }>(
    `WITH incoming AS (
      SELECT DISTINCT UNNEST($1::text[]) AS station_key
    ),
    upserted AS (
      INSERT INTO station_lifecycle (
        system_id,
        station_key,
        first_seen_at,
        last_seen_at,
        last_active_at,
        lifecycle_status
      )
      SELECT $2, station_key, $3, $3, NULL, 'active'
      FROM incoming
      ON CONFLICT (system_id, station_key) DO UPDATE
        SET last_seen_at = GREATEST(station_lifecycle.last_seen_at, EXCLUDED.last_seen_at),
            updated_at = NOW(),
            lifecycle_status = CASE
              WHEN station_lifecycle.lifecycle_status = 'retired' THEN station_lifecycle.lifecycle_status
              ELSE EXCLUDED.lifecycle_status
            END
      RETURNING 1
    )
    SELECT COUNT(*) AS lifecycle_upserts FROM upserted`,
    [stationKeys, systemId, publisherLastUpdated]
  );

  return {
    scd_opened: scdResult.rows[0]?.scd_opened ?? 0,
    scd_closed: scdResult.rows[0]?.scd_closed ?? 0,
    lifecycle_upserts: lifecycleResult.rows[0]?.lifecycle_upserts ?? 0,
    station_rows_written: insertResult.rows.length,
  };
}

async function insertStationStatusRows(
  db: SqlExecutor,
  logicalSnapshotId: number,
  systemId: string,
  rows: StationStatusRow[]
): Promise<{ station_rows_written: number; lifecycle_upserts: number }> {
  if (rows.length === 0) {
    return { station_rows_written: 0, lifecycle_upserts: 0 };
  }

  const stationKeys = rows.map((row) => row.station_key);
  const stationIds = rows.map((row) => row.station_id);
  const bikes = rows.map((row) => row.bikes_available);
  const docks = rows.map((row) => row.docks_available);
  const isInstalled = rows.map((row) => row.is_installed);
  const isRenting = rows.map((row) => row.is_renting);
  const isReturning = rows.map((row) => row.is_returning);
  const lastReported = rows.map((row) => row.last_reported);
  const observationRaw = rows.map((row) => row.observation_ts_raw);
  const observation = rows.map((row) => row.observation_ts);
  const qualityFlags = rows.map((row) => row.quality_flags_literal);
  const servingGrades = rows.map((row) => row.is_serving_grade);

  const insertResult = await db.query(
    `WITH incoming AS (
      SELECT * FROM UNNEST(
        $1::text[],
        $2::text[],
        $3::int[],
        $4::int[],
        $5::boolean[],
        $6::boolean[],
        $7::boolean[],
        $8::timestamptz[],
        $9::timestamptz[],
        $10::timestamptz[],
        $11::text[],
        $12::boolean[]
      ) AS t(
        station_key,
        station_id,
        bikes_available,
        docks_available,
        is_installed,
        is_renting,
        is_returning,
        last_reported,
        observation_ts_raw,
        observation_ts,
        quality_flags_literal,
        is_serving_grade
      )
    )
    INSERT INTO snapshot_station_status (
      logical_snapshot_id,
      system_id,
      station_key,
      station_id,
      bikes_available,
      docks_available,
      is_installed,
      is_renting,
      is_returning,
      last_reported,
      observation_ts_raw,
      observation_ts,
      quality_flag_codes,
      is_serving_grade
    )
    SELECT $13, $14, station_key, station_id, bikes_available, docks_available,
           is_installed, is_renting, is_returning, last_reported, observation_ts_raw,
           observation_ts, quality_flags_literal::text[], is_serving_grade
    FROM incoming
    ON CONFLICT (logical_snapshot_id, station_key) DO NOTHING
    RETURNING 1`,
    [
      stationKeys,
      stationIds,
      bikes,
      docks,
      isInstalled,
      isRenting,
      isReturning,
      lastReported,
      observationRaw,
      observation,
      qualityFlags,
      servingGrades,
      logicalSnapshotId,
      systemId,
    ]
  );

  const lifecycleResult = await db.query<{ lifecycle_upserts: number }>(
    `WITH incoming AS (
      SELECT * FROM UNNEST($1::text[], $2::timestamptz[]) AS t(station_key, observed_at)
    ),
    normalized AS (
      SELECT station_key, MAX(observed_at) AS observed_at
      FROM incoming
      GROUP BY station_key
    ),
    upserted AS (
      INSERT INTO station_lifecycle (
        system_id,
        station_key,
        first_seen_at,
        last_seen_at,
        last_active_at,
        lifecycle_status
      )
      SELECT $3, station_key, observed_at, observed_at, observed_at, 'active'
      FROM normalized
      ON CONFLICT (system_id, station_key) DO UPDATE
        SET last_seen_at = GREATEST(station_lifecycle.last_seen_at, EXCLUDED.last_seen_at),
            last_active_at = GREATEST(COALESCE(station_lifecycle.last_active_at, EXCLUDED.last_active_at), EXCLUDED.last_active_at),
            updated_at = NOW(),
            lifecycle_status = CASE
              WHEN station_lifecycle.lifecycle_status = 'retired' THEN station_lifecycle.lifecycle_status
              ELSE EXCLUDED.lifecycle_status
            END
      RETURNING 1
    )
    SELECT COUNT(*) AS lifecycle_upserts FROM upserted`,
    [stationKeys, observation, systemId]
  );

  return {
    station_rows_written: insertResult.rows.length,
    lifecycle_upserts: lifecycleResult.rows[0]?.lifecycle_upserts ?? 0,
  };
}

export async function loadGbfsManifest(
  db: SqlExecutor,
  options: LoaderOptions
): Promise<LoadResult> {
  const manifest = await readManifest(options.manifest_path);
  if (!manifest.object_path || !manifest.raw_object_sha256) {
    throw new Error("manifest_missing_raw_object");
  }

  const publisherLastUpdated = manifest.publisher_last_updated ?? manifest.collected_at;
  if (!publisherLastUpdated) {
    throw new Error("manifest_missing_publisher_last_updated");
  }
  if (!manifest.publisher_last_updated) {
    logEvent("warn", "gbfs_manifest_missing_last_updated", {
      system_id: manifest.system_id,
      feed_name: manifest.feed_name,
      collected_at: manifest.collected_at,
      manifest_path: manifest.manifest_path,
    });
  }

  await db.query("BEGIN");
  try {
    await insertRawManifest(db, manifest, publisherLastUpdated);

    const logicalSnapshot = await insertLogicalSnapshot(db, manifest, publisherLastUpdated);
    if (logicalSnapshot.conflict) {
      logEvent("warn", "gbfs_logical_snapshot_conflict", {
        system_id: manifest.system_id,
        feed_name: manifest.feed_name,
        publisher_last_updated: publisherLastUpdated,
        loader_schema_version: manifest.loader_schema_version,
        raw_object_sha256: manifest.raw_object_sha256,
      });
      await db.query("COMMIT");
      return {
        logical_snapshot_id: logicalSnapshot.logical_snapshot_id,
        feed_name: manifest.feed_name,
        deduped: logicalSnapshot.deduped,
        conflict: true,
        conflict_reason: "raw_object_sha256_mismatch",
        station_rows_written: 0,
        station_rows_skipped: 0,
        scd_opened: 0,
        scd_closed: 0,
        lifecycle_upserts: 0,
      };
    }

    const rawPayload = await readRawObject(manifest.object_path);
    const parsed = parsePayload(rawPayload);

    let stationRowsWritten = 0;
    let stationRowsSkipped = 0;
    let scdOpened = 0;
    let scdClosed = 0;
    let lifecycleUpserts = 0;

    if (manifest.feed_name === "station_information") {
      const infoRows = parseStationInformation(manifest.system_id, parsed);
      stationRowsSkipped = Math.max(0, (parsed.data?.stations?.length ?? 0) - infoRows.length);
      const infoResult = await insertStationInformationRows(
        db,
        logicalSnapshot.logical_snapshot_id,
        manifest.system_id,
        publisherLastUpdated,
        infoRows
      );
      stationRowsWritten = infoResult.station_rows_written;
      scdOpened = infoResult.scd_opened;
      scdClosed = infoResult.scd_closed;
      lifecycleUpserts = infoResult.lifecycle_upserts;
    } else if (manifest.feed_name === "station_status") {
      const statusRows = parseStationStatus(
        manifest.system_id,
        parsed,
        publisherLastUpdated,
        manifest.collected_at
      );
      stationRowsSkipped = Math.max(0, (parsed.data?.stations?.length ?? 0) - statusRows.length);
      const statusResult = await insertStationStatusRows(
        db,
        logicalSnapshot.logical_snapshot_id,
        manifest.system_id,
        statusRows
      );
      stationRowsWritten = statusResult.station_rows_written;
      lifecycleUpserts = statusResult.lifecycle_upserts;
    }

    logEvent("info", "gbfs_manifest_loaded", {
      system_id: manifest.system_id,
      feed_name: manifest.feed_name,
      logical_snapshot_id: logicalSnapshot.logical_snapshot_id,
      publisher_last_updated: publisherLastUpdated,
      deduped: logicalSnapshot.deduped,
      raw_object_sha256: manifest.raw_object_sha256,
      manifest_path: manifest.manifest_path,
      station_rows_written: stationRowsWritten,
      station_rows_skipped: stationRowsSkipped,
      scd_opened: scdOpened,
      scd_closed: scdClosed,
      lifecycle_upserts: lifecycleUpserts,
    });

    await db.query("COMMIT");
    return {
      logical_snapshot_id: logicalSnapshot.logical_snapshot_id,
      feed_name: manifest.feed_name,
      deduped: logicalSnapshot.deduped,
      conflict: false,
      station_rows_written: stationRowsWritten,
      station_rows_skipped: stationRowsSkipped,
      scd_opened: scdOpened,
      scd_closed: scdClosed,
      lifecycle_upserts: lifecycleUpserts,
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
