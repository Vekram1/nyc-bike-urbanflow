import path from "path";

import { collectGbfs } from "./gbfs/collector";
import { runGbfsPoller } from "./gbfs/poller";
import { loadSystemRegistry, requireSystemById } from "./gbfs/registry";

type CliArgs = {
  system_id: string | null;
  feeds: string[];
  data_root: string;
  mode: "once" | "poll";
  min_ttl_s: number;
  max_ttl_s: number;
  jitter_s: number;
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
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.system_id) {
    throw new Error("Missing --system <system_id>");
  }

  const registry = loadSystemRegistry();
  const system = requireSystemById(registry, args.system_id);

  const dataRoot = path.resolve(process.cwd(), args.data_root);
  if (args.mode === "poll") {
    await runGbfsPoller({
      system_id: system.system_id,
      discovery_url: system.gbfs.auto_discovery_url,
      data_root: dataRoot,
      feeds: args.feeds.length > 0 ? args.feeds : undefined,
      min_ttl_s: args.min_ttl_s,
      max_ttl_s: args.max_ttl_s,
      jitter_s: args.jitter_s,
    });
  } else {
    await collectGbfs({
      system_id: system.system_id,
      discovery_url: system.gbfs.auto_discovery_url,
      data_root: dataRoot,
      feeds: args.feeds.length > 0 ? args.feeds : undefined,
    });
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
