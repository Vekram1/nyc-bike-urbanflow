// apps/web/src/components/hud/HUDCard.tsx
import type { CSSProperties, ReactNode } from "react";

export default function HUDCard({
    children,
    style,
    className = "",
}: {
    children: ReactNode;
    style?: CSSProperties;
    className?: string;
}) {
    return (
        <div className={`uf-card uf-hud-pe-auto ${className}`} style={style}>
            {children}
        </div>
    );
}
