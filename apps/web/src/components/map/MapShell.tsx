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
                    <ClockChip
                        mode={mock.clock.mode}
                        sv={mock.clock.sv}
                        delayed={mock.clock.delayed}
                        inspectLocked={mock.clock.inspectLocked}
                    />
                </div>

                <div className="uf-bottom">
                    <ScrubberBar
                        playing={hud.playing}
                        speed={hud.speed}
                        progress={hud.progress}
                        onTogglePlay={hud.togglePlay}
                        onSpeedDown={hud.speedDown}
                        onSpeedUp={hud.speedUp}
                        onStepBack={hud.stepBack}
                        onStepForward={hud.stepForward}
                    />
                </div>

                <div className="uf-left-stack">
                    <CommandStack
                        playing={hud.playing}
                        layers={hud.layers}
                        onTogglePlay={hud.togglePlay}
                        onToggleLayer={hud.toggleLayer}
                    />
                </div>

                <div className="uf-right-stack">
                    <StatsCard
                        activeStations={mock.stats.activeStations}
                        empty={mock.stats.empty}
                        full={mock.stats.full}
                        tileP95={mock.stats.tileP95}
                        fps={mock.stats.fps}
                        spark={mock.stats.spark}
                    />
                </div>

                <StationDrawer station={selected} onClose={closeInspect} />
            </HUDRoot>
        </div>
    );
}
