import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "bun:test";

import { applyArchivePrune, planArchivePrune } from "./retention";

const tmpRoots: string[] = [];

async function mkTmp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "uf-retention-"));
  tmpRoots.push(root);
  return root;
}

async function writeFile(fileAbs: string, bytes: number, mtimeMs: number): Promise<void> {
  await fs.mkdir(path.dirname(fileAbs), { recursive: true });
  await fs.writeFile(fileAbs, Buffer.alloc(bytes, 1));
  const atime = new Date(mtimeMs);
  const mtime = new Date(mtimeMs);
  await fs.utimes(fileAbs, atime, mtime);
}

afterEach(async () => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (!root) continue;
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("archive retention planning", () => {
  it("selects age-based candidates", async () => {
    const root = await mkTmp();
    const nowMs = Date.UTC(2026, 1, 9, 12, 0, 0);
    await writeFile(path.join(root, "old/a.raw"), 10, nowMs - 40 * 24 * 60 * 60 * 1000);
    await writeFile(path.join(root, "new/b.raw"), 10, nowMs - 1 * 24 * 60 * 60 * 1000);

    const plan = await planArchivePrune({
      data_root: root,
      retention_days: 30,
      max_archive_gb: null,
      now_ms: nowMs,
    });

    expect(plan.total_files_before).toBe(2);
    expect(plan.age_candidates.map((file) => file.path_rel)).toEqual(["old/a.raw"]);
    expect(plan.delete_candidates.map((file) => file.path_rel)).toEqual(["old/a.raw"]);
    expect(plan.total_files_after).toBe(1);
  });

  it("selects oldest files to satisfy size cap after age filtering", async () => {
    const root = await mkTmp();
    const nowMs = Date.UTC(2026, 1, 9, 12, 0, 0);

    await writeFile(path.join(root, "a.bin"), 120, nowMs - 10_000);
    await writeFile(path.join(root, "b.bin"), 120, nowMs - 9_000);
    await writeFile(path.join(root, "c.bin"), 120, nowMs - 8_000);

    const plan = await planArchivePrune({
      data_root: root,
      retention_days: null,
      max_archive_gb: 0.0000003,
      now_ms: nowMs,
    });

    expect(plan.total_files_before).toBe(3);
    expect(plan.total_bytes_before).toBe(360);
    expect(plan.delete_candidates.length).toBe(1);
    expect(plan.delete_candidates[0]?.path_rel).toBe("a.bin");
    expect(plan.total_bytes_after).toBe(240);
  });

  it("applies archive prune deletes selected files", async () => {
    const root = await mkTmp();
    const nowMs = Date.UTC(2026, 1, 9, 12, 0, 0);
    await writeFile(path.join(root, "old/a.raw"), 10, nowMs - 40 * 24 * 60 * 60 * 1000);
    await writeFile(path.join(root, "new/b.raw"), 10, nowMs - 1 * 24 * 60 * 60 * 1000);

    const plan = await planArchivePrune({
      data_root: root,
      retention_days: 30,
      max_archive_gb: null,
      now_ms: nowMs,
    });

    const result = await applyArchivePrune(plan);
    expect(result.deleted_files).toBe(1);
    expect(result.deleted_bytes).toBe(10);

    const oldStat = await fs.stat(path.join(root, "old/a.raw")).catch(() => null);
    const newStat = await fs.stat(path.join(root, "new/b.raw")).catch(() => null);
    expect(oldStat).toBeNull();
    expect(newStat).not.toBeNull();
  });
});
