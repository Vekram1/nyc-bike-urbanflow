import crypto from "crypto";

import type { GbfsManifest } from "./types";

export function deriveParserFingerprint(
  parseSchemaId: string,
  loaderSchemaVersion: string
): string {
  const hash = crypto.createHash("sha256");
  hash.update(`${parseSchemaId}:${loaderSchemaVersion}`);
  return hash.digest("hex");
}

export function createManifest(payload: GbfsManifest): GbfsManifest {
  return payload;
}
