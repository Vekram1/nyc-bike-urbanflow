// apps/web/src/lib/useRollingP95.ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";

type Sample = { t: number; v: number };

export function useRollingP95({ windowMs }: { windowMs: number }) {
    const buf = useRef<Sample[]>([]);
    const [, bump] = useState(0);

    const prune = useCallback(() => {
        const cutoff = performance.now() - windowMs;
        buf.current = buf.current.filter((s) => s.t >= cutoff);
    }, [windowMs]);

    const pushSample = useCallback(
        (ms: number) => {
            buf.current.push({ t: performance.now(), v: ms });
            prune();
            // bump occasionally (cheap re-render)
            bump((x) => (x + 1) % 1_000_000);
        },
        [prune]
    );

    const { p95, spark } = useMemo(() => {
        prune();
        const vals = buf.current.map((s) => s.v);
        if (vals.length === 0) return { p95: null as number | null, spark: [] };

        const sorted = [...vals].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
        const p95 = sorted[idx];

        // sparkline downsample: last ~40
        const spark = vals.slice(Math.max(0, vals.length - 40));
        return { p95, spark };
    }, [prune]);

    return { p95, spark, pushSample };
}
