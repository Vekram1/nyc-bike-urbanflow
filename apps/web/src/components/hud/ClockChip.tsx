"use client";

import HUDCard from "./HUDCard";
import { useNowClock } from "@/lib/useNowClock";
import { useHasMounted } from "@/lib/useHasMounted";

function formatDate(d: Date) {
    return d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "2-digit",
        year: "numeric",
    });
}
function formatTime(d: Date) {
    return d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

type Props = {
    mode: "live" | "replay";
    sv: string;
    delayed: boolean;
    inspectLocked: boolean;
};

function compactSv(sv: string): string {
    if (sv.length <= 20) return sv;
    return `${sv.slice(0, 10)}...${sv.slice(-7)}`;
}

export default function ClockChip({ mode, sv, delayed, inspectLocked }: Props) {
    const mounted = useHasMounted();

    // Don’t render real time/date until after mount (prevents hydration mismatch)
    const now = useNowClock(250);

    const dateText = mounted ? formatDate(now) : "—";
    const timeText = mounted ? formatTime(now) : "—";
    const dateIso = mounted ? now.toISOString().slice(0, 10) : undefined;
    const timeIso = mounted ? now.toISOString() : undefined;
    const statusSummary = [
        mode === "live" ? "Live mode" : "Replay mode",
        inspectLocked ? "Inspect lock active" : "Inspect lock inactive",
        delayed ? "Data delayed" : "Data current",
    ].join(". ");

    return (
        <HUDCard>
            <span
                style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: "hidden",
                    clip: "rect(0 0 0 0)",
                    whiteSpace: "nowrap",
                    border: 0,
                }}
                aria-live="polite"
                aria-atomic="true"
            >
                {statusSummary}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <time
                        dateTime={dateIso}
                        style={{ fontSize: 12, opacity: 0.8 }}
                        aria-label="Current date"
                    >
                        {dateText}
                    </time>
                    <time
                        dateTime={timeIso}
                        style={{ fontSize: 14, fontWeight: 600 }}
                        aria-label="Current time"
                    >
                        {timeText}
                    </time>
                </div>

                <div
                    style={{
                        width: 1,
                        height: 28,
                        background: "rgba(255,255,255,0.12)",
                        margin: "0 4px",
                    }}
                />

                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                            style={{
                                padding: "2px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(255,255,255,0.18)",
                                background: "rgba(255,255,255,0.07)",
                                opacity: 0.92,
                            }}
                        >
                            {mode === "live" ? "Live" : "Replay"}
                        </span>
                        <span style={{ opacity: 0.55 }} aria-label={`Serving view ${sv}`}>
                            {compactSv(sv)}
                        </span>
                    </div>
                    {inspectLocked ? (
                        <div
                            style={{
                                display: "inline-flex",
                                alignSelf: "flex-start",
                                fontSize: 12,
                                padding: "2px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(120,200,255,0.35)",
                                background: "rgba(90,160,220,0.12)",
                                color: "rgba(200,230,255,0.95)",
                            }}
                        >
                            Inspect Lock
                        </div>
                    ) : null}

                    {delayed ? (
                        <div
                            style={{
                                display: "inline-flex",
                                alignSelf: "flex-start",
                                fontSize: 12,
                                padding: "2px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(255,180,0,0.35)",
                                background: "rgba(255,180,0,0.12)",
                                color: "rgba(255,220,160,0.95)",
                            }}
                        >
                            Delayed
                        </div>
                    ) : null}
                </div>
            </div>
        </HUDCard>
    );
}
