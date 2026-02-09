// apps/web/src/components/hud/StationDrawer.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { StationPick } from "@/components/map/MapView";

const TIER2_DEBOUNCE_MS = 350;
const TIER2_DEFAULT_RANGE = "6h";

type Tier2State =
    | { status: "idle"; message: string }
    | { status: "loading"; message: string }
    | { status: "success"; message: string; bundleBytes: number; payload: unknown }
    | { status: "error"; message: string };

type UfE2EState = {
    tier1OpenedCount?: number;
    tier2RequestedCount?: number;
    tier2LoadingCount?: number;
    tier2SuccessCount?: number;
    tier2ErrorCount?: number;
    tier2DebounceScheduledCount?: number;
    tier2AbortCount?: number;
    tier2LastBundleBytes?: number;
    tier2LastHttpStatus?: number | null;
    tier2LastStationKey?: string;
    tier2InFlight?: boolean;
    tier2LastRequestedBucket?: number;
    tier2LastRequestedRange?: string;
    tier2LastErrorMessage?: string;
};

function updateUfE2E(update: (current: UfE2EState) => UfE2EState): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = update(current);
}

export default function StationDrawer(props: {
    station: StationPick | null;
    sv: string;
    timelineBucket: number;
    onClose: () => void;
}) {
    const { station, sv, timelineBucket, onClose } = props;
    const isOpen = station != null;
    const debounceRef = useRef<number | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const [tier2, setTier2] = useState<Tier2State>({
        status: "idle",
        message: "Tier2 details are optional and loaded on demand.",
    });

    const stationId = station?.station_id ?? null;
    const tier2BucketEpochS = deriveTier2BucketEpochS(station);
    const fallbackBucketEpochS =
        tier2BucketEpochS ??
        (timelineBucket > 1_000_000_000 ? timelineBucket : Math.floor(Date.now() / 1000));

    const updated =
        station?.gbfs_last_updated != null
            ? new Date(station.gbfs_last_updated * 1000).toLocaleString()
            : "—";
    const titleId = `uf-drawer-title-${stationId ?? "none"}`;
    const descId = `uf-drawer-desc-${stationId ?? "none"}`;
    const tierId = `uf-drawer-tier-${stationId ?? "none"}`;

    useEffect(() => {
        if (!stationId) return;
        setTier2({
            status: "idle",
            message: "Tier2 details are optional and loaded on demand.",
        });
        updateUfE2E((current) => ({
            ...current,
            tier1OpenedCount: (current.tier1OpenedCount ?? 0) + 1,
            tier2InFlight: false,
        }));
        console.info("[StationDrawer] tier1_opened", {
            stationId,
            source: "tile_payload",
        });

        return () => {
            if (debounceRef.current != null) {
                window.clearTimeout(debounceRef.current);
            }
            abortRef.current?.abort();
        };
    }, [stationId]);

    const onLoadTier2 = () => {
        if (!stationId) return;
        if (debounceRef.current != null) {
            window.clearTimeout(debounceRef.current);
        }
        if (abortRef.current) {
            abortRef.current.abort();
            updateUfE2E((current) => ({
                ...current,
                tier2AbortCount: (current.tier2AbortCount ?? 0) + 1,
                tier2InFlight: false,
            }));
        }

        setTier2({
            status: "loading",
            message: `Loading Tier2 details (debounced ${TIER2_DEBOUNCE_MS}ms)...`,
        });
        updateUfE2E((current) => ({
            ...current,
            tier2RequestedCount: (current.tier2RequestedCount ?? 0) + 1,
            tier2LoadingCount: (current.tier2LoadingCount ?? 0) + 1,
            tier2LastStationKey: stationId,
            tier2InFlight: true,
            tier2LastRequestedBucket: fallbackBucketEpochS,
            tier2LastRequestedRange: TIER2_DEFAULT_RANGE,
        }));
        console.info("[StationDrawer] tier2_requested", {
            station_key: stationId,
            sv,
            debounceMs: TIER2_DEBOUNCE_MS,
            tBucketEpochS: fallbackBucketEpochS,
            range: TIER2_DEFAULT_RANGE,
        });

        debounceRef.current = window.setTimeout(async () => {
            updateUfE2E((current) => ({
                ...current,
                tier2DebounceScheduledCount: (current.tier2DebounceScheduledCount ?? 0) + 1,
            }));
            const ctrl = new AbortController();
            abortRef.current = ctrl;
            try {
                const params = new URLSearchParams({
                    v: "1",
                    sv,
                    T_bucket: String(fallbackBucketEpochS),
                    range: TIER2_DEFAULT_RANGE,
                });
                const res = await fetch(
                    `/api/stations/${encodeURIComponent(stationId)}/drawer?${params.toString()}`,
                    { cache: "no-store", signal: ctrl.signal }
                );
                const text = await res.text();
                const bundleBytes = new TextEncoder().encode(text).length;
                const payload = text.length > 0 ? JSON.parse(text) : null;

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                console.info("[StationDrawer] tier2_loaded", {
                    station_key: stationId,
                    sv,
                    bundleBytes,
                    tBucketEpochS: fallbackBucketEpochS,
                });
                updateUfE2E((current) => ({
                    ...current,
                    tier2SuccessCount: (current.tier2SuccessCount ?? 0) + 1,
                    tier2LastBundleBytes: bundleBytes,
                    tier2LastHttpStatus: res.status,
                    tier2LastStationKey: stationId,
                    tier2InFlight: false,
                    tier2LastErrorMessage: "",
                }));
                setTier2({
                    status: "success",
                    message: "Tier2 details loaded.",
                    bundleBytes,
                    payload,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown error";
                console.warn("[StationDrawer] tier2_failed", {
                    station_key: stationId,
                    sv,
                    error: message,
                    tBucketEpochS: fallbackBucketEpochS,
                });
                updateUfE2E((current) => ({
                    ...current,
                    tier2ErrorCount: (current.tier2ErrorCount ?? 0) + 1,
                    tier2LastHttpStatus: null,
                    tier2LastStationKey: stationId,
                    tier2InFlight: false,
                    tier2LastErrorMessage: message,
                }));
                setTier2({
                    status: "error",
                    message: `Tier2 load failed: ${message}`,
                });
            }
        }, TIER2_DEBOUNCE_MS);
    };

    if (!isOpen || !station) return null;

    return (
        <div
            className="uf-drawer"
            data-uf-id="station-drawer"
            data-uf-station-key={station.station_id}
            data-uf-tier2-status={tier2.status}
            role="dialog"
            aria-labelledby={titleId}
            aria-describedby={`${descId} ${tierId}`}
        >
            <div style={{ padding: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Station</div>
                <div id={titleId} style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>
                    {station.name}
                </div>

                <div id={descId} style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                    Updated: {updated}
                </div>
                <div id={tierId} style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                    Tier1 view: tile payload only (no detail fetch).
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    <Row label="Station key" value={station.station_id} />
                    <Row label="Capacity" value={fmtNum(station.capacity)} />
                    <Row label="Bikes" value={fmtNum(station.bikes)} />
                    <Row label="Docks" value={fmtNum(station.docks)} />
                    <Row label="Bucket quality" value={fmtText(station.bucket_quality)} />
                    <Row label="T_bucket" value={fmtText(station.t_bucket)} />
                </div>

                <div style={{ marginTop: 14 }}>
                    <button
                        type="button"
                        style={secondaryBtnStyle}
                        onClick={onLoadTier2}
                        disabled={tier2.status === "loading"}
                        aria-label="Load Tier2 details"
                        data-uf-id="drawer-tier2-button"
                        data-uf-tier2-t-bucket={String(fallbackBucketEpochS)}
                    >
                        {tier2.status === "loading" ? "Loading details..." : "Details (Tier2)"}
                    </button>
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                        {tier2.message}
                    </div>
                    {tier2.status === "success" ? (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                            Bundle size: {tier2.bundleBytes.toLocaleString()} bytes
                        </div>
                    ) : null}
                </div>

                <button
                    type="button"
                    style={primaryBtnStyle}
                    onClick={onClose}
                    aria-label="Close station details"
                    data-uf-id="drawer-close-button"
                >
                    Close
                </button>
            </div>
        </div>
    );
}

function deriveTier2BucketEpochS(station: StationPick | null): number | null {
    if (!station) return null;
    if (station.gbfs_last_updated != null && Number.isFinite(station.gbfs_last_updated)) {
        return Math.floor(station.gbfs_last_updated);
    }
    if (station.t_bucket) {
        const parsed = Date.parse(station.t_bucket);
        if (Number.isFinite(parsed)) {
            return Math.floor(parsed / 1000);
        }
    }
    return null;
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{value}</span>
        </div>
    );
}

function fmtNum(x: number | null) {
    return x == null || Number.isNaN(x) ? "—" : String(x);
}

function fmtText(x: string | null) {
    return x == null || x.length === 0 ? "—" : x;
}

const primaryBtnStyle: React.CSSProperties = {
    marginTop: 14,
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(230,237,243,0.92)",
    padding: "10px 12px",
    cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(230,237,243,0.9)",
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: 12,
};
