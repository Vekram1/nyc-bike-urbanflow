// apps/web/src/lib/useNowClock.ts
"use client";

import { useEffect, useState } from "react";

export function useNowClock(tickMs = 250) {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = window.setInterval(() => setNow(new Date()), tickMs);
        return () => window.clearInterval(id);
    }, [tickMs]);

    return now;
}
