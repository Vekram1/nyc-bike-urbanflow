import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "bun:test";

type FixtureManifest = {
  fixtures: Array<{
    filename: string;
    checksum_sha256: string;
  }>;
};

type TileContract = {
  tile_schema_version: string;
  layers: string[];
  required_properties: Record<string, string[]>;
  optional_properties?: Record<string, string[]>;
  inspect_minimum: Record<string, string>;
};

type PolicyInput = {
  policy_version: string;
  system_id: string;
  decision_bucket_ts: number;
  bucket_size_s: number;
  spec: {
    effort: {
      bike_move_budget_per_step: number;
      max_stations_touched: number;
      max_moves: number;
    };
  };
  stations: Array<{
    station_key: string;
    capacity: number;
    bikes: number;
    docks: number;
    bucket_quality: string;
  }>;
};

type PolicyExpected = {
  policy_version: string;
  system_id: string;
  decision_bucket_ts: number;
  effort: {
    bike_move_budget_per_step: number;
    max_stations_touched: number;
    max_moves: number;
  };
  moves: Array<{
    from_station_key: string;
    to_station_key: string;
    bikes_moved: number;
    dist_m: number;
    rank: number;
  }>;
  stations_touched: Array<{
    station_key: string;
    capacity: number;
    bikes_before: number;
    bikes_after: number;
    L_s: number;
    U_s: number;
    need_before: number;
    excess_before: number;
  }>;
  summary: {
    bikes_moved_total: number;
    stations_touched: number;
    no_op: boolean;
  };
};

async function sha256File(filePath: string): Promise<string> {
  const payload = await fs.readFile(filePath);
  const hash = crypto.createHash("sha256");
  hash.update(payload);
  return hash.digest("hex");
}

async function loadManifest(manifestPath: string): Promise<FixtureManifest> {
  const raw = await fs.readFile(manifestPath, "utf-8");
  return JSON.parse(raw) as FixtureManifest;
}

describe("tile contract fixtures", () => {
  it("matches fixture checksums", async () => {
    const manifestPath = path.join(process.cwd(), "fixtures", "tiles", "composite_tile.manifest.json");
    const manifest = await loadManifest(manifestPath);

    for (const fixture of manifest.fixtures) {
      const resolved = path.resolve(process.cwd(), fixture.filename);
      const hash = await sha256File(resolved);
      expect(hash).toBe(fixture.checksum_sha256);
    }
  });

  it("includes inspect minimum properties in inventory layer", async () => {
    const contractPath = path.join(process.cwd(), "fixtures", "tiles", "composite_tile.contract.json");
    const contract = JSON.parse(await fs.readFile(contractPath, "utf-8")) as TileContract;

    const invProps = new Set(contract.required_properties.inv ?? []);
    for (const key of Object.keys(contract.inspect_minimum)) {
      expect(invProps.has(key)).toBe(true);
    }
  });
});

describe("policy contract fixtures", () => {
  it("matches fixture checksums", async () => {
    const manifestPath = path.join(process.cwd(), "fixtures", "policy", "greedy_v1.manifest.json");
    const manifest = await loadManifest(manifestPath);

    for (const fixture of manifest.fixtures) {
      const resolved = path.resolve(process.cwd(), fixture.filename);
      const hash = await sha256File(resolved);
      expect(hash).toBe(fixture.checksum_sha256);
    }
  });

  it("satisfies invariants for expected moves", async () => {
    const inputPath = path.join(process.cwd(), "fixtures", "policy", "greedy_v1_input.json");
    const expectedPath = path.join(process.cwd(), "fixtures", "policy", "greedy_v1_expected.json");

    const input = JSON.parse(await fs.readFile(inputPath, "utf-8")) as PolicyInput;
    const expected = JSON.parse(await fs.readFile(expectedPath, "utf-8")) as PolicyExpected;

    expect(expected.policy_version).toBe(input.policy_version);
    expect(expected.system_id).toBe(input.system_id);
    expect(expected.decision_bucket_ts).toBe(input.decision_bucket_ts);

    const stationMap = new Map(
      input.stations.map((station) => [station.station_key, station])
    );

    const moveBikeTotal = expected.moves.reduce((sum, move) => sum + move.bikes_moved, 0);
    expect(moveBikeTotal).toBe(expected.summary.bikes_moved_total);
    expect(expected.summary.stations_touched).toBe(expected.stations_touched.length);
    expect(expected.moves.length).toBeLessThanOrEqual(expected.effort.max_moves);
    expect(moveBikeTotal).toBeLessThanOrEqual(expected.effort.bike_move_budget_per_step);

    const touchedSet = new Set(expected.stations_touched.map((station) => station.station_key));
    expect(touchedSet.size).toBeLessThanOrEqual(expected.effort.max_stations_touched);

    let deltaSum = 0;
    for (const station of expected.stations_touched) {
      const inputStation = stationMap.get(station.station_key);
      expect(inputStation).toBeDefined();
      expect(station.bikes_before).toBeGreaterThanOrEqual(0);
      expect(station.bikes_after).toBeGreaterThanOrEqual(0);
      expect(station.bikes_before).toBeLessThanOrEqual(station.capacity);
      expect(station.bikes_after).toBeLessThanOrEqual(station.capacity);
      expect(station.L_s).toBeLessThanOrEqual(station.U_s);
      deltaSum += station.bikes_after - station.bikes_before;
    }
    expect(deltaSum).toBe(0);

    for (const move of expected.moves) {
      expect(stationMap.has(move.from_station_key)).toBe(true);
      expect(stationMap.has(move.to_station_key)).toBe(true);
      expect(move.bikes_moved).toBeGreaterThan(0);
    }
  });
});
