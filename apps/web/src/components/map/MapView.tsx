// apps/web/src/components/map/MapView.tsx
"use client";

import Map, { NavigationControl, MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRef, useEffect, useCallback } from "react";

const NYC = {
    longitude: -74.006,
    latitude: 40.7128,
    zoom: 10.5,
    bearing: 0,
    pitch: 0,
};

const SOURCE_ID = "gbfs-stations";
const LAYER_ID = "gbfs-stations-circles";

export default function MapView() {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const mapRef = useRef<MapRef | null>(null);

    // Error handling for missing token
    if (!token) {
        return (
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    color: "rgba(230,237,243,0.9)",
                    fontSize: 14,
                    background: "#071018",
                }}
            >
                Missing NEXT_PUBLIC_MAPBOX_TOKEN
            </div>
        );
    }

    const refreshStations = useCallback(async () => {
        const map = mapRef.current?.getMap();
        if (!map) return;

        const src = map.getSource(SOURCE_ID) as any;
        if (!src?.setData) return;

        const res = await fetch("/api/gbfs/stations", { cache: "no-store" });
        const json = await res.json();

        if (json?.type === "FeatureCollection") {
            src.setData(json);
        } else {
            console.warn("Unexpected GBFS response:", json);
        }
    }, []);

    const ensureStationsLayer = useCallback(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;

        // Source
        if (!map.getSource(SOURCE_ID)) {
            map.addSource(SOURCE_ID, {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
                // helpful later if you use feature-state keyed by station_id
                promoteId: "station_id",
            } as any);
        }

        // Layer
        if (!map.getLayer(LAYER_ID)) {
            map.addLayer({
                id: LAYER_ID,
                type: "circle",
                source: SOURCE_ID,
                paint: {
                    // radius from capacity (sqrt scaling + clamp-ish)
                    "circle-radius": [
                        "interpolate",
                        ["linear"],
                        ["sqrt", ["coalesce", ["get", "capacity"], 0]],
                        0, 2,
                        10, 6,
                        30, 12,
                        60, 18,
                    ],

                    // simple “bad if empty/full else good” — replace with severity later
                    "circle-color": [
                        "case",
                        ["==", ["get", "bikes"], 0], "#ff4d4d",
                        ["==", ["get", "docks"], 0], "#ff4d4d",
                        "#3ddc84",
                    ],

                    "circle-opacity": 0.85,
                    "circle-stroke-width": 1,
                    "circle-stroke-color": "rgba(255,255,255,0.25)",
                },
            });
        }
    }, []);

    // Polling loop (kept simple; you can align to GBFS ttl later)
    useEffect(() => {
        const id = window.setInterval(() => {
            refreshStations().catch((e) => console.error(e));
        }, 15000);

        return () => window.clearInterval(id);
    }, [refreshStations]);

    return (
        <Map
            ref={mapRef}
            mapboxAccessToken={token}
            initialViewState={NYC}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            style={{ width: "100%", height: "100%" }}
            cooperativeGestures={false}
            attributionControl={true}
            onLoad={() => {
                ensureStationsLayer();
                refreshStations().catch((e) => console.error(e));
            }}
        >
            <NavigationControl position="bottom-right" />
        </Map>
    );
}
