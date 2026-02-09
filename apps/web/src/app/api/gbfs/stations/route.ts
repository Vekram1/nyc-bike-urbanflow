import { NextResponse } from "next/server";

const BACKEND_ORIGIN = process.env.URBANFLOW_API_ORIGIN?.trim() || "http://127.0.0.1:3000";
const DEFAULT_SYSTEM_ID = process.env.SYSTEM_ID?.trim() || "citibike-nyc";
const ALLOWED_KEYS = new Set(["sv", "T_bucket", "system_id", "limit"]);

type TimeResponse = {
    recommended_live_sv?: string;
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

        const upstreamParams = new URLSearchParams({
            v: "1",
            sv: effectiveSv,
            system_id: systemId,
        });
        if (requestedBucket != null) {
            upstreamParams.set("T_bucket", String(requestedBucket));
        }
        const limitRaw = url.searchParams.get("limit")?.trim();
        if (limitRaw) {
            upstreamParams.set("limit", limitRaw);
        }

        const upstreamRes = await fetch(`${BACKEND_ORIGIN}/api/stations?${upstreamParams.toString()}`, {
            cache: "no-store",
        });
        const text = await upstreamRes.text();
        return new NextResponse(text, {
            status: upstreamRes.status,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
            },
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "unknown error";
        return json(500, { ok: false, error: message });
    }
}
