import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import type { GreedyPolicyInput } from "./types";
import { runGreedyPolicyV1 } from "./greedy_v1";

type FixtureManifest = {
  fixtures: Array<{
    filename: string;
    checksum_sha256: string;
  }>;
};

describe("policy fixture contracts", () => {
  it("matches fixture checksums declared in manifest", async () => {
    const manifest = (await Bun.file("fixtures/policy/greedy_v1.manifest.json").json()) as FixtureManifest;

    for (const fixture of manifest.fixtures) {
      const text = await Bun.file(fixture.filename).text();
      const checksum = createHash("sha256").update(text).digest("hex");
      expect(checksum).toBe(fixture.checksum_sha256);
    }
  });

  it("keeps deterministic output for greedy_v1 fixture input", async () => {
    const scenarios = [
      {
        inputPath: "fixtures/policy/greedy_v1_input.json",
        expectedPath: "fixtures/policy/greedy_v1_expected.json",
      },
      {
        inputPath: "fixtures/policy/greedy_v1_tiebreak_input.json",
        expectedPath: "fixtures/policy/greedy_v1_tiebreak_expected.json",
      },
    ];

    for (const scenario of scenarios) {
      const input = (await Bun.file(scenario.inputPath).json()) as GreedyPolicyInput;
      const expected = (await Bun.file(scenario.expectedPath).json()) as Record<string, unknown>;

      const out1 = runGreedyPolicyV1(input, { logger: { info() {} } });
      const out2 = runGreedyPolicyV1(input, { logger: { info() {} } });

      expect(out1).toEqual(out2);
      expect(out1.policy_version).toBe(expected.policy_version);
      expect(out1.system_id).toBe(expected.system_id);
      expect(out1.decision_bucket_ts).toBe(expected.decision_bucket_ts);
      expect(out1.moves).toEqual(expected.moves);
      expect(out1.summary).toEqual(expected.summary);
      expect(out1.policy_spec_sha256).toHaveLength(64);
    }
  });
});
