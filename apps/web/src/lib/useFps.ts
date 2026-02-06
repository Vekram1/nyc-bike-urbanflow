// apps/web/src/lib/useFps.ts
"use client";

import { useEffect, useRef, useState } from "react";

export function useFps() {
    const [fps, setFps] = useState<number | null>(null);
    const last = useRef<number | null>(null);
    const frames = useRef<number>(0);

    useEffect(() => {
        let raf = 0;

        const loop = (t: number) => {
            if (last.current == null) {
                last.current = t;
                raf = requestAnimationFrame(loop);
                return;
            }

            frames.current += 1;
            const dt = t - last.current;

            // update about 2x/sec
            if (dt >= 500) {
                setFps((frames.current * 1000) / dt);
                frames.current = 0;
                last.current = t;
            }
            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, []);

    return fps;
}
