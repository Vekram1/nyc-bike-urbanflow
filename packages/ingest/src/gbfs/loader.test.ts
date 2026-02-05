import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "bun:test";

import { loadGbfsManifest } from "./loader";
import type { SqlExecutor, SqlQueryResult } from "../db/types";

const fixtureRoot = path.join(process.cwd(), "fixtures", "gbfs", "manifests");

type LogicalSnapshot = {
  logical_snapshot_id: number;
  system_id: string;
  feed_name: string;
  publisher_last_updated: string;
  loader_schema_version: string;
  raw_object_sha256: string;
};

type StationStatusRecord = {
  station_key: string;
  bucket_quality: string;
  is_serving_grade: boolean;
  quality_flags: string[];
};

class FakeDb implements SqlExecutor {
  private logicalSnapshots: LogicalSnapshot[] = [];
  private rawManifests = new Set<string>();
  private snapshotStatusKeys = new Map<number, Set<string>>();
  private snapshotInfoKeys = new Map<number, Set<string>>();
  private stationScd = new Map<string, string>();
  private stationStatusRows = new Map<number, StationStatusRecord[]>();
  private nextSnapshotId = 1;

  seedLogicalSnapshot(snapshot: Omit<LogicalSnapshot, "logical_snapshot_id">): void {
    this.logicalSnapshots.push({
      logical_snapshot_id: this.nextSnapshotId++,
      ...snapshot,
    });
  }

  getStationStatusRows(logicalSnapshotId: number): StationStatusRecord[] {
    return this.stationStatusRows.get(logicalSnapshotId) ?? [];
  }

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    const trimmed = text.trim();
    if (trimmed === "BEGIN" || trimmed === "COMMIT" || trimmed === "ROLLBACK") {
      return { rows: [] as Row[] };
    }

    if (trimmed.startsWith("SELECT publisher_last_updated")) {
      const systemId = params[0] as string;
      const feedName = params[1] as string;
      const latest = this.logicalSnapshots
        .filter((row) => row.system_id === systemId && row.feed_name === feedName)
        .sort((a, b) => (a.publisher_last_updated < b.publisher_last_updated ? 1 : -1))[0];
      return { rows: (latest ? [{ publisher_last_updated: latest.publisher_last_updated }] : []) as Row[] };
    }

    if (trimmed.startsWith("INSERT INTO raw_manifests")) {
      const rawObjectSha = params[7] as string;
      this.rawManifests.add(rawObjectSha);
      return { rows: [] as Row[] };
    }

    if (trimmed.startsWith("INSERT INTO logical_snapshots")) {
      const [systemId, feedName, , publisherLastUpdated, , , loaderSchemaVersion, rawObjectSha] = params as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
      const existing = this.logicalSnapshots.find(
        (row) =>
          row.system_id === systemId &&
          row.feed_name === feedName &&
          row.publisher_last_updated === publisherLastUpdated &&
          row.loader_schema_version === loaderSchemaVersion
      );
      if (existing) {
        return { rows: [] as Row[] };
      }
      const logicalSnapshot: LogicalSnapshot = {
        logical_snapshot_id: this.nextSnapshotId++,
        system_id: systemId,
        feed_name: feedName,
        publisher_last_updated: publisherLastUpdated,
        loader_schema_version: loaderSchemaVersion,
        raw_object_sha256: rawObjectSha,
      };
      this.logicalSnapshots.push(logicalSnapshot);
      return {
        rows: [{ logical_snapshot_id: logicalSnapshot.logical_snapshot_id, raw_object_sha256: rawObjectSha }] as Row[],
      };
    }

    if (trimmed.startsWith("SELECT logical_snapshot_id, raw_object_sha256")) {
      const [systemId, feedName, publisherLastUpdated, loaderSchemaVersion] = params as [
        string,
        string,
        string,
        string
      ];
      const existing = this.logicalSnapshots.find(
        (row) =>
          row.system_id === systemId &&
          row.feed_name === feedName &&
          row.publisher_last_updated === publisherLastUpdated &&
          row.loader_schema_version === loaderSchemaVersion
      );
      return {
        rows: existing
          ? ([
              {
                logical_snapshot_id: existing.logical_snapshot_id,
                raw_object_sha256: existing.raw_object_sha256,
              },
            ] as Row[])
          : ([] as Row[]),
      };
    }

    if (trimmed.startsWith("WITH incoming") && trimmed.includes("INSERT INTO snapshot_station_information")) {
      const stationKeys = params[0] as string[];
      const logicalSnapshotId = params[8] as number;
      const existing = this.snapshotInfoKeys.get(logicalSnapshotId) ?? new Set<string>();
      let inserted = 0;
      for (const key of stationKeys) {
        if (!existing.has(key)) {
          existing.add(key);
          inserted += 1;
        }
      }
      this.snapshotInfoKeys.set(logicalSnapshotId, existing);
      return { rows: Array.from({ length: inserted }, () => ({})) as Row[] };
    }

