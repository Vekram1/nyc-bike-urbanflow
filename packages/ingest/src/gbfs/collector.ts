import path from "path";

import { buildArchivePaths, writeManifest, writeRawObject } from "./archive";
import { discoverGbfsFeeds } from "./discovery";
import { fetchGbfsFeed } from "./fetch";
import { createManifest, deriveParserFingerprint } from "./manifest";
import type {
  GbfsArchivePaths,
  GbfsDiscoveryResult,
  GbfsFeedName,
  GbfsManifest,
} from "./types";

type CollectorOptions = {
  system_id: string;
  discovery_url: string;
  data_root: string;
  feeds?: GbfsFeedName[];
  loader_schema_version?: string;
};

type CollectorResult = {
  discovery: GbfsDiscoveryResult;
  manifests: GbfsManifest[];
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

function parseGbfsPayload(body: Uint8Array): { ttl: number | null; last_updated: number | null } {
  try {
    const text = new TextDecoder().decode(body);
    const json = JSON.parse(text) as { ttl?: number; last_updated?: number };
    return {
      ttl: typeof json.ttl === "number" ? json.ttl : null,
      last_updated: typeof json.last_updated === "number" ? json.last_updated : null,
    };
  } catch {
    return { ttl: null, last_updated: null };
  }
}

function toTimestampOrNull(value: number | null): string | null {
  if (value == null) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function pickFeeds(
  discovery: GbfsDiscoveryResult,
  requested?: GbfsFeedName[]
): GbfsFeedName[] {
  if (requested && requested.length > 0) {
    return requested;
  }
  return discovery.feeds.map((feed) => feed.name);
}

export async function collectGbfs(
  options: CollectorOptions
): Promise<CollectorResult> {
  const loader_schema_version = options.loader_schema_version ?? "loader.v1";
  const discovery = await discoverGbfsFeeds(
    options.system_id,
    options.discovery_url
  );
  const wantedFeeds = pickFeeds(discovery, options.feeds);
  const manifests: GbfsManifest[] = [];

  for (const feedName of wantedFeeds) {
    const feed = discovery.feeds.find((item) => item.name === feedName);
    if (!feed) {
      logEvent("warn", "gbfs_feed_missing", {
        system_id: options.system_id,
        feed_name: feedName,
      });
      continue;
    }

    const fetchResult = await fetchGbfsFeed(feed.url);
    const archivePaths: GbfsArchivePaths = buildArchivePaths(
      options.data_root,
      feed.name,
      fetchResult.collected_at
    );

    let raw_object_sha256: string | null = null;
    let object_path: string | null = null;
    let raw_object_deduped = false;
    let publisher_last_updated: string | null = null;
    let ttl: number | null = null;

    if (fetchResult.body) {
      const parsed = parseGbfsPayload(fetchResult.body);
      ttl = parsed.ttl;
      publisher_last_updated = toTimestampOrNull(parsed.last_updated);
      const extension = ".json";
      const stored = await writeRawObject(
        options.data_root,
        fetchResult.body,
        extension
      );
      raw_object_sha256 = stored.sha256;
      object_path = stored.object_path;
      raw_object_deduped = stored.deduped;
      if (stored.deduped) {
        logEvent("info", "gbfs_raw_object_deduped", {
          system_id: options.system_id,
          feed_name: feed.name,
          hash_algo: "sha256",
          sha256: stored.sha256,
          object_path: stored.object_path,
        });
      }
    }

    const parse_schema_id = `gbfs.${feed.name}.v1`;
    const parser_fingerprint = deriveParserFingerprint(
      parse_schema_id,
      loader_schema_version
    );

    const manifest: GbfsManifest = createManifest({
      system_id: options.system_id,
      feed_name: feed.name,
      collected_at: fetchResult.collected_at,
      publisher_last_updated,
      ttl,
      http_status: fetchResult.status,
      ok: fetchResult.ok,
      etag: fetchResult.etag,
      content_length: fetchResult.content_length,
      content_type: fetchResult.content_type,
      content_encoding: fetchResult.content_encoding,
      last_modified: fetchResult.last_modified,
      duration_ms: fetchResult.duration_ms,
      raw_object_sha256,
      object_path,
      manifest_path: archivePaths.manifest_path,
      parse_schema_id,
      parser_fingerprint,
      loader_schema_version,
      gbfs_version: discovery.gbfs_version,
      source_url: feed.url,
    });

    await writeManifest(archivePaths.manifest_path, manifest);
    manifests.push(manifest);

    logEvent(fetchResult.ok ? "info" : "warn", "gbfs_feed_fetched", {
      system_id: options.system_id,
      feed_name: feed.name,
      status: fetchResult.status,
      collected_at: fetchResult.collected_at,
      publisher_last_updated,
      raw_object_sha256,
      raw_object_deduped,
      manifest_path: path.relative(process.cwd(), archivePaths.manifest_path),
    });
  }

  return { discovery, manifests };
}
