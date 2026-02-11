// apps/web/src/components/map/MapShell.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import HUDRoot from "@/components/hud/HUDRoot";
import ClockChip from "@/components/hud/ClockChip";
import ScrubberBar from "@/components/hud/ScrubberBar";
import CommandStack from "@/components/hud/CommandStack";
import StatsCard from "@/components/hud/StatsCard";
import StationDrawer from "@/components/hud/StationDrawer";
import MapView, { StationPick } from "@/components/map/MapView";
import { useHudControls } from "@/lib/useHudControls";
import { useFps } from "@/lib/useFps";
import { useRollingP95 } from "@/lib/useRollingP95";
import {
    DEFAULT_SYSTEM_ID,
    fetchPolicyConfig,
    fetchTimelineDensity,
    type PolicyMove,
} from "@/lib/controlPlane";
import {
    buildPolicyRunKey,
    buildRenderedViewModel,
    createOptimizationSession,
    deriveEffectivePolicyStatus,
    isActiveSessionRequest,
    runPolicyForView,
    serializePolicyRunKey,
    type OptimizationSession,
    type OptimizeMode,
    type PolicyRunKey,
} from "@/lib/policy";

type UfE2EState = {
    mapShellMounted?: boolean;
    mapShellMountCount?: number;
    mapShellUnmountCount?: number;
    mapShellLastMountTs?: string;
    mapShellLastUnmountTs?: string;
    inspectOpen?: boolean;
    selectedStationId?: string | null;
    timelineBucket?: number;
    compareBucket?: number | null;
    tileRequestKey?: string;
    tileRequestKeyHistory?: string[];
    tileRequestKeyChangeCount?: number;
    tileRequestKeyLastChangedAt?: string;
    invariantViolations?: string[];
    invariantViolationCount?: number;
    lastInvariantViolation?: string;
    lastInvariantViolationAt?: string;
    inspectOpenCount?: number;
    inspectCloseCount?: number;
    inspectCloseReasons?: Record<string, number>;
    inspectOpenedAt?: string;
    inspectClosedAt?: string;
    inspectLastCloseReason?: string;
    inspectLastOpenedStationId?: string;
    inspectLastClosedStationId?: string;
    hotkeyHandledCount?: number;
    hotkeyIgnoredCount?: number;
    hotkeyLastCode?: string;
    hotkeyLastHandledAt?: string;
    hotkeyLastIgnoredAt?: string;
    inspectAnchorTileRequestKey?: string;
    inspectSessionId?: number;
    inspectSessionStartedAt?: string;
    inspectSessionEndedAt?: string;
    inspectAnchorSetAt?: string;
    inspectAnchorClearedAt?: string;
    controlsDisabled?: boolean;
    compareEnabled?: boolean;
    splitEnabled?: boolean;
    layerSeverityEnabled?: boolean;
    layerCapacityEnabled?: boolean;
    layerLabelsEnabled?: boolean;
    compareOffsetBuckets?: number;
    playbackSpeed?: number;
    playing?: boolean;
    mode?: "live" | "replay";
    playbackTsMs?: number;
    policyStatus?: "idle" | "pending" | "ready" | "stale" | "error";
    policyImpactEnabled?: boolean;
    policyMoveCount?: number;
    policyBikesMoved?: number;
    policyLastRunId?: number;
    policyLastError?: string;
    optimizationSessionId?: string;
    optimizationSessionMode?: string;
    optimizationActiveRequestId?: number;
    optimizationPlaybackCursor?: number;
    reducedMotion?: boolean;
    playbackQuality?: PlaybackQuality;
    playbackQualityReason?: string;
    demoPolicyMode?: boolean;
};

type UfE2EActions = {
    openInspect: (stationId?: string) => void;
    closeInspect: (reason?: "drawer_close_button" | "escape_key") => void;
    toggleCompareMode: () => void;
    toggleSplitView: () => void;
    compareOffsetUp: () => void;
    compareOffsetDown: () => void;
};

type PolicyImpactSummary = {
    impactedStations: number;
    improvedStations: number;
    worsenedStations: number;
    avgDeltaPctPoints: number;
};

type PolicyRunStats = {
    strategy: "greedy" | "global";
    bikesMoved: number;
    improvedStations: number;
};

type LocalPolicyStation = {
    station_id: string;
    capacity: number;
    bikes: number;
    docks: number;
};

type ActivePlaybackMove = {
    fromStationKey: string;
    toStationKey: string;
    bikesMoved: number;
    from: [number, number];
    to: [number, number];
    startedAtMs: number;
    durationMs: number;
    routeCoords?: Array<[number, number]>;
};

type DiagnosticsStationDelta = {
    station_key: string;
    delta: number;
};

type DiagnosticsPayload = {
    generated_at: string;
    system_id: string;
    run_key: {
        system_id: string;
        sv_redacted: string;
        decision_bucket_ts: number;
        view_snapshot_id: string;
        view_snapshot_sha256: string;
        policy_version: string;
        policy_spec_sha256: string;
    };
    policy_status: "idle" | "pending" | "ready" | "stale" | "error";
    policy_run_id: number | null;
    policy_moves_count: number;
    policy_bikes_moved: number;
    policy_strategy: "greedy" | "global";
    playback_quality: PlaybackQuality;
    playback_quality_reason: string;
    optimization_session_mode: OptimizationSession["mode"];
    policy_error: string | null;
    top_station_deltas: DiagnosticsStationDelta[];
};

const POLICY_BUCKET_SECONDS = 300;
const PREVIEW_STEP_MS = 180;
const PERFORMANCE_DROP_FPS = 24;

type PlaybackQuality = "full" | "reduced" | "summary";

type PlaybackProfile = {
    quality: PlaybackQuality;
    stepMs: number;
    batchSize: number;
    animateMoveMarker: boolean;
    reason: string;
};

function decidePlaybackProfile(args: {
    moveCount: number;
    reducedMotion: boolean;
    fps: number | null;
}): PlaybackProfile {
    if (args.reducedMotion) {
        return {
            quality: "summary",
            stepMs: PREVIEW_STEP_MS,
            batchSize: args.moveCount,
            animateMoveMarker: false,
            reason: "reduced_motion",
        };
    }
    if (args.moveCount >= 500) {
        return {
            quality: "reduced",
            stepMs: 300,
            batchSize: 4,
            animateMoveMarker: true,
            reason: "move_volume_high",
        };
    }
    if ((args.fps ?? 0) > 0 && (args.fps ?? 0) < PERFORMANCE_DROP_FPS) {
        return {
            quality: "summary",
            stepMs: PREVIEW_STEP_MS,
            batchSize: args.moveCount,
            animateMoveMarker: false,
            reason: "fps_critical",
        };
    }
    if (args.moveCount >= 240 || ((args.fps ?? 0) > 0 && (args.fps ?? 0) < 40)) {
        return {
            quality: "reduced",
            stepMs: 260,
            batchSize: 2,
            animateMoveMarker: true,
            reason: args.moveCount >= 240 ? "move_volume_medium" : "fps_low",
        };
    }
    return {
        quality: "full",
        stepMs: PREVIEW_STEP_MS,
        batchSize: 1,
        animateMoveMarker: true,
        reason: "budget_ok",
    };
}

function redactSvForDiagnostics(sv: string): string {
    if (sv.length <= 8) return sv;
    return `${sv.slice(0, 4)}...${sv.slice(-4)}`;
}

