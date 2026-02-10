import { createHash } from "node:crypto";

export type SnapshotIdentityRow = {
  station_key: string;
  bucket_ts: string | null;
  bikes_available: number | null;
  docks_available: number | null;
  capacity: number | null;
  bucket_quality: string | null;
};

export function parseIsoEpochSeconds(value: string | null): number | null {
  if (!value || value.trim().length === 0) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 1000);
}

export function deriveEffectiveSnapshotBucket(
  tBucketEpochS: number | null,
  snapshot: Array<{ bucket_ts: string | null }>
): number | null {
  if (tBucketEpochS !== null) return tBucketEpochS;
  for (const row of snapshot) {
    const parsed = parseIsoEpochSeconds(row.bucket_ts);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function buildSnapshotIdentity(args: {
  system_id: string;
  view_id: number;
  view_spec_sha256: string;
  effective_t_bucket: number | null;
  snapshot: SnapshotIdentityRow[];
}): { view_snapshot_id: string; view_snapshot_sha256: string } {
  const canonicalRows = [...args.snapshot]
    .sort((a, b) => a.station_key.localeCompare(b.station_key))
    .map((row) => ({
      station_key: row.station_key,
      bucket_ts: row.bucket_ts,
      bikes_available: row.bikes_available,
      docks_available: row.docks_available,
      capacity: row.capacity,
      bucket_quality: row.bucket_quality,
    }));
  const canonical = JSON.stringify({
    system_id: args.system_id,
    view_id: args.view_id,
    view_spec_sha256: args.view_spec_sha256,
    effective_t_bucket: args.effective_t_bucket,
    rows: canonicalRows,
  });
  const view_snapshot_sha256 = createHash("sha256").update(canonical).digest("hex");
  const view_snapshot_id = `vs:${args.system_id}:${args.view_id}:${args.effective_t_bucket ?? "latest"}:${view_snapshot_sha256.slice(0, 16)}`;
  return { view_snapshot_id, view_snapshot_sha256 };
}
