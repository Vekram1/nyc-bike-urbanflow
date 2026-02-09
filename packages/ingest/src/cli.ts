import fs from "fs/promises";
import path from "path";
import { SQL } from "bun";

import { collectGbfs } from "./gbfs/collector";
import { loadGbfsManifest } from "./gbfs/loader";
import { runGbfsPoller } from "./gbfs/poller";
import { loadSystemRegistry, requireSystemById } from "./gbfs/registry";
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

async function loadManifestPathsToDb(db: SqlExecutor, manifestPaths: string[]): Promise<void> {
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
