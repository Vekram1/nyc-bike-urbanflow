// apps/web/src/components/hud/StatsCard.tsx
"use client";

import HUDCard from "./HUDCard";

type Props = {
    activeStations: number;
    empty: number;
    full: number;
    tileP95: number | null;
    fps: number | null;
    spark: number[];
};

export default function StatsCard({ activeStations, empty, full, tileP95, fps, spark }: Props) {
    const constrained = empty + full;
    const constrainedPct = activeStations > 0 ? (constrained / activeStations) * 100 : 0;

    return (
        <HUDCard>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>Network Stats</div>
                    <div style={badgeStyle}>{constrainedPct.toFixed(1)}% constrained</div>
                </div>

                <KV k="Stations" v={activeStations.toLocaleString()} />
                <KV k="Constrained (E/F)" v={`${empty} / ${full}`} />
                <KV k="Tile p95" v={tileP95 ? `${Math.round(tileP95)} ms` : "n/a"} />
                <KV k="FPS" v={fps ? fps.toFixed(0) : "n/a"} />

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
            <div style={sparkBaseStyle}>
                <div style={{ fontSize: 11, opacity: 0.5, textAlign: "center", lineHeight: `${h}px` }}>
                    collecting latency samples
                </div>
            </div>
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
            style={sparkBaseStyle}
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

const badgeStyle: React.CSSProperties = {
    fontSize: 11,
    opacity: 0.85,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    padding: "2px 8px",
};

const sparkBaseStyle: React.CSSProperties = {
    display: "block",
    width: 220,
    height: 36,
    borderRadius: 8,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
};
