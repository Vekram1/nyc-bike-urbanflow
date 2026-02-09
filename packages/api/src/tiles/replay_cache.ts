import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

type ReplayTileMeta = {
  feature_count: number;
  bytes: number;
  degrade_level?: number;
};

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class FileReplayTileCache {
  constructor(private readonly rootDir: string) {}

  private async keyPaths(key: string): Promise<{ tilePath: string; metaPath: string }> {
    const hash = await sha256Hex(key);
    const prefix = hash.slice(0, 2);
    const baseDir = join(this.rootDir, prefix);
    return {
      tilePath: join(baseDir, `${hash}.mvt`),
      metaPath: join(baseDir, `${hash}.json`),
    };
  }

  async get(key: string): Promise<{
    mvt: Uint8Array;
    feature_count: number;
    bytes: number;
    degrade_level?: number;
  } | null> {
    const { tilePath, metaPath } = await this.keyPaths(key);
    const tileFile = Bun.file(tilePath);
    const metaFile = Bun.file(metaPath);
    if (!(await tileFile.exists()) || !(await metaFile.exists())) {
      return null;
    }
    const meta = (await metaFile.json()) as ReplayTileMeta;
    const mvt = new Uint8Array(await tileFile.arrayBuffer());
    return {
      mvt,
      feature_count: meta.feature_count,
      bytes: meta.bytes,
      degrade_level: meta.degrade_level,
    };
  }

  async put(
    key: string,
    value: {
      mvt: Uint8Array;
      feature_count: number;
      bytes: number;
      degrade_level?: number;
    }
  ): Promise<void> {
    const { tilePath, metaPath } = await this.keyPaths(key);
    await mkdir(dirname(tilePath), { recursive: true });
    await Bun.write(tilePath, value.mvt);
    await Bun.write(
      metaPath,
      JSON.stringify({
        feature_count: value.feature_count,
        bytes: value.bytes,
        degrade_level: value.degrade_level,
      } satisfies ReplayTileMeta)
    );
  }
}
