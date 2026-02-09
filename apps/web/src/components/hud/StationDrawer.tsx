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
    tier2LastRequestedAt?: string;
    tier2LastSuccessAt?: string;
    tier2LastErrorAt?: string;
    tier2UiStatus?: Tier2State["status"];
    tier2UiMessage?: string;
    tier2UiBundleBytes?: number;
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
    const [tier2LastHttpStatusText, setTier2LastHttpStatusText] = useState("");
    const [tier2LastErrorText, setTier2LastErrorText] = useState("");

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
        updateUfE2E((current) => ({
            ...current,
            tier2UiStatus: tier2.status,
            tier2UiMessage: tier2.message,
            tier2UiBundleBytes: tier2.status === "success" ? tier2.bundleBytes : 0,
        }));
    }, [tier2]);

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
        setTier2LastHttpStatusText("");
        setTier2LastErrorText("");
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
        setTier2LastErrorText("");
        updateUfE2E((current) => ({
            ...current,
            tier2RequestedCount: (current.tier2RequestedCount ?? 0) + 1,
            tier2LoadingCount: (current.tier2LoadingCount ?? 0) + 1,
            tier2LastStationKey: stationId,
            tier2InFlight: true,
            tier2LastRequestedBucket: fallbackBucketEpochS,
            tier2LastRequestedRange: TIER2_DEFAULT_RANGE,
            tier2LastRequestedAt: new Date().toISOString(),
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
            let lastHttpStatus: number | null = null;
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
                lastHttpStatus = res.status;
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
                    tier2LastSuccessAt: new Date().toISOString(),
                }));
                setTier2LastHttpStatusText(String(res.status));
                setTier2LastErrorText("");
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
                    tier2LastHttpStatus: lastHttpStatus,
                    tier2LastStationKey: stationId,
                    tier2InFlight: false,
                    tier2LastErrorMessage: message,
                    tier2LastErrorAt: new Date().toISOString(),
                }));
                setTier2LastHttpStatusText(lastHttpStatus == null ? "" : String(lastHttpStatus));
                setTier2LastErrorText(message);
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
            data-uf-tier2-in-flight={tier2.status === "loading" ? "true" : "false"}
            data-uf-tier2-last-http-status={tier2LastHttpStatusText}
            data-uf-tier2-last-error={tier2LastErrorText}
            role="dialog"
            aria-labelledby={titleId}
            aria-describedby={`${descId} ${tierId}`}
        >
            <div style={{ padding: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Station</div>
                <div id={titleId} style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }} data-uf-id="drawer-station-title">
                    {station.name}
                </div>

                <div id={descId} style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }} data-uf-id="drawer-updated-text">
                    Updated: {updated}
                </div>
                <div id={tierId} style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }} data-uf-id="drawer-tier1-note">
                    Tier1 view: tile payload only (no detail fetch).
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                    <Row label="Station key" value={station.station_id} rowId="drawer-row-station-key" valueId="drawer-value-station-key" />
                    <Row label="Capacity" value={fmtNum(station.capacity)} rowId="drawer-row-capacity" valueId="drawer-value-capacity" />
                    <Row label="Bikes" value={fmtNum(station.bikes)} rowId="drawer-row-bikes" valueId="drawer-value-bikes" />
                    <Row label="Docks" value={fmtNum(station.docks)} rowId="drawer-row-docks" valueId="drawer-value-docks" />
                    <Row label="Bucket quality" value={fmtText(station.bucket_quality)} rowId="drawer-row-bucket-quality" valueId="drawer-value-bucket-quality" />
                    <Row label="T_bucket" value={fmtText(station.t_bucket)} rowId="drawer-row-t-bucket" valueId="drawer-value-t-bucket" />
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
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }} data-uf-id="drawer-tier2-status-text">
                        {tier2.message}
                    </div>
                    {tier2.status === "success" ? (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }} data-uf-id="drawer-tier2-bundle-size">
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

function Row({
    label,
    value,
    rowId,
    valueId,
}: {
    label: string;
    value: string;
    rowId: string;
    valueId: string;
}) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }} data-uf-id={rowId}>
            <span style={{ fontSize: 12, opacity: 0.85 }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600 }} data-uf-id={valueId}>{value}</span>
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
