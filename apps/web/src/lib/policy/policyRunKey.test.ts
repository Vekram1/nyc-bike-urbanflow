import { describe, expect, it } from "bun:test";

import {
    buildPolicyRunKey,
    policyRunKeyEquals,
    serializePolicyRunKey,
} from "@/lib/policy/policyRunKey";

const renderedView = {
    systemId: "citibike-nyc",
    sv: "sv:test",
    decisionBucketTs: 1738872000,
    viewSnapshotId: "snapshot-1",
    viewSnapshotSha256: "sha-1",
    mode: "frozen" as const,
};

describe("policyRunKey", () => {
    it("serializes all key dimensions deterministically", () => {
        const key = buildPolicyRunKey({
            renderedView,
            policyVersion: "rebal.greedy.v1",
            policySpecSha256: "policy-sha-1",
        });
        expect(serializePolicyRunKey(key)).toBe(
            "citibike-nyc|sv:test|1738872000|snapshot-1|sha-1|rebal.greedy.v1|policy-sha-1"
        );
    });

    it("returns false when any single key dimension differs", () => {
        const a = buildPolicyRunKey({
            renderedView,
            policyVersion: "rebal.greedy.v1",
            policySpecSha256: "policy-sha-1",
        });
        const b = buildPolicyRunKey({
            renderedView: { ...renderedView, viewSnapshotSha256: "sha-2" },
            policyVersion: "rebal.greedy.v1",
            policySpecSha256: "policy-sha-1",
        });
        expect(policyRunKeyEquals(a, b)).toBeFalse();
    });
});
