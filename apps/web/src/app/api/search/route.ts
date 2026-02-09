import { NextRequest, NextResponse } from "next/server";

const STATION_INFO_URL =
    "https://gbfs.citibikenyc.com/gbfs/en/station_information.json";

const ALLOWED_KEYS = new Set(["q", "limit"]);
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

type StationInformation = {
    stations: Array<{
        station_id: string;
        name: string;
    }>;
};

type GbfsWrapper<T> = {
    data: T;
};

function json(status: number, body: unknown): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}

function parseLimit(raw: string | null): number | null {
    if (!raw) return DEFAULT_LIMIT;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return null;
    }
    return parsed;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
    const params = request.nextUrl.searchParams;

    for (const key of params.keys()) {
        if (!ALLOWED_KEYS.has(key)) {
            return json(400, {
                error: {
                    code: "unknown_param",
                    message: `Unknown query parameter: ${key}`,
                },
            });
        }
    }

    const q = params.get("q")?.trim() ?? "";
    if (q.length < 2) {
        return json(400, {
            error: {
                code: "invalid_query",
                message: "q must be at least 2 characters",
            },
        });
    }

    const limit = parseLimit(params.get("limit"));
    if (limit == null) {
        return json(400, {
            error: {
                code: "invalid_limit",
                message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
            },
        });
    }

    try {
        const res = await fetch(STATION_INFO_URL, { cache: "no-store" });
        if (!res.ok) {
            return json(502, {
                error: {
                    code: "upstream_unavailable",
                    message: "station_information fetch failed",
                },
            });
        }

        const payload = (await res.json()) as GbfsWrapper<StationInformation>;
        const query = q.toLowerCase();

        const results = payload.data.stations
            .filter((station) => {
                const name = station.name.toLowerCase();
                const id = station.station_id.toLowerCase();
                return name.includes(query) || id.includes(query);
            })
            .slice(0, limit)
            .map((station) => ({
                stationKey: station.station_id,
                name: station.name,
            }));

        return json(200, { results });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        return json(500, {
            error: {
                code: "search_failed",
                message,
            },
        });
    }
}
