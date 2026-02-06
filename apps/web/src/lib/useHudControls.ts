"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerToggles } from "@/lib/hudTypes";

const SPEED_STEPS = [0.25, 1, 4, 16];

export function useHudControls() {
    const [playing, setPlaying] = useState(true);
    const [speedIdx, setSpeedIdx] = useState(1);
    const [progress, setProgress] = useState(0.62);
    const [layers, setLayers] = useState<LayerToggles>({
        severity: true,
        capacity: true,
        labels: false,
    });
    const wasPlayingBeforeInspectRef = useRef(false);

    const speed = SPEED_STEPS[speedIdx] ?? 1;

    useEffect(() => {
        if (!playing) return;

        const timer = window.setInterval(() => {
            setProgress((curr) => {
                const next = curr + 0.0025 * speed;
                return next > 1 ? next - 1 : next;
            });
        }, 250);

        return () => window.clearInterval(timer);
    }, [playing, speed]);

    const seekTo = (next: number) => {
        const clamped = Math.min(1, Math.max(0, next));
        setProgress(clamped);
    };

    const togglePlay = () => setPlaying((v) => !v);
    const speedDown = () => setSpeedIdx((i) => Math.max(0, i - 1));
    const speedUp = () => setSpeedIdx((i) => Math.min(SPEED_STEPS.length - 1, i + 1));
    const stepBack = () => setProgress((p) => Math.max(0, p - 0.01));
    const stepForward = () => setProgress((p) => Math.min(1, p + 0.01));
    const toggleLayer = (key: keyof LayerToggles) => {
        setLayers((curr) => ({ ...curr, [key]: !curr[key] }));
    };

    const onInspectOpen = () => {
        wasPlayingBeforeInspectRef.current = playing;
        if (playing) {
            setPlaying(false);
        }
    };

    const onInspectClose = () => {
        if (wasPlayingBeforeInspectRef.current) {
            setPlaying(true);
        }
    };

    const handleHotkey = (event: KeyboardEvent) => {
        if (event.defaultPrevented) return false;
        if (event.metaKey || event.ctrlKey || event.altKey) return false;

        const target = event.target;
        if (target instanceof HTMLElement) {
            const tag = target.tagName;
            const editable = target.isContentEditable;
            if (editable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
                return false;
            }
        }

        switch (event.code) {
            case "Space":
                event.preventDefault();
                togglePlay();
                return true;
            case "ArrowLeft":
                event.preventDefault();
                stepBack();
                return true;
            case "ArrowRight":
                event.preventDefault();
                stepForward();
                return true;
            case "Minus":
            case "NumpadSubtract":
                event.preventDefault();
                speedDown();
                return true;
            case "Equal":
            case "NumpadAdd":
                event.preventDefault();
                speedUp();
                return true;
            default:
                return false;
        }
    };

    return {
        playing,
        speed,
        progress,
        layers,
        seekTo,
        togglePlay,
        speedDown,
        speedUp,
        stepBack,
        stepForward,
        toggleLayer,
        onInspectOpen,
        onInspectClose,
        handleHotkey,
    };
}
