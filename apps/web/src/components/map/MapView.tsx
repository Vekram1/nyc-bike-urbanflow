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
let activeMapViewCount = 0;

export type StationPick = {
    station_id: string;
    name: string;
    capacity: number | null;
    bikes: number | null;
    docks: number | null;
    bucket_quality: string | null;
    t_bucket: string | null;
    gbfs_last_updated: number | null;
    gbfs_ttl: number | null;
};

type Props = {
    onStationPick?: (s: StationPick) => void;
    selectedStationId?: string | null;
    freeze?: boolean; // when true, stop refreshing GBFS + keep view deterministic
};

type SourceWithSetData = {
    setData: (data: unknown) => void;
};

function toNum(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function toText(v: unknown): string | null {
    if (v == null) return null;
    const text = String(v).trim();
    return text.length > 0 ? text : null;
}

export default function MapView(props: Props) {
    const { onStationPick, selectedStationId, freeze } = props;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const mapRef = useRef<MapRef | null>(null);
    const lastSelectedRef = useRef<string | null>(null);

    useEffect(() => {
        activeMapViewCount += 1;
        console.info("[MapView] mount", { activeMapViewCount });
        if (typeof window !== "undefined") {
            const current = (window as { __UF_E2E?: Record<string, unknown> }).__UF_E2E ?? {};
            (window as { __UF_E2E?: Record<string, unknown> }).__UF_E2E = {
                ...current,
                mapViewMountCount: activeMapViewCount,
            };
        }

        if (activeMapViewCount > 1) {
            console.error("[MapView] mount_once_invariant_violation", {
                activeMapViewCount,
                sourceId: SOURCE_ID,
                layerId: LAYER_ID,
            });
        }

        return () => {
            activeMapViewCount = Math.max(0, activeMapViewCount - 1);
            console.info("[MapView] unmount", { activeMapViewCount });
            if (typeof window !== "undefined") {
                const current = (window as { __UF_E2E?: Record<string, unknown> }).__UF_E2E ?? {};
                (window as { __UF_E2E?: Record<string, unknown> }).__UF_E2E = {
                    ...current,
                    mapViewMountCount: activeMapViewCount,
                };
            }
        };
    }, []);

    const ensureStationsLayer = useCallback(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;
        let sourceAdded = false;
        let layerAdded = false;

        if (!map.getSource(SOURCE_ID)) {
            map.addSource(SOURCE_ID, {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
                promoteId: "station_id",
            });
            sourceAdded = true;
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
            layerAdded = true;
        }

        if (sourceAdded || layerAdded) {
            console.info("[MapView] source_layer_ready", {
                sourceId: SOURCE_ID,
                layerId: LAYER_ID,
                sourceAdded,
                layerAdded,
            });
        }
    }, []);

    const refreshStations = useCallback(async () => {
        if (freeze) return; // <— Inspect lock: no updates while drawer is open

        const map = mapRef.current?.getMap();
        if (!map) return;

        const src = map.getSource(SOURCE_ID);
        if (!src || !("setData" in src)) return;

        const res = await fetch("/api/gbfs/stations", { cache: "no-store" });
        const json = await res.json();

        if (json?.type === "FeatureCollection") {
            (src as SourceWithSetData).setData(json);
            const featureCount = Array.isArray(json.features) ? json.features.length : 0;
            console.debug("[MapView] source_updated", {
                sourceId: SOURCE_ID,
                featureCount,
                freeze: !!freeze,
            });
        } else {
            console.warn("Unexpected GBFS response:", json);
        }
    }, [freeze]);

    // poll live GBFS (disabled when freeze=true)
    useEffect(() => {
        if (freeze) return;

        const id = window.setInterval(() => {
            refreshStations().catch((e) =>
                console.error("[MapView] refresh_failed", { error: e })
            );
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
                console.info("[MapView] map_loaded", {
                    sourceId: SOURCE_ID,
                    layerId: LAYER_ID,
                });
                ensureStationsLayer();
                refreshStations().catch((e) =>
                    console.error("[MapView] initial_refresh_failed", { error: e })
                );
            }}
            onClick={(e) => {
                const f = e.features?.[0];
                if (!f || !onStationPick) return;

                const p = (f.properties ?? {}) as Record<string, unknown>;
                const station_id = String(p.station_id ?? f.id ?? "");
                if (!station_id) return;

                // IMPORTANT: Mapbox props may be strings
                onStationPick({
                    station_id,
                    name: p.name ? String(p.name) : station_id,
                    capacity: toNum(p.capacity),
                    bikes: toNum(p.bikes),
                    docks: toNum(p.docks),
                    bucket_quality: toText(p.bucket_quality),
                    t_bucket: toText(p.t_bucket),
                    gbfs_last_updated: toNum(p.gbfs_last_updated),
                    gbfs_ttl: toNum(p.gbfs_ttl),
                });
            }}
        >
            <NavigationControl position="bottom-right" />
        </Map>
    );
}
