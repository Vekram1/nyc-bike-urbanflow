import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import type { GbfsArchivePaths } from "./types";

type ArchiveWriteResult = {
  sha256: string;
  object_path: string;
  bytes: number;
};

function sha256Hex(payload: Uint8Array): string {
  const hash = crypto.createHash("sha256");
  hash.update(payload);
  return hash.digest("hex");
}

function chunkedPath(hash: string): string {
  const prefix = hash.slice(0, 2);
  const mid = hash.slice(2, 4);
  return `sha256=${prefix}/${mid}/${hash}`;
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeFileIfMissing(filePath: string, payload: Uint8Array): Promise<void> {
  try {
    await fs.writeFile(filePath, payload, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

export async function writeRawObject(
  dataRoot: string,
  payload: Uint8Array,
  extension: string
): Promise<ArchiveWriteResult> {
  const sha256 = sha256Hex(payload);
  const objectRelPath = path.join("objects", chunkedPath(sha256) + extension);
  const objectPath = path.join(dataRoot, objectRelPath);
  await ensureDir(path.dirname(objectPath));
  await writeFileIfMissing(objectPath, payload);
  return {
    sha256,
    object_path: objectPath,
    bytes: payload.byteLength,
  };
}

export async function writeManifest(
  manifestPath: string,
  manifest: Record<string, unknown>
): Promise<void> {
  await ensureDir(path.dirname(manifestPath));
  const payload = JSON.stringify(manifest, null, 2);
  await writeFileIfMissing(manifestPath, new TextEncoder().encode(payload));
}

export function buildArchivePaths(
  dataRoot: string,
  feedName: string,
  collectedAtIso: string
): GbfsArchivePaths {
  const collectedAt = new Date(collectedAtIso);
  const datePart = collectedAt.toISOString().slice(0, 10);
  const hourPart = collectedAt.toISOString().slice(11, 13);
  const basePath = path.join(
    dataRoot,
    `feed=${feedName}`,
    `dt=${datePart}`,
    `hour=${hourPart}`
  );
  const manifestPath = path.join(basePath, `${collectedAt.toISOString()}.manifest.json`);
  return {
    data_root: dataRoot,
    manifest_path: manifestPath,
  };
}
