import { NextResponse } from "next/server";

const BACKEND_ORIGIN = process.env.URBANFLOW_API_ORIGIN?.trim() || "http://127.0.0.1:3000";
const DEFAULT_SYSTEM_ID = process.env.SYSTEM_ID?.trim() || "citibike-nyc";
const STATION_INFO_URL =
    "https://gbfs.citibikenyc.com/gbfs/en/station_information.json";
const STATION_STATUS_URL =
    "https://gbfs.citibikenyc.com/gbfs/en/station_status.json";
const ALLOWED_KEYS = new Set(["sv", "T_bucket", "system_id"]);

type GbfsWrapper<T> = { last_updated: number; ttl: number; data: T };

type StationInformation = {
    stations: Array<{
        station_id: string;
        name: string;
        lat: number;
        lon: number;
        capacity?: number;
        short_name?: string;
        region_id?: string;
    }>;
};

type StationStatus = {
    stations: Array<{
        station_id: string;
        num_bikes_available: number;
        num_docks_available: number;
        num_bikes_disabled?: number;
        num_docks_disabled?: number;
        is_renting?: number;
        is_returning?: number;
    }>;
};

type TimeResponse = {
    server_now?: string;
    recommended_live_sv?: string;
};

type TimelineResponse = {
    bucket_size_seconds?: number;
};

function json(status: number, body: unknown) {
    return NextResponse.json(body, {
        status,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}

function parsePositiveInt(raw: string | null): number | null {
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
}

function parseEpochSeconds(rawIso: string | undefined): number | null {
    if (!rawIso) return null;
    const ms = Date.parse(rawIso);
    if (!Number.isFinite(ms)) return null;
    return Math.floor(ms / 1000);
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        for (const key of url.searchParams.keys()) {
            if (!ALLOWED_KEYS.has(key)) {
                return json(400, {
                    error: {
                        code: "unknown_param",
                        message: `Unknown query parameter: ${key}`,
                    },
                });
            }
        }

        const systemId = url.searchParams.get("system_id")?.trim() || DEFAULT_SYSTEM_ID;
        const requestedBucket = parsePositiveInt(url.searchParams.get("T_bucket"));
        if (url.searchParams.has("T_bucket") && requestedBucket == null) {
            return json(400, {
                error: {
                    code: "invalid_t_bucket",
                    message: "T_bucket must be a positive integer epoch second",
                },
            });
        }

        const timeRes = await fetch(
            `${BACKEND_ORIGIN}/api/time?system_id=${encodeURIComponent(systemId)}`,
            { cache: "no-store" }
        );
        if (!timeRes.ok) {
            return json(502, {
                error: {
                    code: "time_unavailable",
                    message: "Failed to resolve control-plane time state",
                },
            });
        }
        const timeBody = (await timeRes.json()) as TimeResponse;
        const serverNow = parseEpochSeconds(timeBody.server_now) ?? Math.floor(Date.now() / 1000);
        const requestedSv = url.searchParams.get("sv")?.trim() ?? "";
        const effectiveSv =
            requestedSv && !requestedSv.startsWith("sv:local-")
                ? requestedSv
                : timeBody.recommended_live_sv?.trim() ?? "";
        if (!effectiveSv) {
            return json(502, {
                error: {
                    code: "sv_unavailable",
                    message: "No serving view token available from control plane",
                },
            });
        }

        const timelineRes = await fetch(
            `${BACKEND_ORIGIN}/api/timeline?v=1&sv=${encodeURIComponent(effectiveSv)}`,
            { cache: "no-store" }
        );
        if (!timelineRes.ok) {
            const message = await timelineRes.text();
            return json(timelineRes.status, {
                error: {
                    code: "sv_invalid_for_timeline",
                    message: message || "Failed timeline validation for sv",
                },
            });
        }
        const timelineBody = (await timelineRes.json()) as TimelineResponse;
        const bucketSize = Math.max(1, timelineBody.bucket_size_seconds ?? 300);
        const upperBound = Math.max(0, Math.floor(serverNow / bucketSize) * bucketSize);
        const requestedOrNow = requestedBucket ?? upperBound;
        const effectiveBucket = Math.min(requestedOrNow, upperBound);

        const [infoRes, statusRes] = await Promise.all([
            fetch(STATION_INFO_URL, { cache: "no-store" }),
            fetch(STATION_STATUS_URL, { cache: "no-store" }),
        ]);

        if (!infoRes.ok || !statusRes.ok) {
            return NextResponse.json(
                {
                    ok: false,
                    error: "GBFS fetch failed",
                    infoStatus: infoRes.status,
                    statusStatus: statusRes.status,
                },
                { status: 502 }
            );
        }

        const infoJson = (await infoRes.json()) as GbfsWrapper<StationInformation>;
        const statusJson = (await statusRes.json()) as GbfsWrapper<StationStatus>;

        const statusById = new Map(
            statusJson.data.stations.map((s) => [s.station_id, s])
        );

        const features = infoJson.data.stations.map((s) => {
            const st = statusById.get(s.station_id);
            const bikes = st?.num_bikes_available ?? null;
            const docks = st?.num_docks_available ?? null;
            const docksDisabled = st?.num_docks_disabled ?? null;
            const capacity = s.capacity ?? null;
            const totalKnownSlots =
                (bikes ?? 0) + (docks ?? 0) + (docksDisabled ?? 0);
            const inventoryDelta =
                capacity != null ? totalKnownSlots - capacity : null;
            const occupancyRatio =
                capacity != null && bikes != null && capacity > 0
                    ? Math.min(1, Math.max(0, bikes / capacity))
                    : null;
            const bikesAvailabilityRatio = occupancyRatio;
            const severityScore =
                occupancyRatio == null
                    ? null
                    : Math.min(1, Math.max(0, Math.abs(occupancyRatio - 0.5) * 2));

            return {
                type: "Feature" as const,
                id: s.station_id,
                geometry: {
                    type: "Point" as const,
                    coordinates: [s.lon, s.lat] as [number, number],
                },
                properties: {
                    station_id: s.station_id,
                    name: s.name,
                    capacity,

                    bikes,
                    docks,
                    bikes_disabled: st?.num_bikes_disabled ?? null,
                    docks_disabled: docksDisabled,
                    inventory_slots_known: totalKnownSlots,
                    inventory_delta: inventoryDelta,
                    occupancy_ratio: occupancyRatio,
                    bikes_availability_ratio: bikesAvailabilityRatio,
                    severity_score: severityScore,

                    is_renting: st?.is_renting ?? null,
                    is_returning: st?.is_returning ?? null,

                    gbfs_last_updated: statusJson.last_updated,
                    gbfs_ttl: statusJson.ttl,
                    sv: effectiveSv,
                    t_bucket: new Date(effectiveBucket * 1000).toISOString(),
                },
            };
        });

        return json(
            200,
            {
                ok: true,
                as_of: statusJson.last_updated,
                ttl: statusJson.ttl,
                system_id: systemId,
                sv: effectiveSv,
                requested_t_bucket: requestedBucket,
                effective_t_bucket: effectiveBucket,
                type: "FeatureCollection" as const,
                features,
            },
        );
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "unknown error";
        return json(
            500,
            { ok: false, error: message },
        );
    }
}
