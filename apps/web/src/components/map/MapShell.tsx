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

export default function MapShell() {
    const [selected, setSelected] = useState<StationPick | null>(null);
    const lastDrawerStationRef = useRef<string | null>(null);
    const hud = useHudControls();

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
        }
        setSelected(station);
    }, [hud, selected]);

    const closeInspect = useCallback(() => {
        setSelected(null);
        hud.onInspectClose();
    }, [hud]);

    useEffect(() => {
        console.info("[MapShell] mounted");
        return () => {
            console.info("[MapShell] unmounted");
        };
    }, []);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (hud.handleHotkey(e)) return;
            if (e.code !== "Escape") return;
            if (!inspectOpen) return;

            e.preventDefault();
            closeInspect();
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
            } else if (prev) {
                console.info("[MapShell] tier1_drawer_closed", {
                    stationId: prev,
                    tileOnly: true,
                });
            }
            lastDrawerStationRef.current = next;
        }
    }, [selected?.station_id]);

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
        const current = (window as { __UF_E2E?: Record<string, unknown> }).__UF_E2E ?? {};
        (window as { __UF_E2E?: Record<string, unknown> }).__UF_E2E = {
            ...current,
            mapShellMounted: true,
            inspectOpen,
            selectedStationId: selected?.station_id ?? null,
            timelineBucket,
            compareBucket,
            tileRequestKey,
        };
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

                <StationDrawer station={selected} onClose={closeInspect} />
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
