import type { GbfsFetchResult } from "./types";

function headerOrNull(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  return value && value.length > 0 ? value : null;
}

function numberOrNull(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchGbfsFeed(feedUrl: string): Promise<GbfsFetchResult> {
  const started = Date.now();
  try {
    const res = await fetch(feedUrl, {
      headers: {
        "accept-encoding": "identity",
        "user-agent": "urbanflow-gbfs/0.1",
      },
    });

    const body = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    const duration_ms = Date.now() - started;

    return {
      ok: res.ok,
      status: res.status,
      collected_at: new Date().toISOString(),
      duration_ms,
      etag: headerOrNull(res.headers, "etag"),
      content_type: headerOrNull(res.headers, "content-type"),
      content_encoding: headerOrNull(res.headers, "content-encoding"),
      last_modified: headerOrNull(res.headers, "last-modified"),
      content_length: numberOrNull(headerOrNull(res.headers, "content-length")),
      body,
      error_message: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (error) {
    const duration_ms = Date.now() - started;
    return {
      ok: false,
      status: 0,
      collected_at: new Date().toISOString(),
      duration_ms,
      etag: null,
      content_type: null,
      content_encoding: null,
      last_modified: null,
      content_length: null,
      body: null,
      error_message: (error as Error).message ?? "fetch_failed",
    };
  }
}
