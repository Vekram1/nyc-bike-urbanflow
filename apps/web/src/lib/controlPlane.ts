export const DEFAULT_SYSTEM_ID =
    process.env.NEXT_PUBLIC_SYSTEM_ID?.trim() || "citibike-nyc";

export type TimeResponse = {
    server_now: string;
    recommended_live_sv: string;
    network?: {
        degrade_level?: number;
        client_should_throttle?: boolean;
    };
};

export type TimelineResponse = {
    available_range: [string, string];
    bucket_size_seconds: number;
    live_edge_ts: string;
};

export type TimelineDensityPoint = {
    bucket_ts: string;
    pct_serving_grade: number;
    empty_rate: number;
    full_rate: number;
    severity_p95?: number;
};

export type TimelineDensityResponse = {
    bucket_size_seconds: number;
    points: TimelineDensityPoint[];
};

export type PolicyConfigResponse = {
    default_policy_version: string;
    available_policy_versions: string[];
    default_horizon_steps: number;
    max_moves: number;
};

export type PolicyRunSummary = {
    run_id: number;
    system_id: string;
    policy_version: string;
    policy_spec_sha256: string;
    sv: string;
    decision_bucket_ts: string;
    horizon_steps: number;
    input_quality: string;
    no_op: boolean;
    no_op_reason: string | null;
    error_reason: string | null;
    move_count: number;
    created_at: string;
};

export type PolicyRunReadyResponse = {
    status: "ready";
    run: PolicyRunSummary;
};

export type PolicyRunPendingResponse = {
    status: "pending";
    retry_after_ms: number;
    cache_key: string;
};

export type PolicyRunResponse = PolicyRunReadyResponse | PolicyRunPendingResponse;

export type PolicyMove = {
    move_rank: number;
    from_station_key: string;
    to_station_key: string;
    bikes_moved: number;
    dist_m: number;
    budget_exhausted: boolean;
    neighbor_exhausted: boolean;
    reason_codes: string[];
};

export type PolicyMovesResponse = {
    status: "ready";
    run: {
        run_id: number;
        policy_version: string;
        policy_spec_sha256: string;
        decision_bucket_ts: string;
        horizon_steps: number;
    };
    top_n: number;
    moves: PolicyMove[];
};

