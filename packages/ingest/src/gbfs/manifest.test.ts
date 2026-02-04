import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "bun:test";

import { deriveParserFingerprint } from "./manifest";

async function sha256File(filePath: string): Promise<string> {
  const payload = await fs.readFile(filePath);
  const hash = crypto.createHash("sha256");
  hash.update(payload);
  return hash.digest("hex");
}

type ManifestFixture = {
  feed_name: string;
  raw_object_sha256: string;
  object_path: string;
  parse_schema_id: string;
  loader_schema_version: string;
  parser_fingerprint: string;
};

const fixtureRoot = path.join(process.cwd(), "fixtures", "gbfs", "manifests");

describe("gbfs manifest fixtures", () => {
  it("matches raw_object_sha256 for station_status", async () => {
    const manifestPath = path.join(fixtureRoot, "station_status.manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as ManifestFixture;
    const rawPath = path.resolve(process.cwd(), manifest.object_path);
    const hash = await sha256File(rawPath);
    expect(hash).toBe(manifest.raw_object_sha256);
  });

  it("matches raw_object_sha256 for station_information", async () => {
    const manifestPath = path.join(fixtureRoot, "station_information.manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as ManifestFixture;
    const rawPath = path.resolve(process.cwd(), manifest.object_path);
    const hash = await sha256File(rawPath);
    expect(hash).toBe(manifest.raw_object_sha256);
  });

  it("derives parser_fingerprint deterministically", async () => {
    const manifestPath = path.join(fixtureRoot, "station_status.manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as ManifestFixture;
    const derived = deriveParserFingerprint(manifest.parse_schema_id, manifest.loader_schema_version);
    expect(derived).toBe(manifest.parser_fingerprint);
  });
});
