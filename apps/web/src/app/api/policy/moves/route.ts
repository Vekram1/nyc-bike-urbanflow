import { NextRequest, NextResponse } from "next/server";

const BACKEND_ORIGIN = process.env.URBANFLOW_API_ORIGIN?.trim() || "http://127.0.0.1:3000";

function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = new URLSearchParams(request.nextUrl.searchParams);
  const upstreamUrl = `${BACKEND_ORIGIN}/api/policy/moves?${params.toString()}`;

  try {
    const res = await fetch(upstreamUrl, { cache: "no-store" });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "upstream unavailable";
    return json(502, {
      error: {
        code: "upstream_unavailable",
        message,
      },
    });
  }
}

