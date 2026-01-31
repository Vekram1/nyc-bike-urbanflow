// apps/web/src/components/hud/StatsCard.tsx
"use client";

import HUDCard from "./HUDCard";
import { useFps } from "@/lib/useFps";
import { useRollingP95 } from "@/lib/useRollingP95";

export default function StatsCard() {
    const fps = useFps();
    const { p95, pushSample, spark } = useRollingP95({ windowMs: 15_000 });

    // TEMP: simulate tile timings until you wire real fetch timings.
    // Replace by calling pushSample(ms) whenever a tile request completes.
    // This keeps the UI + plumbing stable.
    if (typeof window !== "undefined") {
        // Lightweight jitter injection (dev only)
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        setTimeout(() => pushSample(60 + Math.random() * 180), 400);
    }

    // Stubs until you connect real station state
    const activeStations = 1834;
    const empty = 71;
    const full = 42;

    return (
        <HUDCard>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Stats</div>

                <KV k="Active stations" v={activeStations.toLocaleString()} />
                <KV k="Empty / Full" v={`${empty} / ${full}`} />
                <KV k="Tile p95 (ms)" v={p95 ? Math.round(p95).toString() : "—"} />
                <KV k="FPS" v={fps ? fps.toFixed(0) : "—"} />

                <div style={{ marginTop: 4 }}>
                    <Sparkline values={spark} />
                </div>
            </div>
        </HUDCard>
    );
}

function KV({ k, v }: { k: string; v: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>{k}</span>
            <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.95 }}>{v}</span>
        </div>
    );
}

function Sparkline({ values }: { values: number[] }) {
    const w = 220;
    const h = 36;
    if (values.length < 2) {
        return (
            <div
                style={{
                    width: w,
                    height: h,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.10)",
                }}
            />
        );
    }

    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = Math.max(1e-6, max - min);

    const pts = values
        .map((v, i) => {
            const x = (i / (values.length - 1)) * w;
            const y = h - ((v - min) / span) * h;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");

    return (
        <svg
            width={w}
            height={h}
            style={{
                display: "block",
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
            }}
        >
            <polyline
                points={pts}
                fill="none"
                stroke="rgba(230,237,243,0.85)"
                strokeWidth="2"
            />
        </svg>
    );
}
