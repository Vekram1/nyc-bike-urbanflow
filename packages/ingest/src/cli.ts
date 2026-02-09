import fs from "fs/promises";
import path from "path";
import { SQL } from "bun";

import { collectGbfs } from "./gbfs/collector";
import { loadGbfsManifest } from "./gbfs/loader";
import { runGbfsPoller } from "./gbfs/poller";
import { loadSystemRegistry, requireSystemById } from "./gbfs/registry";
import type { GbfsManifest } from "./gbfs/types";
import type { SqlExecutor, SqlQueryResult } from "./db/types";

type CliArgs = {
  system_id: string | null;
  feeds: string[];
  data_root: string;
  mode: "once" | "poll" | "load";
  min_ttl_s: number;
  max_ttl_s: number;
  jitter_s: number;
  load_db: boolean;
  manifest_paths: string[];
  refresh_serving: boolean;
  refresh_lookback_minutes: number;
  severity_version: string;
  pressure_proxy_method: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    system_id: null,
    feeds: [],
    data_root: process.env.GBFS_DATA_ROOT ?? "data/gbfs",
    mode: "once",
    min_ttl_s: Number(process.env.GBFS_MIN_TTL_S ?? 30),
    max_ttl_s: Number(process.env.GBFS_MAX_TTL_S ?? 3600),
    jitter_s: Number(process.env.GBFS_TTL_JITTER_S ?? 5),
    load_db: false,
    manifest_paths: [],
    refresh_serving: false,
    refresh_lookback_minutes: Number(process.env.REFRESH_LOOKBACK_MINUTES ?? 180),
    severity_version: process.env.SEVERITY_VERSION?.trim() || "sev.v1",
    pressure_proxy_method: process.env.PRESSURE_PROXY_METHOD?.trim() || "delta_cap.v1",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--system" && argv[i + 1]) {
      args.system_id = argv[i + 1] ?? null;
      i += 1;
    } else if (token === "--feed" && argv[i + 1]) {
      args.feeds.push(argv[i + 1] ?? "");
      i += 1;
    } else if (token === "--data-root" && argv[i + 1]) {
      args.data_root = argv[i + 1] ?? args.data_root;
      i += 1;
    } else if (token === "--poll") {
      args.mode = "poll";
    } else if (token === "--min-ttl" && argv[i + 1]) {
      args.min_ttl_s = Number(argv[i + 1]);
      i += 1;
    } else if (token === "--max-ttl" && argv[i + 1]) {
      args.max_ttl_s = Number(argv[i + 1]);
      i += 1;
    } else if (token === "--jitter" && argv[i + 1]) {
      args.jitter_s = Number(argv[i + 1]);
      i += 1;
    } else if (token === "--load") {
      args.mode = "load";
    } else if (token === "--load-db") {
      args.load_db = true;
    } else if (token === "--manifest" && argv[i + 1]) {
      args.manifest_paths.push(argv[i + 1] ?? "");
      i += 1;
    } else if (token === "--refresh-serving") {
      args.refresh_serving = true;
    } else if (token === "--refresh-lookback-minutes" && argv[i + 1]) {
      args.refresh_lookback_minutes = Number(argv[i + 1]);
      i += 1;
    } else if (token === "--severity-version" && argv[i + 1]) {
      args.severity_version = argv[i + 1] ?? args.severity_version;
      i += 1;
    } else if (token === "--pressure-proxy-method" && argv[i + 1]) {
      args.pressure_proxy_method = argv[i + 1] ?? args.pressure_proxy_method;
      i += 1;
    }
  }

  return args;
}

class BunSqlExecutor implements SqlExecutor {
  private readonly sql: SQL;

  constructor(db_url: string) {
    this.sql = new SQL(db_url);
  }

  async query<Row extends Record<string, unknown>>(
    text: string,
    params: Array<unknown> = []
  ): Promise<SqlQueryResult<Row>> {
    const out = await this.sql.unsafe(text, params);
    return { rows: out as Row[] };
  }
}

