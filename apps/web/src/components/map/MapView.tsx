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
    docks_disabled: number | null;
    bikes_disabled: number | null;
    inventory_slots_known: number | null;
    inventory_delta: number | null;
    occupancy_ratio: number | null;
    severity_score: number | null;
    bucket_quality: string | null;
    t_bucket: string | null;
    gbfs_last_updated: number | null;
    gbfs_ttl: number | null;
};

type Props = {
    onStationPick?: (s: StationPick) => void;
    onStationsData?: (stations: StationPick[]) => void;
    onTileFetchSampleMs?: (latencyMs: number) => void;
    selectedStationId?: string | null;
    freeze?: boolean; // when true, stop refreshing GBFS + keep view deterministic
};

type SourceWithSetData = {
    setData: (data: unknown) => void;
};

type UfE2EState = {
    mapViewMountCount?: number;
    mapRefreshAttempts?: number;
    mapRefreshSuccess?: number;
    mapRefreshFailureCount?: number;
    mapRefreshSkippedFrozen?: number;
    mapRefreshSkippedNoMap?: number;
    mapRefreshSkippedNoSource?: number;
    mapRefreshBadPayload?: number;
    mapRefreshLastFeatureCount?: number;
    mapRefreshLastAttemptTs?: string;
    mapRefreshLastSuccessTs?: string;
    mapRefreshLastSkipReason?: string;
    mapRefreshLastErrorMessage?: string;
    mapRefreshLastHttpStatus?: number | null;
    mapRefreshLastErrorHttpStatus?: number | null;
    mapRefreshLastLatencyMs?: number | null;
    mapStationPickCount?: number;
    mapClickMissCount?: number;
    mapLastPickedStationId?: string;
    mapLastPickedAt?: string;
    mapLastClickMissAt?: string;
    mapFeatureStateSetCount?: number;
    mapFeatureStateClearCount?: number;
    mapFeatureStateErrorCount?: number;
    mapFeatureStateLastSelectedId?: string;
    mapFeatureStateLastSetAt?: string;
    mapFeatureStateLastClearAt?: string;
    mapFeatureStateLastErrorAt?: string;
};

