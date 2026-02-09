import { NextRequest, NextResponse } from "next/server";

const BACKEND_ORIGIN = process.env.URBANFLOW_API_ORIGIN?.trim() || "http://127.0.0.1:3000";
const DEFAULT_SYSTEM_ID = process.env.SYSTEM_ID?.trim() || "citibike-nyc";

const ALLOWED_KEYS = new Set(["q", "limit", "bbox", "system_id"]);
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;

type BackendSearchResponse = {
    results?: Array<{
        station_key: string;
        name: string;
    }>;
    error?: {
        message?: string;
    };
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

    const upstreamParams = new URLSearchParams({
        q,
        limit: String(limit),
        system_id: params.get("system_id")?.trim() || DEFAULT_SYSTEM_ID,
    });

    const bbox = params.get("bbox")?.trim();
    if (bbox) {
        upstreamParams.set("bbox", bbox);
    }

    const upstreamUrl = `${BACKEND_ORIGIN}/api/search?${upstreamParams.toString()}`;

    try {
        const res = await fetch(upstreamUrl, { cache: "no-store" });
        const body = (await res.json()) as BackendSearchResponse;

        if (!res.ok) {
            return json(res.status, {
                error: {
                    code: "upstream_error",
                    message: body.error?.message ?? "Search unavailable",
                },
            });
        }

        const results = Array.isArray(body.results)
            ? body.results.map((station) => ({
                  stationKey: station.station_key,
                  name: station.name,
              }))
            : [];

        return json(200, { results });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown error";
        return json(502, {
            error: {
                code: "search_failed",
                message,
            },
        });
    }
}
