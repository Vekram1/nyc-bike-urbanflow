import { describe, expect, it } from "bun:test";

import { evaluateRolloutGate } from "./rollout_gates";

describe("evaluateRolloutGate", () => {
  it("passes when all shadow thresholds are met", () => {
    const out = evaluateRolloutGate("shadow", {
      timeout_rate: 0.04,
      fallback_rate: 0.08,
      objective_delta_ratio: 0.02,
    });
    expect(out.pass).toBe(true);
    expect(out.reasons.length).toBe(0);
  });

  it("fails when internal thresholds are exceeded", () => {
    const out = evaluateRolloutGate("internal", {
      timeout_rate: 0.12,
      fallback_rate: 0.11,
      objective_delta_ratio: -0.15,
    });
    expect(out.pass).toBe(false);
    expect(out.reasons.length).toBe(3);
  });

  it("uses stricter public thresholds", () => {
    const out = evaluateRolloutGate("public", {
      timeout_rate: 0.031,
      fallback_rate: 0.02,
      objective_delta_ratio: -0.01,
    });
    expect(out.pass).toBe(false);
    expect(out.reasons[0]?.includes("timeout_rate")).toBe(true);
  });
});
