"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerToggles } from "@/lib/hudTypes";

const SPEED_STEPS = [0.25, 1, 4, 16];
const STORAGE_KEY = "urbanflow.hud.controls.v1";
const DEFAULT_LAYERS: LayerToggles = {
    severity: true,
    capacity: true,
    labels: false,
};

type PersistedHud = {
    speedIdx?: number;
    layers?: Partial<LayerToggles>;
};

function readPersistedHud(): PersistedHud | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as PersistedHud;
    } catch {
        return null;
    }
}

export function useHudControls() {
    const persisted = readPersistedHud();
    const [playing, setPlaying] = useState(true);
    const [speedIdx, setSpeedIdx] = useState(() => {
        if (typeof persisted?.speedIdx !== "number") return 1;
        return Math.max(0, Math.min(SPEED_STEPS.length - 1, persisted.speedIdx));
    });
    const [progress, setProgress] = useState(0.62);
    const [layers, setLayers] = useState<LayerToggles>(() => ({
        severity:
            typeof persisted?.layers?.severity === "boolean"
                ? persisted.layers.severity
                : DEFAULT_LAYERS.severity,
        capacity:
            typeof persisted?.layers?.capacity === "boolean"
                ? persisted.layers.capacity
                : DEFAULT_LAYERS.capacity,
        labels:
            typeof persisted?.layers?.labels === "boolean"
                ? persisted.layers.labels
                : DEFAULT_LAYERS.labels,
    }));
    const wasPlayingBeforeInspectRef = useRef(false);
    const wasPlayingBeforeHiddenRef = useRef(false);
    const autoPausedByHiddenRef = useRef(false);
    const [inspectLocked, setInspectLocked] = useState(false);

    const speed = SPEED_STEPS[speedIdx] ?? 1;

    useEffect(() => {
        const payload: PersistedHud = { speedIdx, layers };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }, [layers, speedIdx]);

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

    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.hidden) {
                if (playing) {
                    wasPlayingBeforeHiddenRef.current = true;
                    autoPausedByHiddenRef.current = true;
                    setPlaying(false);
                } else {
                    wasPlayingBeforeHiddenRef.current = false;
                }
                return;
            }

            if (autoPausedByHiddenRef.current && wasPlayingBeforeHiddenRef.current) {
                setPlaying(true);
            }
            autoPausedByHiddenRef.current = false;
            wasPlayingBeforeHiddenRef.current = false;
        };

        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }, [playing]);

    const seekTo = (next: number) => {
        if (inspectLocked) {
            console.info("[HudControls] seek_blocked_inspect_lock");
            return;
        }
        const clamped = Math.min(1, Math.max(0, next));
        console.info("[HudControls] seek", { next: clamped });
        setProgress(clamped);
    };

    const togglePlay = () => {
        if (inspectLocked) {
            console.info("[HudControls] toggle_play_blocked_inspect_lock");
            return;
        }
        setPlaying((v) => !v);
    };
    const speedDown = () => {
        if (inspectLocked) {
            console.info("[HudControls] speed_down_blocked_inspect_lock");
            return;
        }
        setSpeedIdx((i) => {
            const next = Math.max(0, i - 1);
            if (next !== i) {
                console.info("[HudControls] speed_changed", {
                    from: SPEED_STEPS[i],
                    to: SPEED_STEPS[next],
                });
            }
            return next;
        });
    };
    const speedUp = () => {
        if (inspectLocked) {
            console.info("[HudControls] speed_up_blocked_inspect_lock");
            return;
        }
        setSpeedIdx((i) => {
            const next = Math.min(SPEED_STEPS.length - 1, i + 1);
            if (next !== i) {
                console.info("[HudControls] speed_changed", {
                    from: SPEED_STEPS[i],
                    to: SPEED_STEPS[next],
                });
            }
            return next;
        });
    };
    const stepBack = () => {
        if (inspectLocked) {
            console.info("[HudControls] step_back_blocked_inspect_lock");
            return;
        }
        setProgress((p) => {
            const next = Math.max(0, p - 0.01);
            console.info("[HudControls] step_back", { from: p, to: next });
            return next;
        });
    };
    const stepForward = () => {
        if (inspectLocked) {
            console.info("[HudControls] step_forward_blocked_inspect_lock");
            return;
        }
        setProgress((p) => {
            const next = Math.min(1, p + 0.01);
            console.info("[HudControls] step_forward", { from: p, to: next });
            return next;
        });
    };
    const toggleLayer = (key: keyof LayerToggles) => {
        setLayers((curr) => ({ ...curr, [key]: !curr[key] }));
    };

    const onInspectOpen = () => {
        setInspectLocked(true);
        wasPlayingBeforeInspectRef.current = playing;
        if (playing) {
            setPlaying(false);
        }
        console.info("[HudControls] inspect_open", {
            wasPlayingBeforeInspect: wasPlayingBeforeInspectRef.current,
        });
    };

    const onInspectClose = () => {
        setInspectLocked(false);
        console.info("[HudControls] inspect_close", {
            resumePlayback: wasPlayingBeforeInspectRef.current,
        });
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
            case "Home":
                event.preventDefault();
                seekTo(0);
                return true;
            case "End":
                event.preventDefault();
                seekTo(1);
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
        inspectLocked,
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
