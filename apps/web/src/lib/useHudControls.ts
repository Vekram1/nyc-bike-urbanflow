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
    compareMode?: boolean;
    splitView?: boolean;
    compareOffsetBuckets?: number;
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
    const [compareMode, setCompareMode] = useState(
        typeof persisted?.compareMode === "boolean" ? persisted.compareMode : false
    );
    const [splitView, setSplitView] = useState(
        typeof persisted?.splitView === "boolean" ? persisted.splitView : false
    );
    const [compareOffsetBuckets, setCompareOffsetBuckets] = useState(() => {
        const persistedOffset = persisted?.compareOffsetBuckets;
        if (typeof persistedOffset !== "number") return 6;
        return Math.max(1, Math.min(24, Math.round(persistedOffset)));
    });

    const speed = SPEED_STEPS[speedIdx] ?? 1;

    useEffect(() => {
        const payload: PersistedHud = {
            speedIdx,
            layers,
            compareMode,
            splitView,
            compareOffsetBuckets,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }, [compareMode, compareOffsetBuckets, layers, speedIdx, splitView]);

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

    const toggleCompareMode = () => {
        if (inspectLocked) {
            console.info("[HudControls] compare_mode_toggle_blocked_inspect_lock");
            return;
        }
        setCompareMode((curr) => {
            const next = !curr;
            if (!next) {
                setSplitView(false);
            }
            console.info("[HudControls] compare_mode_changed", { enabled: next });
            return next;
        });
    };

    const toggleSplitView = () => {
        if (inspectLocked) {
            console.info("[HudControls] split_view_toggle_blocked_inspect_lock");
            return;
        }
        if (!compareMode) {
            console.info("[HudControls] split_view_toggle_blocked_compare_disabled");
            return;
        }
        setSplitView((curr) => {
            const next = !curr;
            console.info("[HudControls] split_view_changed", { enabled: next });
            return next;
        });
    };

    const compareOffsetDown = () => {
        if (inspectLocked) {
            console.info("[HudControls] compare_offset_down_blocked_inspect_lock");
            return;
        }
        setCompareOffsetBuckets((curr) => {
            const next = Math.max(1, curr - 1);
            if (next !== curr) {
                console.info("[HudControls] compare_offset_changed", { from: curr, to: next });
            }
            return next;
        });
    };

    const compareOffsetUp = () => {
        if (inspectLocked) {
            console.info("[HudControls] compare_offset_up_blocked_inspect_lock");
            return;
        }
        setCompareOffsetBuckets((curr) => {
            const next = Math.min(24, curr + 1);
            if (next !== curr) {
                console.info("[HudControls] compare_offset_changed", { from: curr, to: next });
            }
            return next;
        });
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
        compareMode,
        splitView,
        compareOffsetBuckets,
        seekTo,
        togglePlay,
        speedDown,
        speedUp,
        stepBack,
        stepForward,
        toggleLayer,
        toggleCompareMode,
        toggleSplitView,
        compareOffsetDown,
        compareOffsetUp,
        onInspectOpen,
        onInspectClose,
        handleHotkey,
    };
}
