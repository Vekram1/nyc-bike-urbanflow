import { describe, expect, it } from "bun:test";

import {
    createOptimizationSession,
    isActiveSessionRequest,
} from "@/lib/policy/optimizationSession";

describe("optimizationSession", () => {
    it("creates a deterministic default session shape", () => {
        const session = createOptimizationSession();
        expect(session).toEqual({
            sessionId: "session-0",
            mode: "live",
            frozenRunKey: null,
            activeRequestId: null,
            playbackCursor: 0,
        });
    });

    it("accepts only exact matching session and request ids", () => {
        const session = {
            ...createOptimizationSession(),
            sessionId: "session-100",
            activeRequestId: 7,
        };
        expect(isActiveSessionRequest(session, "session-100", 7)).toBeTrue();
        expect(isActiveSessionRequest(session, "session-101", 7)).toBeFalse();
        expect(isActiveSessionRequest(session, "session-100", 8)).toBeFalse();
    });
});
