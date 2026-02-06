"use client";

import { useEffect } from "react";
import { useFps } from "@/lib/useFps";
import { useRollingP95 } from "@/lib/useRollingP95";
import type { LayerToggles } from "@/lib/hudTypes";

export function useHudMockAdapter({
    layers,
    inspectLocked,
    playing,
}: {
    layers: LayerToggles;
    inspectLocked: boolean;
    playing: boolean;
}) {
    const fps = useFps();
    const { p95, spark, pushSample } = useRollingP95({ windowMs: 15_000 });

    useEffect(() => {
        const timer = window.setInterval(() => {
            pushSample(60 + Math.random() * 180);
        }, 600);
        return () => window.clearInterval(timer);
    }, [pushSample]);

    return {
        clock: {
            mode: (playing ? "live" : "replay") as "live" | "replay",
            sv: "sv:mock-frontend",
            delayed: false,
            inspectLocked,
        },
        stats: {
            activeStations: 1834,
            empty: layers.severity ? 71 : 64,
            full: layers.capacity ? 42 : 39,
            fps,
            tileP95: p95,
            spark,
        },
    };
}

