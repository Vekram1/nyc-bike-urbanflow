export type GbfsFeedName = "station_information" | "station_status" | string;

export type GbfsDiscoveryFeed = {
  name: GbfsFeedName;
  url: string;
};

export type GbfsDiscoveryPayload = {
  last_updated?: number;
  ttl?: number;
  data: Record<string, { feeds: GbfsDiscoveryFeed[] }>;
  version?: string;
};

export type GbfsDiscoveryResult = {
  system_id: string;
  gbfs_version: string | null;
  discovery_url: string;
  language: string;
  feeds: GbfsDiscoveryFeed[];
  ttl: number | null;
  last_updated: number | null;
};

export type GbfsFetchResult = {
  ok: boolean;
  status: number;
  collected_at: string;
  duration_ms: number;
  etag: string | null;
  content_type: string | null;
  content_encoding: string | null;
  last_modified: string | null;
  content_length: number | null;
  body: Uint8Array | null;
  error_message: string | null;
};

export type GbfsManifest = {
  system_id: string;
  feed_name: GbfsFeedName;
  collected_at: string;
  publisher_last_updated: string | null;
  ttl: number | null;
  http_status: number;
  ok: boolean;
  etag: string | null;
  content_length: number | null;
  content_type: string | null;
  content_encoding: string | null;
  last_modified: string | null;
  duration_ms: number;
  raw_object_sha256: string | null;
  object_path: string | null;
  manifest_path: string;
  parse_schema_id: string;
  parser_fingerprint: string;
  loader_schema_version: string;
  gbfs_version: string | null;
  source_url: string;
};

export type GbfsArchivePaths = {
  data_root: string;
  manifest_path: string;
};

export type GbfsPollerConfig = {
  min_ttl_s: number;
  max_ttl_s: number;
  jitter_s: number;
};