function makeDbExecutor(): SqlExecutor {
  const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!dbUrl) {
    throw new Error("Missing DATABASE_URL (required for DB load)");
  }
  return new BunSqlExecutor(dbUrl);
}

async function findManifestPaths(root: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".manifest.json")) {
        output.push(fullPath);
      }
    }
  }

  await walk(root);
  output.sort((a, b) => a.localeCompare(b));
  return output;
}

type LoadSummary = {
  manifests_loaded: number;
  manifests_deduped: number;
  manifests_conflict: number;
  station_rows_written: number;
  station_rows_skipped: number;
};

async function loadManifestPathsToDb(db: SqlExecutor, manifestPaths: string[]): Promise<LoadSummary> {
  let loaded = 0;
  let deduped = 0;
  let conflicts = 0;
  let writtenRows = 0;
  let skippedRows = 0;

  for (const manifestPath of manifestPaths) {
    const result = await loadGbfsManifest(db, { manifest_path: manifestPath });
    loaded += 1;
    if (result.deduped) deduped += 1;
    if (result.conflict) conflicts += 1;
    writtenRows += result.station_rows_written;
    skippedRows += result.station_rows_skipped;
  }

  console.info(
    JSON.stringify({
      level: "info",
      event: "gbfs_db_load_complete",
      ts: new Date().toISOString(),
      manifests_loaded: loaded,
      manifests_deduped: deduped,
      manifests_conflict: conflicts,
      station_rows_written: writtenRows,
      station_rows_skipped: skippedRows,
    })
  );

  return {
    manifests_loaded: loaded,
    manifests_deduped: deduped,
    manifests_conflict: conflicts,
    station_rows_written: writtenRows,
    station_rows_skipped: skippedRows,
  };
}

function deriveRefreshWindow(
  manifests: GbfsManifest[],
  lookbackMinutes: number
): { fromTsIso: string; toTsIso: string } {
  const timestampsMs: number[] = [];
  for (const manifest of manifests) {
    const candidate = manifest.publisher_last_updated ?? manifest.collected_at;
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) timestampsMs.push(parsed);
  }
  if (timestampsMs.length === 0) {
    const now = Date.now();
    return {
      fromTsIso: new Date(now - lookbackMinutes * 60_000).toISOString(),
      toTsIso: new Date(now + 5 * 60_000).toISOString(),
    };
  }
  const minTs = Math.min(...timestampsMs);
  const maxTs = Math.max(...timestampsMs);
  return {
    fromTsIso: new Date(minTs - 10 * 60_000).toISOString(),
    toTsIso: new Date(maxTs + 10 * 60_000).toISOString(),
  };
}

async function loadManifestFile(pathAbs: string): Promise<GbfsManifest> {
  const raw = await fs.readFile(pathAbs, "utf8");
  return JSON.parse(raw) as GbfsManifest;
}