function parseJson(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function parseErrorMessage(body: Record<string, unknown> | null, fallback: string): string {
    const error = body?.error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return fallback;
    const message = (error as { message?: unknown }).message;
    return isString(message) && message.length > 0 ? message : fallback;
}

function parseTimeResponse(body: Record<string, unknown> | null): TimeResponse | null {
    if (!body) return null;
    if (!isString(body.server_now) || !isString(body.recommended_live_sv)) return null;
    const networkRaw = body.network;
    let network: TimeResponse["network"] | undefined;
    if (networkRaw && typeof networkRaw === "object" && !Array.isArray(networkRaw)) {
        const parsedNetwork: NonNullable<TimeResponse["network"]> = {};
        const degradeLevel = (networkRaw as { degrade_level?: unknown }).degrade_level;
        const shouldThrottle = (networkRaw as { client_should_throttle?: unknown }).client_should_throttle;
        if (isFiniteNumber(degradeLevel)) {
            parsedNetwork.degrade_level = degradeLevel;
        }
        if (typeof shouldThrottle === "boolean") {
            parsedNetwork.client_should_throttle = shouldThrottle;
        }
        network = Object.keys(parsedNetwork).length > 0 ? parsedNetwork : undefined;
    }
    return {
        server_now: body.server_now,
        recommended_live_sv: body.recommended_live_sv,
        network,
    };
}

function parseTimelineResponse(body: Record<string, unknown> | null): TimelineResponse | null {
    if (!body) return null;
    const range = body.available_range;
    if (!Array.isArray(range) || range.length !== 2) return null;
    if (!isString(range[0]) || !isString(range[1])) return null;
    if (!isFiniteNumber(body.bucket_size_seconds) || !isString(body.live_edge_ts)) return null;
    return {
        available_range: [range[0], range[1]],
        bucket_size_seconds: body.bucket_size_seconds,
        live_edge_ts: body.live_edge_ts,
    };
}

function parseTimelineDensityResponse(body: Record<string, unknown> | null): TimelineDensityResponse | null {
    if (!body || !isFiniteNumber(body.bucket_size_seconds) || !Array.isArray(body.points)) return null;
    const points: TimelineDensityPoint[] = [];
    for (const pointRaw of body.points) {
        if (!pointRaw || typeof pointRaw !== "object" || Array.isArray(pointRaw)) return null;
        const point = pointRaw as Record<string, unknown>;
        if (!isString(point.bucket_ts)) return null;
        if (!isFiniteNumber(point.pct_serving_grade)) return null;
        if (!isFiniteNumber(point.empty_rate)) return null;
        if (!isFiniteNumber(point.full_rate)) return null;
        const nextPoint: TimelineDensityPoint = {
            bucket_ts: point.bucket_ts,
            pct_serving_grade: point.pct_serving_grade,
            empty_rate: point.empty_rate,
            full_rate: point.full_rate,
        };
        if (typeof point.severity_p95 !== "undefined") {
            if (!isFiniteNumber(point.severity_p95)) return null;
            nextPoint.severity_p95 = point.severity_p95;
        }
        points.push(nextPoint);
    }
    return {
        bucket_size_seconds: body.bucket_size_seconds,
        points,
    };
}

function parsePolicyConfigResponse(body: Record<string, unknown> | null): PolicyConfigResponse | null {
    if (!body) return null;
    if (!isString(body.default_policy_version)) return null;
    if (!isFiniteNumber(body.default_horizon_steps) || !isFiniteNumber(body.max_moves)) return null;
    if (!Array.isArray(body.available_policy_versions)) return null;
    if (!body.available_policy_versions.every((value) => isString(value))) return null;
    return {
        default_policy_version: body.default_policy_version,
        available_policy_versions: body.available_policy_versions,
        default_horizon_steps: body.default_horizon_steps,
        max_moves: body.max_moves,
    };
}

function parsePolicyRunSummary(raw: Record<string, unknown>): PolicyRunSummary | null {
    if (!isFiniteNumber(raw.run_id)) return null;
    if (!isString(raw.system_id)) return null;
    if (!isString(raw.policy_version)) return null;
    if (!isString(raw.policy_spec_sha256)) return null;
    if (!isString(raw.sv)) return null;
    if (!isString(raw.decision_bucket_ts)) return null;
    if (!isFiniteNumber(raw.horizon_steps)) return null;
    if (!isString(raw.input_quality)) return null;
    if (typeof raw.no_op !== "boolean") return null;
    if (!(raw.no_op_reason === null || isString(raw.no_op_reason))) return null;
    if (!(raw.error_reason === null || isString(raw.error_reason))) return null;
    if (!isFiniteNumber(raw.move_count)) return null;
    if (!isString(raw.created_at)) return null;
    return {
        run_id: raw.run_id,
        system_id: raw.system_id,
        policy_version: raw.policy_version,
        policy_spec_sha256: raw.policy_spec_sha256,
        sv: raw.sv,
        decision_bucket_ts: raw.decision_bucket_ts,
        horizon_steps: raw.horizon_steps,
        input_quality: raw.input_quality,
        no_op: raw.no_op,
        no_op_reason: raw.no_op_reason,
        error_reason: raw.error_reason,
        move_count: raw.move_count,
        created_at: raw.created_at,
    };
}

function parsePolicyRunResponse(body: Record<string, unknown> | null): PolicyRunResponse | null {
    if (!body || !isString(body.status)) return null;
    if (body.status === "pending") {
        if (!isFiniteNumber(body.retry_after_ms) || !isString(body.cache_key)) return null;
        return {
            status: "pending",
            retry_after_ms: body.retry_after_ms,
            cache_key: body.cache_key,
        };
    }
    if (body.status !== "ready") return null;
    const runRaw = body.run;
    if (!runRaw || typeof runRaw !== "object" || Array.isArray(runRaw)) return null;
    const run = parsePolicyRunSummary(runRaw as Record<string, unknown>);
    if (!run) return null;
    return {
        status: "ready",
        run,
    };
}

function parsePolicyMove(raw: Record<string, unknown>): PolicyMove | null {
    if (!isFiniteNumber(raw.move_rank)) return null;
    if (!isString(raw.from_station_key)) return null;
    if (!isString(raw.to_station_key)) return null;
    if (!isFiniteNumber(raw.bikes_moved)) return null;
    if (!isFiniteNumber(raw.dist_m)) return null;
    if (typeof raw.budget_exhausted !== "boolean") return null;
    if (typeof raw.neighbor_exhausted !== "boolean") return null;
    if (!Array.isArray(raw.reason_codes) || !raw.reason_codes.every((value) => isString(value))) return null;
    return {
        move_rank: raw.move_rank,
        from_station_key: raw.from_station_key,
        to_station_key: raw.to_station_key,
        bikes_moved: raw.bikes_moved,
        dist_m: raw.dist_m,
        budget_exhausted: raw.budget_exhausted,
        neighbor_exhausted: raw.neighbor_exhausted,
        reason_codes: raw.reason_codes,
    };
}

function parsePolicyMovesResponse(body: Record<string, unknown> | null): PolicyMovesResponse | null {
    if (!body || body.status !== "ready") return null;
    const runRaw = body.run;
    if (!runRaw || typeof runRaw !== "object" || Array.isArray(runRaw)) return null;
    const run = runRaw as Record<string, unknown>;
    if (!isFiniteNumber(run.run_id)) return null;
    if (!isString(run.policy_version)) return null;
    if (!isString(run.policy_spec_sha256)) return null;
    if (!isString(run.decision_bucket_ts)) return null;
    if (!isFiniteNumber(run.horizon_steps)) return null;
    if (!isFiniteNumber(body.top_n)) return null;
    if (!Array.isArray(body.moves)) return null;
    const moves: PolicyMove[] = [];
    for (const moveRaw of body.moves) {
        if (!moveRaw || typeof moveRaw !== "object" || Array.isArray(moveRaw)) return null;
        const move = parsePolicyMove(moveRaw as Record<string, unknown>);
        if (!move) return null;
        moves.push(move);
    }
    return {
        status: "ready",
        run: {
            run_id: run.run_id,
            policy_version: run.policy_version,
            policy_spec_sha256: run.policy_spec_sha256,
            decision_bucket_ts: run.decision_bucket_ts,
            horizon_steps: run.horizon_steps,
        },
        top_n: body.top_n,
        moves,
    };
}

export async function fetchTime(args?: {
    systemId?: string;
    signal?: AbortSignal;
}): Promise<TimeResponse> {
    const params = new URLSearchParams({
        system_id: args?.systemId ?? DEFAULT_SYSTEM_ID,
    });
    const res = await fetch(`/api/time?${params.toString()}`, {
        cache: "no-store",
        signal: args?.signal,
    });
    const body = parseJson(await res.json().catch(() => null));
    if (!res.ok) {
        throw new Error(parseErrorMessage(body, "time_unavailable"));
    }
    const parsed = parseTimeResponse(body);
    if (!parsed) throw new Error("time_invalid_response");
    return parsed;
}

export async function fetchTimeline(args: {
    sv: string;
    signal?: AbortSignal;
}): Promise<TimelineResponse> {
    const params = new URLSearchParams({ v: "1", sv: args.sv });
    const res = await fetch(`/api/timeline?${params.toString()}`, {
        cache: "no-store",
        signal: args.signal,
    });
    const body = parseJson(await res.json().catch(() => null));
    if (!res.ok) {
        throw new Error(parseErrorMessage(body, "timeline_unavailable"));
    }
    const parsed = parseTimelineResponse(body);
    if (!parsed) throw new Error("timeline_invalid_response");
    return parsed;
}

export async function fetchTimelineDensity(args: {
    sv: string;
    bucketSeconds?: number;
    signal?: AbortSignal;
}): Promise<TimelineDensityResponse> {
    const bucketSeconds = args.bucketSeconds ?? 300;
    const params = new URLSearchParams({
        v: "1",
        sv: args.sv,
        bucket: String(bucketSeconds),
    });
    const res = await fetch(`/api/timeline/density?${params.toString()}`, {
        cache: "no-store",
        signal: args.signal,
    });
    const body = parseJson(await res.json().catch(() => null));
    if (!res.ok) {
        throw new Error(parseErrorMessage(body, "timeline_density_unavailable"));
    }
    const parsed = parseTimelineDensityResponse(body);
    if (!parsed) throw new Error("timeline_density_invalid_response");
    return parsed;
}

export async function fetchPolicyConfig(args?: { signal?: AbortSignal }): Promise<PolicyConfigResponse> {
    const params = new URLSearchParams({ v: "1" });
    const res = await fetch(`/api/policy/config?${params.toString()}`, {
        cache: "no-store",
        signal: args?.signal,
    });
    const body = parseJson(await res.json().catch(() => null));
    if (!res.ok) {
        throw new Error(parseErrorMessage(body, "policy_config_unavailable"));
    }
    const parsed = parsePolicyConfigResponse(body);
    if (!parsed) throw new Error("policy_config_invalid_response");
    return parsed;
}

export async function fetchPolicyRun(args: {
    sv: string;
    policyVersion: string;
    timelineBucket: number;
    viewSnapshotId?: string;
    viewSnapshotSha256?: string;
    horizonSteps?: number;
    systemId?: string;
    signal?: AbortSignal;
}): Promise<PolicyRunResponse> {
    const params = new URLSearchParams({
        v: "1",
        sv: args.sv,
        policy_version: args.policyVersion,
        T_bucket: String(Math.max(0, Math.floor(args.timelineBucket))),
        system_id: args.systemId ?? DEFAULT_SYSTEM_ID,
    });
    if (typeof args.horizonSteps === "number" && Number.isFinite(args.horizonSteps)) {
        params.set("horizon_steps", String(Math.max(0, Math.floor(args.horizonSteps))));
    }
    const hasViewSnapshotId = typeof args.viewSnapshotId === "string" && args.viewSnapshotId.length > 0;
    const hasViewSnapshotSha = typeof args.viewSnapshotSha256 === "string" && args.viewSnapshotSha256.length > 0;
    if (hasViewSnapshotId && hasViewSnapshotSha) {
        params.set("view_snapshot_id", args.viewSnapshotId as string);
        params.set("view_snapshot_sha256", args.viewSnapshotSha256 as string);
    }
    const res = await fetch(`/api/policy/run?${params.toString()}`, {
        cache: "no-store",
        signal: args.signal,
    });
    const body = parseJson(await res.json().catch(() => null));
    if (!res.ok) {
        throw new Error(parseErrorMessage(body, "policy_run_unavailable"));
    }
    const parsed = parsePolicyRunResponse(body);
    if (!parsed) throw new Error("policy_run_invalid_response");
    return parsed;
}

export async function fetchPolicyMoves(args: {
    sv: string;
    policyVersion: string;
    timelineBucket: number;
    viewSnapshotId?: string;
    viewSnapshotSha256?: string;
    horizonSteps?: number;
    topN?: number;
    systemId?: string;
    signal?: AbortSignal;
}): Promise<PolicyMovesResponse> {
    const params = new URLSearchParams({
        v: "1",
        sv: args.sv,
        policy_version: args.policyVersion,
        T_bucket: String(Math.max(0, Math.floor(args.timelineBucket))),
        system_id: args.systemId ?? DEFAULT_SYSTEM_ID,
    });
    if (typeof args.horizonSteps === "number" && Number.isFinite(args.horizonSteps)) {
        params.set("horizon_steps", String(Math.max(0, Math.floor(args.horizonSteps))));
    }
    if (typeof args.topN === "number" && Number.isFinite(args.topN)) {
        params.set("top_n", String(Math.max(1, Math.floor(args.topN))));
    }
    const hasViewSnapshotId = typeof args.viewSnapshotId === "string" && args.viewSnapshotId.length > 0;
    const hasViewSnapshotSha = typeof args.viewSnapshotSha256 === "string" && args.viewSnapshotSha256.length > 0;
    if (hasViewSnapshotId && hasViewSnapshotSha) {
        params.set("view_snapshot_id", args.viewSnapshotId as string);
        params.set("view_snapshot_sha256", args.viewSnapshotSha256 as string);
    }
    const res = await fetch(`/api/policy/moves?${params.toString()}`, {
        cache: "no-store",
        signal: args.signal,
    });
    const body = parseJson(await res.json().catch(() => null));
    if (!res.ok) {
        throw new Error(parseErrorMessage(body, "policy_moves_unavailable"));
    }
    const parsed = parsePolicyMovesResponse(body);
    if (!parsed) throw new Error("policy_moves_invalid_response");
    return parsed;
}