    if (trimmed.startsWith("WITH incoming") && trimmed.includes("UPDATE stations_scd")) {
      const stationKeys = params[0] as string[];
      const stationIds = params[1] as (string | null)[];
      const names = params[2] as (string | null)[];
      const shortNames = params[3] as (string | null)[];
      const regionIds = params[4] as (string | null)[];
      const lats = params[5] as number[];
      const lons = params[6] as number[];
      const capacities = params[7] as (number | null)[];

      let scdOpened = 0;
      let scdClosed = 0;
      stationKeys.forEach((key, index) => {
        const snapshot = [
          stationIds[index],
          names[index],
          shortNames[index],
          regionIds[index],
          lats[index],
          lons[index],
          capacities[index],
        ].join("|");
        const prev = this.stationScd.get(key);
        if (!prev || prev !== snapshot) {
          if (prev) {
            scdClosed += 1;
          }
          scdOpened += 1;
          this.stationScd.set(key, snapshot);
        }
      });
      return { rows: [{ scd_closed: scdClosed, scd_opened: scdOpened }] as Row[] };
    }

    if (trimmed.startsWith("WITH incoming") && trimmed.includes("INSERT INTO station_lifecycle")) {
      const stationKeys = params[0] as string[];
      const unique = new Set(stationKeys);
      return { rows: [{ lifecycle_upserts: unique.size }] as Row[] };
    }

    if (trimmed.startsWith("WITH incoming") && trimmed.includes("INSERT INTO snapshot_station_status")) {
      const stationKeys = params[0] as string[];
      const qualityFlags = params[10] as string[];
      const bucketQualities = params[11] as string[];
      const servingGrades = params[12] as boolean[];
      const logicalSnapshotId = params[13] as number;
      const existing = this.snapshotStatusKeys.get(logicalSnapshotId) ?? new Set<string>();
      let inserted = 0;
      const rows: StationStatusRecord[] = [];

      stationKeys.forEach((key, index) => {
        if (!existing.has(key)) {
          existing.add(key);
          inserted += 1;
          rows.push({
            station_key: key,
            bucket_quality: bucketQualities[index],
            is_serving_grade: servingGrades[index],
            quality_flags: parseFlags(qualityFlags[index]),
          });
        }
      });

      this.snapshotStatusKeys.set(logicalSnapshotId, existing);
      if (rows.length > 0) {
        this.stationStatusRows.set(logicalSnapshotId, rows);
      }
      return { rows: Array.from({ length: inserted }, () => ({})) as Row[] };
    }

    return { rows: [] as Row[] };
  }
}

function parseFlags(flagsLiteral: string): string[] {
  const trimmed = flagsLiteral.trim();
  if (trimmed === "{}") {
    return [];
  }
  const inner = trimmed.replace(/^\{/, "").replace(/\}$/, "");
  return inner.length ? inner.split(",") : [];
}

async function loadManifestPath(name: string): Promise<string> {
  return path.join(fixtureRoot, name);
}

describe("gbfs loader", () => {
  it("is idempotent for station_status", async () => {
    const db = new FakeDb();
    const manifestPath = await loadManifestPath("station_status.manifest.json");

    const first = await loadGbfsManifest(db, { manifest_path: manifestPath });
    const second = await loadGbfsManifest(db, { manifest_path: manifestPath });

    expect(first.conflict).toBe(false);
    expect(first.station_rows_written).toBeGreaterThan(0);
    expect(second.station_rows_written).toBe(0);
    expect(second.deduped).toBe(true);
  });

  it("marks monotonicity violations as blocked", async () => {
    const db = new FakeDb();
    const manifestPath = await loadManifestPath("station_status.manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as {
      system_id: string;
      feed_name: string;
      loader_schema_version: string;
      raw_object_sha256: string;
    };

    db.seedLogicalSnapshot({
      system_id: manifest.system_id,
      feed_name: manifest.feed_name,
      publisher_last_updated: "2023-11-14T22:13:30Z",
      loader_schema_version: manifest.loader_schema_version,
      raw_object_sha256: manifest.raw_object_sha256,
    });

    const result = await loadGbfsManifest(db, { manifest_path: manifestPath });
    const rows = db.getStationStatusRows(result.logical_snapshot_id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].bucket_quality).toBe("blocked");
    expect(rows[0].is_serving_grade).toBe(false);
    expect(rows[0].quality_flags).toContain("MONOTONICITY_VIOLATION");
  });
});
