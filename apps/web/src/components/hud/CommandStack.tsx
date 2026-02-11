// apps/web/src/components/hud/CommandStack.tsx
"use client";

import { useEffect, useMemo, useState, type KeyboardEventHandler } from "react";

import HUDCard from "./HUDCard";
import Keycap from "./Keycap";
import type { LayerToggles } from "@/lib/hudTypes";

type Props = {
    previewMode?: boolean;
    playing: boolean;
    inspectLocked: boolean;
    compareMode: boolean;
    splitView: boolean;
    compareOffsetBuckets: number;
    mode: "live" | "replay";
    layers: LayerToggles;
    searchStations: Array<{ stationKey: string; name: string }>;
    policyStatus: "idle" | "pending" | "ready" | "stale" | "error";
    policyMovesCount: number;
    policyImpactEnabled: boolean;
    policyImpactSummary?: {
        impactedStations: number;
        improvedStations: number;
        worsenedStations: number;
        avgDeltaPctPoints: number;
    } | null;
    playbackView?: "before" | "after";
    policySummary?: {
        frozenTimeLabel: string;
        strategyLabel: string;
        stationsImproved: number;
        shortageReducedLabel: string;
        bikesMoved: number;
        previewDisclaimer: string;
        technical: {
            sv: string;
            policyVersion: string;
            policySpecSha256: string;
            decisionBucketTs: number;
            viewSnapshotId: string;
            viewSnapshotSha256: string;
        };
    } | null;
    policyStrategy?: "greedy" | "global";
    availablePolicyStrategies?: Array<"greedy" | "global">;
    onPolicyStrategyChange?: (strategy: "greedy" | "global") => void;
    canCancelPolicy?: boolean;
    onCancelPolicy?: () => void;
    policyCompare?: {
        currentStrategy: string;
        previousStrategy: string;
        bikesMovedDelta: number;
        stationsImprovedDelta: number;
    } | null;
    diagnosticsPayload?: string | null;
    onExportDiagnostics?: () => Promise<boolean> | boolean;
    showDemoModeToggle?: boolean;
    demoModeEnabled?: boolean;
    onToggleDemoMode?: () => void;
    reducedMotion?: boolean;
    onToggleReducedMotion?: () => void;
    onTogglePlay: () => void;
    onTogglePlaybackView?: () => void;
    onGoLive: () => void;
    onToggleLayer: (key: keyof LayerToggles) => void;
    onToggleCompareMode: () => void;
    onToggleSplitView: () => void;
    onCompareOffsetDown: () => void;
    onCompareOffsetUp: () => void;
    onSearchPick: (station: { stationKey: string; name: string }) => void;
    showSyncView?: boolean;
    onSyncView?: () => void;
    onRunPolicy: () => void;
    onTogglePolicyImpact: () => void;
};

type SearchResult = {
    stationKey: string;
    name: string;
};

