// apps/web/src/components/map/MapShell.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import HUDRoot from "@/components/hud/HUDRoot";
import ClockChip from "@/components/hud/ClockChip";
import ScrubberBar from "@/components/hud/ScrubberBar";
import CommandStack from "@/components/hud/CommandStack";
import StatsCard from "@/components/hud/StatsCard";
import StationDrawer from "@/components/hud/StationDrawer";
import MapView, { StationPick } from "@/components/map/MapView";
import { useHudControls } from "@/lib/useHudControls";
import { useFps } from "@/lib/useFps";
import { useRollingP95 } from "@/lib/useRollingP95";
import { DEFAULT_SYSTEM_ID, fetchTimelineDensity } from "@/lib/controlPlane";

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
    inspectLastOpenedStationId?: string;
    inspectLastClosedStationId?: string;
    hotkeyHandledCount?: number;
    hotkeyIgnoredCount?: number;
    hotkeyLastCode?: string;
    hotkeyLastHandledAt?: string;
    hotkeyLastIgnoredAt?: string;
    inspectAnchorTileRequestKey?: string;
    inspectSessionId?: number;
    inspectSessionStartedAt?: string;
    inspectSessionEndedAt?: string;
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
    mode?: "live" | "replay";
    playbackTsMs?: number;
};

type UfE2EActions = {
    openInspect: (stationId?: string) => void;
    closeInspect: (reason?: "drawer_close_button" | "escape_key") => void;
    toggleCompareMode: () => void;
    toggleSplitView: () => void;
    compareOffsetUp: () => void;
    compareOffsetDown: () => void;
};

function updateUfE2E(update: (current: UfE2EState) => UfE2EState): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = update(current);
}

