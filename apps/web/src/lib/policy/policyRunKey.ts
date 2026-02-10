import type { RenderedViewModel } from "@/lib/policy/renderedViewModel";

export type PolicyRunKey = {
    systemId: string;
    sv: string;
    decisionBucketTs: number;
    viewSnapshotId: string;
    viewSnapshotSha256: string;
    policyVersion: string;
    policySpecSha256: string;
};

export type PolicyRunKeyInput = {
    renderedView: RenderedViewModel;
    policyVersion: string;
    policySpecSha256: string;
};

export function buildPolicyRunKey(input: PolicyRunKeyInput): PolicyRunKey {
    return {
        systemId: input.renderedView.systemId,
        sv: input.renderedView.sv,
        decisionBucketTs: input.renderedView.decisionBucketTs,
        viewSnapshotId: input.renderedView.viewSnapshotId,
        viewSnapshotSha256: input.renderedView.viewSnapshotSha256,
        policyVersion: input.policyVersion,
        policySpecSha256: input.policySpecSha256,
    };
}

export function serializePolicyRunKey(key: PolicyRunKey): string {
    return [
        key.systemId,
        key.sv,
        String(key.decisionBucketTs),
        key.viewSnapshotId,
        key.viewSnapshotSha256,
        key.policyVersion,
        key.policySpecSha256,
    ].join("|");
}

export function policyRunKeyEquals(a: PolicyRunKey, b: PolicyRunKey): boolean {
    return serializePolicyRunKey(a) === serializePolicyRunKey(b);
}

