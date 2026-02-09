import fs from "fs/promises";
import path from "path";

import type { SqlExecutor } from "./db/types";

export type ArchiveFileEntry = {
  path_abs: string;
  path_rel: string;
  bytes: number;
  mtime_ms: number;
  logical_ts_ms: number | null;
  age_basis_ms: number;
  age_basis_source: "logical" | "mtime";
};

export type RetentionPlan = {
  total_files_before: number;
  total_bytes_before: number;
  total_files_after: number;
  total_bytes_after: number;
  age_candidates: ArchiveFileEntry[];
  size_candidates: ArchiveFileEntry[];
  delete_candidates: ArchiveFileEntry[];
};

export type DbPruneResult = {
  cutoff_iso: string;
  deleted: Record<string, number>;
};

type MaybeManifest = {
  publisher_last_updated?: unknown;
  collected_at?: unknown;
};

function parseIsoMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function maybeIsoFromFilename(name: string): number | null {
  const match = name.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/);
  if (!match) return null;
  return parseIsoMs(match[1]);
}

async function logicalTsForFile(fileAbs: string, fileName: string): Promise<number | null> {
  if (fileName.endsWith(".manifest.json")) {
    try {
      const payload = (await fs.readFile(fileAbs, "utf8")) as string;
      const parsed = JSON.parse(payload) as MaybeManifest;
      const publisher =
        typeof parsed.publisher_last_updated === "string"
          ? parseIsoMs(parsed.publisher_last_updated)
          : null;
      if (publisher != null) {
        return publisher;
      }
      const collected = typeof parsed.collected_at === "string" ? parseIsoMs(parsed.collected_at) : null;
      if (collected != null) {
        return collected;
      }
    } catch {
      // Fallback to filename/mtime when manifest cannot be parsed.
    }
  }

  return maybeIsoFromFilename(fileName);
}

async function walkFiles(root: string): Promise<ArchiveFileEntry[]> {
  const out: ArchiveFileEntry[] = [];

  async function walk(dirAbs: string): Promise<void> {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name === ".gitkeep") {
        continue;
      }
      const st = await fs.stat(full);
      const rel = path.relative(root, full);
      const logicalTsMs = await logicalTsForFile(full, entry.name);
      out.push({
        path_abs: full,
        path_rel: rel,
        bytes: Number(st.size),
        mtime_ms: st.mtimeMs,
        logical_ts_ms: logicalTsMs,
        age_basis_ms: logicalTsMs ?? st.mtimeMs,
        age_basis_source: logicalTsMs == null ? "mtime" : "logical",
      });
    }
  }

  try {
    await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  out.sort((a, b) => a.age_basis_ms - b.age_basis_ms || a.path_rel.localeCompare(b.path_rel));
  return out;
}

function sumBytes(files: ArchiveFileEntry[]): number {
  return files.reduce((acc, file) => acc + file.bytes, 0);
}

function toMaxBytes(rawGb: number | null): number | null {
  if (rawGb == null) return null;
  if (!Number.isFinite(rawGb) || rawGb <= 0) return null;
  return Math.floor(rawGb * 1024 * 1024 * 1024);
}

export async function planArchivePrune(args: {
  data_root: string;
  retention_days: number | null;
  max_archive_gb: number | null;
  now_ms?: number;
}): Promise<RetentionPlan> {
  const nowMs = args.now_ms ?? Date.now();
  const files = await walkFiles(args.data_root);
  const totalBefore = sumBytes(files);

  const maxBytes = toMaxBytes(args.max_archive_gb);
  const ageCutoffMs =
    args.retention_days == null ? null : nowMs - args.retention_days * 24 * 60 * 60 * 1000;

  const ageCandidates =
    ageCutoffMs == null ? [] : files.filter((file) => file.age_basis_ms < ageCutoffMs);

  const ageCandidateSet = new Set(ageCandidates.map((file) => file.path_abs));
  const retainedAfterAge = files.filter((file) => !ageCandidateSet.has(file.path_abs));

  const sizeCandidates: ArchiveFileEntry[] = [];
  if (maxBytes != null) {
    let running = sumBytes(retainedAfterAge);
    for (const file of retainedAfterAge) {
      if (running <= maxBytes) break;
      sizeCandidates.push(file);
      running -= file.bytes;
    }
  }

  const deleteMap = new Map<string, ArchiveFileEntry>();
  for (const file of ageCandidates) {
    deleteMap.set(file.path_abs, file);
  }
  for (const file of sizeCandidates) {
    deleteMap.set(file.path_abs, file);
  }
  const deleteCandidates = Array.from(deleteMap.values()).sort(
    (a, b) => a.age_basis_ms - b.age_basis_ms || a.path_rel.localeCompare(b.path_rel)
  );

  const deleteSet = new Set(deleteCandidates.map((file) => file.path_abs));
  const retained = files.filter((file) => !deleteSet.has(file.path_abs));

  return {
    total_files_before: files.length,
    total_bytes_before: totalBefore,
    total_files_after: retained.length,
    total_bytes_after: sumBytes(retained),
    age_candidates: ageCandidates,
    size_candidates: sizeCandidates,
    delete_candidates: deleteCandidates,
  };
}

