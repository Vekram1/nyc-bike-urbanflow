"use client";

import { useEffect, useRef, useState } from "react";

import { mapboxStyleUrl, mapboxToken } from "../data/config";

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
        const mapboxgl = (await import("mapbox-gl")).default;
        const token = mapboxToken();
        if (!token) {
          setStatus("Missing Mapbox token");
          return;
        }
        mapboxgl.accessToken = token;
        mapInstance = new mapboxgl.Map({
          container: containerRef.current,
          style: mapboxStyleUrl(),
          center: [-73.9857, 40.7484],
          zoom: 9.5,
        });
        mapInstance.on("load", () => setStatus("Map loaded"));
        mapInstance.on("error", () => setStatus("Map error"));
      } catch (error) {
        setStatus("Mapbox unavailable");
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
