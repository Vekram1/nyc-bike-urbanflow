import path from "path";

import { collectGbfs } from "./gbfs/collector";
import { loadSystemRegistry, requireSystemById } from "./gbfs/registry";

type CliArgs = {
  system_id: string | null;
  feeds: string[];
  data_root: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    system_id: null,
    feeds: [],
    data_root: process.env.GBFS_DATA_ROOT ?? "data/gbfs",
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
  await collectGbfs({
    system_id: system.system_id,
    discovery_url: system.gbfs.auto_discovery_url,
    data_root: dataRoot,
    feeds: args.feeds.length > 0 ? args.feeds : undefined,
  });
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
