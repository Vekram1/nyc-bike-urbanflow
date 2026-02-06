// apps/web/src/components/hud/ScrubberBar.tsx
"use client";

import HUDCard from "./HUDCard";
import Keycap from "./Keycap";

type Props = {
    playing: boolean;
    speed: number;
    progress: number;
    progressLabel: string;
    onTogglePlay: () => void;
    onSpeedDown: () => void;
    onSpeedUp: () => void;
    onStepBack: () => void;
    onStepForward: () => void;
    onSeek: (next: number) => void;
};

export default function ScrubberBar({
    playing,
    speed,
    progress,
    progressLabel,
    onTogglePlay,
    onSpeedDown,
    onSpeedUp,
    onStepBack,
    onStepForward,
    onSeek,
}: Props) {
    const clampedProgress = Math.min(1, Math.max(0, progress));
    const onTrackClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const x = e.clientX - rect.left;
        onSeek(x / rect.width);
    };

    return (
        <HUDCard>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto 1fr auto",
                    gap: 12,
                    alignItems: "center",
                }}
            >
                <button
                    type="button"
                    style={btnStyle}
                    title="Play/Pause"
                    onClick={onTogglePlay}
                >
                    {playing ? "Pause" : "Play"} <Keycap k="Space" />
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" style={btnStyle} onClick={onSpeedDown}>
                        - <span style={{ opacity: 0.7 }}>speed</span>
                    </button>
                    <button type="button" style={btnStyle} onClick={onSpeedUp}>
                        + <span style={{ opacity: 0.7 }}>speed</span>
                    </button>
                    <div style={{ opacity: 0.7, fontSize: 12, alignSelf: "center" }}>
                        {speed.toFixed(2)}x
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onTrackClick}
                    style={trackButtonStyle}
                    title="Seek"
                >
                    <div
                        style={{
                            position: "absolute",
                            inset: "9px 0 9px 0",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.10)",
                        }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            top: 2,
                            bottom: 2,
                            left: `${(clampedProgress * 100).toFixed(2)}%`,
                            width: 2,
                            borderRadius: 2,
                            background: "rgba(230,237,243,0.9)",
                        }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            left: "22%",
                            top: 7,
                            height: 8,
                            width: 2,
                            background: "rgba(255,80,80,0.7)",
                        }}
                    />
                    <div
                        style={{
                            position: "absolute",
                            left: "40%",
                            top: 7,
                            height: 8,
                            width: 2,
                            background: "rgba(255,80,80,0.7)",
                        }}
                    />
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" style={btnStyle} onClick={onStepBack} title="Step back">
                        Back <Keycap k="LEFT" />
                    </button>
                    <button type="button" style={btnStyle} onClick={onStepForward} title="Step forward">
                        Step <Keycap k="RIGHT" />
                    </button>
                </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                {progressLabel}
            </div>
        </HUDCard>
    );
}

const btnStyle: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(230,237,243,0.92)",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
};

const trackButtonStyle: React.CSSProperties = {
    position: "relative",
    height: 22,
    width: "100%",
    border: "none",
    margin: 0,
    padding: 0,
    background: "transparent",
    cursor: "pointer",
};

