import { describe, expect, it } from "bun:test";

import { deriveEffectivePolicyStatus } from "@/lib/policy/stale";

describe("deriveEffectivePolicyStatus", () => {
    it("marks ready as stale when run key no longer matches current view", () => {
        const status = deriveEffectivePolicyStatus({
            policyStatus: "ready",
            policyReadyRunKeySerialized: "run-key-a",
            currentRunKeySerialized: "run-key-b",
        });
        expect(status).toBe("stale");
    });

    it("preserves non-ready states", () => {
        expect(
            deriveEffectivePolicyStatus({
                policyStatus: "pending",
                policyReadyRunKeySerialized: "run-key-a",
                currentRunKeySerialized: "run-key-b",
            })
        ).toBe("pending");
    });

    it("preserves ready when keys still match", () => {
        expect(
            deriveEffectivePolicyStatus({
                policyStatus: "ready",
                policyReadyRunKeySerialized: "run-key-a",
                currentRunKeySerialized: "run-key-a",
            })
        ).toBe("ready");
    });
});
