// apps/web/src/components/hud/CommandStack.tsx
"use client";

import HUDCard from "./HUDCard";
import Keycap from "./Keycap";
import type { LayerToggles } from "@/lib/hudTypes";

type Props = {
    playing: boolean;
    inspectLocked: boolean;
    compareMode: boolean;
    splitView: boolean;
    compareOffsetBuckets: number;
    layers: LayerToggles;
    onTogglePlay: () => void;
    onToggleLayer: (key: keyof LayerToggles) => void;
    onToggleCompareMode: () => void;
    onToggleSplitView: () => void;
    onCompareOffsetDown: () => void;
    onCompareOffsetUp: () => void;
};

export default function CommandStack({
    playing,
    inspectLocked,
    compareMode,
    splitView,
    compareOffsetBuckets,
    layers,
    onTogglePlay,
    onToggleLayer,
    onToggleCompareMode,
    onToggleSplitView,
    onCompareOffsetDown,
    onCompareOffsetUp,
}: Props) {
    return (
        <>
            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Row label="Search" hint=" / " />
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onTogglePlay}
                        aria-label={playing ? "Pause playback" : "Start playback"}
                        title={playing ? "Pause playback" : "Start playback"}
                        disabled={inspectLocked}
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }}>
                            {playing ? "Pause" : "Play"}
                        </span>
                        <span>
                            <Keycap k="Space" />
                        </span>
                    </button>
                    <Row label="Step" hint="← / →" />
                    <Row label="Jump" hint="Home / End" />
                    <Row label="Speed" hint="- / +" />
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
                            aria-label="Toggle severity layer"
                        />
                        <span>Severity</span>
                    </label>
                    <label style={toggleStyle}>
                        <input
                            type="checkbox"
                            checked={layers.capacity}
                            onChange={() => onToggleLayer("capacity")}
                            aria-label="Toggle capacity layer"
                        />
                        <span>Capacity</span>
                    </label>
                    <label style={toggleStyle}>
                        <input
                            type="checkbox"
                            checked={layers.labels}
                            onChange={() => onToggleLayer("labels")}
                            aria-label="Toggle station labels layer"
                        />
                        <span>Stations (labels)</span>
                    </label>
                </div>
            </HUDCard>

            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 2 }}>
                        Compare
                    </div>
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onToggleCompareMode}
                        disabled={inspectLocked}
                        aria-label="Toggle compare mode"
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }}>
                            {compareMode ? "Compare On" : "Compare Off"}
                        </span>
                    </button>
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onToggleSplitView}
                        disabled={inspectLocked || !compareMode}
                        aria-label="Toggle split view"
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }}>
                            {splitView ? "Split On" : "Split Off"}
                        </span>
                    </button>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            type="button"
                            style={smallBtnStyle}
                            onClick={onCompareOffsetDown}
                            disabled={inspectLocked}
                            aria-label="Decrease compare offset"
                        >
                            -
                        </button>
                        <div style={{ fontSize: 12, opacity: 0.9, alignSelf: "center" }}>
                            Offset {compareOffsetBuckets} buckets
                        </div>
                        <button
                            type="button"
                            style={smallBtnStyle}
                            onClick={onCompareOffsetUp}
                            disabled={inspectLocked}
                            aria-label="Increase compare offset"
                        >
                            +
                        </button>
                    </div>
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

const smallBtnStyle: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(230,237,243,0.92)",
    borderRadius: 8,
    padding: "2px 8px",
    cursor: "pointer",
    fontSize: 12,
};
