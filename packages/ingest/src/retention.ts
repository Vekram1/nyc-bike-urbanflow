import fs from "fs/promises";
import path from "path";

import type { SqlExecutor } from "./db/types";

export type ArchiveFileEntry = {
  path_abs: string;
  path_rel: string;
  bytes: number;
  mtime_ms: number;
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
      out.push({
        path_abs: full,
        path_rel: rel,
        bytes: Number(st.size),
        mtime_ms: st.mtimeMs,
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

  out.sort((a, b) => a.mtime_ms - b.mtime_ms || a.path_rel.localeCompare(b.path_rel));
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
    ageCutoffMs == null ? [] : files.filter((file) => file.mtime_ms < ageCutoffMs);

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
    (a, b) => a.mtime_ms - b.mtime_ms || a.path_rel.localeCompare(b.path_rel)
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
  const deleted: Record<string, number> = {};

  const statements: Array<{ key: string; sql: string }> = [
    {
      key: "station_pressure_now_5m",
      sql: `DELETE FROM station_pressure_now_5m WHERE system_id = $1 AND bucket_ts < $2::timestamptz`,
    },
    {
      key: "station_severity_5m",
      sql: `DELETE FROM station_severity_5m WHERE system_id = $1 AND bucket_ts < $2::timestamptz`,
    },
    {
      key: "station_status_1m",
      sql: `DELETE FROM station_status_1m WHERE system_id = $1 AND bucket_ts < $2::timestamptz`,
    },
    {
      key: "episode_markers_15m",
      sql: `DELETE FROM episode_markers_15m WHERE system_id = $1 AND bucket_ts < $2::timestamptz`,
    },
    {
      key: "logical_snapshots",
      sql: `DELETE FROM logical_snapshots WHERE system_id = $1 AND publisher_last_updated < $2::timestamptz`,
    },
    {
      key: "raw_manifests",
      sql: `DELETE FROM raw_manifests WHERE system_id = $1 AND publisher_last_updated < $2::timestamptz`,
    },
    {
      key: "fetch_attempts",
      sql: `DELETE FROM fetch_attempts WHERE system_id = $1 AND requested_at < $2::timestamptz`,
    },
  ];

  for (const stmt of statements) {
    const result = await args.db.query<{ count: string }>(
      `WITH deleted AS (${stmt.sql} RETURNING 1)
       SELECT COUNT(*)::text AS count FROM deleted`,
      [args.system_id, args.cutoff_iso]
    );
    deleted[stmt.key] = Number(result.rows[0]?.count ?? 0);
  }

  return {
    cutoff_iso: args.cutoff_iso,
    deleted,
  };
}
