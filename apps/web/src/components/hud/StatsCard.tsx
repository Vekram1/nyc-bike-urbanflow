// apps/web/src/components/hud/StatsCard.tsx
"use client";

import HUDCard from "./HUDCard";

type Props = {
    activeStations: number;
    empty: number;
    full: number;
};

export default function StatsCard({ activeStations, empty, full }: Props) {
    const constrained = empty + full;
    const constrainedPct = activeStations > 0 ? (constrained / activeStations) * 100 : 0;

    return (
        <HUDCard>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }} data-uf-id="stats-title">Network Stats</div>
                    <div style={badgeStyle} data-uf-id="stats-constrained-badge">
                        {constrainedPct.toFixed(1)}% empty/full constrained
                    </div>
                </div>

                <KV k="Stations" v={activeStations.toLocaleString()} rowId="stats-row-stations" valueId="stats-value-stations" />
                <KV k="Empty Stations" v={empty.toLocaleString()} rowId="stats-row-empty-stations" valueId="stats-value-empty-stations" />
                <KV k="Full Stations" v={full.toLocaleString()} rowId="stats-row-full-stations" valueId="stats-value-full-stations" />
            </div>
        </HUDCard>
    );
}

function KV({ k, v, rowId, valueId }: { k: string; v: string; rowId: string; valueId: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }} data-uf-id={rowId}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>{k}</span>
            <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.95 }} data-uf-id={valueId}>{v}</span>
        </div>
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
