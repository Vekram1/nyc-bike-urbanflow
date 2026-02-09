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

function parseJson<T>(value: unknown): T | null {
    if (!value || typeof value !== "object") return null;
    return value as T;
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
    const body = parseJson<TimeResponse & { error?: { message?: string } }>(
        await res.json().catch(() => null)
    );
    if (!res.ok || !body) {
        throw new Error(body?.error?.message ?? "time_unavailable");
    }
    return body;
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
    const body = parseJson<TimelineResponse & { error?: { message?: string } }>(
        await res.json().catch(() => null)
    );
    if (!res.ok || !body) {
        throw new Error(body?.error?.message ?? "timeline_unavailable");
    }
    return body;
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
    const body = parseJson<TimelineDensityResponse & { error?: { message?: string } }>(
        await res.json().catch(() => null)
    );
    if (!res.ok || !body) {
        throw new Error(body?.error?.message ?? "timeline_density_unavailable");
    }
    return body;
}

export async function fetchPolicyConfig(args?: { signal?: AbortSignal }): Promise<PolicyConfigResponse> {
    const params = new URLSearchParams({ v: "1" });
    const res = await fetch(`/api/policy/config?${params.toString()}`, {
        cache: "no-store",
        signal: args?.signal,
    });
    const body = parseJson<PolicyConfigResponse & { error?: { message?: string } }>(
        await res.json().catch(() => null)
    );
    if (!res.ok || !body) {
        throw new Error(body?.error?.message ?? "policy_config_unavailable");
    }
    return body;
}

export async function fetchPolicyRun(args: {
    sv: string;
    policyVersion: string;
    timelineBucket: number;
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
    const res = await fetch(`/api/policy/run?${params.toString()}`, {
        cache: "no-store",
        signal: args.signal,
    });
    const body = parseJson<PolicyRunResponse & { error?: { message?: string } }>(
        await res.json().catch(() => null)
    );
    if (!res.ok || !body) {
        throw new Error(body?.error?.message ?? "policy_run_unavailable");
    }
    return body;
}

export async function fetchPolicyMoves(args: {
    sv: string;
    policyVersion: string;
    timelineBucket: number;
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
    const res = await fetch(`/api/policy/moves?${params.toString()}`, {
        cache: "no-store",
        signal: args.signal,
    });
    const body = parseJson<PolicyMovesResponse & { error?: { message?: string } }>(
        await res.json().catch(() => null)
    );
    if (!res.ok || !body) {
        throw new Error(body?.error?.message ?? "policy_moves_unavailable");
    }
    return body;
}
