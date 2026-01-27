"use client";

import { useEffect, useRef, useState } from "react";

export default function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("loading map...");

  useEffect(() => {
    let mapInstance: { remove: () => void } | null = null;

    async function init() {
      if (!containerRef.current) {
        return;
      }

      try {
        const maplibre = await import("maplibre-gl");
        mapInstance = new maplibre.Map({
          container: containerRef.current,
          style: "/styles/map-style.json",
          center: [-73.9857, 40.7484],
          zoom: 12,
        });
        mapInstance.on("load", () => setStatus("Map loaded"));
        mapInstance.on("error", () => setStatus("Map error"));
      } catch (error) {
        setStatus("MapLibre unavailable");
      }
    }

    void init();

    return () => {
      mapInstance?.remove();
    };
  }, []);

  return (
    <div
      style={{
        height: "480px",
        borderRadius: "12px",
        background: "#e9e3d8",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div ref={containerRef} style={{ height: "100%" }} />
      <div
        style={{
          position: "absolute",
          left: "12px",
          bottom: "12px",
          padding: "6px 10px",
          borderRadius: "999px",
          background: "rgba(255, 255, 255, 0.85)",
          fontSize: "12px",
        }}
      >
        {status}
      </div>
    </div>
  );
}
