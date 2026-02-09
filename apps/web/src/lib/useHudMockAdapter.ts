"use client";

import { useEffect } from "react";
import { useFps } from "@/lib/useFps";
import { useRollingP95 } from "@/lib/useRollingP95";
import type { LayerToggles } from "@/lib/hudTypes";

export function useHudMockAdapter({
    layers,
    inspectLocked,
    mode,
    sv,
    delayed,
}: {
    layers: LayerToggles;
    inspectLocked: boolean;
    mode: "live" | "replay";
    sv: string;
    delayed: boolean;
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
            mode,
            sv,
            delayed,
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
