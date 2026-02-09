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
