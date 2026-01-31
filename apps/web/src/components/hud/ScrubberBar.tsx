// apps/web/src/components/hud/ScrubberBar.tsx
"use client";

import HUDCard from "./HUDCard";
import Keycap from "./Keycap";

export default function ScrubberBar() {
    return (
        <HUDCard>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto 1fr auto",
                    gap: 12,
                    alignItems: "center",
                }}
            >
                <button
                    type="button"
                    style={btnStyle}
                    title="Play/Pause"
                    onClick={() => { }}
                >
                    ▶︎ / ❚❚ <Keycap k="Space" />
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" style={btnStyle} onClick={() => { }}>
                        − <span style={{ opacity: 0.7 }}>speed</span>
                    </button>
                    <button type="button" style={btnStyle} onClick={() => { }}>
                        + <span style={{ opacity: 0.7 }}>speed</span>
                    </button>
                    <div style={{ opacity: 0.7, fontSize: 12, alignSelf: "center" }}>
                        1.0×
                    </div>
                </div>

                {/* Range + markers placeholder */}
                <div style={{ position: "relative", height: 22 }}>
                    <div
                        style={{
                            position: "absolute",
                            inset: "9px 0 9px 0",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.10)",
                        }}
                    />
                    {/* “playhead” */}
                    <div
                        style={{
                            position: "absolute",
                            top: 2,
                            bottom: 2,
                            left: "62%",
                            width: 2,
                            borderRadius: 2,
                            background: "rgba(230,237,243,0.9)",
                        }}
                    />
                    {/* gap markers (stub) */}
                    <div style={{ position: "absolute", left: "22%", top: 7, height: 8, width: 2, background: "rgba(255,80,80,0.7)" }} />
                    <div style={{ position: "absolute", left: "40%", top: 7, height: 8, width: 2, background: "rgba(255,80,80,0.7)" }} />
                </div>

                <button type="button" style={btnStyle} onClick={() => { }} title="Step">
                    Step <Keycap k="←/→" />
                </button>
            </div>
        </HUDCard>
    );
}

const btnStyle: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(230,237,243,0.92)",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
};