export default function MapShell() {
    const [selected, setSelected] = useState<StationPick | null>(null);
    const [stationIndex, setStationIndex] = useState<StationPick[]>([]);
    const [densityResponse, setDensityResponse] = useState<{
        sv: string;
        points: Array<{ pct: number; intensity: number }>;
    } | null>(null);
    const lastDrawerStationRef = useRef<string | null>(null);
    const hud = useHudControls();
    const fps = useFps();
    const { p95: tileP95, spark, pushSample } = useRollingP95({ windowMs: 15_000 });
    const inspectAnchorTileKeyRef = useRef<string | null>(null);
    const inspectSessionIdRef = useRef(0);

    // “Inspect lock” v0: freeze live GBFS updates while drawer open
    const inspectOpen = !!selected;
    const timelineDisplayTimeMs = hud.playbackTsMs;
    const timelineBucket = Math.floor(timelineDisplayTimeMs / 1000);
    const compareBucket = hud.compareMode
        ? Math.max(0, timelineBucket - hud.compareOffsetBuckets * 300)
        : null;
    const progressLabel = `${hud.mode === "live" ? "Live" : "Replay"} ${Math.round(hud.progress * 100)}%`;
    const searchStations = stationIndex.map((station) => ({
        stationKey: station.station_id,
        name: station.name,
    }));
    const handleTileFetchSample = useCallback(
        (latencyMs: number) => {
            pushSample(latencyMs);
        },
        [pushSample]
    );
    const stats = useMemo(() => {
        let empty = 0;
        let full = 0;
        for (const station of stationIndex) {
            if (typeof station.bikes === "number" && station.bikes <= 0) {
                empty += 1;
            }
            if (typeof station.docks === "number" && station.docks <= 0) {
                full += 1;
            }
        }
        return {
            activeStations: stationIndex.length,
            empty,
            full,
        };
    }, [stationIndex]);

    useEffect(() => {
        if (!hud.sv || hud.sv.startsWith("sv:local-")) return;

        let cancelled = false;

        const loadDensity = async () => {
            try {
                const out = await fetchTimelineDensity({ sv: hud.sv, bucketSeconds: 300 });
                if (cancelled) return;

                const rangeStart = hud.rangeMinMs;
                const rangeEnd = Math.max(hud.rangeMinMs + 1, hud.rangeMaxMs);
                const span = Math.max(1, rangeEnd - rangeStart);
                const next = out.points
                    .map((point): { pct: number; intensity: number } | null => {
                        const pointMs = Date.parse(point.bucket_ts);
                        if (!Number.isFinite(pointMs)) return null;
                        const pctRaw = (pointMs - rangeStart) / span;
                        if (pctRaw < 0 || pctRaw > 1) return null;
                        const risk = Math.max(0, Math.min(1, 1 - point.pct_serving_grade));
                        const pressure = Math.max(point.empty_rate, point.full_rate);
                        const intensity = Math.max(0, Math.min(1, risk * 0.6 + pressure * 0.4));
                        return { pct: pctRaw, intensity };
                    })
                    .filter((mark): mark is { pct: number; intensity: number } => mark !== null)
                    .sort((a, b) => a.pct - b.pct);

                if (next.length > 120) {
                    const step = Math.ceil(next.length / 120);
                    setDensityResponse({
                        sv: hud.sv,
                        points: next.filter((_, idx) => idx % step === 0),
                    });
                    return;
                }
                setDensityResponse({ sv: hud.sv, points: next });
            } catch {
                if (cancelled) return;
                setDensityResponse({ sv: hud.sv, points: [] });
            }
        };

        loadDensity();
        const timer = window.setInterval(loadDensity, 60000);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [hud.rangeMaxMs, hud.rangeMinMs, hud.sv]);
    const densityMarks = useMemo(() => {
        if (!hud.sv || hud.sv.startsWith("sv:local-")) return [];
        if (!densityResponse || densityResponse.sv !== hud.sv) return [];
        return densityResponse.points;
    }, [densityResponse, hud.sv]);
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
                inspectSessionStartedAt: new Date().toISOString(),
                inspectLastOpenedStationId: station.station_id,
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
            inspectSessionEndedAt: new Date().toISOString(),
            inspectLastClosedStationId: selected.station_id,
        }));
    }, [hud, selected]);

    const handleSearchPick = useCallback(
        (result: { stationKey: string; name: string }) => {
            const fromMap =
                stationIndex.find((station) => station.station_id === result.stationKey) ?? null;
            openInspect({
                station_id: result.stationKey,
                name: result.name,
                capacity: fromMap?.capacity ?? null,
                bikes: fromMap?.bikes ?? null,
                docks: fromMap?.docks ?? null,
                docks_disabled: fromMap?.docks_disabled ?? null,
                bikes_disabled: fromMap?.bikes_disabled ?? null,
                inventory_slots_known: fromMap?.inventory_slots_known ?? null,
                inventory_delta: fromMap?.inventory_delta ?? null,
                occupancy_ratio: fromMap?.occupancy_ratio ?? null,
                severity_score: fromMap?.severity_score ?? null,
                bucket_quality: fromMap?.bucket_quality ?? null,
                t_bucket: new Date(timelineDisplayTimeMs).toISOString(),
                gbfs_last_updated: fromMap?.gbfs_last_updated ?? null,
                gbfs_ttl: fromMap?.gbfs_ttl ?? null,
            });
        },
        [openInspect, stationIndex, timelineDisplayTimeMs]
    );

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
                inspectLastOpenedStationId: current.inspectLastOpenedStationId ?? "",
                inspectLastClosedStationId: current.inspectLastClosedStationId ?? "",
                hotkeyHandledCount: current.hotkeyHandledCount ?? 0,
                hotkeyIgnoredCount: current.hotkeyIgnoredCount ?? 0,
                hotkeyLastCode: current.hotkeyLastCode ?? "",
                hotkeyLastHandledAt: current.hotkeyLastHandledAt ?? "",
                hotkeyLastIgnoredAt: current.hotkeyLastIgnoredAt ?? "",
                inspectAnchorTileRequestKey: current.inspectAnchorTileRequestKey ?? "",
                inspectSessionId: current.inspectSessionId ?? 0,
                inspectSessionStartedAt: current.inspectSessionStartedAt ?? "",
                inspectSessionEndedAt: current.inspectSessionEndedAt ?? "",
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
                mode: hud.mode,
                playbackTsMs: hud.playbackTsMs,
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
        hud.mode,
        hud.playbackTsMs,
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

    useEffect(() => {
        if (typeof window === "undefined") return;
        const actions: UfE2EActions = {
            openInspect: (stationId = "station-e2e") => {
                openInspect({
                    station_id: stationId,
                    name: `Station ${stationId}`,
                    capacity: 40,
                    bikes: 12,
                    docks: 28,
                    docks_disabled: 0,
                    bikes_disabled: 0,
                    inventory_slots_known: 40,
                    inventory_delta: 0,
                    occupancy_ratio: 0.3,
                    severity_score: 0.4,
                    bucket_quality: "ok",
                    t_bucket: new Date().toISOString(),
                    gbfs_last_updated: Math.floor(Date.now() / 1000),
                    gbfs_ttl: 60,
                });
            },
            closeInspect: (reason = "drawer_close_button") => {
                closeInspect(reason);
            },
            toggleCompareMode: () => {
                hud.toggleCompareMode();
            },
            toggleSplitView: () => {
                hud.toggleSplitView();
            },
            compareOffsetUp: () => {
                hud.compareOffsetUp();
            },
            compareOffsetDown: () => {
                hud.compareOffsetDown();
            },
        };
        (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS = actions;
    }, [closeInspect, hud, openInspect]);

    return (
        <div className="uf-root" data-uf-id="app-root">
            {/* MAP */}
            <div className="uf-map" aria-label="Map" data-uf-id="map-shell">
                <MapView
                    onStationPick={openInspect}
                    onStationsData={setStationIndex}
                    onTileFetchSampleMs={handleTileFetchSample}
                    sv={hud.sv}
                    timelineBucket={timelineBucket}
                    systemId={DEFAULT_SYSTEM_ID}
                    selectedStationId={selected?.station_id ?? null}
                    freeze={inspectOpen}
                />
            </div>

            {/* HUD OVERLAY */}
            <HUDRoot>
                <div className="uf-top-center" data-uf-id="hud-clock">
                    <section role="region" aria-label="Clock and serving status">
                        <ClockChip
                            mode={hud.mode}
                            sv={hud.sv}
                            delayed={hud.delayed}
                            inspectLocked={hud.inspectLocked}
                            displayTimeMs={timelineDisplayTimeMs}
                        />
                    </section>
                </div>

                <div className="uf-bottom" data-uf-id="hud-timeline">
                    <section role="region" aria-label="Timeline playback controls">
                        <ScrubberBar
                            mode={hud.mode}
                            playing={hud.playing}
                            inspectLocked={hud.inspectLocked}
                            speed={hud.speed}
                            progress={hud.progress}
                            progressLabel={progressLabel}
                            densityMarks={densityMarks}
                            onTogglePlay={hud.togglePlay}
                            onSpeedDown={hud.speedDown}
                            onSpeedUp={hud.speedUp}
                            onStepBack={hud.stepBack}
                            onStepForward={hud.stepForward}
                            onSeek={hud.seekTo}
                            onGoLive={hud.goLive}
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
                            mode={hud.mode}
                            layers={hud.layers}
                            searchStations={searchStations}
                            onTogglePlay={hud.togglePlay}
                            onGoLive={hud.goLive}
                            onToggleLayer={hud.toggleLayer}
                            onToggleCompareMode={hud.toggleCompareMode}
                            onToggleSplitView={hud.toggleSplitView}
                            onCompareOffsetDown={hud.compareOffsetDown}
                            onCompareOffsetUp={hud.compareOffsetUp}
                            onSearchPick={handleSearchPick}
                        />
                    </nav>
                </div>

                <div className="uf-right-stack" data-uf-id="hud-stats">
                    <aside role="complementary" aria-label="Network stats and performance">
                        <StatsCard
                            activeStations={stats.activeStations}
                            empty={stats.empty}
                            full={stats.full}
                            tileP95={tileP95}
                            fps={fps}
                            spark={spark}
                        />
                    </aside>
                </div>

                <StationDrawer
                    station={selected}
                    sv={hud.sv}
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