export default function CommandStack({
    previewMode = false,
    playing,
    inspectLocked,
    compareMode,
    splitView,
    compareOffsetBuckets,
    mode,
    layers,
    searchStations,
    policyStatus,
    policyMovesCount,
    policyImpactEnabled,
    policyImpactSummary,
    policySummary,
    policyStrategy = "greedy",
    availablePolicyStrategies = ["greedy", "global"],
    onPolicyStrategyChange,
    canCancelPolicy = false,
    onCancelPolicy,
    policyCompare = null,
    diagnosticsPayload = null,
    onExportDiagnostics,
    showDemoModeToggle = false,
    demoModeEnabled = false,
    onToggleDemoMode,
    reducedMotion = false,
    onToggleReducedMotion,
    playbackView = "after",
    onTogglePlay,
    onTogglePlaybackView,
    onGoLive,
    onToggleLayer,
    onToggleCompareMode,
    onToggleSplitView,
    onCompareOffsetDown,
    onCompareOffsetUp,
    onSearchPick,
    showSyncView = false,
    onSyncView,
    onRunPolicy,
    onTogglePolicyImpact,
}: Props) {
    const [query, setQuery] = useState("");
    const [activeResultIdx, setActiveResultIdx] = useState(0);
    const [remoteResults, setRemoteResults] = useState<SearchResult[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [remoteError, setRemoteError] = useState<string | null>(null);
    const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
    const greedyStrategyAvailable = availablePolicyStrategies.includes("greedy");
    const globalStrategyAvailable = availablePolicyStrategies.includes("global");
    const trimmedQuery = query.trim();
    const canSearch = trimmedQuery.length >= 2;
    const localResults = useMemo(() => {
        if (!canSearch) return [];
        const q = trimmedQuery.toLowerCase();
        return searchStations
            .filter((item) => {
                const stationKey = item.stationKey.toLowerCase();
                const stationName = item.name.toLowerCase();
                return stationName.includes(q) || stationKey.includes(q);
            })
            .slice(0, 8);
    }, [canSearch, searchStations, trimmedQuery]);
    const results = useMemo(() => {
        const merged: SearchResult[] = [];
        const seen = new Set<string>();
        const remote = remoteResults ?? [];
        for (const item of remote) {
            if (seen.has(item.stationKey)) continue;
            seen.add(item.stationKey);
            merged.push(item);
        }
        for (const item of localResults) {
            if (seen.has(item.stationKey)) continue;
            seen.add(item.stationKey);
            merged.push(item);
        }
        return merged;
    }, [localResults, remoteResults]);

    useEffect(() => {
        if (!canSearch) {
            setRemoteResults(null);
            setRemoteError(null);
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true);
            setRemoteError(null);
            try {
                const params = new URLSearchParams({
                    q: trimmedQuery,
                    limit: "8",
                });
                const res = await fetch(`/api/search?${params.toString()}`, {
                    cache: "no-store",
                    signal: controller.signal,
                });
                const body = (await res.json()) as {
                    results?: SearchResult[];
                    error?: { message?: string };
                };
                if (!res.ok) {
                    setRemoteResults(null);
                    setRemoteError(body.error?.message ?? "Search unavailable");
                    return;
                }
                setRemoteResults(Array.isArray(body.results) ? body.results : []);
            } catch (error: unknown) {
                if ((error as { name?: string })?.name === "AbortError") return;
                setRemoteResults(null);
                setRemoteError("Search unavailable");
            } finally {
                setLoading(false);
            }
        }, 120);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [canSearch, trimmedQuery]);

    useEffect(() => {
        if (!canSearch || results.length === 0) {
            setActiveResultIdx(0);
            return;
        }
        setActiveResultIdx((current) => Math.max(0, Math.min(results.length - 1, current)));
    }, [canSearch, results.length]);

    const searchHint = useMemo(() => {
        if (!canSearch) return "Type at least 2 chars";
        if (loading) return "Searching...";
        if (remoteError) return `${remoteError} (showing local matches)`;
        if (results.length === 0) return "No matches";
        const localOnly =
            remoteResults != null &&
            remoteResults.length === 0 &&
            localResults.length > 0 &&
            !remoteError;
        if (localOnly) {
            return `${results.length} local result${results.length === 1 ? "" : "s"}`;
        }
        return `${results.length} result${results.length === 1 ? "" : "s"}`;
    }, [canSearch, loading, localResults.length, remoteError, remoteResults, results.length]);

    const handlePick = (item: SearchResult) => {
        onSearchPick({
            stationKey: item.stationKey,
            name: item.name,
        });
        setQuery("");
        setRemoteResults(null);
        setRemoteError(null);
    };
    const handleExportDiagnostics = async () => {
        if (!onExportDiagnostics) return;
        const success = await onExportDiagnostics();
        setDiagnosticsCopied(success);
        if (!success) return;
        window.setTimeout(() => {
            setDiagnosticsCopied(false);
        }, 1500);
    };

    const onSearchKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
        if (results.length === 0) return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveResultIdx((current) => Math.min(results.length - 1, current + 1));
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveResultIdx((current) => Math.max(0, current - 1));
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            handlePick(results[Math.max(0, Math.min(results.length - 1, activeResultIdx))]);
        }
    };

    return (
        <>
            {!previewMode ? (
            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {!previewMode ? (
                        <>
                            <Row label="Search" hint=" / " />
                            <input
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                onKeyDown={onSearchKeyDown}
                                placeholder="Station name or key"
                                aria-label="Search stations"
                                data-uf-id="search-input"
                                style={searchInputStyle}
                            />
                            <div
                                style={{ fontSize: 11, opacity: 0.7, minHeight: 14 }}
                                data-uf-id="search-status"
                            >
                                {searchHint}
                            </div>
                            {remoteError ? (
                                <div
                                    style={{
                                        fontSize: 10,
                                        opacity: 0.9,
                                        border: "1px solid rgba(251,191,36,0.45)",
                                        borderRadius: 999,
                                        padding: "2px 8px",
                                        display: "inline-flex",
                                        width: "fit-content",
                                    }}
                                    data-uf-id="search-fallback-badge"
                                >
                                    Backend unavailable; using local fallback
                                </div>
                            ) : null}
                            {results.length > 0 ? (
                                <div style={searchResultsStyle} data-uf-id="search-results">
                                    {results.map((item, idx) => (
                                        <button
                                            key={item.stationKey}
                                            type="button"
                                            onClick={() => handlePick(item)}
                                            onMouseEnter={() => setActiveResultIdx(idx)}
                                            style={
                                                idx === activeResultIdx
                                                    ? {
                                                          ...searchResultButtonStyle,
                                                          border: "1px solid rgba(255,255,255,0.35)",
                                                          background: "rgba(255,255,255,0.12)",
                                                      }
                                                    : searchResultButtonStyle
                                            }
                                            data-uf-id={`search-result-${item.stationKey}`}
                                            data-uf-active={idx === activeResultIdx ? "true" : "false"}
                                        >
                                            {item.name}
                                            <span style={{ opacity: 0.6, marginLeft: 6 }}>
                                                {item.stationKey}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </>
                    ) : null}
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onTogglePlay}
                        aria-label={playing ? "Pause playback" : "Start playback"}
                        title={playing ? "Pause playback" : "Start playback"}
                        aria-pressed={playing}
                        disabled={inspectLocked}
                        data-uf-id="command-play-toggle"
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }}>
                            {playing ? "Pause" : "Play"}
                        </span>
                        <span>
                            <Keycap k="Space" />
                        </span>
                    </button>
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onGoLive}
                        aria-label="Jump to live time"
                        title="Jump to live time"
                        disabled={!previewMode && inspectLocked}
                        data-uf-id="command-go-live"
                        data-uf-mode={mode}
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }}>
                            {previewMode ? "Return Live" : mode === "live" ? "Live Now" : "Go Live"}
                        </span>
                        <span>
                            <Keycap k="L" />
                        </span>
                    </button>
                    {previewMode && onTogglePlaybackView ? (
                        <button
                            type="button"
                            style={rowBtnStyle}
                            onClick={onTogglePlaybackView}
                            aria-label="Toggle before and after preview"
                            aria-pressed={playbackView === "after"}
                            data-uf-id="preview-before-after-toggle"
                        >
                            <span style={{ fontSize: 12, opacity: 0.92 }}>
                                {playbackView === "after" ? "View: After" : "View: Before"}
                            </span>
                        </button>
                    ) : null}
                    <Row label="Step" hint="← / →" />
                    <Row label="Jump" hint="Home / End" />
                    <Row label="Speed" hint="- / +" />
                    {!previewMode ? <Row label="About" hint="?" /> : null}
                </div>
            </HUDCard>
            ) : null}

            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 2 }}>
                        Policy
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            type="button"
                            style={smallBtnStyle}
                            onClick={() => onPolicyStrategyChange?.("greedy")}
                            disabled={policyStatus === "pending" || !greedyStrategyAvailable}
                            data-uf-id="policy-strategy-greedy"
                            data-uf-active={policyStrategy === "greedy" ? "true" : "false"}
                        >
                            Greedy
                        </button>
                        <button
                            type="button"
                            style={smallBtnStyle}
                            onClick={() => onPolicyStrategyChange?.("global")}
                            disabled={policyStatus === "pending" || !globalStrategyAvailable}
                            data-uf-id="policy-strategy-global"
                            data-uf-active={policyStrategy === "global" ? "true" : "false"}
                        >
                            Global
                        </button>
                    </div>
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onRunPolicy}
                        disabled={inspectLocked || policyStatus === "pending"}
                        aria-label="Run optimize preview for current bucket"
                        data-uf-id="policy-run-button"
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }}>
                            {policyStatus === "pending" ? "Computing Preview..." : "Optimize (Preview)"}
                        </span>
                    </button>
                    {previewMode && onTogglePlaybackView ? (
                        <button
                            type="button"
                            style={rowBtnStyle}
                            onClick={onTogglePlaybackView}
                            aria-label="Toggle before and after preview"
                            aria-pressed={playbackView === "after"}
                            data-uf-id="preview-before-after-toggle"
                        >
                            <span style={{ fontSize: 12, opacity: 0.92 }}>
                                {playbackView === "after" ? "View: After" : "View: Before"}
                            </span>
                        </button>
                    ) : null}
                    {canCancelPolicy && onCancelPolicy ? (
                        <button
                            type="button"
                            style={rowBtnStyle}
                            onClick={onCancelPolicy}
                            data-uf-id="policy-cancel"
                            aria-label="Cancel policy run"
                        >
                            <span style={{ fontSize: 12, opacity: 0.92 }}>Cancel Preview</span>
                        </button>
                    ) : null}
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onTogglePolicyImpact}
                        disabled={inspectLocked || (policyMovesCount <= 0 && !policyImpactEnabled)}
                        aria-label="Toggle policy impact overlay"
                        aria-pressed={policyImpactEnabled}
                        data-uf-id="policy-impact-toggle"
                        data-uf-enabled={policyImpactEnabled ? "true" : "false"}
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }}>
                            {policyImpactEnabled ? "Preview Overlay On" : "Preview Overlay Off"}
                        </span>
                    </button>
                    <div
                        style={{
                            fontSize: 11,
                            opacity: 0.88,
                            border: "1px solid rgba(255,255,255,0.16)",
                            borderRadius: 999,
                            padding: "2px 8px",
                            width: "fit-content",
                        }}
                        data-uf-id="policy-status-badge"
                        data-uf-status={policyStatus}
                    >
                        {policyStatusLabel(policyStatus, policyMovesCount)}
                    </div>
                    {showSyncView && onSyncView ? (
                        <button
                            type="button"
                            style={rowBtnStyle}
                            onClick={onSyncView}
                            data-uf-id="policy-sync-view"
                            aria-label="Sync view and rerun optimize"
                        >
                            <span style={{ fontSize: 12, opacity: 0.92 }}>
                                Sync Snapshot
                            </span>
                        </button>
                    ) : null}
                    {policyImpactEnabled && policyImpactSummary ? (
                        <div
                            style={{
                                fontSize: 11,
                                opacity: 0.9,
                                lineHeight: 1.35,
                            }}
                            data-uf-id="policy-impact-summary"
                        >
                            <div data-uf-id="policy-impact-delta">
                                Avg availability {formatSigned(policyImpactSummary.avgDeltaPctPoints)} pts
                            </div>
                            <div data-uf-id="policy-impact-breakdown">
                                Improved {policyImpactSummary.improvedStations} | Worsened {policyImpactSummary.worsenedStations} | Impacted {policyImpactSummary.impactedStations}
                            </div>
                        </div>
                    ) : null}
                    {policySummary ? (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                                fontSize: 11,
                                lineHeight: 1.35,
                                borderTop: "1px solid rgba(255,255,255,0.12)",
                                paddingTop: 8,
                            }}
                            data-uf-id="policy-user-summary"
                        >
                            <div data-uf-id="policy-summary-frozen-time">
                                Frozen at: {policySummary.frozenTimeLabel}
                            </div>
                            <div data-uf-id="policy-summary-strategy">
                                Strategy: {policySummary.strategyLabel}
                            </div>
                            <div data-uf-id="policy-summary-improved">
                                Stations improved: {policySummary.stationsImproved}
                            </div>
                            <div data-uf-id="policy-summary-shortage">
                                Shortage reduced: {policySummary.shortageReducedLabel}
                            </div>
                            <div data-uf-id="policy-summary-moved">
                                Bikes moved: {policySummary.bikesMoved}
                            </div>
                            <div style={{ opacity: 0.8 }} data-uf-id="policy-summary-disclaimer">
                                {policySummary.previewDisclaimer}
                            </div>
                            <details data-uf-id="policy-technical-details">
                                <summary style={{ cursor: "pointer" }}>
                                    Technical details
                                </summary>
                                <div style={{ marginTop: 6, opacity: 0.9, wordBreak: "break-word" }}>
                                    <div>sv: {policySummary.technical.sv}</div>
                                    <div>policy_version: {policySummary.technical.policyVersion}</div>
                                    <div>policy_spec_sha256: {policySummary.technical.policySpecSha256}</div>
                                    <div>decision_bucket_ts: {policySummary.technical.decisionBucketTs}</div>
                                    <div>view_snapshot_id: {policySummary.technical.viewSnapshotId}</div>
                                    <div>view_snapshot_sha256: {policySummary.technical.viewSnapshotSha256}</div>
                                </div>
                                {diagnosticsPayload && onExportDiagnostics ? (
                                    <div style={{ marginTop: 8 }}>
                                        <button
                                            type="button"
                                            style={smallBtnStyle}
                                            onClick={() => {
                                                void handleExportDiagnostics();
                                            }}
                                            data-uf-id="policy-export-diagnostics"
                                            aria-label="Copy diagnostics payload"
                                        >
                                            {diagnosticsCopied ? "Copied" : "Copy Diagnostics"}
                                        </button>
                                    </div>
                                ) : null}
                            </details>
                        </div>
                    ) : null}
                    {policyCompare ? (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                                fontSize: 11,
                                opacity: 0.9,
                                borderTop: "1px solid rgba(255,255,255,0.12)",
                                paddingTop: 8,
                            }}
                            data-uf-id="policy-compare-cards"
                        >
                            <div>
                                Preview Compare: {policyCompare.currentStrategy} vs {policyCompare.previousStrategy}
                            </div>
                            <div>
                                Bikes moved {formatSigned(policyCompare.bikesMovedDelta)}
                            </div>
                            <div>
                                Stations improved {formatSigned(policyCompare.stationsImprovedDelta)}
                            </div>
                        </div>
                    ) : null}
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={() => onToggleReducedMotion?.()}
                        disabled={!onToggleReducedMotion}
                        aria-label="Toggle reduced motion mode"
                        aria-pressed={reducedMotion}
                        data-uf-id="policy-reduced-motion-toggle"
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }}>
                            {reducedMotion ? "Reduced Motion On" : "Reduced Motion Off"}
                        </span>
                    </button>
                    {showDemoModeToggle ? (
                        <button
                            type="button"
                            style={rowBtnStyle}
                            onClick={() => onToggleDemoMode?.()}
                            disabled={!onToggleDemoMode}
                            aria-label="Toggle demo policy data"
                            aria-pressed={demoModeEnabled}
                            data-uf-id="policy-demo-mode-toggle"
                        >
                            <span style={{ fontSize: 12, opacity: 0.92 }}>
                                {demoModeEnabled ? "Demo Policy Data On" : "Demo Policy Data Off"}
                            </span>
                        </button>
                    ) : null}
                </div>
            </HUDCard>

            {!previewMode ? (
            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 2 }}>
                        Layers
                    </div>
                    <label style={toggleStyle}>
                        <input
                            type="checkbox"
                            checked={layers.severity}
                            onChange={() => onToggleLayer("severity")}
                            aria-label="Toggle severity layer"
                            data-uf-id="layer-toggle-severity"
                        />
                        <span>Severity</span>
                    </label>
                    <label style={toggleStyle}>
                        <input
                            type="checkbox"
                            checked={layers.capacity}
                            onChange={() => onToggleLayer("capacity")}
                            aria-label="Toggle capacity layer"
                            data-uf-id="layer-toggle-capacity"
                        />
                        <span>Capacity</span>
                    </label>
                    <label style={toggleStyle}>
                        <input
                            type="checkbox"
                            checked={layers.labels}
                            onChange={() => onToggleLayer("labels")}
                            aria-label="Toggle station labels layer"
                            data-uf-id="layer-toggle-labels"
                        />
                        <span>Stations (labels)</span>
                    </label>
                </div>
            </HUDCard>
            ) : null}

            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 2 }}>
                        Compare
                    </div>
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onToggleCompareMode}
                        disabled={inspectLocked}
                        aria-label="Toggle compare mode"
                        data-uf-id="compare-mode-toggle"
                        data-uf-enabled={compareMode ? "true" : "false"}
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }} data-uf-id="compare-mode-state">
                            {compareMode ? "Compare On" : "Compare Off"}
                        </span>
                    </button>
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onToggleSplitView}
                        disabled={inspectLocked || !compareMode}
                        aria-label="Toggle split view"
                        data-uf-id="compare-split-toggle"
                        data-uf-enabled={splitView ? "true" : "false"}
                    >
                        <span style={{ fontSize: 12, opacity: 0.92 }} data-uf-id="compare-split-state">
                            {splitView ? "Split On" : "Split Off"}
                        </span>
                    </button>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            type="button"
                            style={smallBtnStyle}
                            onClick={onCompareOffsetDown}
                            disabled={inspectLocked}
                            aria-label="Decrease compare offset"
                            data-uf-id="compare-offset-down"
                        >
                            -
                        </button>
                        <div
                            style={{ fontSize: 12, opacity: 0.9, alignSelf: "center" }}
                            data-uf-id="compare-offset-value"
                            data-uf-offset-buckets={String(compareOffsetBuckets)}
                        >
                            Offset {compareOffsetBuckets} buckets
                        </div>
                        <button
                            type="button"
                            style={smallBtnStyle}
                            onClick={onCompareOffsetUp}
                            disabled={inspectLocked}
                            aria-label="Increase compare offset"
                            data-uf-id="compare-offset-up"
                        >
                            +
                        </button>
                    </div>
                </div>
            </HUDCard>
        </>
    );
}

