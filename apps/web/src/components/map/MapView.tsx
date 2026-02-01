// apps/web/src/components/map/MapView.tsx
"use client";

import Map, { NavigationControl, MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRef, useEffect, useCallback } from "react";

const NYC = {
    longitude: -74.0060,
    latitude: 40.7128,
    zoom: 10.5,
    bearing: 0,
    pitch: 0,
};

const SOURCE_ID = "gbfs-stations";
const LAYER_ID = "gbfs-stations-circles";

export type StationPick = {
    station_id: string;
    name: string;
    capacity: number | null;
    bikes: number | null;
    docks: number | null;
    gbfs_last_updated: number | null;
    gbfs_ttl: number | null;
};

type Props = {
    onStationPick?: (s: StationPick) => void;
    selectedStationId?: string | null;
    freeze?: boolean; // when true, stop refreshing GBFS + keep view deterministic
};

export default function MapView(props: Props) {
    const { onStationPick, selectedStationId, freeze } = props;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const mapRef = useRef<MapRef | null>(null);
    const lastSelectedRef = useRef<string | null>(null);

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

    const ensureStationsLayer = useCallback(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;

        if (!map.getSource(SOURCE_ID)) {
            map.addSource(SOURCE_ID, {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
                promoteId: "station_id",
            } as any);
        }

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

                    // selection highlight via feature-state
                    "circle-stroke-width": [
                        "case",
                        ["boolean", ["feature-state", "selected"], false],
                        2,
                        1,
                    ],
                    "circle-stroke-color": [
                        "case",
                        ["boolean", ["feature-state", "selected"], false],
                        "rgba(255,255,255,0.75)",
                        "rgba(255,255,255,0.25)",
                    ],
                },
            });
        }
    }, []);

    const refreshStations = useCallback(async () => {
        if (freeze) return; // <— Inspect lock: no updates while drawer is open

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
    }, [freeze]);

    // poll live GBFS (disabled when freeze=true)
    useEffect(() => {
        if (freeze) return;

        const id = window.setInterval(() => {
            refreshStations().catch((e) => console.error(e));
        }, 15000);

        return () => window.clearInterval(id);
    }, [freeze, refreshStations]);

    // keep feature-state selection in sync with MapShell
    useEffect(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;

        const prev = lastSelectedRef.current;
        const next = selectedStationId ?? null;

        if (prev && prev !== next) {
            try {
                map.setFeatureState({ source: SOURCE_ID, id: prev }, { selected: false });
            } catch { }
        }

        if (next) {
            try {
                map.setFeatureState({ source: SOURCE_ID, id: next }, { selected: true });
            } catch { }
        }

        lastSelectedRef.current = next;
    }, [selectedStationId]);

    return (
        <Map
            ref={mapRef}
            mapboxAccessToken={token}
            initialViewState={NYC}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            style={{ width: "100%", height: "100%" }}
            cooperativeGestures={false}
            attributionControl={true}
            interactiveLayerIds={[LAYER_ID]}
            onLoad={() => {
                ensureStationsLayer();
                refreshStations().catch((e) => console.error(e));
            }}
            onClick={(e) => {
                const f = e.features?.[0];
                if (!f || !onStationPick) return;

                const p: any = f.properties ?? {};
                const station_id = String(p.station_id ?? f.id ?? "");
                if (!station_id) return;

                // IMPORTANT: Mapbox props may be strings
                onStationPick({
                    station_id,
                    name: p.name ? String(p.name) : station_id,
                    capacity: p.capacity != null ? Number(p.capacity) : null,
                    bikes: p.bikes != null ? Number(p.bikes) : null,
                    docks: p.docks != null ? Number(p.docks) : null,
                    gbfs_last_updated: p.gbfs_last_updated != null ? Number(p.gbfs_last_updated) : null,
                    gbfs_ttl: p.gbfs_ttl != null ? Number(p.gbfs_ttl) : null,
                });
            }}
        >
            <NavigationControl position="bottom-right" />
        </Map>
    );
}
