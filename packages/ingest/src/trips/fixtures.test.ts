import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "bun:test";

type ManifestFixture = {
  checksum_sha256: string;
  filename: string;
  row_count: number;
};

type ExpectedFixture = {
  row_count: number;
  member_type_counts: Record<string, number>;
  unique_start_stations: number;
  unique_end_stations: number;
};

const fixtureRoot = path.join(process.cwd(), "fixtures", "trips");

function sha256(payload: Uint8Array): string {
  const hash = crypto.createHash("sha256");
  hash.update(payload);
  return hash.digest("hex");
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split("\n");
  if (lines.length < 2) {
    return [];
  }
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return header.reduce<Record<string, string>>((acc, key, index) => {
      acc[key] = values[index] ?? "";
      return acc;
    }, {});
  });
}

describe("trips mini-month fixtures", () => {
  it("matches checksum in manifest", async () => {
    const manifestPath = path.join(fixtureRoot, "mini_month.manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as ManifestFixture;
    const csvPath = path.resolve(process.cwd(), manifest.filename);
    const payload = await fs.readFile(csvPath);
    expect(sha256(payload)).toBe(manifest.checksum_sha256);
  });

  it("matches expected aggregates", async () => {
    const csvPath = path.join(fixtureRoot, "mini_month.csv");
    const expectedPath = path.join(fixtureRoot, "mini_month.expected.json");
    const csv = await fs.readFile(csvPath, "utf-8");
    const expected = JSON.parse(await fs.readFile(expectedPath, "utf-8")) as ExpectedFixture;
    const records = parseCsv(csv);

    const memberTypeCounts: Record<string, number> = {};
    const startStations = new Set<string>();
    const endStations = new Set<string>();

    for (const record of records) {
      const memberType = record.member_type;
      memberTypeCounts[memberType] = (memberTypeCounts[memberType] ?? 0) + 1;
      startStations.add(record.start_station_id);
      endStations.add(record.end_station_id);
    }

    expect(records.length).toBe(expected.row_count);
    expect(memberTypeCounts).toEqual(expected.member_type_counts);
    expect(startStations.size).toBe(expected.unique_start_stations);
    expect(endStations.size).toBe(expected.unique_end_stations);
  });
});
