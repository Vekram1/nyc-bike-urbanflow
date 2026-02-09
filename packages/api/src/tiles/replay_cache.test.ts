import { describe, expect, it } from "bun:test";

import { FileReplayTileCache } from "./replay_cache";

describe("FileReplayTileCache", () => {
  it("returns null when key is missing", async () => {
    const cache = new FileReplayTileCache(`/tmp/urbanflow-replay-cache-miss-${Date.now()}`);
    const out = await cache.get("missing-key");
    expect(out).toBeNull();
  });

  it("writes and reads replay tile payload", async () => {
    const cache = new FileReplayTileCache(`/tmp/urbanflow-replay-cache-hit-${Date.now()}`);
    await cache.put("k1", {
      mvt: new Uint8Array([1, 2, 3]),
      feature_count: 3,
      bytes: 3,
      degrade_level: 1,
    });
    const out = await cache.get("k1");
    expect(out).not.toBeNull();
    expect(out?.feature_count).toBe(3);
    expect(out?.bytes).toBe(3);
    expect(out?.degrade_level).toBe(1);
    expect(Array.from(out?.mvt ?? [])).toEqual([1, 2, 3]);
  });
});
