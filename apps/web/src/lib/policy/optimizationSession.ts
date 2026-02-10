import type { PolicyRunKey } from "@/lib/policy/policyRunKey";

export type OptimizationSessionMode =
    | "live"
    | "frozen"
    | "computing"
    | "playback"
    | "error";

export type OptimizationSession = {
    sessionId: string;
    mode: OptimizationSessionMode;
    frozenRunKey: PolicyRunKey | null;
    activeRequestId: number | null;
    playbackCursor: number;
};

export function createOptimizationSession(): OptimizationSession {
    return {
        sessionId: "session-0",
        mode: "live",
        frozenRunKey: null,
        activeRequestId: null,
        playbackCursor: 0,
    };
}

export function isActiveSessionRequest(
    session: OptimizationSession,
    sessionId: string,
    requestId: number
): boolean {
    return session.sessionId === sessionId && session.activeRequestId === requestId;
}
