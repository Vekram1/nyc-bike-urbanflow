// apps/web/src/components/hud/ScrubberBar.tsx
"use client";

import { useId } from "react";

import HUDCard from "./HUDCard";
import Keycap from "./Keycap";

type Props = {
    mode: "live" | "replay";
    playing: boolean;
    inspectLocked: boolean;
    speed: number;
    progress: number;
    progressLabel: string;
    onTogglePlay: () => void;
    onSpeedDown: () => void;
    onSpeedUp: () => void;
    onStepBack: () => void;
    onStepForward: () => void;
    onSeek: (next: number) => void;
    onGoLive: () => void;
};

export default function ScrubberBar({
    mode,
    playing,
    inspectLocked,
    speed,
    progress,
    progressLabel,
    onTogglePlay,
    onSpeedDown,
    onSpeedUp,
    onStepBack,
    onStepForward,
    onSeek,
    onGoLive,
}: Props) {
    const scrubberLabelId = useId();
    const scrubberValueId = useId();
    const scrubberHelpId = useId();
    const clampedProgress = Math.min(1, Math.max(0, progress));
    const progressPercent = Math.round(clampedProgress * 100);
    const scrubberValueText = `${progressLabel}. Playback ${
        playing ? "playing" : "paused"
    }. Speed ${speed.toFixed(2)}x.${inspectLocked ? " Inspect lock is active." : ""}`;

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
                    gridTemplateColumns: "auto auto auto 1fr auto",
                    gap: 12,
                    alignItems: "center",
                }}
            >
                <button
                    type="button"
                    style={btnStyle}
                    title={playing ? "Pause playback" : "Start playback"}
                    aria-label={playing ? "Pause playback" : "Start playback"}
                    onClick={onTogglePlay}
                    disabled={inspectLocked}
                    data-uf-id="scrubber-play-toggle"
                >
                    {playing ? "Pause" : "Play"} <Keycap k="Space" />
                </button>
                <button
                    type="button"
                    style={btnStyle}
                    onClick={onGoLive}
                    title="Jump to current live time"
                    aria-label="Jump to current live time"
                    disabled={inspectLocked}
                    data-uf-id="scrubber-go-live"
                    data-uf-mode={mode}
                >
                    {mode === "live" ? "Live" : "Go Live"} <Keycap k="L" />
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                    <button
                        type="button"
                        style={btnStyle}
                        onClick={onSpeedDown}
                        title="Decrease playback speed"
                        aria-label="Decrease playback speed"
                        disabled={inspectLocked}
                        data-uf-id="scrubber-speed-down"
                    >
                        - <span style={{ opacity: 0.7 }}>speed</span> <Keycap k="-" />
                    </button>
                    <button
                        type="button"
                        style={btnStyle}
                        onClick={onSpeedUp}
                        title="Increase playback speed"
                        aria-label="Increase playback speed"
                        disabled={inspectLocked}
                        data-uf-id="scrubber-speed-up"
                    >
                        + <span style={{ opacity: 0.7 }}>speed</span> <Keycap k="+" />
                    </button>
                    <div style={{ opacity: 0.7, fontSize: 12, alignSelf: "center" }} data-uf-id="scrubber-speed-value">
                        {speed.toFixed(2)}x
                    </div>
                </div>

                <button
                    type="button"
                    onClick={onTrackClick}
                    style={trackButtonStyle}
                    title="Seek timeline position"
                    aria-label="Seek timeline position"
                    role="progressbar"
                    aria-labelledby={`${scrubberLabelId} ${scrubberValueId}`}
                    aria-describedby={scrubberHelpId}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercent}
                    aria-valuetext={scrubberValueText}
                    disabled={inspectLocked}
                    data-uf-id="scrubber-track"
                    data-uf-progress-percent={String(progressPercent)}
                    data-uf-playing={playing ? "true" : "false"}
                    data-uf-inspect-locked={inspectLocked ? "true" : "false"}
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
                    <button
                        type="button"
                        style={btnStyle}
                        onClick={onStepBack}
                        title="Step back one bucket"
                        aria-label="Step back one bucket"
                        disabled={inspectLocked}
                        data-uf-id="scrubber-step-back"
                    >
                        Back <Keycap k="←" />
                    </button>
                    <button
                        type="button"
                        style={btnStyle}
                        onClick={onStepForward}
                        title="Step forward one bucket"
                        aria-label="Step forward one bucket"
                        disabled={inspectLocked}
                        data-uf-id="scrubber-step-forward"
                    >
                        Step <Keycap k="→" />
                    </button>
                </div>
            </div>
            <div id={scrubberLabelId} style={srOnlyStyle}>
                Timeline progress
            </div>
            <output
                id={scrubberValueId}
                aria-live="polite"
                aria-atomic="true"
                style={{ marginTop: 8, fontSize: 12, opacity: 0.75, display: "block" }}
                data-uf-id="scrubber-progress-label"
            >
                {progressLabel}
            </output>
            <div id={scrubberHelpId} style={srOnlyStyle}>
                Click the timeline bar to seek or use step controls for single bucket movement.
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

const srOnlyStyle: React.CSSProperties = {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
};
