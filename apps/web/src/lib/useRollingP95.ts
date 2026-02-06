// apps/web/src/lib/useRollingP95.ts
"use client";

import { useCallback, useMemo, useState } from "react";

type Sample = { t: number; v: number };

export function useRollingP95({ windowMs }: { windowMs: number }) {
    const [samples, setSamples] = useState<Sample[]>([]);

    const pushSample = useCallback(
        (ms: number) => {
            const now = performance.now();
            const cutoff = now - windowMs;
            setSamples((curr) => {
                const next = [...curr, { t: now, v: ms }].filter((s) => s.t >= cutoff);
                return next.slice(Math.max(0, next.length - 400));
            });
        },
        [windowMs]
    );

    const { p95, spark } = useMemo(() => {
        const vals = samples.map((s) => s.v);
        if (vals.length === 0) return { p95: null as number | null, spark: [] };

        const sorted = [...vals].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
        const p95 = sorted[idx];

        // sparkline downsample: last ~40
        const spark = vals.slice(Math.max(0, vals.length - 40));
        return { p95, spark };
    }, [samples]);

    return { p95, spark, pushSample };
}