function Row({ label, hint }: { label: string; hint: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12, opacity: 0.92 }}>{label}</span>
            <span>
                <Keycap k={hint} />
            </span>
        </div>
    );
}

function policyStatusLabel(status: Props["policyStatus"], moveCount: number): string {
    if (status === "pending") return "Preview: Computing";
    if (status === "ready") return `Preview: Ready (${moveCount} moves)`;
    if (status === "stale") return "Preview: Stale";
    if (status === "error") return "Preview: Error";
    return "Preview: Idle";
}

function formatSigned(value: number): string {
    if (!Number.isFinite(value)) return "0.0";
    const rounded = Math.round(value * 10) / 10;
    return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

const toggleStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    opacity: 0.92,
};

const rowBtnStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    padding: 0,
    margin: 0,
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
};

const smallBtnStyle: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(230,237,243,0.92)",
    borderRadius: 8,
    padding: "2px 8px",
    cursor: "pointer",
    fontSize: 12,
};

const searchInputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(230,237,243,0.95)",
    borderRadius: 8,
    padding: "6px 8px",
    fontSize: 12,
};

const searchResultsStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: 160,
    overflowY: "auto",
};

const searchResultButtonStyle: React.CSSProperties = {
    textAlign: "left",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(230,237,243,0.92)",
    borderRadius: 8,
    padding: "6px 8px",
    cursor: "pointer",
    fontSize: 12,
};
