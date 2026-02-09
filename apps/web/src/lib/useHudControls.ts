"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_SYSTEM_ID, fetchTime, fetchTimeline } from "@/lib/controlPlane";
import type { LayerToggles } from "@/lib/hudTypes";

const SPEED_STEPS = [0.25, 1, 4, 16];
const LIVE_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPLAY_STEP_MS = 5 * 60 * 1000;
const STORAGE_KEY = "urbanflow.hud.controls.v1";
const TIME_POLL_MS = 5000;
const TIMELINE_POLL_MS = 30000;
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

function parseIsoMs(value: string | undefined): number | null {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function useHudControls() {
    const persisted = readPersistedHud();
    const [initialNowMs] = useState(() => Date.now());

    const [playing, setPlaying] = useState(true);
    const [speedIdx, setSpeedIdx] = useState(() => {
        if (typeof persisted?.speedIdx !== "number") return 1;
        return Math.max(0, Math.min(SPEED_STEPS.length - 1, persisted.speedIdx));
    });
    const [mode, setMode] = useState<"live" | "replay">("live");
    const [rangeMinMs, setRangeMinMs] = useState(initialNowMs - LIVE_FALLBACK_WINDOW_MS);
    const [rangeMaxMs, setRangeMaxMs] = useState(initialNowMs);
    const [playbackTsMs, setPlaybackTsMs] = useState(initialNowMs);
    const [serverNowMs, setServerNowMs] = useState(initialNowMs);
    const [sv, setSv] = useState("sv:local-fallback");
    const [delayed, setDelayed] = useState(false);
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
    const progressRange = Math.max(1, rangeMaxMs - rangeMinMs);
    const progress = Math.min(1, Math.max(0, (playbackTsMs - rangeMinMs) / progressRange));

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
        let cancelled = false;

        const pollTime = async () => {
            try {
                const out = await fetchTime({ systemId: DEFAULT_SYSTEM_ID });
                if (cancelled) return;

                const nowFromServer = parseIsoMs(out.server_now);
                if (nowFromServer != null) {
                    setServerNowMs(nowFromServer);
                    setRangeMaxMs((curr) => Math.max(curr, nowFromServer));
                }
                if (out.recommended_live_sv?.length > 0) {
                    setSv(out.recommended_live_sv);
                }
                setDelayed(
                    Boolean(out.network?.client_should_throttle) ||
                        (out.network?.degrade_level ?? 0) >= 1
                );
            } catch {
                if (cancelled) return;
                setServerNowMs(Date.now());
            }
        };

        pollTime();
        const timer = window.setInterval(pollTime, TIME_POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setServerNowMs((current) => current + 1000);
        }, 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!sv || sv.startsWith("sv:local-")) return;
        let cancelled = false;

        const pollTimeline = async () => {
            try {
                const out = await fetchTimeline({ sv });
                if (cancelled) return;
                const minMs = parseIsoMs(out.available_range[0]);
                const maxMs = parseIsoMs(out.available_range[1]);
                const liveEdgeMs = parseIsoMs(out.live_edge_ts);
                if (minMs == null || maxMs == null) return;
                const boundedMax = liveEdgeMs == null ? maxMs : Math.min(maxMs, liveEdgeMs);
                setRangeMinMs(minMs);
                setRangeMaxMs((current) => Math.max(current, Math.max(minMs, boundedMax)));
                setPlaybackTsMs((current) => clamp(current, minMs, Math.max(minMs, boundedMax)));
            } catch {
                // Keep fallback range on timeline failures.
            }
        };

        pollTimeline();
        const timer = window.setInterval(pollTimeline, TIMELINE_POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [sv]);

    useEffect(() => {
        if (!playing) return;

        const timer = window.setInterval(() => {
            if (mode === "live") {
                setServerNowMs((current) => current + 250);
                setPlaybackTsMs((current) => current + 250);
                return;
            }

            const replayMax = Math.max(rangeMinMs, Math.min(rangeMaxMs, serverNowMs));
            setPlaybackTsMs((curr) => {
                const stepMs = Math.max(1, Math.round((REPLAY_STEP_MS / 4) * speed));
                const next = Math.min(replayMax, curr + stepMs);
                if (next >= replayMax) {
                    setPlaying(false);
                    return replayMax;
                }
                return next;
            });
        }, 250);

        return () => window.clearInterval(timer);
    }, [mode, playing, rangeMaxMs, rangeMinMs, serverNowMs, speed]);

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
        enterReplayPaused();
        const replayMin = rangeMinMs;
        const replayMax = Math.max(rangeMinMs, Math.min(rangeMaxMs, serverNowMs));
        const requested = replayMin + Math.round(clamped * Math.max(1, replayMax - replayMin));
        setPlaybackTsMs(clamp(requested, replayMin, replayMax));
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

    const enterReplayPaused = () => {
        setMode("replay");
        setPlaying(false);
        setSpeedIdx(1);
    };

    const stepBack = () => {
        if (inspectLocked) {
            console.info("[HudControls] step_back_blocked_inspect_lock");
            markBlockedAction("stepBack", "inspect_lock");
            return;
        }
        enterReplayPaused();
        setPlaybackTsMs((curr) => {
            const replayMin = rangeMinMs;
            const replayMax = Math.max(rangeMinMs, Math.min(rangeMaxMs, serverNowMs));
            const bounded = Math.min(replayMax, curr);
            const next = Math.max(replayMin, bounded - REPLAY_STEP_MS);
            console.info("[HudControls] step_back", { from: curr, to: next });
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
        enterReplayPaused();
        setPlaybackTsMs((curr) => {
            const replayMax = Math.max(rangeMinMs, Math.min(rangeMaxMs, serverNowMs));
            const next = Math.min(replayMax, curr + REPLAY_STEP_MS);
            console.info("[HudControls] step_forward", { from: curr, to: next });
            markHudAction("stepForward");
            markStepAction("stepForward");
            return next;
        });
    };

    const goLive = () => {
        if (inspectLocked) {
            console.info("[HudControls] go_live_blocked_inspect_lock");
            markBlockedAction("goLive", "inspect_lock");
            return;
        }
        const replayMin = rangeMinMs;
        const replayMax = Math.max(rangeMinMs, Math.min(rangeMaxMs, serverNowMs));
        setMode("live");
        setPlaybackTsMs(clamp(serverNowMs, replayMin, replayMax));
        setPlaying(true);
        markHudAction("goLive");
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
            case "KeyL":
                event.preventDefault();
                goLive();
                return true;
            default:
                return false;
        }
    };

    return {
        mode,
        playing,
        speed,
        progress,
        rangeMinMs,
        rangeMaxMs,
        playbackTsMs,
        layers,
        inspectLocked,
        compareMode,
        splitView,
        compareOffsetBuckets,
        sv,
        delayed,
        seekTo,
        togglePlay,
        speedDown,
        speedUp,
        stepBack,
        stepForward,
        goLive,
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
