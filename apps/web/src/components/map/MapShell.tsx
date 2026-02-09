// apps/web/src/components/map/MapShell.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import HUDRoot from "@/components/hud/HUDRoot";
import ClockChip from "@/components/hud/ClockChip";
import ScrubberBar from "@/components/hud/ScrubberBar";
import CommandStack from "@/components/hud/CommandStack";
import StatsCard from "@/components/hud/StatsCard";
import StationDrawer from "@/components/hud/StationDrawer";
import MapView, { StationPick } from "@/components/map/MapView";
import { useHudControls } from "@/lib/useHudControls";
import { useHudMockAdapter } from "@/lib/useHudMockAdapter";

type UfE2EState = {
    mapShellMounted?: boolean;
    mapShellMountCount?: number;
    mapShellUnmountCount?: number;
    mapShellLastMountTs?: string;
    mapShellLastUnmountTs?: string;
    inspectOpen?: boolean;
    selectedStationId?: string | null;
    timelineBucket?: number;
    compareBucket?: number | null;
    tileRequestKey?: string;
    tileRequestKeyHistory?: string[];
    tileRequestKeyChangeCount?: number;
    tileRequestKeyLastChangedAt?: string;
    invariantViolations?: string[];
    invariantViolationCount?: number;
    lastInvariantViolation?: string;
    lastInvariantViolationAt?: string;
    inspectOpenCount?: number;
    inspectCloseCount?: number;
    inspectCloseReasons?: Record<string, number>;
    inspectOpenedAt?: string;
    inspectClosedAt?: string;
    inspectLastCloseReason?: string;
    hotkeyHandledCount?: number;
    hotkeyIgnoredCount?: number;
    hotkeyLastCode?: string;
    hotkeyLastHandledAt?: string;
    hotkeyLastIgnoredAt?: string;
    inspectAnchorTileRequestKey?: string;
    inspectSessionId?: number;
    inspectAnchorSetAt?: string;
    inspectAnchorClearedAt?: string;
    controlsDisabled?: boolean;
    compareEnabled?: boolean;
    splitEnabled?: boolean;
    layerSeverityEnabled?: boolean;
    layerCapacityEnabled?: boolean;
    layerLabelsEnabled?: boolean;
    compareOffsetBuckets?: number;
    playbackSpeed?: number;
    playing?: boolean;
};

function updateUfE2E(update: (current: UfE2EState) => UfE2EState): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = update(current);
}

