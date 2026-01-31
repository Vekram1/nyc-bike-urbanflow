// apps/web/src/components/map/MapShell.tsx
"use client";

import HUDRoot from "@/components/hud/HUDRoot";
import ClockChip from "@/components/hud/ClockChip";
import ScrubberBar from "@/components/hud/ScrubberBar";
import CommandStack from "@/components/hud/CommandStack";
import StatsCard from "@/components/hud/StatsCard";
import StationDrawer from "@/components/hud/StationDrawer";

export default function MapShell() {
    return (
        <div className="uf-root">
            {/* MAP (placeholder) */}
            <div className="uf-map" aria-label="Map">
                {/* Replace with Mapbox later; keep this div full-bleed */}
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "radial-gradient(1200px 700px at 30% 30%, rgba(80,160,255,0.16), transparent 60%), radial-gradient(1000px 600px at 70% 60%, rgba(255,120,120,0.10), transparent 55%), #071018",
                    }}
                />
                <div
                    style={{
                        position: "absolute",
                        left: 16,
                        bottom: 70,
                        opacity: 0.65,
                        fontSize: 12,
                    }}
                >
                    Map placeholder (swap in Mapbox GL)
                </div>
            </div>

            {/* HUD OVERLAY */}
            <HUDRoot>
                {/* Top-center: clock chip (date + time, live/replay, sv watermark, delayed badge) */}
                <div className="uf-top-center">
                    <ClockChip />
                </div>

                {/* Bottom: scrubber */}
                <div className="uf-bottom">
                    <ScrubberBar />
                </div>

                {/* Left: command stack */}
                <div className="uf-left-stack">
                    <CommandStack />
                </div>

                {/* Right: stats card */}
                <div className="uf-right-stack">
                    <StatsCard />
                </div>

                {/* Station drawer */}
                <StationDrawer />
            </HUDRoot>
        </div>
    );
}