function updateUfE2E(update: (current: UfE2EState) => UfE2EState): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = update(current);
}

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
    const { onStationPick, onStationsData, onTileFetchSampleMs, selectedStationId, freeze } = props;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const mapRef = useRef<MapRef | null>(null);
    const lastSelectedRef = useRef<string | null>(null);

    useEffect(() => {
        activeMapViewCount += 1;
        console.info("[MapView] mount", { activeMapViewCount });
        updateUfE2E((current) => ({
            ...current,
            mapViewMountCount: activeMapViewCount,
            mapRefreshAttempts: current.mapRefreshAttempts ?? 0,
            mapRefreshSuccess: current.mapRefreshSuccess ?? 0,
            mapRefreshFailureCount: current.mapRefreshFailureCount ?? 0,
            mapRefreshSkippedFrozen: current.mapRefreshSkippedFrozen ?? 0,
            mapRefreshSkippedNoMap: current.mapRefreshSkippedNoMap ?? 0,
            mapRefreshSkippedNoSource: current.mapRefreshSkippedNoSource ?? 0,
            mapRefreshBadPayload: current.mapRefreshBadPayload ?? 0,
            mapRefreshLastFeatureCount: current.mapRefreshLastFeatureCount ?? 0,
            mapRefreshLastAttemptTs: current.mapRefreshLastAttemptTs ?? "",
            mapRefreshLastSuccessTs: current.mapRefreshLastSuccessTs ?? "",
            mapRefreshLastSkipReason: current.mapRefreshLastSkipReason ?? "",
            mapRefreshLastErrorMessage: current.mapRefreshLastErrorMessage ?? "",
            mapRefreshLastHttpStatus: current.mapRefreshLastHttpStatus ?? null,
            mapRefreshLastErrorHttpStatus: current.mapRefreshLastErrorHttpStatus ?? null,
            mapRefreshLastLatencyMs: current.mapRefreshLastLatencyMs ?? null,
            mapStationPickCount: current.mapStationPickCount ?? 0,
            mapClickMissCount: current.mapClickMissCount ?? 0,
            mapLastPickedStationId: current.mapLastPickedStationId ?? "",
            mapLastPickedAt: current.mapLastPickedAt ?? "",
            mapLastClickMissAt: current.mapLastClickMissAt ?? "",
            mapFeatureStateSetCount: current.mapFeatureStateSetCount ?? 0,
            mapFeatureStateClearCount: current.mapFeatureStateClearCount ?? 0,
            mapFeatureStateErrorCount: current.mapFeatureStateErrorCount ?? 0,
            mapFeatureStateLastSelectedId: current.mapFeatureStateLastSelectedId ?? "",
            mapFeatureStateLastSetAt: current.mapFeatureStateLastSetAt ?? "",
            mapFeatureStateLastClearAt: current.mapFeatureStateLastClearAt ?? "",
            mapFeatureStateLastErrorAt: current.mapFeatureStateLastErrorAt ?? "",
        }));

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
            updateUfE2E((current) => ({ ...current, mapViewMountCount: activeMapViewCount }));
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
                        ["!", ["has", "bikes_availability_ratio"]], "#7f8c8d",
                        [
                            "step",
                            ["coalesce", ["get", "bikes_availability_ratio"], -1],
                            "#ef4444",
                            0.1, "#f97316",
                            0.2, "#fb923c",
                            0.3, "#fdba74",
                            0.4, "#facc15",
                            0.5, "#fde047",
                            0.6, "#d9f99d",
                            0.7, "#86efac",
                            0.8, "#4ade80",
                            0.9, "#22c55e",
                        ],
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
        updateUfE2E((current) => ({
            ...current,
            mapRefreshAttempts: (current.mapRefreshAttempts ?? 0) + 1,
            mapRefreshLastAttemptTs: new Date().toISOString(),
        }));
        if (freeze) {
            updateUfE2E((current) => ({
                ...current,
                mapRefreshSkippedFrozen: (current.mapRefreshSkippedFrozen ?? 0) + 1,
                mapRefreshLastSkipReason: "freeze",
            }));
            return; // <— Inspect lock: no updates while drawer is open
        }

        const map = mapRef.current?.getMap();
        if (!map) {
            updateUfE2E((current) => ({
                ...current,
                mapRefreshSkippedNoMap: (current.mapRefreshSkippedNoMap ?? 0) + 1,
                mapRefreshLastSkipReason: "no_map",
            }));
            return;
        }

        const src = map.getSource(SOURCE_ID);
        if (!src || !("setData" in src)) {
            updateUfE2E((current) => ({
                ...current,
                mapRefreshSkippedNoSource: (current.mapRefreshSkippedNoSource ?? 0) + 1,
                mapRefreshLastSkipReason: "no_source",
            }));
            return;
        }

        try {
            const started = performance.now();
            const res = await fetch("/api/gbfs/stations", { cache: "no-store" });
            const httpStatus = res.status;
            const json = await res.json();
            const latencyMs = Math.max(0, performance.now() - started);
            onTileFetchSampleMs?.(latencyMs);

            if (json?.type === "FeatureCollection") {
                (src as SourceWithSetData).setData(json);
                const featureCount = Array.isArray(json.features) ? json.features.length : 0;
                if (onStationsData && Array.isArray(json.features)) {
                    const stations: StationPick[] = json.features
                        .map((feature: { properties?: Record<string, unknown> }): StationPick | null => {
                            const p = (feature.properties ?? {}) as Record<string, unknown>;
                            const stationId = String(p.station_id ?? "");
                            if (!stationId) return null;
                            return {
                                station_id: stationId,
                                name: p.name ? String(p.name) : stationId,
                                capacity: toNum(p.capacity),
                                bikes: toNum(p.bikes),
                                docks: toNum(p.docks),
                                docks_disabled: toNum(p.docks_disabled),
                                bikes_disabled: toNum(p.bikes_disabled),
                                inventory_slots_known: toNum(p.inventory_slots_known),
                                inventory_delta: toNum(p.inventory_delta),
                                occupancy_ratio: toNum(p.occupancy_ratio),
                                severity_score: toNum(p.severity_score),
                                bucket_quality: toText(p.bucket_quality),
                                t_bucket: toText(p.t_bucket),
                                gbfs_last_updated: toNum(p.gbfs_last_updated),
                                gbfs_ttl: toNum(p.gbfs_ttl),
                            } satisfies StationPick;
                        })
                        .filter((station: StationPick | null): station is StationPick => station !== null);
                    onStationsData(stations);
                }
                updateUfE2E((current) => ({
                    ...current,
                    mapRefreshSuccess: (current.mapRefreshSuccess ?? 0) + 1,
                    mapRefreshLastFeatureCount: featureCount,
                    mapRefreshLastSuccessTs: new Date().toISOString(),
                    mapRefreshLastSkipReason: "",
                    mapRefreshLastErrorMessage: "",
                    mapRefreshLastHttpStatus: httpStatus,
                    mapRefreshLastErrorHttpStatus: null,
                    mapRefreshLastLatencyMs: latencyMs,
                }));
                console.debug("[MapView] source_updated", {
                    sourceId: SOURCE_ID,
                    featureCount,
                    freeze: !!freeze,
                });
            } else {
                updateUfE2E((current) => ({
                    ...current,
                    mapRefreshBadPayload: (current.mapRefreshBadPayload ?? 0) + 1,
                    mapRefreshFailureCount: (current.mapRefreshFailureCount ?? 0) + 1,
                    mapRefreshLastErrorMessage: "bad_payload",
                    mapRefreshLastHttpStatus: httpStatus,
                    mapRefreshLastErrorHttpStatus: httpStatus,
                    mapRefreshLastLatencyMs: latencyMs,
                }));
                console.warn("Unexpected GBFS response:", json);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : "unknown_error";
            updateUfE2E((current) => ({
                ...current,
                mapRefreshFailureCount: (current.mapRefreshFailureCount ?? 0) + 1,
                mapRefreshLastErrorMessage: message,
                mapRefreshLastErrorHttpStatus: null,
                mapRefreshLastLatencyMs: null,
            }));
            console.error("[MapView] refresh_failed", { error: message });
        }
    }, [freeze, onStationsData, onTileFetchSampleMs]);

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
                updateUfE2E((current) => ({
                    ...current,
                    mapFeatureStateClearCount: (current.mapFeatureStateClearCount ?? 0) + 1,
                    mapFeatureStateLastClearAt: new Date().toISOString(),
                }));
            } catch {
                updateUfE2E((current) => ({
                    ...current,
                    mapFeatureStateErrorCount: (current.mapFeatureStateErrorCount ?? 0) + 1,
                    mapFeatureStateLastErrorAt: new Date().toISOString(),
                }));
            }
        }

        if (next) {
            try {
                map.setFeatureState({ source: SOURCE_ID, id: next }, { selected: true });
                updateUfE2E((current) => ({
                    ...current,
                    mapFeatureStateSetCount: (current.mapFeatureStateSetCount ?? 0) + 1,
                    mapFeatureStateLastSelectedId: next,
                    mapFeatureStateLastSetAt: new Date().toISOString(),
                }));
            } catch {
                updateUfE2E((current) => ({
                    ...current,
                    mapFeatureStateErrorCount: (current.mapFeatureStateErrorCount ?? 0) + 1,
                    mapFeatureStateLastErrorAt: new Date().toISOString(),
                }));
            }
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
                if (!f || !onStationPick) {
                    updateUfE2E((current) => ({
                        ...current,
                        mapClickMissCount: (current.mapClickMissCount ?? 0) + 1,
                        mapLastClickMissAt: new Date().toISOString(),
                    }));
                    return;
                }

                const p = (f.properties ?? {}) as Record<string, unknown>;
                const station_id = String(p.station_id ?? f.id ?? "");
                if (!station_id) return;

                updateUfE2E((current) => ({
                    ...current,
                    mapStationPickCount: (current.mapStationPickCount ?? 0) + 1,
                    mapLastPickedStationId: station_id,
                    mapLastPickedAt: new Date().toISOString(),
                }));
                // IMPORTANT: Mapbox props may be strings
                onStationPick({
                    station_id,
                    name: p.name ? String(p.name) : station_id,
                    capacity: toNum(p.capacity),
                    bikes: toNum(p.bikes),
                    docks: toNum(p.docks),
                    docks_disabled: toNum(p.docks_disabled),
                    bikes_disabled: toNum(p.bikes_disabled),
                    inventory_slots_known: toNum(p.inventory_slots_known),
                    inventory_delta: toNum(p.inventory_delta),
                    occupancy_ratio: toNum(p.occupancy_ratio),
                    severity_score: toNum(p.severity_score),
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