export default function MapShell() {
    const [selected, setSelected] = useState<StationPick | null>(null);
    const lastDrawerStationRef = useRef<string | null>(null);
    const hud = useHudControls();
    const inspectAnchorTileKeyRef = useRef<string | null>(null);
    const inspectSessionIdRef = useRef(0);

    // “Inspect lock” v0: freeze live GBFS updates while drawer open
    const inspectOpen = !!selected;
    const mock = useHudMockAdapter({
        layers: hud.layers,
        inspectLocked: inspectOpen,
        playing: hud.playing,
    });
    const progressLabel = `Progress ${Math.round(hud.progress * 100)}%`;
    const timelineBucket = Math.round(hud.progress * 100);
    const compareBucket = hud.compareMode
        ? Math.max(0, timelineBucket - hud.compareOffsetBuckets)
        : null;
    const tileRequestKey = JSON.stringify({
        layers: hud.layers,
        bucket: timelineBucket,
        compare_mode: hud.compareMode,
        t2_bucket: compareBucket,
        split_view: hud.splitView,
        inspectLocked: hud.inspectLocked,
    });

    const openInspect = useCallback((station: StationPick) => {
        if (!selected) {
            hud.onInspectOpen();
            updateUfE2E((current) => ({
                ...current,
                inspectOpenCount: (current.inspectOpenCount ?? 0) + 1,
                inspectOpenedAt: new Date().toISOString(),
            }));
        }
        setSelected(station);
    }, [hud, selected]);

    const closeInspect = useCallback((reason: "drawer_close_button" | "escape_key" = "drawer_close_button") => {
        if (!selected) return;
        setSelected(null);
        hud.onInspectClose();
        updateUfE2E((current) => ({
            ...current,
            inspectCloseCount: (current.inspectCloseCount ?? 0) + 1,
            inspectCloseReasons: {
                ...(current.inspectCloseReasons ?? {}),
                [reason]: ((current.inspectCloseReasons ?? {})[reason] ?? 0) + 1,
            },
            inspectClosedAt: new Date().toISOString(),
            inspectLastCloseReason: reason,
        }));
    }, [hud, selected]);

    useEffect(() => {
        console.info("[MapShell] mounted");
        updateUfE2E((current) => ({
            ...current,
            mapShellMountCount: (current.mapShellMountCount ?? 0) + 1,
            mapShellLastMountTs: new Date().toISOString(),
        }));
        return () => {
            console.info("[MapShell] unmounted");
            updateUfE2E((current) => ({
                ...current,
                mapShellUnmountCount: (current.mapShellUnmountCount ?? 0) + 1,
                mapShellLastUnmountTs: new Date().toISOString(),
            }));
        };
    }, []);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (hud.handleHotkey(e)) {
                updateUfE2E((current) => ({
                    ...current,
                    hotkeyHandledCount: (current.hotkeyHandledCount ?? 0) + 1,
                    hotkeyLastCode: e.code,
                    hotkeyLastHandledAt: new Date().toISOString(),
                }));
                return;
            }
            updateUfE2E((current) => ({
                ...current,
                hotkeyIgnoredCount: (current.hotkeyIgnoredCount ?? 0) + 1,
                hotkeyLastCode: e.code,
                hotkeyLastIgnoredAt: new Date().toISOString(),
            }));
            if (e.code !== "Escape") return;
            if (!inspectOpen) return;

            e.preventDefault();
            closeInspect("escape_key");
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [closeInspect, hud, inspectOpen]);

    useEffect(() => {
        console.info("[MapShell] inspect_lock_changed", {
            inspectOpen,
            selectedStationId: selected?.station_id ?? null,
            freezeMapUpdates: inspectOpen,
        });
    }, [inspectOpen, selected?.station_id]);

    useEffect(() => {
        const prev = lastDrawerStationRef.current;
        const next = selected?.station_id ?? null;

        if (prev !== next) {
            if (next) {
                console.info("[MapShell] tier1_drawer_opened", {
                    stationId: next,
                    tileOnly: true,
                });
                inspectAnchorTileKeyRef.current = tileRequestKey;
                inspectSessionIdRef.current += 1;
                updateUfE2E((current) => ({
                    ...current,
                    inspectAnchorTileRequestKey: tileRequestKey,
                    inspectSessionId: inspectSessionIdRef.current,
                    inspectAnchorSetAt: new Date().toISOString(),
                }));
            } else if (prev) {
                console.info("[MapShell] tier1_drawer_closed", {
                    stationId: prev,
                    tileOnly: true,
                });
                inspectAnchorTileKeyRef.current = null;
                updateUfE2E((current) => ({
                    ...current,
                    inspectAnchorTileRequestKey: "",
                    inspectAnchorClearedAt: new Date().toISOString(),
                }));
            }
            lastDrawerStationRef.current = next;
        }
    }, [selected?.station_id, tileRequestKey]);

    useEffect(() => {
        console.info("[MapShell] playback_changed", {
            playing: hud.playing,
            speed: hud.speed,
        });
    }, [hud.playing, hud.speed]);

    useEffect(() => {
        console.info("[MapShell] layers_changed", {
            layers: hud.layers,
        });
    }, [hud.layers]);

    useEffect(() => {
        console.info("[MapShell] tile_request_key_changed", {
            tileRequestKey,
            timelineBucket,
            compareBucket,
            compareMode: hud.compareMode,
            splitView: hud.splitView,
            inspectLocked: hud.inspectLocked,
            layers: hud.layers,
        });
    }, [
        compareBucket,
        hud.compareMode,
        hud.inspectLocked,
        hud.layers,
        hud.splitView,
        tileRequestKey,
        timelineBucket,
    ]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const updatedAt = new Date().toISOString();
        updateUfE2E((current) => {
            const keyChanged = current.tileRequestKey !== tileRequestKey;
            const nextHistory = keyChanged
                ? [...(current.tileRequestKeyHistory ?? []), tileRequestKey].slice(-40)
                : (current.tileRequestKeyHistory ?? []);
            return {
                ...current,
                mapShellMounted: true,
                mapShellMountCount: current.mapShellMountCount ?? 0,
                mapShellUnmountCount: current.mapShellUnmountCount ?? 0,
                mapShellLastMountTs: current.mapShellLastMountTs ?? "",
                mapShellLastUnmountTs: current.mapShellLastUnmountTs ?? "",
                inspectOpen,
                selectedStationId: selected?.station_id ?? null,
                timelineBucket,
                compareBucket,
                tileRequestKey,
                tileRequestKeyHistory: nextHistory,
                tileRequestKeyChangeCount: (current.tileRequestKeyChangeCount ?? 0) + (keyChanged ? 1 : 0),
                tileRequestKeyLastChangedAt: keyChanged ? updatedAt : (current.tileRequestKeyLastChangedAt ?? ""),
                invariantViolations: current.invariantViolations ?? [],
                invariantViolationCount: current.invariantViolationCount ?? 0,
                lastInvariantViolation: current.lastInvariantViolation ?? "",
                lastInvariantViolationAt: current.lastInvariantViolationAt ?? "",
                inspectOpenCount: current.inspectOpenCount ?? 0,
                inspectCloseCount: current.inspectCloseCount ?? 0,
                inspectCloseReasons: current.inspectCloseReasons ?? {},
                inspectOpenedAt: current.inspectOpenedAt ?? "",
                inspectClosedAt: current.inspectClosedAt ?? "",
                inspectLastCloseReason: current.inspectLastCloseReason ?? "",
                hotkeyHandledCount: current.hotkeyHandledCount ?? 0,
                hotkeyIgnoredCount: current.hotkeyIgnoredCount ?? 0,
                hotkeyLastCode: current.hotkeyLastCode ?? "",
                hotkeyLastHandledAt: current.hotkeyLastHandledAt ?? "",
                hotkeyLastIgnoredAt: current.hotkeyLastIgnoredAt ?? "",
                inspectAnchorTileRequestKey: current.inspectAnchorTileRequestKey ?? "",
                inspectSessionId: current.inspectSessionId ?? 0,
                inspectAnchorSetAt: current.inspectAnchorSetAt ?? "",
                inspectAnchorClearedAt: current.inspectAnchorClearedAt ?? "",
                controlsDisabled: hud.inspectLocked,
                compareEnabled: hud.compareMode,
                splitEnabled: hud.compareMode && hud.splitView,
                layerSeverityEnabled: hud.layers.severity,
                layerCapacityEnabled: hud.layers.capacity,
                layerLabelsEnabled: hud.layers.labels,
                compareOffsetBuckets: hud.compareOffsetBuckets,
                playbackSpeed: hud.speed,
                playing: hud.playing,
            };
        });
    }, [
        compareBucket,
        hud.compareOffsetBuckets,
        hud.compareMode,
        hud.inspectLocked,
        hud.layers.capacity,
        hud.layers.labels,
        hud.layers.severity,
        hud.playing,
        hud.speed,
        hud.splitView,
        inspectOpen,
        selected?.station_id,
        tileRequestKey,
        timelineBucket,
    ]);

    useEffect(() => {
        if (!inspectOpen) return;
        const anchor = inspectAnchorTileKeyRef.current;
        if (!anchor || anchor === tileRequestKey) return;

        console.error("[MapShell] inspect_tile_key_mutated", {
            anchorTileRequestKey: anchor,
            currentTileRequestKey: tileRequestKey,
            selectedStationId: selected?.station_id ?? null,
        });
        updateUfE2E((current) => ({
            ...current,
            invariantViolations: [
                ...(current.invariantViolations ?? []),
                "inspect_tile_key_mutated",
            ].slice(-20),
            invariantViolationCount: (current.invariantViolationCount ?? 0) + 1,
            lastInvariantViolation: "inspect_tile_key_mutated",
            lastInvariantViolationAt: new Date().toISOString(),
        }));
    }, [compareBucket, inspectOpen, selected?.station_id, tileRequestKey, timelineBucket]);

    return (
        <div className="uf-root" data-uf-id="app-root">
            {/* MAP */}
            <div className="uf-map" aria-label="Map" data-uf-id="map-shell">
                <MapView
                    onStationPick={openInspect}
                    selectedStationId={selected?.station_id ?? null}
                    freeze={inspectOpen}
                />
            </div>

            {/* HUD OVERLAY */}
            <HUDRoot>
                <div className="uf-top-center" data-uf-id="hud-clock">
                    <section role="region" aria-label="Clock and serving status">
                        <ClockChip
                            mode={mock.clock.mode}
                            sv={mock.clock.sv}
                            delayed={mock.clock.delayed}
                            inspectLocked={mock.clock.inspectLocked}
                        />
                    </section>
                </div>

                <div className="uf-bottom" data-uf-id="hud-timeline">
                    <section role="region" aria-label="Timeline playback controls">
                        <ScrubberBar
                            playing={hud.playing}
                            inspectLocked={hud.inspectLocked}
                            speed={hud.speed}
                            progress={hud.progress}
                            progressLabel={progressLabel}
                            onTogglePlay={hud.togglePlay}
                            onSpeedDown={hud.speedDown}
                            onSpeedUp={hud.speedUp}
                            onStepBack={hud.stepBack}
                            onStepForward={hud.stepForward}
                            onSeek={hud.seekTo}
                        />
                    </section>
                </div>

                <div className="uf-left-stack" data-uf-id="hud-controls">
                    <nav aria-label="Playback and layer controls">
                        <CommandStack
                            playing={hud.playing}
                            inspectLocked={hud.inspectLocked}
                            compareMode={hud.compareMode}
                            splitView={hud.splitView}
                            compareOffsetBuckets={hud.compareOffsetBuckets}
                            layers={hud.layers}
                            onTogglePlay={hud.togglePlay}
                            onToggleLayer={hud.toggleLayer}
                            onToggleCompareMode={hud.toggleCompareMode}
                            onToggleSplitView={hud.toggleSplitView}
                            onCompareOffsetDown={hud.compareOffsetDown}
                            onCompareOffsetUp={hud.compareOffsetUp}
                        />
                    </nav>
                </div>

                <div className="uf-right-stack" data-uf-id="hud-stats">
                    <aside role="complementary" aria-label="Network stats and performance">
                        <StatsCard
                            activeStations={mock.stats.activeStations}
                            empty={mock.stats.empty}
                            full={mock.stats.full}
                            tileP95={mock.stats.tileP95}
                            fps={mock.stats.fps}
                            spark={mock.stats.spark}
                        />
                    </aside>
                </div>

                <StationDrawer
                    station={selected}
                    sv={mock.clock.sv}
                    timelineBucket={timelineBucket}
                    onClose={() => closeInspect("drawer_close_button")}
                />
            </HUDRoot>
            {hud.compareMode && hud.splitView ? (
                <div
                    style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: "50%",
                        width: 2,
                        background: "rgba(255,255,255,0.18)",
                        pointerEvents: "none",
                    }}
                    aria-hidden="true"
                />
            ) : null}
        </div>
    );
}
