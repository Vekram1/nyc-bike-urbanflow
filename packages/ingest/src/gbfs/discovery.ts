import type { GbfsDiscoveryPayload, GbfsDiscoveryResult } from "./types";

function pickLanguage(data: GbfsDiscoveryPayload["data"]): string {
  if (data.en) {
    return "en";
  }
  const keys = Object.keys(data);
  if (keys.length === 0) {
    throw new Error("GBFS discovery payload missing data feeds");
  }
  return keys[0] as string;
}

export async function discoverGbfsFeeds(
  systemId: string,
  discoveryUrl: string
): Promise<GbfsDiscoveryResult> {
  const res = await fetch(discoveryUrl, {
    headers: {
      "accept-encoding": "identity",
      "user-agent": "urbanflow-gbfs/0.1",
    },
  });

  if (!res.ok) {
    throw new Error(`GBFS discovery failed (${res.status}) for ${discoveryUrl}`);
  }

  const payload = (await res.json()) as GbfsDiscoveryPayload;
  const language = pickLanguage(payload.data);
  const feeds = payload.data[language]?.feeds ?? [];
  if (feeds.length === 0) {
    throw new Error(`No feeds found in gbfs.json for system_id=${systemId}`);
  }

  return {
    system_id: systemId,
    gbfs_version: payload.version ?? null,
    discovery_url: discoveryUrl,
    language,
    feeds,
    ttl: payload.ttl ?? null,
    last_updated: payload.last_updated ?? null,
  };
}
