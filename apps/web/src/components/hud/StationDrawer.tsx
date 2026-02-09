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
    const titleId = `uf-drawer-title-${station.station_id}`;
    const descId = `uf-drawer-desc-${station.station_id}`;
    const tierId = `uf-drawer-tier-${station.station_id}`;

    return (
        <div
            className="uf-drawer"
            role="dialog"
            aria-labelledby={titleId}
            aria-describedby={`${descId} ${tierId}`}
        >
            <div style={{ padding: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Station</div>
                <div id={titleId} style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>
                    {station.name}
                </div>

                <div id={descId} style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                    Updated: {updated}
                </div>
                <div id={tierId} style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                    Tier1 view: tile payload only (no detail fetch).
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    <Row label="Station key" value={station.station_id} />
                    <Row label="Capacity" value={fmtNum(station.capacity)} />
                    <Row label="Bikes" value={fmtNum(station.bikes)} />
                    <Row label="Docks" value={fmtNum(station.docks)} />
                    <Row label="Bucket quality" value={fmtText(station.bucket_quality)} />
                    <Row label="T_bucket" value={fmtText(station.t_bucket)} />
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
                    aria-label="Close station details"
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

function fmtText(x: string | null) {
    return x == null || x.length === 0 ? "—" : x;
}
