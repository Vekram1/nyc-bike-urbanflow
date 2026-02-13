// apps/web/src/components/hud/ScrubberBar.tsx
"use client";

import { useId, useMemo, useState } from "react";

import HUDCard from "./HUDCard";
import Keycap from "./Keycap";

type Props = {
    mode: "live" | "replay";
    playing: boolean;
    inspectLocked: boolean;
    speed: number;
    progress: number;
    progressLabel: string;
    densityMarks?: Array<{
        pct: number;
        intensity: number;
        bucketTsMs: number;
        emptyRate: number;
        fullRate: number;
        constrainedPct: number;
    }>;
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
    densityMarks = [],
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
    const [hoverMark, setHoverMark] = useState<{
        pct: number;
        timeLabel: string;
        emptyLabel: string;
        fullLabel: string;
        constrainedLabel: string;
    } | null>(null);
    const sortedDensityMarks = useMemo(
        () => [...densityMarks].sort((a, b) => a.pct - b.pct),
        [densityMarks]
    );
    const scrubberValueText = `${progressLabel}. Playback ${
        playing ? "playing" : "paused"
    }. Speed ${speed.toFixed(2)}x.${inspectLocked ? " Inspect lock is active." : ""}`;

    const findNearestDensityMark = (pctRaw: number) => {
        if (sortedDensityMarks.length === 0) return null;
        const pct = Math.max(0, Math.min(1, pctRaw));
        let nearest = sortedDensityMarks[0];
        let nearestDistance = Math.abs(nearest.pct - pct);
        for (let idx = 1; idx < sortedDensityMarks.length; idx += 1) {
            const candidate = sortedDensityMarks[idx];
            const distance = Math.abs(candidate.pct - pct);
            if (distance < nearestDistance) {
                nearest = candidate;
                nearestDistance = distance;
            }
        }
        return nearest;
    };

    const updateHoverMark = (target: HTMLButtonElement, clientX: number) => {
        const rect = target.getBoundingClientRect();
        if (rect.width <= 0) return;
        const pctRaw = (clientX - rect.left) / rect.width;
        const nearest = findNearestDensityMark(pctRaw);
        if (!nearest) {
            setHoverMark(null);
            return;
        }
        setHoverMark({
            pct: nearest.pct,
            timeLabel: new Date(nearest.bucketTsMs).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            }),
            emptyLabel: `${Math.round(nearest.emptyRate * 100)}%`,
            fullLabel: `${Math.round(nearest.fullRate * 100)}%`,
            constrainedLabel: `${Math.round(nearest.constrainedPct)}%`,
        });
    };

    const seekFromClientX = (target: HTMLButtonElement, clientX: number) => {
        const rect = target.getBoundingClientRect();
        if (rect.width <= 0) return;
        const x = clientX - rect.left;
        onSeek(x / rect.width);
    };

    const onTrackClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        seekFromClientX(e.currentTarget, e.clientX);
    };

    const onTrackPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        const target = e.currentTarget;
        seekFromClientX(target, e.clientX);

        const onPointerMove = (event: PointerEvent) => {
            seekFromClientX(target, event.clientX);
        };
        const onPointerUp = () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
    };

    const onTrackPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        updateHoverMark(e.currentTarget, e.clientX);
    };
    const onTrackPointerEnter = (e: React.PointerEvent<HTMLButtonElement>) => {
        updateHoverMark(e.currentTarget, e.clientX);
    };
    const onTrackMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
        updateHoverMark(e.currentTarget, e.clientX);
    };

    const onTrackPointerLeave = () => {
        setHoverMark(null);
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
                    onPointerDown={onTrackPointerDown}
                    onPointerEnter={onTrackPointerEnter}
                    onPointerMove={onTrackPointerMove}
                    onMouseMove={onTrackMouseMove}
                    onPointerLeave={onTrackPointerLeave}
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
                    {hoverMark ? (
                        <div
                            style={{
                                position: "absolute",
                                left: `${(hoverMark.pct * 100).toFixed(2)}%`,
                                bottom: "calc(100% + 10px)",
                                transform: "translateX(-50%)",
                                borderRadius: 8,
                                border: "1px solid rgba(255,255,255,0.20)",
                                background: "rgba(6,12,18,0.95)",
                                color: "rgba(230,237,243,0.95)",
                                padding: "6px 8px",
                                fontSize: 11,
                                lineHeight: 1.35,
                                minWidth: 150,
                                textAlign: "left",
                                pointerEvents: "none",
                                zIndex: 4,
                                boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
                            }}
                            data-uf-id="scrubber-constraint-tooltip"
                        >
                            <div style={{ fontWeight: 600 }}>{hoverMark.timeLabel}</div>
                            <div>Constraint: {hoverMark.constrainedLabel}</div>
                            <div>Empty: {hoverMark.emptyLabel}</div>
                            <div>Full: {hoverMark.fullLabel}</div>
                        </div>
                    ) : null}
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
                    {sortedDensityMarks.map((mark, idx) => {
                        const clampedPct = Math.max(0, Math.min(1, mark.pct));
                        const intensity = Math.max(0, Math.min(1, mark.intensity));
                        const height = 4 + Math.round(intensity * 8);
                        const alpha = 0.2 + intensity * 0.65;
                        const hue = 120 - intensity * 120;
                        return (
                            <div
                                key={`density-${idx}-${clampedPct.toFixed(4)}`}
                                style={{
                                    position: "absolute",
                                    left: `${(clampedPct * 100).toFixed(2)}%`,
                                    top: 11 - height / 2,
                                    height,
                                    width: 2,
                                    borderRadius: 1,
                                    background: `hsla(${hue.toFixed(0)}, 95%, 55%, ${alpha.toFixed(3)})`,
                                }}
                            />
                        );
                    })}
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
