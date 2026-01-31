// apps/web/src/app/layout.tsx
import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
