// apps/web/src/components/hud/CommandStack.tsx
"use client";

import HUDCard from "./HUDCard";
import Keycap from "./Keycap";

export default function CommandStack() {
    return (
        <>
            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Row label="Search" hint=" / " />
                    <Row label="Pause" hint="Space" />
                    <Row label="Random" hint="R" />
                    <Row label="About" hint="?" />
                </div>
            </HUDCard>

            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 2 }}>
                        Layers
                    </div>
                    <label style={toggleStyle}>
                        <input type="checkbox" defaultChecked />
                        <span>Severity</span>
                    </label>
                    <label style={toggleStyle}>
                        <input type="checkbox" defaultChecked />
                        <span>Capacity</span>
                    </label>
                    <label style={toggleStyle}>
                        <input type="checkbox" />
                        <span>Stations (labels)</span>
                    </label>
                </div>
            </HUDCard>
        </>
    );
}

function Row({ label, hint }: { label: string; hint: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12, opacity: 0.92 }}>{label}</span>
            <span>
                <Keycap k={hint} />
            </span>
        </div>
    );
}

const toggleStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    opacity: 0.92,
};