export async function applyArchivePrune(plan: RetentionPlan): Promise<{ deleted_files: number; deleted_bytes: number }> {
  let deletedFiles = 0;
  let deletedBytes = 0;
  for (const file of plan.delete_candidates) {
    try {
      await fs.unlink(file.path_abs);
      deletedFiles += 1;
      deletedBytes += file.bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return { deleted_files: deletedFiles, deleted_bytes: deletedBytes };
}

export async function pruneDbHotWindow(args: {
  db: SqlExecutor;
  system_id: string;
  cutoff_iso: string;
}): Promise<DbPruneResult> {
  const result = await args.db.query<Record<string, string>>(
    `WITH
       d_station_pressure_now_5m AS (
         DELETE FROM station_pressure_now_5m
          WHERE system_id = $1
            AND bucket_ts < $2::timestamptz
          RETURNING 1
       ),
       d_station_severity_5m AS (
         DELETE FROM station_severity_5m
          WHERE system_id = $1
            AND bucket_ts < $2::timestamptz
          RETURNING 1
       ),
       d_station_status_1m AS (
         DELETE FROM station_status_1m
          WHERE system_id = $1
            AND bucket_ts < $2::timestamptz
          RETURNING 1
       ),
       d_episode_markers_15m AS (
         DELETE FROM episode_markers_15m
          WHERE system_id = $1
            AND bucket_ts < $2::timestamptz
          RETURNING 1
       ),
       d_logical_snapshots AS (
         DELETE FROM logical_snapshots
          WHERE system_id = $1
            AND publisher_last_updated < $2::timestamptz
          RETURNING 1
       ),
       d_raw_manifests AS (
         DELETE FROM raw_manifests
          WHERE system_id = $1
            AND publisher_last_updated < $2::timestamptz
          RETURNING 1
       ),
       d_fetch_attempts AS (
         DELETE FROM fetch_attempts
          WHERE system_id = $1
            AND requested_at < $2::timestamptz
          RETURNING 1
       )
     SELECT
       (SELECT COUNT(*)::text FROM d_station_pressure_now_5m) AS station_pressure_now_5m,
       (SELECT COUNT(*)::text FROM d_station_severity_5m) AS station_severity_5m,
       (SELECT COUNT(*)::text FROM d_station_status_1m) AS station_status_1m,
       (SELECT COUNT(*)::text FROM d_episode_markers_15m) AS episode_markers_15m,
       (SELECT COUNT(*)::text FROM d_logical_snapshots) AS logical_snapshots,
       (SELECT COUNT(*)::text FROM d_raw_manifests) AS raw_manifests,
       (SELECT COUNT(*)::text FROM d_fetch_attempts) AS fetch_attempts`,
    [args.system_id, args.cutoff_iso]
  );

  const row = result.rows[0] ?? {};
  const deleted: Record<string, number> = {
    station_pressure_now_5m: Number(row.station_pressure_now_5m ?? 0),
    station_severity_5m: Number(row.station_severity_5m ?? 0),
    station_status_1m: Number(row.station_status_1m ?? 0),
    episode_markers_15m: Number(row.episode_markers_15m ?? 0),
    logical_snapshots: Number(row.logical_snapshots ?? 0),
    raw_manifests: Number(row.raw_manifests ?? 0),
    fetch_attempts: Number(row.fetch_attempts ?? 0),
  };

  return {
    cutoff_iso: args.cutoff_iso,
    deleted,
  };
}
