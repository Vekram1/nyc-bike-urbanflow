// apps/web/src/components/hud/CommandStack.tsx
"use client";

import { useEffect, useMemo, useState, type KeyboardEventHandler } from "react";

import HUDCard from "./HUDCard";
import Keycap from "./Keycap";
import type { LayerToggles } from "@/lib/hudTypes";

type Props = {
    playing: boolean;
    inspectLocked: boolean;
    systemId: string;
    compareMode: boolean;
    splitView: boolean;
    compareOffsetBuckets: number;
    layers: LayerToggles;
    onTogglePlay: () => void;
    onToggleLayer: (key: keyof LayerToggles) => void;
    onToggleCompareMode: () => void;
    onToggleSplitView: () => void;
    onCompareOffsetDown: () => void;
    onCompareOffsetUp: () => void;
    onSearchPick: (station: { stationKey: string; name: string }) => void;
};

type SearchResult = {
    station_key: string;
    name: string;
};

export default function CommandStack({
    playing,
    inspectLocked,
    systemId,
    compareMode,
    splitView,
    compareOffsetBuckets,
    layers,
    onTogglePlay,
    onToggleLayer,
    onToggleCompareMode,
    onToggleSplitView,
    onCompareOffsetDown,
    onCompareOffsetUp,
    onSearchPick,
}: Props) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const trimmedQuery = query.trim();
    const canSearch = trimmedQuery.length >= 2;

    useEffect(() => {
        if (!canSearch) {
            setResults([]);
            setLoading(false);
            setError(null);
            return;
        }

        const abort = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true);
            setError(null);
            try {
                const url = new URL("/api/search", window.location.origin);
                url.searchParams.set("system_id", systemId);
                url.searchParams.set("q", trimmedQuery);
                url.searchParams.set("limit", "8");
                const res = await fetch(url.toString(), {
                    method: "GET",
                    cache: "no-store",
                    signal: abort.signal,
                });
                const body = (await res.json()) as { results?: SearchResult[]; error?: { message?: string } };
                if (!res.ok) {
                    setResults([]);
                    setError(body.error?.message ?? "Search failed");
                    return;
                }
                setResults(Array.isArray(body.results) ? body.results : []);
            } catch (err) {
                if ((err as { name?: string })?.name === "AbortError") return;
                setResults([]);
                setError("Search request failed");
            } finally {
                setLoading(false);
            }
        }, 180);

        return () => {
            window.clearTimeout(timer);
            abort.abort();
        };
    }, [canSearch, systemId, trimmedQuery]);

    const searchHint = useMemo(() => {
        if (!canSearch) return "Type at least 2 chars";
        if (loading) return "Searching...";
        if (error) return error;
        if (results.length === 0) return "No matches";
        return `${results.length} result${results.length === 1 ? "" : "s"}`;
    }, [canSearch, error, loading, results.length]);

    const handlePick = (item: SearchResult) => {
        onSearchPick({
            stationKey: item.station_key,
            name: item.name,
        });
        setQuery("");
        setResults([]);
        setError(null);
    };

    const onSearchKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
        if (event.key !== "Enter" || results.length === 0) return;
        event.preventDefault();
        handlePick(results[0]);
    };

    return (
        <>
            <HUDCard>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                    {results.length > 0 ? (
                        <div style={searchResultsStyle} data-uf-id="search-results">
                            {results.map((item) => (
                                <button
                                    key={item.station_key}
                                    type="button"
                                    onClick={() => handlePick(item)}
                                    style={searchResultButtonStyle}
                                    data-uf-id={`search-result-${item.station_key}`}
                                >
                                    {item.name}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <button
                        type="button"
                        style={rowBtnStyle}
                        onClick={onTogglePlay}
                        aria-label={playing ? "Pause playback" : "Start playback"}
                        title={playing ? "Pause playback" : "Start playback"}
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
                    <Row label="Step" hint="← / →" />
                    <Row label="Jump" hint="Home / End" />
                    <Row label="Speed" hint="- / +" />
                    <Row label="About" hint="?" />
                </div>
            </HUDCard>

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
