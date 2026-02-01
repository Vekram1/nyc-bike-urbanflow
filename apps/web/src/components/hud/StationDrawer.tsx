// apps/web/src/components/hud/StationDrawer.tsx
"use client";

import type { StationPick } from "@/components/map/MapView";

export default function StationDrawer(props: {
    station: StationPick | null;
    onClose: () => void;
}) {
    const { station, onClose } = props;
    const isOpen = !!station;

    if (!isOpen || !station) return null;

    const updated =
        station.gbfs_last_updated != null
            ? new Date(station.gbfs_last_updated * 1000).toLocaleString()
            : "—";

    return (
        <div className="uf-drawer" role="dialog" aria-label="Station details">
            <div style={{ padding: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Station</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>
                    {station.name}
                </div>

                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                    Updated: {updated}
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    <Row label="Capacity" value={fmtNum(station.capacity)} />
                    <Row label="Bikes" value={fmtNum(station.bikes)} />
                    <Row label="Docks" value={fmtNum(station.docks)} />
                </div>

                <button
                    type="button"
                    style={{
                        marginTop: 14,
                        width: "100%",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(255,255,255,0.06)",
                        color: "rgba(230,237,243,0.92)",
                        padding: "10px 12px",
                        cursor: "pointer",
                    }}
                    onClick={onClose}
                >
                    Close
                </button>
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{value}</span>
        </div>
    );
}

function fmtNum(x: number | null) {
    return x == null || Number.isNaN(x) ? "—" : String(x);
}
