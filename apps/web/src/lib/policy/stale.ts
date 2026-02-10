export type PolicyStatus = "idle" | "pending" | "ready" | "stale" | "error";

export function deriveEffectivePolicyStatus(args: {
    policyStatus: PolicyStatus;
    policyReadyRunKeySerialized: string | null;
    currentRunKeySerialized: string;
}): PolicyStatus {
    if (
        args.policyStatus === "ready" &&
        args.policyReadyRunKeySerialized &&
        args.policyReadyRunKeySerialized !== args.currentRunKeySerialized
    ) {
        return "stale";
    }
    return args.policyStatus;
}
