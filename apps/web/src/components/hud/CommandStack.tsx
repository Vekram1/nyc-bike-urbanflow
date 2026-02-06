// apps/web/src/components/hud/CommandStack.tsx
"use client";

import HUDCard from "./HUDCard";
import Keycap from "./Keycap";
import type { LayerToggles } from "@/lib/hudTypes";

type Props = {
    playing: boolean;
    layers: LayerToggles;
    onTogglePlay: () => void;
    onToggleLayer: (key: keyof LayerToggles) => void;
};

export default function CommandStack({
    playing,
    layers,
    onTogglePlay,
    onToggleLayer,
}: Props) {
    return (
        <>
            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Row label="Search" hint=" / " />
                    <button type="button" style={rowBtnStyle} onClick={onTogglePlay}>
                        <span style={{ fontSize: 12, opacity: 0.92 }}>
                            {playing ? "Pause" : "Play"}
                        </span>
                        <span>
                            <Keycap k="Space" />
                        </span>
                    </button>
                    <Row label="About" hint="?" />
                </div>
            </HUDCard>

            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 2 }}>
                        Layers
                    </div>
                    <label style={toggleStyle}>
                        <input
                            type="checkbox"
                            checked={layers.severity}
                            onChange={() => onToggleLayer("severity")}
                        />
                        <span>Severity</span>
                    </label>
                    <label style={toggleStyle}>
                        <input
                            type="checkbox"
                            checked={layers.capacity}
                            onChange={() => onToggleLayer("capacity")}
                        />
                        <span>Capacity</span>
                    </label>
                    <label style={toggleStyle}>
                        <input
                            type="checkbox"
                            checked={layers.labels}
                            onChange={() => onToggleLayer("labels")}
                        />
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

const rowBtnStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
};
