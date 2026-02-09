// apps/web/src/components/map/MapShell.tsx
"use client";

import { useCallback, useEffect, useState } from "react";

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
    const hud = useHudControls();

    // “Inspect lock” v0: freeze live GBFS updates while drawer open
    const inspectOpen = !!selected;
    const mock = useHudMockAdapter({
        layers: hud.layers,
        inspectLocked: inspectOpen,
        playing: hud.playing,
    });
    const progressLabel = `Progress ${Math.round(hud.progress * 100)}%`;

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

    return (
        <div className="uf-root">
            {/* MAP */}
            <div className="uf-map" aria-label="Map">
                <MapView
                    onStationPick={openInspect}
                    selectedStationId={selected?.station_id ?? null}
                    freeze={inspectOpen}
                />
            </div>

            {/* HUD OVERLAY */}
            <HUDRoot>
                <div className="uf-top-center">
                    <section role="region" aria-label="Clock and serving status">
                        <ClockChip
                            mode={mock.clock.mode}
                            sv={mock.clock.sv}
                            delayed={mock.clock.delayed}
                            inspectLocked={mock.clock.inspectLocked}
                        />
                    </section>
                </div>

                <div className="uf-bottom">
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

                <div className="uf-left-stack">
                    <nav aria-label="Playback and layer controls">
                        <CommandStack
                            playing={hud.playing}
                            inspectLocked={hud.inspectLocked}
                            layers={hud.layers}
                            onTogglePlay={hud.togglePlay}
                            onToggleLayer={hud.toggleLayer}
                        />
                    </nav>
                </div>

                <div className="uf-right-stack">
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
        </div>
    );
}
