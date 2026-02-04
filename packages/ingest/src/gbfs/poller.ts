import type { GbfsFeedName } from "./types";
import { collectGbfs } from "./collector";

type PollerOptions = {
  system_id: string;
  discovery_url: string;
  data_root: string;
  feeds?: GbfsFeedName[];
  loader_schema_version?: string;
  min_ttl_s?: number;
  max_ttl_s?: number;
  jitter_s?: number;
  stop_after_cycles?: number;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelaySeconds(
  ttl: number | null,
  minTtl: number,
  maxTtl: number,
  jitter: number
): number {
  let base = ttl ?? minTtl;
  if (!Number.isFinite(base) || base <= 0) {
    base = minTtl;
  }
  if (base < minTtl) base = minTtl;
  if (base > maxTtl) base = maxTtl;
  const jitterMs = Math.floor(Math.random() * jitter * 1000);
  return base + jitterMs / 1000;
}

export async function runGbfsPoller(options: PollerOptions): Promise<void> {
  const minTtl = options.min_ttl_s ?? 30;
  const maxTtl = options.max_ttl_s ?? 3600;
  const jitter = options.jitter_s ?? 5;
  let cycle = 0;

  while (true) {
    cycle += 1;
    const startedAt = new Date().toISOString();
    try {
      const result = await collectGbfs({
        system_id: options.system_id,
        discovery_url: options.discovery_url,
        data_root: options.data_root,
        feeds: options.feeds,
        loader_schema_version: options.loader_schema_version,
      });

      const ttl = result.discovery.ttl;
      if (ttl == null) {
        logEvent("warn", "gbfs_ttl_missing", {
          system_id: options.system_id,
          discovery_url: options.discovery_url,
          cycle,
        });
      }

      const delaySeconds = computeDelaySeconds(ttl, minTtl, maxTtl, jitter);
      logEvent("info", "gbfs_poll_scheduled", {
        system_id: options.system_id,
        cycle,
        ttl,
        delay_seconds: delaySeconds,
        started_at: startedAt,
      });

      if (options.stop_after_cycles && cycle >= options.stop_after_cycles) {
        return;
      }

      await sleep(delaySeconds * 1000);
    } catch (error) {
      logEvent("error", "gbfs_poll_failed", {
        system_id: options.system_id,
        cycle,
        message: (error as Error).message ?? "unknown_error",
      });
      const backoff = computeDelaySeconds(null, minTtl, maxTtl, jitter);
      await sleep(backoff * 1000);
    }
  }
}

