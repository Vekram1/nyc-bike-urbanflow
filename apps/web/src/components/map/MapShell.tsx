// apps/web/src/components/map/MapShell.tsx
"use client";

import { useEffect, useState } from "react";

import HUDRoot from "@/components/hud/HUDRoot";
import ClockChip from "@/components/hud/ClockChip";
import ScrubberBar from "@/components/hud/ScrubberBar";
import CommandStack from "@/components/hud/CommandStack";
import StatsCard from "@/components/hud/StatsCard";
import StationDrawer from "@/components/hud/StationDrawer";
import MapView, { StationPick } from "@/components/map/MapView";

export default function MapShell() {
    const [selected, setSelected] = useState<StationPick | null>(null);

    // “Inspect lock” v0: freeze live GBFS updates while drawer open
    const inspectOpen = !!selected;

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code !== "Escape") return;
            if (!inspectOpen) return;

            e.preventDefault();
            setSelected(null);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [inspectOpen]);

    return (
        <div className="uf-root">
            {/* MAP */}
            <div className="uf-map" aria-label="Map">
                <MapView
                    onStationPick={(s) => setSelected(s)}
                    selectedStationId={selected?.station_id ?? null}
                    freeze={inspectOpen}
                />
            </div>

            {/* HUD OVERLAY */}
            <HUDRoot>
                <div className="uf-top-center">
                    <ClockChip />
                </div>

                <div className="uf-bottom">
                    <ScrubberBar />
                </div>

                <div className="uf-left-stack">
                    <CommandStack />
                </div>

                <div className="uf-right-stack">
                    <StatsCard />
                </div>

                <StationDrawer station={selected} onClose={() => setSelected(null)} />
            </HUDRoot>
        </div>
    );
}
