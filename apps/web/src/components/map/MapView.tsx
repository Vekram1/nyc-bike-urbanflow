// apps/web/src/components/map/MapView.tsx
"use client";

import Map, { NavigationControl } from "react-map-gl/mapbox";

const NYC = {
    longitude: -73.9857,
    latitude: 40.7484,
    zoom: 12.2,
    bearing: 0,
    pitch: 0,
};

export default function MapView() {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

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
                Missing NEXT_PUBLIC_MAPBOX_TOKEN in apps/web/.env.local
            </div>
        );
    }

    return (
        <Map
            mapboxAccessToken={token}
            initialViewState={NYC}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            style={{ width: "100%", height: "100%" }}
            // keep HUD overlays from fighting the map
            cooperativeGestures={false}
            attributionControl={true}
        >
            <NavigationControl position="bottom-right" />
        </Map>
    );
}
