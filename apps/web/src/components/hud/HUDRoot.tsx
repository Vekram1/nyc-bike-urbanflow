// apps/web/src/components/hud/HUDRoot.tsx
import type { ReactNode } from "react";

export default function HUDRoot({ children }: { children: ReactNode }) {
    return <div className="uf-hud-root">{children}</div>;
}