function formatSigned(value: number): string {
    if (!Number.isFinite(value)) return "0.0";
    const rounded = Math.round(value * 10) / 10;
    return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

function toLocalPolicyStations(stations: StationPick[]): LocalPolicyStation[] {
    return stations
        .map((station) => {
            const capacity = Number(station.capacity ?? 0);
            const bikes = Number(station.bikes ?? 0);
            const docks = Number(station.docks ?? 0);
            if (!Number.isFinite(capacity) || capacity <= 0) return null;
            if (!Number.isFinite(bikes) || bikes < 0) return null;
            if (!Number.isFinite(docks) || docks < 0) return null;
            return {
                station_id: station.station_id,
                capacity,
                bikes,
                docks,
            } satisfies LocalPolicyStation;
        })
        .filter((station): station is LocalPolicyStation => station !== null);
}

function computeLocalGreedyFallbackMoves(stations: StationPick[], limit = 200): PolicyMove[] {
    const input = toLocalPolicyStations(stations);
    if (input.length === 0) return [];

    const donors = input
        .map((station) => {
            const softTarget = Math.ceil(station.capacity * 0.6);
            const excess = Math.max(0, station.bikes - softTarget);
            return { station, excess };
        })
        .filter((entry) => entry.excess > 0)
        .sort((a, b) => b.excess - a.excess);

    const receivers = input
        .map((station) => {
            const softFloor = Math.ceil(station.capacity * 0.4);
            const needed = Math.max(0, softFloor - station.bikes);
            return { station, needed };
        })
        .filter((entry) => entry.needed > 0)
        .sort((a, b) => b.needed - a.needed);

    if (donors.length === 0 || receivers.length === 0) return [];

    const moves: PolicyMove[] = [];
    let donorIdx = 0;
    let receiverIdx = 0;

    while (donorIdx < donors.length && receiverIdx < receivers.length && moves.length < limit) {
        const donor = donors[donorIdx];
        const receiver = receivers[receiverIdx];
        const transfer = Math.min(5, donor.excess, receiver.needed);
        if (transfer > 0 && donor.station.station_id !== receiver.station.station_id) {
            moves.push({
                move_rank: moves.length + 1,
                from_station_key: donor.station.station_id,
                to_station_key: receiver.station.station_id,
                bikes_moved: transfer,
                dist_m: 0,
                budget_exhausted: false,
                neighbor_exhausted: false,
                reason_codes: ["local_fallback"],
            });
            donor.excess -= transfer;
            receiver.needed -= transfer;
        } else {
            donor.excess = 0;
            receiver.needed = 0;
        }

        if (donor.excess <= 0) donorIdx += 1;
        if (receiver.needed <= 0) receiverIdx += 1;
    }

    return moves;
}

function computeDemoFixtureMoves(stations: StationPick[]): PolicyMove[] {
    const ordered = [...stations].sort((a, b) => a.station_id.localeCompare(b.station_id));
    if (ordered.length < 4) return [];
    return [
        {
            move_rank: 1,
            from_station_key: ordered[0].station_id,
            to_station_key: ordered[1].station_id,
            bikes_moved: 3,
            dist_m: 240,
            budget_exhausted: false,
            neighbor_exhausted: false,
            reason_codes: ["demo_fixture"],
        },
        {
            move_rank: 2,
            from_station_key: ordered[2].station_id,
            to_station_key: ordered[3].station_id,
            bikes_moved: 2,
            dist_m: 310,
            budget_exhausted: false,
            neighbor_exhausted: false,
            reason_codes: ["demo_fixture"],
        },
    ];
}

function updateUfE2E(update: (current: UfE2EState) => UfE2EState): void {
    if (typeof window === "undefined") return;
    const current = ((window as { __UF_E2E?: UfE2EState }).__UF_E2E ?? {}) as UfE2EState;
    (window as { __UF_E2E?: UfE2EState }).__UF_E2E = update(current);
}

function summarizePolicyImpact(moves: PolicyMove[]): Record<string, number> {
    const next: Record<string, number> = {};
    for (const move of moves) {
        const delta = Number(move.bikes_moved);
        if (!Number.isFinite(delta) || delta <= 0) continue;
        next[move.from_station_key] = (next[move.from_station_key] ?? 0) - delta;
        next[move.to_station_key] = (next[move.to_station_key] ?? 0) + delta;
    }
    return next;
}

function buildStationSnapshotSha(stations: StationPick[]): string {
    // Deterministic lightweight checksum for current rendered station vector.
    const sorted = [...stations].sort((a, b) => a.station_id.localeCompare(b.station_id));
    let acc = 2166136261;
    for (const station of sorted) {
        const bikes = Number(station.bikes ?? 0);
        const docks = Number(station.docks ?? 0);
        const capacity = Number(station.capacity ?? 0);
        const key = `${station.station_id}|${bikes}|${docks}|${capacity}`;
        for (let idx = 0; idx < key.length; idx += 1) {
            acc ^= key.charCodeAt(idx);
            acc = Math.imul(acc, 16777619);
        }
    }
    return `snap-${(acc >>> 0).toString(16).padStart(8, "0")}`;
}

function parseSnapshotBucketFromViewSnapshotId(viewSnapshotId: string): number | null {
    const parts = viewSnapshotId.split(":");
    if (parts.length < 5) return null;
    const parsed = Number(parts[3]);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.floor(parsed);
}

export default function MapShell() {
    const isDevMode = process.env.NODE_ENV !== "production";
    const [selected, setSelected] = useState<StationPick | null>(null);
    const [stationIndex, setStationIndex] = useState<StationPick[]>([]);
    const [stationFeedSnapshot, setStationFeedSnapshot] = useState<{
        viewSnapshotId: string;
        viewSnapshotSha256: string;
    } | null>(null);
    const [densityResponse, setDensityResponse] = useState<{
        sv: string;
        points: Array<{ pct: number; intensity: number }>;
    } | null>(null);
    const [policyVersion, setPolicyVersion] = useState<string>("rebal.greedy.v1");
    const [policyStrategy, setPolicyStrategy] = useState<"greedy" | "global">("greedy");
    const [availablePolicyVersions, setAvailablePolicyVersions] = useState<string[]>([
        "rebal.greedy.v1",
    ]);
    const [policyStatus, setPolicyStatus] = useState<"idle" | "pending" | "ready" | "stale" | "error">("idle");
    const [policyError, setPolicyError] = useState<string | null>(null);
    const [policySyncViewNeeded, setPolicySyncViewNeeded] = useState(false);
    const [policyRunId, setPolicyRunId] = useState<number | null>(null);
    const [policyMovesCount, setPolicyMovesCount] = useState(0);
    const [policyBikesMoved, setPolicyBikesMoved] = useState(0);
    const [policyImpactEnabled, setPolicyImpactEnabled] = useState(false);
    const [policyImpactByStation, setPolicyImpactByStation] = useState<Record<string, number>>({});
    const [playbackView, setPlaybackView] = useState<"before" | "after">("after");
    const [demoPolicyMode, setDemoPolicyMode] = useState(false);
    const [activePlaybackMove, setActivePlaybackMove] = useState<ActivePlaybackMove | null>(null);
    const [policySpecSha256, setPolicySpecSha256] = useState<string>("unknown");
    const [latestRunStats, setLatestRunStats] = useState<PolicyRunStats | null>(null);
    const [previousRunStats, setPreviousRunStats] = useState<PolicyRunStats | null>(null);
    const [policyReadyRunKeySerialized, setPolicyReadyRunKeySerialized] = useState<string | null>(null);
    const [previewPhase, setPreviewPhase] = useState<"idle" | "frozen" | "computing" | "playback">("idle");
    const [optimizationSession, setOptimizationSession] =
        useState<OptimizationSession>(createOptimizationSession);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const [reducedMotionOverride, setReducedMotionOverride] = useState<boolean | null>(null);
    const [a11yAnnouncement, setA11yAnnouncement] = useState("");
    const [playbackQuality, setPlaybackQuality] = useState<PlaybackQuality>("full");
    const [playbackQualityReason, setPlaybackQualityReason] = useState("budget_ok");
    const lastDrawerStationRef = useRef<string | null>(null);
    const previewTimerRef = useRef<number | null>(null);
    const policyAbortRef = useRef<AbortController | null>(null);
    const nextPolicyRequestIdRef = useRef(0);
    const optimizationSessionRef = useRef<OptimizationSession>(optimizationSession);
    const fpsRef = useRef<number | null>(null);
    const hud = useHudControls();
    const fps = useFps();
    const { p95: tileP95, spark, pushSample } = useRollingP95({ windowMs: 15_000 });
    const inspectAnchorTileKeyRef = useRef<string | null>(null);
    const inspectSessionIdRef = useRef(0);
    const [inspectLockRunContext, setInspectLockRunContext] = useState<{
        decisionBucketTs: number;
        viewSnapshotId: string;
        viewSnapshotSha256: string;
    } | null>(null);
    const stationIndexRef = useRef<StationPick[]>(stationIndex);
    const osrmRouteCacheRef = useRef<Map<string, Array<[number, number]>>>(new Map());
    const reducedMotion =
        reducedMotionOverride === null ? prefersReducedMotion : reducedMotionOverride;
    useEffect(() => {
        optimizationSessionRef.current = optimizationSession;
    }, [optimizationSession]);
    useEffect(() => {
        if (typeof window === "undefined") return;
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const applyMedia = () => {
            setPrefersReducedMotion(media.matches);
        };
        applyMedia();
        media.addEventListener("change", applyMedia);
        return () => {
            media.removeEventListener("change", applyMedia);
        };
    }, []);
    useEffect(() => {
        stationIndexRef.current = stationIndex;
    }, [stationIndex]);
    useEffect(() => {
        fpsRef.current = fps;
    }, [fps]);

    // “Inspect lock” v0: freeze live GBFS updates while drawer open
    const inspectOpen = !!selected;
    const timelineDisplayTimeMs =
        hud.mode === "live" && hud.playing ? hud.serverNowMs : hud.playbackTsMs;
    const timelineBucket = Math.floor(timelineDisplayTimeMs / 1000);
    const decisionBucketTs = Math.floor(timelineBucket / POLICY_BUCKET_SECONDS) * POLICY_BUCKET_SECONDS;
    const compareBucket = hud.compareMode
        ? Math.max(0, timelineBucket - hud.compareOffsetBuckets * 300)
        : null;
    const optimizeMode: OptimizeMode =
        previewPhase === "playback"
            ? "playback"
            : policyStatus === "pending" || previewPhase === "computing"
            ? "computing"
            : hud.mode === "live" && hud.playing && !inspectOpen
              ? "live"
              : "frozen";
    const stationSnapshotSha = useMemo(() => buildStationSnapshotSha(stationIndex), [stationIndex]);
    const currentRunKey = useMemo<PolicyRunKey>(() => {
        const lockedContext = hud.inspectLocked ? inspectLockRunContext : null;
        const renderedViewModel = buildRenderedViewModel({
            systemId: DEFAULT_SYSTEM_ID,
            sv: hud.sv,
            displayTimeMs: timelineDisplayTimeMs,
            bucketSizeSeconds: POLICY_BUCKET_SECONDS,
            viewSnapshotId:
                lockedContext?.viewSnapshotId ??
                stationFeedSnapshot?.viewSnapshotId ??
                `${hud.sv}:${decisionBucketTs}:${stationIndex.length}`,
            viewSnapshotSha256:
                lockedContext?.viewSnapshotSha256 ??
                stationFeedSnapshot?.viewSnapshotSha256 ??
                stationSnapshotSha,
            mode: optimizeMode,
        });
        const runKey = buildPolicyRunKey({
            renderedView: renderedViewModel,
            policyVersion,
            policySpecSha256,
        });
        if (lockedContext) {
            return {
                ...runKey,
                decisionBucketTs: lockedContext.decisionBucketTs,
            };
        }
        return runKey;
    }, [
        decisionBucketTs,
        inspectLockRunContext,
        hud.inspectLocked,
        hud.sv,
        optimizeMode,
        policySpecSha256,
        policyVersion,
        stationFeedSnapshot,
        stationIndex.length,
        stationSnapshotSha,
        timelineDisplayTimeMs,
    ]);
    const activeRunKey = useMemo<PolicyRunKey>(() => {
        if (optimizationSession.mode !== "live" && optimizationSession.frozenRunKey) {
            return optimizationSession.frozenRunKey;
        }
        return currentRunKey;
    }, [currentRunKey, optimizationSession.frozenRunKey, optimizationSession.mode]);
    const activeRunKeySerialized = useMemo(
        () => serializePolicyRunKey(activeRunKey),
        [activeRunKey]
    );
    const effectivePolicyStatus = deriveEffectivePolicyStatus({
        policyStatus,
        policyReadyRunKeySerialized,
        currentRunKeySerialized: activeRunKeySerialized,
    });
    const effectivePolicyImpactEnabled =
        policyImpactEnabled && effectivePolicyStatus === "ready" && playbackView === "after";
    const progressLabel = `${hud.mode === "live" ? "Live" : "Replay"} ${Math.round(hud.progress * 100)}%`;
    const searchStations = stationIndex.map((station) => ({
        stationKey: station.station_id,
        name: station.name,
    }));
    const handleTileFetchSample = useCallback(
        (latencyMs: number) => {
            pushSample(latencyMs);
        },
        [pushSample]
    );
    const stats = useMemo(() => {
        let empty = 0;
        let full = 0;
        for (const station of stationIndex) {
            if (typeof station.bikes === "number" && station.bikes <= 0) {
                empty += 1;
            }
            if (typeof station.docks === "number" && station.docks <= 0) {
                full += 1;
            }
        }
        return {
            activeStations: stationIndex.length,
            empty,
            full,
        };
    }, [stationIndex]);
    const policyImpactSummary = useMemo<PolicyImpactSummary | null>(() => {
        if (!effectivePolicyImpactEnabled || Object.keys(policyImpactByStation).length === 0) {
            return null;
        }

        let impactedStations = 0;
        let improvedStations = 0;
        let worsenedStations = 0;
        let sumCurrent = 0;
        let sumProjected = 0;

        for (const station of stationIndex) {
            const delta = Number(policyImpactByStation[station.station_id] ?? 0);
            if (!Number.isFinite(delta) || delta === 0) continue;

            const bikes = Number(station.bikes ?? 0);
            const docks = Number(station.docks ?? 0);
            const capacity = Number(station.capacity ?? 0);
            const fallbackSlots = Math.max(0, bikes + docks);
            const totalSlots = Number.isFinite(capacity) && capacity > 0 ? capacity : fallbackSlots;
            if (!Number.isFinite(totalSlots) || totalSlots <= 0) continue;

            const currentRatio = Math.max(0, Math.min(1, bikes / totalSlots));
            const projectedRatio = Math.max(0, Math.min(1, (bikes + delta) / totalSlots));
            const ratioDelta = projectedRatio - currentRatio;

            impactedStations += 1;
            if (ratioDelta > 0) improvedStations += 1;
            if (ratioDelta < 0) worsenedStations += 1;
            sumCurrent += currentRatio;
            sumProjected += projectedRatio;
        }

        if (impactedStations <= 0) return null;
        return {
            impactedStations,
            improvedStations,
            worsenedStations,
            avgDeltaPctPoints: ((sumProjected - sumCurrent) / impactedStations) * 100,
        };
    }, [effectivePolicyImpactEnabled, policyImpactByStation, stationIndex]);
    const policySummary = useMemo(() => {
        if (effectivePolicyStatus !== "ready") return null;
        const strategyLabel = policyVersion.includes("global")
            ? "Global"
            : "Greedy";
        const frozenTimeLabel = new Date(decisionBucketTs * 1000).toLocaleString();
        const stationsImproved = policyImpactSummary?.improvedStations ?? 0;
        const shortageReducedLabel =
            policyImpactSummary && Number.isFinite(policyImpactSummary.avgDeltaPctPoints)
                ? `${formatSigned(policyImpactSummary.avgDeltaPctPoints)} pts`
                : "n/a";
        return {
            frozenTimeLabel,
            strategyLabel,
            stationsImproved,
            shortageReducedLabel,
            bikesMoved: policyBikesMoved,
            previewDisclaimer: "Preview only: this simulation does not dispatch bikes in the live system.",
            technical: {
                sv: activeRunKey.sv,
                policyVersion,
                policySpecSha256,
                decisionBucketTs: activeRunKey.decisionBucketTs,
                viewSnapshotId: activeRunKey.viewSnapshotId,
                viewSnapshotSha256: activeRunKey.viewSnapshotSha256,
            },
        };
    }, [
        activeRunKey.decisionBucketTs,
        activeRunKey.sv,
        activeRunKey.viewSnapshotId,
        activeRunKey.viewSnapshotSha256,
        decisionBucketTs,
        effectivePolicyStatus,
        policyBikesMoved,
        policyImpactSummary,
        policySpecSha256,
        policyVersion,
    ]);
    const policyCompare = useMemo(() => {
        if (!latestRunStats || !previousRunStats) return null;
        return {
            currentStrategy: latestRunStats.strategy === "global" ? "Global" : "Greedy",
            previousStrategy: previousRunStats.strategy === "global" ? "Global" : "Greedy",
            bikesMovedDelta: latestRunStats.bikesMoved - previousRunStats.bikesMoved,
            stationsImprovedDelta:
                latestRunStats.improvedStations - previousRunStats.improvedStations,
        };
    }, [latestRunStats, previousRunStats]);
    const previewFrozenLabel = useMemo(
        () => new Date(activeRunKey.decisionBucketTs * 1000).toLocaleString(),
        [activeRunKey.decisionBucketTs]
    );
    const diagnosticsPayload = useMemo<DiagnosticsPayload>(() => {
        const topStationDeltas = Object.entries(policyImpactByStation)
            .map(([stationKey, delta]) => ({
                station_key: stationKey,
                delta: Number(delta),
            }))
            .filter((entry) => Number.isFinite(entry.delta) && entry.delta !== 0)
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 12);
        return {
            generated_at: new Date().toISOString(),
            system_id: activeRunKey.systemId,
            run_key: {
                system_id: activeRunKey.systemId,
                sv_redacted: redactSvForDiagnostics(activeRunKey.sv),
                decision_bucket_ts: activeRunKey.decisionBucketTs,
                view_snapshot_id: activeRunKey.viewSnapshotId,
                view_snapshot_sha256: activeRunKey.viewSnapshotSha256,
                policy_version: activeRunKey.policyVersion,
                policy_spec_sha256: activeRunKey.policySpecSha256,
            },
            policy_status: effectivePolicyStatus,
            policy_run_id: policyRunId,
            policy_moves_count: policyMovesCount,
            policy_bikes_moved: policyBikesMoved,
            policy_strategy: policyStrategy,
            playback_quality: playbackQuality,
            playback_quality_reason: playbackQualityReason,
            optimization_session_mode: optimizationSession.mode,
            policy_error: policyError,
            top_station_deltas: topStationDeltas,
        };
    }, [
        activeRunKey,
        effectivePolicyStatus,
        optimizationSession.mode,
        playbackQuality,
        playbackQualityReason,
        policyBikesMoved,
        policyError,
        policyImpactByStation,
        policyMovesCount,
        policyRunId,
        policyStrategy,
    ]);
    const diagnosticsPayloadText = useMemo(
        () => JSON.stringify(diagnosticsPayload, null, 2),
        [diagnosticsPayload]
    );
    const availablePolicyStrategies = useMemo<Array<"greedy" | "global">>(() => {
        const next = new Set<"greedy" | "global">();
        for (const version of availablePolicyVersions) {
            next.add(version.includes("global") ? "global" : "greedy");
        }
        if (next.size === 0) next.add("greedy");
        return Array.from(next);
    }, [availablePolicyVersions]);
    const handleExportDiagnostics = useCallback(async (): Promise<boolean> => {
        try {
            await navigator.clipboard.writeText(diagnosticsPayloadText);
            return true;
        } catch {
            return false;
        }
    }, [diagnosticsPayloadText]);
    useEffect(() => {
        if (policyStatus === "pending") {
            setA11yAnnouncement("Optimization started. Computing preview on frozen data.");
            return;
        }
        if (optimizationSession.mode === "playback") {
            if (playbackQuality === "reduced") {
                setA11yAnnouncement("Optimization complete. Playback started in reduced quality mode.");
                return;
            }
            if (playbackQuality === "summary") {
                setA11yAnnouncement("Optimization complete. Using summary mode for performance.");
                return;
            }
            setA11yAnnouncement("Optimization complete. Playback started.");
            return;
        }
        if (policyStatus === "ready" && optimizationSession.mode === "frozen") {
            setA11yAnnouncement(
                reducedMotion
                    ? "Optimization complete. Summary is ready with reduced motion."
                    : "Optimization complete. Preview is ready."
            );
            return;
        }
        if (policyStatus === "error" && policyError) {
            setA11yAnnouncement(`Optimization failed. ${policyError}`);
        }
    }, [optimizationSession.mode, playbackQuality, policyError, policyStatus, reducedMotion]);

    useEffect(() => {
        let cancelled = false;
        const loadPolicyConfig = async () => {
            try {
                const out = await fetchPolicyConfig();
                if (cancelled) return;
                const versions =
                    out.available_policy_versions.length > 0
                        ? out.available_policy_versions
                        : [out.default_policy_version];
                setAvailablePolicyVersions(versions);
                if (out.default_policy_version?.length > 0) {
                    setPolicyVersion(out.default_policy_version);
                    setPolicyStrategy(
                        out.default_policy_version.includes("global") ? "global" : "greedy"
                    );
                    return;
                }
                const fallbackVersion = versions[0] ?? "rebal.greedy.v1";
                setPolicyVersion(fallbackVersion);
                setPolicyStrategy(fallbackVersion.includes("global") ? "global" : "greedy");
            } catch {
                if (cancelled) return;
            }
        };
        loadPolicyConfig();
        return () => {
            cancelled = true;
        };
    }, []);
    const handlePolicyStrategyChange = useCallback(
        (strategy: "greedy" | "global") => {
            const matchingVersion = availablePolicyVersions.find((version) =>
                strategy === "global"
                    ? version.includes("global")
                    : !version.includes("global")
            );
            if (!matchingVersion) return;
            setPolicyStrategy(strategy);
            setPolicyVersion(matchingVersion);
        },
        [availablePolicyVersions]
    );

    const applyPolicyMoves = useCallback(
        (
            moves: PolicyMove[],
            args: {
                runId: number | null;
                policySpecSha: string;
                runKeySerialized: string;
                error: string | null;
                animate: boolean;
            }
        ) => {
            const impact = summarizePolicyImpact(moves);
            const bikesMoved = moves.reduce((sum, move) => sum + Math.max(0, Math.round(move.bikes_moved)), 0);
            const improvedStations = Object.values(impact).filter((delta) => delta > 0).length;
            setPreviousRunStats(latestRunStats);
            setLatestRunStats({
                strategy: policyStrategy,
                bikesMoved,
                improvedStations,
            });
            setPolicyRunId(args.runId);
            setPolicyMovesCount(moves.length);
            setPolicyBikesMoved(bikesMoved);
            setPolicySpecSha256(args.policySpecSha);
            setOptimizationSession((session) => {
                if (!session.frozenRunKey) {
                    return session;
                }
                if (session.frozenRunKey.policySpecSha256 === args.policySpecSha) {
                    return session;
                }
                return {
                    ...session,
                    frozenRunKey: {
                        ...session.frozenRunKey,
                        policySpecSha256: args.policySpecSha,
                    },
                };
            });
            setPolicyReadyRunKeySerialized(args.runKeySerialized);
            setPolicyStatus("ready");
            setPolicyError(
                args.error ??
                    (moves.length <= 0
                        ? "No bike moves recommended for this snapshot."
                        : null)
            );
            if (previewTimerRef.current !== null) {
                window.clearInterval(previewTimerRef.current);
                previewTimerRef.current = null;
            }
            const profile = decidePlaybackProfile({
                moveCount: moves.length,
                reducedMotion,
                fps: fpsRef.current,
            });
            setPlaybackQuality(profile.quality);
            setPlaybackQualityReason(profile.reason);

            if (!args.animate || profile.quality === "summary" || moves.length <= 0) {
                setPolicyImpactByStation(impact);
                setPolicyImpactEnabled(moves.length > 0);
                setActivePlaybackMove(null);
                setPreviewPhase("frozen");
                setOptimizationSession((session) => ({
                    ...session,
                    mode: "frozen",
                    activeRequestId: null,
                    playbackCursor: moves.length,
                }));
                return;
            }

            setPolicyImpactEnabled(true);
            setPlaybackView("after");
            setPolicyImpactByStation({});
            setPreviewPhase("playback");
            setOptimizationSession((session) => ({
                ...session,
                mode: "playback",
                playbackCursor: 0,
            }));
            const ordered = [...moves].sort((a, b) => a.move_rank - b.move_rank);
            const nextImpact: Record<string, number> = {};
            let idx = 0;
            let lowFpsStreak = 0;
            previewTimerRef.current = window.setInterval(() => {
                const currentFps = fpsRef.current;
                if ((currentFps ?? 0) > 0 && (currentFps ?? 0) < PERFORMANCE_DROP_FPS) {
                    lowFpsStreak += 1;
                } else {
                    lowFpsStreak = 0;
                }
                if (profile.quality === "full" && lowFpsStreak >= 3) {
                    setPlaybackQuality("reduced");
                    setPlaybackQualityReason("midplay_fps_drop");
                    setActivePlaybackMove(null);
                    profile.quality = "reduced";
                    profile.batchSize = 3;
                    profile.animateMoveMarker = false;
                }
                if (profile.quality === "reduced" && lowFpsStreak >= 6) {
                    setPlaybackQuality("summary");
                    setPlaybackQualityReason("midplay_fps_critical");
                    const remaining = ordered.slice(idx);
                    for (const move of remaining) {
                        const delta = Number(move.bikes_moved);
                        if (!Number.isFinite(delta) || delta <= 0) continue;
                        nextImpact[move.from_station_key] = (nextImpact[move.from_station_key] ?? 0) - delta;
                        nextImpact[move.to_station_key] = (nextImpact[move.to_station_key] ?? 0) + delta;
                    }
                    setPolicyImpactByStation({ ...nextImpact });
                    if (previewTimerRef.current !== null) {
                        window.clearInterval(previewTimerRef.current);
                        previewTimerRef.current = null;
                    }
                    setPreviewPhase("frozen");
                    setOptimizationSession((session) => ({
                        ...session,
                        mode: "frozen",
                        activeRequestId: null,
                        playbackCursor: ordered.length,
                    }));
                    setActivePlaybackMove(null);
                    return;
                }

                const batchEnd = Math.min(idx + profile.batchSize, ordered.length);
                if (idx >= ordered.length) {
                    if (previewTimerRef.current !== null) {
                        window.clearInterval(previewTimerRef.current);
                        previewTimerRef.current = null;
                    }
                    setPreviewPhase("frozen");
                    setOptimizationSession((session) => ({
                        ...session,
                        mode: "frozen",
                        activeRequestId: null,
                        playbackCursor: ordered.length,
                    }));
                    setActivePlaybackMove(null);
                    return;
                }
                const firstMove = ordered[idx];
                if (profile.animateMoveMarker && firstMove) {
                    const currentStations = stationIndexRef.current;
                    const fromStation = currentStations.find((station) => station.station_id === firstMove.from_station_key);
                    const toStation = currentStations.find((station) => station.station_id === firstMove.to_station_key);
                    if (
                        fromStation &&
                        toStation &&
                        Number.isFinite(fromStation.lon) &&
                        Number.isFinite(fromStation.lat) &&
                        Number.isFinite(toStation.lon) &&
                        Number.isFinite(toStation.lat)
                    ) {
                        const from = [fromStation.lon as number, fromStation.lat as number] as [number, number];
                        const to = [toStation.lon as number, toStation.lat as number] as [number, number];
                        const routeKey = `${from[0]},${from[1]}|${to[0]},${to[1]}`;
                        const cachedRoute = osrmRouteCacheRef.current.get(routeKey);
                        setActivePlaybackMove({
                            fromStationKey: firstMove.from_station_key,
                            toStationKey: firstMove.to_station_key,
                            bikesMoved: Math.max(0, Math.round(firstMove.bikes_moved)),
                            from,
                            to,
                            startedAtMs: performance.now(),
                            durationMs: Math.max(180, profile.stepMs - 20),
                            routeCoords: cachedRoute,
                        });
                        if (!cachedRoute) {
                            fetch(
                                `/api/osrm/route?from=${encodeURIComponent(`${from[0]},${from[1]}`)}&to=${encodeURIComponent(`${to[0]},${to[1]}`)}`,
                                { cache: "force-cache" }
                            )
                                .then((res) => res.json().catch(() => null))
                                .then((body) => {
                                    const route = (body as { route?: unknown } | null)?.route;
                                    if (!Array.isArray(route) || route.length < 2) return;
                                    const parsed = route
                                        .map((coord) => {
                                            if (!Array.isArray(coord) || coord.length < 2) return null;
                                            const lon = Number(coord[0]);
                                            const lat = Number(coord[1]);
                                            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
                                            return [lon, lat] as [number, number];
                                        })
                                        .filter((coord): coord is [number, number] => coord !== null);
                                    if (parsed.length < 2) return;
                                    osrmRouteCacheRef.current.set(routeKey, parsed);
                                    setActivePlaybackMove((current) =>
                                        current &&
                                        current.fromStationKey === firstMove.from_station_key &&
                                        current.toStationKey === firstMove.to_station_key
                                            ? { ...current, routeCoords: parsed }
                                            : current
                                    );
                                })
                                .catch(() => {
                                    // Best-effort route enrichment only.
                                });
                        }
                    } else {
                        setActivePlaybackMove(null);
                    }
                } else {
                    setActivePlaybackMove(null);
                }
                for (let current = idx; current < batchEnd; current += 1) {
                    const move = ordered[current];
                    const delta = Number(move.bikes_moved);
                    if (!Number.isFinite(delta) || delta <= 0) continue;
                    nextImpact[move.from_station_key] = (nextImpact[move.from_station_key] ?? 0) - delta;
                    nextImpact[move.to_station_key] = (nextImpact[move.to_station_key] ?? 0) + delta;
                }
                setPolicyImpactByStation({ ...nextImpact });
                setOptimizationSession((session) => ({
                    ...session,
                    playbackCursor: batchEnd,
                }));
                idx = batchEnd;
            }, profile.stepMs);
        },
        [latestRunStats, policyStrategy, reducedMotion]
    );

    useEffect(() => {
        return () => {
            if (previewTimerRef.current !== null) {
                window.clearInterval(previewTimerRef.current);
                previewTimerRef.current = null;
            }
        };
    }, []);

    const runPolicy = useCallback(async () => {
        if (policyAbortRef.current) {
            policyAbortRef.current.abort();
            policyAbortRef.current = null;
        }
        const abortController = new AbortController();
        policyAbortRef.current = abortController;
        if (previewTimerRef.current !== null) {
            window.clearInterval(previewTimerRef.current);
            previewTimerRef.current = null;
        }
        const requestId = nextPolicyRequestIdRef.current + 1;
        nextPolicyRequestIdRef.current = requestId;
        const sessionId = `session-${Date.now()}-${requestId}`;
        const frozenRunKey = currentRunKey;
        const frozenRunKeySerialized = serializePolicyRunKey(frozenRunKey);
        setOptimizationSession({
            sessionId,
            mode: "computing",
            frozenRunKey,
            activeRequestId: requestId,
            playbackCursor: 0,
        });
        hud.seekTo(hud.progress);
        setPreviewPhase("computing");
        setPolicyStatus("pending");
        setPolicyError(null);
        setPolicySyncViewNeeded(false);
        setPlaybackQuality("full");
        setPlaybackQualityReason("pending");
        const requestRunKeySerialized = frozenRunKeySerialized;
        const requestPolicySpecSha = policySpecSha256;
        const canUseBackend = hud.sv && !hud.sv.startsWith("sv:local-");
        const snapshotBucketTs = parseSnapshotBucketFromViewSnapshotId(
            frozenRunKey.viewSnapshotId
        );
        const snapshotMatchesDecisionBucket =
            snapshotBucketTs !== null &&
            snapshotBucketTs === frozenRunKey.decisionBucketTs;
        const hasServerSnapshotPrecondition =
            frozenRunKey.viewSnapshotId.startsWith("vs:") &&
            frozenRunKey.viewSnapshotSha256.length === 64 &&
            snapshotMatchesDecisionBucket;
        try {
            if (isDevMode && demoPolicyMode) {
                const demoMoves = computeDemoFixtureMoves(stationIndex);
                const activeSession = optimizationSessionRef.current;
                if (!isActiveSessionRequest(activeSession, sessionId, requestId)) return;
                applyPolicyMoves(demoMoves, {
                    runId: null,
                    policySpecSha: requestPolicySpecSha,
                    runKeySerialized: requestRunKeySerialized,
                    error: "Using demo fixture preview data (dev mode)",
                    animate: true,
                });
                return;
            }
            try {
                if (canUseBackend) {
                    const result = await Promise.race([
                        runPolicyForView({
                            runKey: frozenRunKey,
                            maxAttempts: 8,
                            topN: 500,
                            includeSnapshotPrecondition: hasServerSnapshotPrecondition,
                            signal: abortController.signal,
                        }),
                        new Promise<never>((_, reject) => {
                            window.setTimeout(() => {
                                reject(new Error("policy_run_timeout"));
                            }, 15000);
                        }),
                    ]);
                    if (result.status === "ready") {
                        const activeSession = optimizationSessionRef.current;
                        if (!isActiveSessionRequest(activeSession, sessionId, requestId)) return;
                        const readyRunKeySerialized = serializePolicyRunKey({
                            ...frozenRunKey,
                            policySpecSha256: result.policySpecSha256,
                        });
                        applyPolicyMoves(result.moves, {
                            runId: result.runId,
                            policySpecSha: result.policySpecSha256,
                            runKeySerialized: readyRunKeySerialized,
                            error: null,
                            animate: true,
                        });
                        return;
                    }
                    const activeSession = optimizationSessionRef.current;
                    if (!isActiveSessionRequest(activeSession, sessionId, requestId)) return;
                    const fallbackMoves = computeLocalGreedyFallbackMoves(stationIndex, 200);
                    applyPolicyMoves(fallbackMoves, {
                        runId: null,
                        policySpecSha: requestPolicySpecSha,
                        runKeySerialized: requestRunKeySerialized,
                        error: "Backend policy still computing. Showing local preview fallback.",
                        animate: true,
                    });
                    return;
                }
            } catch (error: unknown) {
                if (abortController.signal.aborted) {
                    setPolicyStatus("idle");
                    setPolicyError(null);
                    setPreviewPhase("frozen");
                    setOptimizationSession((session) => ({
                        ...session,
                        mode: "frozen",
                        activeRequestId: null,
                    }));
                    return;
                }
                if (canUseBackend) {
                    const activeSession = optimizationSessionRef.current;
                    if (!isActiveSessionRequest(activeSession, sessionId, requestId)) return;
                    const message =
                        error instanceof Error && error.message.length > 0
                            ? error.message
                            : "Policy run failed";
                    setPolicyStatus("error");
                    if (message === "view_snapshot_mismatch") {
                        setPolicyError("The map view changed while optimizing. Sync to the frozen view and try again.");
                        setPolicySyncViewNeeded(true);
                        setPreviewPhase("frozen");
                        setOptimizationSession((session) => ({
                            ...session,
                            mode: "error",
                            activeRequestId: null,
                        }));
                        return;
                    } else if (message === "policy_run_timeout") {
                        const fallbackMoves = computeLocalGreedyFallbackMoves(stationIndex, 200);
                        applyPolicyMoves(fallbackMoves, {
                            runId: null,
                            policySpecSha: requestPolicySpecSha,
                            runKeySerialized: requestRunKeySerialized,
                            error: "Backend policy timed out. Showing local preview fallback.",
                            animate: true,
                        });
                        return;
                    } else {
                        const fallbackMoves = computeLocalGreedyFallbackMoves(stationIndex, 200);
                        applyPolicyMoves(fallbackMoves, {
                            runId: null,
                            policySpecSha: requestPolicySpecSha,
                            runKeySerialized: requestRunKeySerialized,
                            error: `Backend policy failed (${message}). Showing local preview fallback.`,
                            animate: true,
                        });
                        return;
                    }
                }
            }

            const fallbackMoves = computeLocalGreedyFallbackMoves(stationIndex, 200);
            const activeSession = optimizationSessionRef.current;
            if (!isActiveSessionRequest(activeSession, sessionId, requestId)) return;
            applyPolicyMoves(fallbackMoves, {
                runId: null,
                policySpecSha: requestPolicySpecSha,
                runKeySerialized: requestRunKeySerialized,
                error: "Using local fallback (backend policy worker unavailable or pending)",
                animate: true,
            });
        } finally {
            if (policyAbortRef.current === abortController) {
                policyAbortRef.current = null;
            }
        }
    }, [
        applyPolicyMoves,
        currentRunKey,
        demoPolicyMode,
        hud,
        isDevMode,
        policySpecSha256,
        stationIndex,
    ]);

    const handleRunPolicy = useCallback(() => {
        runPolicy().catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Policy run failed";
            setPolicyStatus("error");
            setPolicyError(message);
            setPolicySyncViewNeeded(false);
        });
    }, [runPolicy]);
    const handleSyncView = useCallback(() => {
        setPolicySyncViewNeeded(false);
        runPolicy().catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Policy run failed";
            setPolicyStatus("error");
            setPolicyError(message);
        });
    }, [runPolicy]);

    const handleTogglePolicyImpact = useCallback(() => {
        setPolicyImpactEnabled((current) => !current);
    }, []);
    const handleCancelPolicy = useCallback(() => {
        if (policyAbortRef.current) {
            policyAbortRef.current.abort();
            policyAbortRef.current = null;
        }
        if (previewTimerRef.current !== null) {
            window.clearInterval(previewTimerRef.current);
            previewTimerRef.current = null;
        }
        setPolicyStatus("idle");
        setPolicyError(null);
        setPolicySyncViewNeeded(false);
        setPreviewPhase("frozen");
        setActivePlaybackMove(null);
        setOptimizationSession((session) => ({
            ...session,
            mode: "frozen",
            activeRequestId: null,
        }));
    }, []);
    const handleGoLive = useCallback(() => {
        if (previewTimerRef.current !== null) {
            window.clearInterval(previewTimerRef.current);
            previewTimerRef.current = null;
        }
        setActivePlaybackMove(null);
        setPreviewPhase("idle");
        setOptimizationSession((session) => ({
            ...session,
            mode: "live",
            frozenRunKey: null,
            activeRequestId: null,
            playbackCursor: 0,
        }));
        hud.goLive();
    }, [hud]);
    const handleExitPreview = useCallback(() => {
        if (policyAbortRef.current) {
            policyAbortRef.current.abort();
            policyAbortRef.current = null;
        }
        if (previewTimerRef.current !== null) {
            window.clearInterval(previewTimerRef.current);
            previewTimerRef.current = null;
        }
        setSelected(null);
        hud.onInspectClose();
        setInspectLockRunContext(null);
        setPolicyStatus("idle");
        setPolicyError(null);
        setPolicySyncViewNeeded(false);
        setPolicyImpactEnabled(false);
        setActivePlaybackMove(null);
        setPreviewPhase("idle");
        setOptimizationSession((session) => ({
            ...session,
            mode: "live",
            frozenRunKey: null,
            activeRequestId: null,
            playbackCursor: 0,
        }));
        hud.goLive();
    }, [hud]);
    const handleTogglePlaybackView = useCallback(() => {
        setPlaybackView((current) => (current === "after" ? "before" : "after"));
    }, []);
    const goLiveAction = optimizationSession.mode !== "live" ? handleExitPreview : handleGoLive;

    useEffect(() => {
        if (!hud.sv || hud.sv.startsWith("sv:local-")) return;

        let cancelled = false;

        const loadDensity = async () => {
            try {
                const out = await fetchTimelineDensity({ sv: hud.sv, bucketSeconds: 300 });
                if (cancelled) return;

                const rangeStart = hud.rangeMinMs;
                const rangeEnd = Math.max(hud.rangeMinMs + 1, hud.rangeMaxMs);
                const span = Math.max(1, rangeEnd - rangeStart);
                const next = out.points
                    .map((point): { pct: number; intensity: number } | null => {
                        const pointMs = Date.parse(point.bucket_ts);
                        if (!Number.isFinite(pointMs)) return null;
                        const pctRaw = (pointMs - rangeStart) / span;
                        if (pctRaw < 0 || pctRaw > 1) return null;
                        const risk = Math.max(0, Math.min(1, 1 - point.pct_serving_grade));
                        const pressure = Math.max(point.empty_rate, point.full_rate);
                        const intensity = Math.max(0, Math.min(1, risk * 0.6 + pressure * 0.4));
                        return { pct: pctRaw, intensity };
                    })
                    .filter((mark): mark is { pct: number; intensity: number } => mark !== null)
                    .sort((a, b) => a.pct - b.pct);

                if (next.length > 120) {
                    const step = Math.ceil(next.length / 120);
                    setDensityResponse({
                        sv: hud.sv,
                        points: next.filter((_, idx) => idx % step === 0),
                    });
                    return;
                }
                setDensityResponse({ sv: hud.sv, points: next });
            } catch {
                if (cancelled) return;
                setDensityResponse({ sv: hud.sv, points: [] });
            }
        };

        loadDensity();
        const timer = window.setInterval(loadDensity, 60000);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [hud.rangeMaxMs, hud.rangeMinMs, hud.sv]);
    const densityMarks = useMemo(() => {
        if (!hud.sv || hud.sv.startsWith("sv:local-")) return [];
        if (!densityResponse || densityResponse.sv !== hud.sv) return [];
        return densityResponse.points;
    }, [densityResponse, hud.sv]);
    const tileRequestKey = JSON.stringify({
        layers: hud.layers,
        bucket: timelineBucket,
        compare_mode: hud.compareMode,
        t2_bucket: compareBucket,
        split_view: hud.splitView,
        inspectLocked: hud.inspectLocked,
    });

    const openInspect = useCallback((station: StationPick) => {
        if (!selected) {
            hud.onInspectOpen();
            setInspectLockRunContext({
                decisionBucketTs: currentRunKey.decisionBucketTs,
                viewSnapshotId: currentRunKey.viewSnapshotId,
                viewSnapshotSha256: currentRunKey.viewSnapshotSha256,
            });
            setOptimizationSession((session) => ({
                ...session,
                mode: session.mode === "playback" ? "playback" : "frozen",
            }));
            updateUfE2E((current) => ({
                ...current,
                inspectOpenCount: (current.inspectOpenCount ?? 0) + 1,
                inspectOpenedAt: new Date().toISOString(),
                inspectSessionStartedAt: new Date().toISOString(),
                inspectLastOpenedStationId: station.station_id,
            }));
        }
        setSelected(station);
    }, [currentRunKey, hud, selected]);

    const closeInspect = useCallback((reason: "drawer_close_button" | "escape_key" = "drawer_close_button") => {
        if (!selected) return;
        setSelected(null);
        hud.onInspectClose();
        setInspectLockRunContext(null);
        setOptimizationSession((session) => ({
            ...session,
            mode: hud.mode === "live" && hud.playing ? "live" : "frozen",
        }));
        updateUfE2E((current) => ({
            ...current,
            inspectCloseCount: (current.inspectCloseCount ?? 0) + 1,
            inspectCloseReasons: {
                ...(current.inspectCloseReasons ?? {}),
                [reason]: ((current.inspectCloseReasons ?? {})[reason] ?? 0) + 1,
            },
            inspectClosedAt: new Date().toISOString(),
            inspectLastCloseReason: reason,
            inspectSessionEndedAt: new Date().toISOString(),
            inspectLastClosedStationId: selected.station_id,
        }));
    }, [hud, selected]);

    const handleSearchPick = useCallback(
        (result: { stationKey: string; name: string }) => {
            const fromMap =
                stationIndex.find((station) => station.station_id === result.stationKey) ?? null;
            openInspect({
                station_id: result.stationKey,
                name: result.name,
                lat: fromMap?.lat ?? 40.75,
                lon: fromMap?.lon ?? -73.98,
                capacity: fromMap?.capacity ?? null,
                bikes: fromMap?.bikes ?? null,
                docks: fromMap?.docks ?? null,
                docks_disabled: fromMap?.docks_disabled ?? null,
                bikes_disabled: fromMap?.bikes_disabled ?? null,
                inventory_slots_known: fromMap?.inventory_slots_known ?? null,
                inventory_delta: fromMap?.inventory_delta ?? null,
                occupancy_ratio: fromMap?.occupancy_ratio ?? null,
                severity_score: fromMap?.severity_score ?? null,
                bucket_quality: fromMap?.bucket_quality ?? null,
                t_bucket: new Date(timelineDisplayTimeMs).toISOString(),
                gbfs_last_updated: fromMap?.gbfs_last_updated ?? null,
                gbfs_ttl: fromMap?.gbfs_ttl ?? null,
            });
        },
        [openInspect, stationIndex, timelineDisplayTimeMs]
    );

    useEffect(() => {
        console.info("[MapShell] mounted");
        updateUfE2E((current) => ({
            ...current,
            mapShellMountCount: (current.mapShellMountCount ?? 0) + 1,
            mapShellLastMountTs: new Date().toISOString(),
        }));
        return () => {
            console.info("[MapShell] unmounted");
            updateUfE2E((current) => ({
                ...current,
                mapShellUnmountCount: (current.mapShellUnmountCount ?? 0) + 1,
                mapShellLastUnmountTs: new Date().toISOString(),
            }));
        };
    }, []);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (hud.handleHotkey(e)) {
                updateUfE2E((current) => ({
                    ...current,
                    hotkeyHandledCount: (current.hotkeyHandledCount ?? 0) + 1,
                    hotkeyLastCode: e.code,
                    hotkeyLastHandledAt: new Date().toISOString(),
                }));
                return;
            }
            updateUfE2E((current) => ({
                ...current,
                hotkeyIgnoredCount: (current.hotkeyIgnoredCount ?? 0) + 1,
                hotkeyLastCode: e.code,
                hotkeyLastIgnoredAt: new Date().toISOString(),
            }));
            if (e.code !== "Escape") return;
            if (optimizationSessionRef.current.mode !== "live") {
                e.preventDefault();
                handleExitPreview();
                return;
            }
            if (!inspectOpen) return;

            e.preventDefault();
            closeInspect("escape_key");
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [closeInspect, handleExitPreview, hud, inspectOpen]);

    useEffect(() => {
        console.info("[MapShell] inspect_lock_changed", {
            inspectOpen,
            selectedStationId: selected?.station_id ?? null,
            freezeMapUpdates: inspectOpen,
        });
    }, [inspectOpen, selected?.station_id]);

    useEffect(() => {
        const prev = lastDrawerStationRef.current;
        const next = selected?.station_id ?? null;

        if (prev !== next) {
            if (next) {
                console.info("[MapShell] tier1_drawer_opened", {
                    stationId: next,
                    tileOnly: true,
                });
                inspectAnchorTileKeyRef.current = tileRequestKey;
                inspectSessionIdRef.current += 1;
                updateUfE2E((current) => ({
                    ...current,
                    inspectAnchorTileRequestKey: tileRequestKey,
                    inspectSessionId: inspectSessionIdRef.current,
                    inspectAnchorSetAt: new Date().toISOString(),
                }));
            } else if (prev) {
                console.info("[MapShell] tier1_drawer_closed", {
                    stationId: prev,
                    tileOnly: true,
                });
                inspectAnchorTileKeyRef.current = null;
                updateUfE2E((current) => ({
                    ...current,
                    inspectAnchorTileRequestKey: "",
                    inspectAnchorClearedAt: new Date().toISOString(),
                }));
            }
            lastDrawerStationRef.current = next;
        }
    }, [selected?.station_id, tileRequestKey]);

    useEffect(() => {
        console.info("[MapShell] playback_changed", {
            playing: hud.playing,
            speed: hud.speed,
        });
    }, [hud.playing, hud.speed]);

    useEffect(() => {
        console.info("[MapShell] layers_changed", {
            layers: hud.layers,
        });
    }, [hud.layers]);

    useEffect(() => {
        console.info("[MapShell] tile_request_key_changed", {
            tileRequestKey,
            timelineBucket,
            compareBucket,
            compareMode: hud.compareMode,
            splitView: hud.splitView,
            inspectLocked: hud.inspectLocked,
            layers: hud.layers,
        });
    }, [
        compareBucket,
        hud.compareMode,
        hud.inspectLocked,
        hud.layers,
        hud.splitView,
        tileRequestKey,
        timelineBucket,
    ]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const updatedAt = new Date().toISOString();
        updateUfE2E((current) => {
            const keyChanged = current.tileRequestKey !== tileRequestKey;
            const nextHistory = keyChanged
                ? [...(current.tileRequestKeyHistory ?? []), tileRequestKey].slice(-40)
                : (current.tileRequestKeyHistory ?? []);
            return {
                ...current,
                mapShellMounted: true,
                mapShellMountCount: current.mapShellMountCount ?? 0,
                mapShellUnmountCount: current.mapShellUnmountCount ?? 0,
                mapShellLastMountTs: current.mapShellLastMountTs ?? "",
                mapShellLastUnmountTs: current.mapShellLastUnmountTs ?? "",
                inspectOpen,
                selectedStationId: selected?.station_id ?? null,
                timelineBucket,
                compareBucket,
                tileRequestKey,
                tileRequestKeyHistory: nextHistory,
                tileRequestKeyChangeCount: (current.tileRequestKeyChangeCount ?? 0) + (keyChanged ? 1 : 0),
                tileRequestKeyLastChangedAt: keyChanged ? updatedAt : (current.tileRequestKeyLastChangedAt ?? ""),
                invariantViolations: current.invariantViolations ?? [],
                invariantViolationCount: current.invariantViolationCount ?? 0,
                lastInvariantViolation: current.lastInvariantViolation ?? "",
                lastInvariantViolationAt: current.lastInvariantViolationAt ?? "",
                inspectOpenCount: current.inspectOpenCount ?? 0,
                inspectCloseCount: current.inspectCloseCount ?? 0,
                inspectCloseReasons: current.inspectCloseReasons ?? {},
                inspectOpenedAt: current.inspectOpenedAt ?? "",
                inspectClosedAt: current.inspectClosedAt ?? "",
                inspectLastCloseReason: current.inspectLastCloseReason ?? "",
                inspectLastOpenedStationId: current.inspectLastOpenedStationId ?? "",
                inspectLastClosedStationId: current.inspectLastClosedStationId ?? "",
                hotkeyHandledCount: current.hotkeyHandledCount ?? 0,
                hotkeyIgnoredCount: current.hotkeyIgnoredCount ?? 0,
                hotkeyLastCode: current.hotkeyLastCode ?? "",
                hotkeyLastHandledAt: current.hotkeyLastHandledAt ?? "",
                hotkeyLastIgnoredAt: current.hotkeyLastIgnoredAt ?? "",
                inspectAnchorTileRequestKey: current.inspectAnchorTileRequestKey ?? "",
                inspectSessionId: current.inspectSessionId ?? 0,
                inspectSessionStartedAt: current.inspectSessionStartedAt ?? "",
                inspectSessionEndedAt: current.inspectSessionEndedAt ?? "",
                inspectAnchorSetAt: current.inspectAnchorSetAt ?? "",
                inspectAnchorClearedAt: current.inspectAnchorClearedAt ?? "",
                controlsDisabled: hud.inspectLocked,
                compareEnabled: hud.compareMode,
                splitEnabled: hud.compareMode && hud.splitView,
                layerSeverityEnabled: hud.layers.severity,
                layerCapacityEnabled: hud.layers.capacity,
                layerLabelsEnabled: hud.layers.labels,
                compareOffsetBuckets: hud.compareOffsetBuckets,
                playbackSpeed: hud.speed,
                playing: hud.playing,
                mode: hud.mode,
                playbackTsMs: hud.playbackTsMs,
                policyStatus: effectivePolicyStatus,
                policyImpactEnabled: effectivePolicyImpactEnabled,
                policyMoveCount: policyMovesCount,
                policyBikesMoved,
                policyLastRunId: policyRunId ?? 0,
                policyLastError: policyError ?? "",
                optimizationSessionId: optimizationSession.sessionId,
                optimizationSessionMode: optimizationSession.mode,
                optimizationActiveRequestId: optimizationSession.activeRequestId ?? 0,
                optimizationPlaybackCursor: optimizationSession.playbackCursor,
                reducedMotion,
                playbackQuality,
                playbackQualityReason,
                demoPolicyMode,
            };
        });
    }, [
        compareBucket,
        hud.compareOffsetBuckets,
        hud.compareMode,
        hud.inspectLocked,
        hud.layers.capacity,
        hud.layers.labels,
        hud.layers.severity,
        hud.mode,
        hud.playbackTsMs,
        hud.playing,
        hud.speed,
        hud.splitView,
        inspectOpen,
        policyError,
        effectivePolicyImpactEnabled,
        policyMovesCount,
        policyBikesMoved,
        policyRunId,
        effectivePolicyStatus,
        optimizationSession.activeRequestId,
        optimizationSession.mode,
        optimizationSession.playbackCursor,
        optimizationSession.sessionId,
        playbackQuality,
        playbackQualityReason,
        demoPolicyMode,
        reducedMotion,
        selected?.station_id,
        tileRequestKey,
        timelineBucket,
    ]);

    useEffect(() => {
        if (!inspectOpen) return;
        const anchor = inspectAnchorTileKeyRef.current;
        if (!anchor || anchor === tileRequestKey) return;

        console.error("[MapShell] inspect_tile_key_mutated", {
            anchorTileRequestKey: anchor,
            currentTileRequestKey: tileRequestKey,
            selectedStationId: selected?.station_id ?? null,
        });
        updateUfE2E((current) => ({
            ...current,
            invariantViolations: [
                ...(current.invariantViolations ?? []),
                "inspect_tile_key_mutated",
            ].slice(-20),
            invariantViolationCount: (current.invariantViolationCount ?? 0) + 1,
            lastInvariantViolation: "inspect_tile_key_mutated",
            lastInvariantViolationAt: new Date().toISOString(),
        }));
    }, [compareBucket, inspectOpen, selected?.station_id, tileRequestKey, timelineBucket]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const actions: UfE2EActions = {
            openInspect: (stationId = "station-e2e") => {
                openInspect({
                    station_id: stationId,
                    name: `Station ${stationId}`,
                    lat: 40.75,
                    lon: -73.98,
                    capacity: 40,
                    bikes: 12,
                    docks: 28,
                    docks_disabled: 0,
                    bikes_disabled: 0,
                    inventory_slots_known: 40,
                    inventory_delta: 0,
                    occupancy_ratio: 0.3,
                    severity_score: 0.4,
                    bucket_quality: "ok",
                    t_bucket: new Date().toISOString(),
                    gbfs_last_updated: Math.floor(Date.now() / 1000),
                    gbfs_ttl: 60,
                });
            },
            closeInspect: (reason = "drawer_close_button") => {
                closeInspect(reason);
            },
            toggleCompareMode: () => {
                hud.toggleCompareMode();
            },
            toggleSplitView: () => {
                hud.toggleSplitView();
            },
            compareOffsetUp: () => {
                hud.compareOffsetUp();
            },
            compareOffsetDown: () => {
                hud.compareOffsetDown();
            },
        };
        (window as { __UF_E2E_ACTIONS?: UfE2EActions }).__UF_E2E_ACTIONS = actions;
    }, [closeInspect, hud, openInspect]);

    return (
        <div
            className={`uf-root ${optimizationSession.mode !== "live" ? "uf-preview-mode" : ""} ${reducedMotion ? "uf-reduced-motion" : ""}`}
            data-uf-id="app-root"
        >
            <div
                className="uf-sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-uf-id="policy-live-region"
            >
                {a11yAnnouncement}
            </div>
            {/* MAP */}
            <div className="uf-map" aria-label="Map" data-uf-id="map-shell">
                <MapView
                    onStationPick={openInspect}
                    onStationsData={setStationIndex}
                    onStationsMeta={(meta) => {
                        if (!meta.viewSnapshotId || !meta.viewSnapshotSha256) return;
                        setStationFeedSnapshot({
                            viewSnapshotId: meta.viewSnapshotId,
                            viewSnapshotSha256: meta.viewSnapshotSha256,
                        });
                    }}
                    onTileFetchSampleMs={handleTileFetchSample}
                    sv={hud.sv}
                    timelineBucket={timelineBucket}
                    systemId={DEFAULT_SYSTEM_ID}
                    selectedStationId={selected?.station_id ?? null}
                    policyImpactEnabled={effectivePolicyImpactEnabled}
                    policyImpactByStation={policyImpactByStation}
                    activePolicyMove={activePlaybackMove}
                    freeze={inspectOpen || optimizationSession.mode !== "live"}
                />
            </div>
            {optimizationSession.mode !== "live" ? (
                <div className="uf-preview-vignette" aria-hidden="true" />
            ) : null}
            {optimizationSession.mode !== "live" ? (
                <div className="uf-preview-pill uf-hud-pe-auto" data-uf-id="preview-pill">
                    Frozen Snapshot: {previewFrozenLabel} · {optimizationSession.mode === "computing" ? "Compute Preview" : optimizationSession.mode === "playback" ? "Animate Preview" : "Preview Ready"} · {playbackQuality}
                </div>
            ) : null}

            {/* HUD OVERLAY */}
            <HUDRoot>
                <div className="uf-top-center" data-uf-id="hud-clock">
                    <section role="region" aria-label="Clock and serving status">
                        <ClockChip
                            mode={hud.mode}
                            sv={hud.sv}
                            delayed={hud.delayed}
                            inspectLocked={hud.inspectLocked}
                            displayTimeMs={timelineDisplayTimeMs}
                        />
                    </section>
                </div>

                <div className="uf-bottom" data-uf-id="hud-timeline">
                    <section role="region" aria-label="Timeline playback controls">
                        <ScrubberBar
                            mode={hud.mode}
                            playing={hud.playing}
                            inspectLocked={hud.inspectLocked}
                            speed={hud.speed}
                            progress={hud.progress}
                            progressLabel={progressLabel}
                            densityMarks={densityMarks}
                            onTogglePlay={hud.togglePlay}
                            onSpeedDown={hud.speedDown}
                            onSpeedUp={hud.speedUp}
                            onStepBack={hud.stepBack}
                            onStepForward={hud.stepForward}
                            onSeek={hud.seekTo}
                            onGoLive={goLiveAction}
                        />
                    </section>
                </div>

                <div className="uf-left-stack" data-uf-id="hud-controls">
                    <nav aria-label="Playback and layer controls">
                        <CommandStack
                            previewMode={optimizationSession.mode !== "live"}
                            playing={hud.playing}
                            inspectLocked={hud.inspectLocked}
                            compareMode={hud.compareMode}
                            splitView={hud.splitView}
                            compareOffsetBuckets={hud.compareOffsetBuckets}
                            mode={hud.mode}
                            layers={hud.layers}
                            searchStations={searchStations}
                            policyStatus={effectivePolicyStatus}
                            policyMovesCount={policyMovesCount}
                            policyImpactEnabled={effectivePolicyImpactEnabled}
                            policyImpactSummary={policyImpactSummary}
                            policySummary={policySummary}
                            policyStrategy={policyStrategy}
                            availablePolicyStrategies={availablePolicyStrategies}
                            onPolicyStrategyChange={handlePolicyStrategyChange}
                            canCancelPolicy={effectivePolicyStatus === "pending"}
                            onCancelPolicy={handleCancelPolicy}
                            policyCompare={policyCompare}
                            diagnosticsPayload={diagnosticsPayloadText}
                            onExportDiagnostics={handleExportDiagnostics}
                            showDemoModeToggle={isDevMode}
                            demoModeEnabled={demoPolicyMode}
                            onToggleDemoMode={() => {
                                setDemoPolicyMode((current) => !current);
                            }}
                            reducedMotion={reducedMotion}
                            onToggleReducedMotion={() =>
                                setReducedMotionOverride((current) =>
                                    current === null ? !prefersReducedMotion : !current
                                )
                            }
                            showSyncView={policySyncViewNeeded && effectivePolicyStatus === "error"}
                            onSyncView={handleSyncView}
                            playbackView={playbackView}
                            onTogglePlaybackView={handleTogglePlaybackView}
                            onTogglePlay={hud.togglePlay}
                            onGoLive={goLiveAction}
                            onToggleLayer={hud.toggleLayer}
                            onToggleCompareMode={hud.toggleCompareMode}
                            onToggleSplitView={hud.toggleSplitView}
                            onCompareOffsetDown={hud.compareOffsetDown}
                            onCompareOffsetUp={hud.compareOffsetUp}
                            onSearchPick={handleSearchPick}
                            onRunPolicy={handleRunPolicy}
                            onTogglePolicyImpact={handleTogglePolicyImpact}
                        />
                    </nav>
                </div>

                <div className="uf-right-stack" data-uf-id="hud-stats">
                    <aside role="complementary" aria-label="Network stats and performance">
                        <StatsCard
                            activeStations={stats.activeStations}
                            empty={stats.empty}
                            full={stats.full}
                            tileP95={tileP95}
                            fps={fps}
                            spark={spark}
                        />
                    </aside>
                </div>

                <StationDrawer
                    station={selected}
                    sv={hud.sv}
                    timelineBucket={timelineBucket}
                    policyImpactEnabled={effectivePolicyImpactEnabled}
                    policyImpactDelta={
                        selected && effectivePolicyImpactEnabled
                            ? Number(policyImpactByStation[selected.station_id] ?? 0)
                            : 0
                    }
                    onClose={() => closeInspect("drawer_close_button")}
                />
            </HUDRoot>
            {hud.compareMode && hud.splitView ? (
                <div
                    style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: "50%",
                        width: 2,
                        background: "rgba(255,255,255,0.18)",
                        pointerEvents: "none",
                    }}
                    aria-hidden="true"
                />
            ) : null}
        </div>
    );
}
