export type OptimizeMode = "live" | "frozen" | "computing" | "playback" | "error";

export type RenderedViewModel = {
    systemId: string;
    sv: string;
    decisionBucketTs: number;
    viewSnapshotId: string;
    viewSnapshotSha256: string;
    mode: OptimizeMode;
};

export type RenderedViewModelInput = {
    systemId: string;
    sv: string;
    displayTimeMs: number;
    bucketSizeSeconds: number;
    viewSnapshotId: string;
    viewSnapshotSha256: string;
    mode: OptimizeMode;
};

export function toDecisionBucketTs(displayTimeMs: number, bucketSizeSeconds: number): number {
    if (!Number.isFinite(displayTimeMs) || displayTimeMs < 0) return 0;
    const clampedBucket = Number.isFinite(bucketSizeSeconds)
        ? Math.max(1, Math.floor(bucketSizeSeconds))
        : 1;
    const totalSeconds = Math.floor(displayTimeMs / 1000);
    return Math.floor(totalSeconds / clampedBucket) * clampedBucket;
}

export function buildRenderedViewModel(input: RenderedViewModelInput): RenderedViewModel {
    return {
        systemId: input.systemId,
        sv: input.sv,
        decisionBucketTs: toDecisionBucketTs(input.displayTimeMs, input.bucketSizeSeconds),
        viewSnapshotId: input.viewSnapshotId,
        viewSnapshotSha256: input.viewSnapshotSha256,
        mode: input.mode,
    };
}

export function hasSnapshotIdentity(view: RenderedViewModel): boolean {
    return view.viewSnapshotId.length > 0 && view.viewSnapshotSha256.length > 0;
}

