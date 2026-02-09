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

type UfE2EState = {
    blockedActions?: Record<string, number>;
    hudActionCounts?: Record<string, number>;
    hudLastAction?: string;
    hudLastActionAt?: string;
    compareModeLastValue?: boolean;
    compareModeLastChangedAt?: string;
    splitViewLastValue?: boolean;
    splitViewLastChangedAt?: string;
    compareOffsetLastValue?: number;
    compareOffsetLastChangedAt?: string;
    stepBackLastAt?: string;
    stepForwardLastAt?: string;
    hudLastBlockedAction?: string;
    hudLastBlockedReason?: string;
    hudLastBlockedAt?: string;
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

function markBlockedAction(action: string, reason: string): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    const blockedActions = { ...(current.blockedActions ?? {}) };
    blockedActions[action] = (blockedActions[action] ?? 0) + 1;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = {
        ...current,
        blockedActions,
        hudLastBlockedAction: action,
        hudLastBlockedReason: reason,
        hudLastBlockedAt: new Date().toISOString(),
    };
}

function markHudAction(action: string): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    const hudActionCounts = { ...(current.hudActionCounts ?? {}) };
    hudActionCounts[action] = (hudActionCounts[action] ?? 0) + 1;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = {
        ...current,
        hudActionCounts,
        hudLastAction: action,
        hudLastActionAt: new Date().toISOString(),
    };
}

function markCompareOffsetChanged(value: number): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = {
        ...current,
        compareOffsetLastValue: value,
        compareOffsetLastChangedAt: new Date().toISOString(),
    };
}

function markCompareModeChanged(value: boolean): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = {
        ...current,
        compareModeLastValue: value,
        compareModeLastChangedAt: new Date().toISOString(),
    };
}

function markSplitViewChanged(value: boolean): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = {
        ...current,
        splitViewLastValue: value,
        splitViewLastChangedAt: new Date().toISOString(),
    };
}

function markStepAction(action: "stepBack" | "stepForward"): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    const now = new Date().toISOString();
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = {
        ...current,
        stepBackLastAt: action === "stepBack" ? now : (current.stepBackLastAt ?? ""),
        stepForwardLastAt: action === "stepForward" ? now : (current.stepForwardLastAt ?? ""),
    };
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
            markBlockedAction("seek", "inspect_lock");
            return;
        }
        const clamped = Math.min(1, Math.max(0, next));
        console.info("[HudControls] seek", { next: clamped });
        markHudAction("seek");
        setProgress(clamped);
    };

    const togglePlay = () => {
        if (inspectLocked) {
            console.info("[HudControls] toggle_play_blocked_inspect_lock");
            markBlockedAction("togglePlay", "inspect_lock");
            return;
        }
        markHudAction("togglePlay");
        setPlaying((v) => !v);
    };
    const speedDown = () => {
        if (inspectLocked) {
            console.info("[HudControls] speed_down_blocked_inspect_lock");
            markBlockedAction("speedDown", "inspect_lock");
            return;
        }
        setSpeedIdx((i) => {
            const next = Math.max(0, i - 1);
            if (next !== i) {
                console.info("[HudControls] speed_changed", {
                    from: SPEED_STEPS[i],
                    to: SPEED_STEPS[next],
                });
                markHudAction("speedDown");
            }
            return next;
        });
    };
    const speedUp = () => {
        if (inspectLocked) {
            console.info("[HudControls] speed_up_blocked_inspect_lock");
            markBlockedAction("speedUp", "inspect_lock");
            return;
        }
        setSpeedIdx((i) => {
            const next = Math.min(SPEED_STEPS.length - 1, i + 1);
            if (next !== i) {
                console.info("[HudControls] speed_changed", {
                    from: SPEED_STEPS[i],
                    to: SPEED_STEPS[next],
                });
                markHudAction("speedUp");
            }
            return next;
        });
    };
    const stepBack = () => {
        if (inspectLocked) {
            console.info("[HudControls] step_back_blocked_inspect_lock");
            markBlockedAction("stepBack", "inspect_lock");
            return;
        }
        setProgress((p) => {
            const next = Math.max(0, p - 0.01);
            console.info("[HudControls] step_back", { from: p, to: next });
            markHudAction("stepBack");
            markStepAction("stepBack");
            return next;
        });
    };
    const stepForward = () => {
        if (inspectLocked) {
            console.info("[HudControls] step_forward_blocked_inspect_lock");
            markBlockedAction("stepForward", "inspect_lock");
            return;
        }
        setProgress((p) => {
            const next = Math.min(1, p + 0.01);
            console.info("[HudControls] step_forward", { from: p, to: next });
            markHudAction("stepForward");
            markStepAction("stepForward");
            return next;
        });
    };
    const toggleLayer = (key: keyof LayerToggles) => {
        markHudAction(`toggleLayer:${key}`);
        setLayers((curr) => ({ ...curr, [key]: !curr[key] }));
    };

    const toggleCompareMode = () => {
        if (inspectLocked) {
            console.info("[HudControls] compare_mode_toggle_blocked_inspect_lock");
            markBlockedAction("toggleCompareMode", "inspect_lock");
            return;
        }
        setCompareMode((curr) => {
            const next = !curr;
            if (!next) {
                setSplitView(false);
                markSplitViewChanged(false);
            }
            console.info("[HudControls] compare_mode_changed", { enabled: next });
            markHudAction("toggleCompareMode");
            markCompareModeChanged(next);
            return next;
        });
    };

    const toggleSplitView = () => {
        if (inspectLocked) {
            console.info("[HudControls] split_view_toggle_blocked_inspect_lock");
            markBlockedAction("toggleSplitView", "inspect_lock");
            return;
        }
        if (!compareMode) {
            console.info("[HudControls] split_view_toggle_blocked_compare_disabled");
            markBlockedAction("toggleSplitView", "compare_mode_disabled");
            return;
        }
        setSplitView((curr) => {
            const next = !curr;
            console.info("[HudControls] split_view_changed", { enabled: next });
            markHudAction("toggleSplitView");
            markSplitViewChanged(next);
            return next;
        });
    };

    const compareOffsetDown = () => {
        if (inspectLocked) {
            console.info("[HudControls] compare_offset_down_blocked_inspect_lock");
            markBlockedAction("compareOffsetDown", "inspect_lock");
            return;
        }
        setCompareOffsetBuckets((curr) => {
            const next = Math.max(1, curr - 1);
            if (next !== curr) {
                console.info("[HudControls] compare_offset_changed", { from: curr, to: next });
                markHudAction("compareOffsetDown");
                markCompareOffsetChanged(next);
            }
            return next;
        });
    };

    const compareOffsetUp = () => {
        if (inspectLocked) {
            console.info("[HudControls] compare_offset_up_blocked_inspect_lock");
            markBlockedAction("compareOffsetUp", "inspect_lock");
            return;
        }
        setCompareOffsetBuckets((curr) => {
            const next = Math.min(24, curr + 1);
            if (next !== curr) {
                console.info("[HudControls] compare_offset_changed", { from: curr, to: next });
                markHudAction("compareOffsetUp");
                markCompareOffsetChanged(next);
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
        markHudAction("inspectOpen");
    };

    const onInspectClose = () => {
        setInspectLocked(false);
        console.info("[HudControls] inspect_close", {
            resumePlayback: wasPlayingBeforeInspectRef.current,
        });
        markHudAction("inspectClose");
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