async function runServingRefresh(args: {
  db: SqlExecutor;
  system_id: string;
  fromTsIso: string;
  toTsIso: string;
  severity_version: string;
  pressure_proxy_method: string;
}): Promise<void> {
  const statusRows = await args.db.query<{ refreshed: number }>(
    `SELECT refresh_station_status_1m($1::text, $2::timestamptz, $3::timestamptz) AS refreshed`,
    [args.system_id, args.fromTsIso, args.toTsIso]
  );
  const severityRows = await args.db.query<{ refreshed: number }>(
    `SELECT refresh_station_severity_5m($1::text, $2::timestamptz, $3::timestamptz, $4::text) AS refreshed`,
    [args.system_id, args.fromTsIso, args.toTsIso, args.severity_version]
  );
  const pressureRows = await args.db.query<{ refreshed: number }>(
    `SELECT refresh_station_pressure_now_5m($1::text, $2::timestamptz, $3::timestamptz, $4::text) AS refreshed`,
    [args.system_id, args.fromTsIso, args.toTsIso, args.pressure_proxy_method]
  );

  console.info(
    JSON.stringify({
      level: "info",
      event: "gbfs_serving_refresh_complete",
      ts: new Date().toISOString(),
      system_id: args.system_id,
      from_ts: args.fromTsIso,
      to_ts: args.toTsIso,
      severity_version: args.severity_version,
      pressure_proxy_method: args.pressure_proxy_method,
      status_refreshed: statusRows.rows[0]?.refreshed ?? 0,
      severity_refreshed: severityRows.rows[0]?.refreshed ?? 0,
      pressure_refreshed: pressureRows.rows[0]?.refreshed ?? 0,
    })
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.system_id) {
    throw new Error("Missing --system <system_id>");
  }

  const registry = loadSystemRegistry();
  const system = requireSystemById(registry, args.system_id);

  const dataRoot = path.resolve(process.cwd(), args.data_root);
  if (args.mode === "load") {
    const db = makeDbExecutor();
    const manifestPaths =
      args.manifest_paths.length > 0
        ? args.manifest_paths.map((p) => path.resolve(process.cwd(), p))
        : await findManifestPaths(dataRoot);
    if (manifestPaths.length === 0) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "gbfs_db_load_no_manifests_found",
          ts: new Date().toISOString(),
          data_root: dataRoot,
        })
      );
      return;
    }
    await loadManifestPathsToDb(db, manifestPaths);
    if (args.refresh_serving) {
      const manifests = await Promise.all(manifestPaths.map((p) => loadManifestFile(p)));
      const window = deriveRefreshWindow(manifests, args.refresh_lookback_minutes);
      await runServingRefresh({
        db,
        system_id: system.system_id,
        fromTsIso: window.fromTsIso,
        toTsIso: window.toTsIso,
        severity_version: args.severity_version,
        pressure_proxy_method: args.pressure_proxy_method,
      });
    }
    return;
  }

  if (args.mode === "poll") {
    const db = args.load_db ? makeDbExecutor() : null;
    await runGbfsPoller({
      system_id: system.system_id,
      discovery_url: system.gbfs.auto_discovery_url,
      data_root: dataRoot,
      feeds: args.feeds.length > 0 ? args.feeds : undefined,
      min_ttl_s: args.min_ttl_s,
      max_ttl_s: args.max_ttl_s,
      jitter_s: args.jitter_s,
      on_cycle_complete:
        db == null
          ? undefined
          : async (result) => {
              const manifestPaths = result.manifests.map((manifest) => manifest.manifest_path);
              if (manifestPaths.length > 0) {
                await loadManifestPathsToDb(db, manifestPaths);
                if (args.refresh_serving) {
                  const window = deriveRefreshWindow(result.manifests, args.refresh_lookback_minutes);
                  await runServingRefresh({
                    db,
                    system_id: system.system_id,
                    fromTsIso: window.fromTsIso,
                    toTsIso: window.toTsIso,
                    severity_version: args.severity_version,
                    pressure_proxy_method: args.pressure_proxy_method,
                  });
                }
              }
            },
    });
  } else {
    const result = await collectGbfs({
      system_id: system.system_id,
      discovery_url: system.gbfs.auto_discovery_url,
      data_root: dataRoot,
      feeds: args.feeds.length > 0 ? args.feeds : undefined,
    });
    if (args.load_db) {
      const db = makeDbExecutor();
      const manifestPaths = result.manifests.map((manifest) => manifest.manifest_path);
      if (manifestPaths.length > 0) {
        await loadManifestPathsToDb(db, manifestPaths);
        if (args.refresh_serving) {
          const window = deriveRefreshWindow(result.manifests, args.refresh_lookback_minutes);
          await runServingRefresh({
            db,
            system_id: system.system_id,
            fromTsIso: window.fromTsIso,
            toTsIso: window.toTsIso,
            severity_version: args.severity_version,
            pressure_proxy_method: args.pressure_proxy_method,
          });
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    level: "error",
    event: "gbfs_collect_failed",
    ts: new Date().toISOString(),
    message: (error as Error).message ?? "unknown_error",
  }));
  process.exit(1);
});
