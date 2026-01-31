// apps/web/src/components/hud/ClockChip.tsx
"use client";

import HUDCard from "./HUDCard";
import { useNowClock } from "@/lib/useNowClock";

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

export default function ClockChip() {
    // For now: "live clock" only. Later: replay clock driven by scrubber state.
    const now = useNowClock(250);

    // Stubs you’ll wire to your real data plane later:
    const mode: "live" | "replay" = "live";
    const sv = "sv:dev-0";
    const delayed = false;

    return (
        <HUDCard>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{formatDate(now)}</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{formatTime(now)}</div>
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
                    <div style={{ fontSize: 12 }}>
                        <span style={{ opacity: 0.85 }}>
                            {mode === "live" ? "Live" : "Replay"}
                        </span>
                        <span style={{ opacity: 0.55, marginLeft: 8 }}>{sv}</span>
                    </div>

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
