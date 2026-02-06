import { describe, expect, it } from "bun:test";

import { validateSeveritySpecV1 } from "../severity/schema";

describe("validateSeveritySpecV1", () => {
  it("accepts sev.v1 canonical shape", () => {
    const out = validateSeveritySpecV1({
      version: "sev.v1",
      bucket_seconds: 300,
      formula: {
        type: "empty_or_full_flag",
        empty_weight: 1,
        full_weight: 1,
        clamp_min: 0,
        clamp_max: 1,
      },
      missing_data: {
        allowed_bucket_quality: ["ok", "degraded"],
        on_missing: "zero",
      },
      components: ["empty_flag", "full_flag", "capacity"],
    });
    expect(out.ok).toBe(true);
  });

  it("rejects invalid versions and missing shape", () => {
    const out = validateSeveritySpecV1({
      version: "sev.v2",
      bucket_seconds: -1,
      formula: { type: "other" },
      missing_data: { allowed_bucket_quality: [], on_missing: "carry" },
      components: [],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.errors.length).toBeGreaterThan(0);
    }
  });
});
