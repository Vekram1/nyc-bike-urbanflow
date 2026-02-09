import { NextResponse } from "next/server";

const STATION_INFO_URL =
    "https://gbfs.citibikenyc.com/gbfs/en/station_information.json";
const STATION_STATUS_URL =
    "https://gbfs.citibikenyc.com/gbfs/en/station_status.json";

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

export async function GET() {
    try {
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
                },
            };
        });

        return NextResponse.json(
            {
                ok: true,
                as_of: statusJson.last_updated,
                ttl: statusJson.ttl,
                type: "FeatureCollection" as const,
                features,
            },
            {
                headers: {
                    // live-ish data; don’t let browser cache hard
                    "Cache-Control": "no-store",
                },
            }
        );
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "unknown error";
        return NextResponse.json(
            { ok: false, error: message },
            { status: 500 }
        );
    }
}
