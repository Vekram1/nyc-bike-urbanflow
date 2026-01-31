// apps/web/src/components/map/MapShell.tsx
"use client";

import HUDRoot from "@/components/hud/HUDRoot";
import ClockChip from "@/components/hud/ClockChip";
import ScrubberBar from "@/components/hud/ScrubberBar";
import CommandStack from "@/components/hud/CommandStack";
import StatsCard from "@/components/hud/StatsCard";
import StationDrawer from "@/components/hud/StationDrawer";
import MapView from "@/components/map/MapView";

export default function MapShell() {
    return (
        <div className="uf-root">
            {/* MAP */}
            <div className="uf-map" aria-label="Map">
                <MapView />
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

                <StationDrawer />
            </HUDRoot>
        </div>
    );
}
