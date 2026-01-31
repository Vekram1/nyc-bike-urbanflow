// apps/web/src/components/hud/StationDrawer.tsx
"use client";

export default function StationDrawer() {
    // Later: controlled by selected station state.
    const isOpen = false;

    if (!isOpen) return null;

    return (
        <div className="uf-drawer">
            <div style={{ padding: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Station</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>
                    W 21 St & 6 Ave
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    <Row label="Capacity" value="47" />
                    <Row label="Bikes" value="12" />
                    <Row label="Docks" value="35" />
                    <Row label="Severity" value="0.62 (red)" />
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
                    onClick={() => { }}
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
