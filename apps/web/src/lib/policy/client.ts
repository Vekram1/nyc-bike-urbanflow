import {
    DEFAULT_SYSTEM_ID,
    fetchPolicyMoves,
    fetchPolicyRun,
    type PolicyMove,
} from "@/lib/controlPlane";
import type { PolicyRunKey } from "@/lib/policy/policyRunKey";

export type RunPolicyForViewArgs = {
    runKey: PolicyRunKey;
    maxAttempts?: number;
    topN?: number;
    horizonSteps?: number;
    includeSnapshotPrecondition?: boolean;
    signal?: AbortSignal;
};

export type RunPolicyForViewReady = {
    status: "ready";
    runId: number;
    policySpecSha256: string;
    moves: PolicyMove[];
};

export type RunPolicyForViewPending = {
    status: "pending";
    retryAfterMs: number;
};

export type RunPolicyForViewResult = RunPolicyForViewReady | RunPolicyForViewPending;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

export async function runPolicyForView(args: RunPolicyForViewArgs): Promise<RunPolicyForViewResult> {
    const maxAttempts = Math.max(1, Math.floor(args.maxAttempts ?? 8));
    const topN = Math.max(1, Math.floor(args.topN ?? 500));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const run = await fetchPolicyRun({
            sv: args.runKey.sv,
            policyVersion: args.runKey.policyVersion,
            timelineBucket: args.runKey.decisionBucketTs,
            systemId: args.runKey.systemId || DEFAULT_SYSTEM_ID,
            horizonSteps: args.horizonSteps,
            viewSnapshotId: args.includeSnapshotPrecondition ? args.runKey.viewSnapshotId : undefined,
            viewSnapshotSha256: args.includeSnapshotPrecondition ? args.runKey.viewSnapshotSha256 : undefined,
            signal: args.signal,
        });
        if (run.status === "pending") {
            const retryAfterMs = Math.max(250, Math.min(2000, run.retry_after_ms ?? 800));
            if (attempt === maxAttempts - 1) {
                return { status: "pending", retryAfterMs };
            }
            await sleep(retryAfterMs);
            continue;
        }

        const moves = await fetchPolicyMoves({
            sv: args.runKey.sv,
            policyVersion: args.runKey.policyVersion,
            timelineBucket: args.runKey.decisionBucketTs,
            systemId: args.runKey.systemId || DEFAULT_SYSTEM_ID,
            horizonSteps: args.horizonSteps,
            topN,
            viewSnapshotId: args.includeSnapshotPrecondition ? args.runKey.viewSnapshotId : undefined,
            viewSnapshotSha256: args.includeSnapshotPrecondition ? args.runKey.viewSnapshotSha256 : undefined,
            signal: args.signal,
        });
        return {
            status: "ready",
            runId: run.run.run_id,
            policySpecSha256: moves.run.policy_spec_sha256,
            moves: moves.moves,
        };
    }
    return { status: "pending", retryAfterMs: 800 };
}
