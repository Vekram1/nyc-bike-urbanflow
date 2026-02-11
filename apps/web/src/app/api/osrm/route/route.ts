import { NextResponse } from "next/server";

const DEFAULT_OSRM_BASE = "https://router.project-osrm.org";
const OSRM_BASE =
    process.env.OSRM_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_OSRM_BASE_URL?.trim() ||
    DEFAULT_OSRM_BASE;

function parseCoord(raw: string | null): [number, number] | null {
    if (!raw) return null;
    const [lonRaw, latRaw] = raw.split(",");
    const lon = Number(lonRaw);
    const lat = Number(latRaw);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    return [lon, lat];
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const from = parseCoord(url.searchParams.get("from"));
        const to = parseCoord(url.searchParams.get("to"));
        if (!from || !to) {
            return NextResponse.json(
                {
                    error: {
                        code: "invalid_route_coords",
                        message: "Expected query params from=lon,lat and to=lon,lat",
                    },
                },
                { status: 400, headers: { "Cache-Control": "no-store" } }
            );
        }

        const upstream = new URL(
            `/route/v1/bicycle/${from[0]},${from[1]};${to[0]},${to[1]}`,
            OSRM_BASE
        );
        upstream.searchParams.set("overview", "full");
        upstream.searchParams.set("geometries", "geojson");
        upstream.searchParams.set("alternatives", "false");
        upstream.searchParams.set("steps", "false");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 800);
        const res = await fetch(upstream.toString(), {
            cache: "no-store",
            signal: controller.signal,
            headers: {
                accept: "application/json",
            },
        }).finally(() => {
            clearTimeout(timeout);
        });
        const body = (await res.json().catch(() => null)) as
            | {
                  code?: string;
                  routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>;
              }
            | null;
        const coords = body?.routes?.[0]?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) {
            return NextResponse.json(
                {
                    error: {
                        code: "route_unavailable",
                        message: "OSRM route unavailable",
                    },
                },
                { status: 502, headers: { "Cache-Control": "no-store" } }
            );
        }

        return NextResponse.json(
            { route: coords },
            {
                status: 200,
                headers: {
                    "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
                },
            }
        );
    } catch {
        return NextResponse.json(
            {
                error: {
                    code: "route_unavailable",
                    message: "OSRM route unavailable",
                },
            },
            { status: 502, headers: { "Cache-Control": "no-store" } }
        );
    }
}
