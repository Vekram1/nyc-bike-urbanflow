const OPS_PAGE_PATH = "/admin/ops";
const PIPELINE_STATE_PATH = "/api/pipeline_state";
const DLQ_PATH = "/api/admin/dlq";
const DLQ_RESOLVE_PATH = "/api/admin/dlq/resolve";
const PIPELINE_ALLOWED_QUERY_PARAMS = new Set(["v", "system_id"]);
const DLQ_ALLOWED_QUERY_PARAMS = new Set(["v", "limit", "include_resolved"]);
const DLQ_RESOLVE_ALLOWED_QUERY_PARAMS = new Set(["v"]);

type PipelineState = {
  queue_depth: number;
  dlq_depth: number;
  feeds: Array<{ dataset_id: string; last_success_at: string }>;
  degrade_history: Array<{ bucket_ts: string; degrade_level: number; client_should_throttle: boolean }>;
};

type DlqItem = {
  dlq_id: number;
  job_id: number;
  type: string;
  reason_code: string;
  failed_at: string;
  attempts: number;
  max_attempts: number;
  payload_summary: string;
  resolved_at?: string | null;
  resolution_note?: string | null;
  resolved_by?: string | null;
};

export type AdminRouteDeps = {
  auth: {
    admin_token: string;
    allowed_origins: string[];
  };
  store: {
    getPipelineState: (args: { system_id: string }) => Promise<PipelineState>;
    listDlq: (args: { limit: number; include_resolved: boolean }) => Promise<DlqItem[]>;
    resolveDlq: (args: { dlq_id: number; resolution_note: string; resolved_by?: string | null }) => Promise<boolean>;
  };
  config: {
    default_system_id: string;
  };
};

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(headers ?? {}),
    },
  });
}

function parseBoolean(raw: string | null): boolean | null {
  if (raw === null) {
    return null;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return null;
}

function parseLimit(raw: string | null, fallback: number): number | null {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 500) {
    return null;
  }
  return n;
}

function hasUnknownQueryParam(searchParams: URLSearchParams, allowed: Set<string>): string | null {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) {
      return key;
    }
  }
  return null;
}

function corsHeaders(request: Request, allowedOrigins: string[]): Record<string, string> | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return {};
  }
  if (!allowedOrigins.includes(origin)) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function authorize(request: Request, deps: AdminRouteDeps): { ok: true; cors: Record<string, string> } | { ok: false; response: Response } {
  const cors = corsHeaders(request, deps.auth.allowed_origins);
  if (cors === null) {
    return {
      ok: false,
      response: json({ error: { code: "forbidden_origin", message: "Origin is not allowed" } }, 403),
    };
  }
  const token = request.headers.get("x-admin-token")?.trim() ?? "";
  if (!token) {
    return {
      ok: false,
      response: json({ error: { code: "missing_admin_token", message: "X-Admin-Token is required" } }, 401, cors),
    };
  }
  if (token !== deps.auth.admin_token) {
    return {
      ok: false,
      response: json({ error: { code: "invalid_admin_token", message: "Invalid admin token" } }, 403, cors),
    };
  }
  return { ok: true, cors };
}

function opsPageHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>UrbanFlow Admin Ops</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 20px; }
    input, button, textarea { font: inherit; margin: 4px 0; width: 100%; }
    pre { background: #111; color: #ddd; padding: 12px; overflow: auto; }
  </style>
</head>
<body>
  <h1>UrbanFlow Admin Ops</h1>
  <label>Admin token</label>
  <input id="token" type="password" />
  <button id="refresh">Refresh pipeline + DLQ</button>
  <pre id="out">{}</pre>
  <script>
    async function call(path, options = {}) {
      const token = document.getElementById("token").value;
      const res = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": token,
          ...(options.headers || {}),
        },
      });
      const body = await res.json();
      return { status: res.status, body };
    }
    document.getElementById("refresh").onclick = async () => {
      const pipeline = await call("/api/pipeline_state?v=1");
      const dlq = await call("/api/admin/dlq?v=1&limit=20");
      document.getElementById("out").textContent = JSON.stringify({ pipeline, dlq }, null, 2);
    };
  </script>
</body>
</html>`;
}

export function createAdminRouteHandler(deps: AdminRouteDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === OPS_PAGE_PATH) {
      if (request.method !== "GET") {
        return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405, { Allow: "GET" });
      }
      return new Response(opsPageHtml(), {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.pathname !== PIPELINE_STATE_PATH && url.pathname !== DLQ_PATH && url.pathname !== DLQ_RESOLVE_PATH) {
      return json({ error: { code: "not_found", message: "Route not found" } }, 404);
    }

    if (request.method === "OPTIONS") {
      const cors = corsHeaders(request, deps.auth.allowed_origins);
      if (cors === null) {
        return json({ error: { code: "forbidden_origin", message: "Origin is not allowed" } }, 403);
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,X-Admin-Token,X-Admin-Actor",
          "Access-Control-Max-Age": "600",
        },
      });
    }

    const auth = authorize(request, deps);
    if (!auth.ok) {
      return auth.response;
    }

    const version = url.searchParams.get("v");
    if (version !== null && version !== "1") {
      return json({ error: { code: "unsupported_version", message: "Only v=1 is supported" } }, 400, auth.cors);
    }

    if (url.pathname === PIPELINE_STATE_PATH) {
      if (request.method !== "GET") {
        return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405, {
          ...auth.cors,
          Allow: "GET",
        });
      }
      const unknown = hasUnknownQueryParam(url.searchParams, PIPELINE_ALLOWED_QUERY_PARAMS);
      if (unknown) {
        return json({ error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } }, 400, auth.cors);
      }
      const systemId = url.searchParams.get("system_id")?.trim() || deps.config.default_system_id;
      const state = await deps.store.getPipelineState({ system_id: systemId });
      return json(state, 200, auth.cors);
    }

    if (url.pathname === DLQ_PATH) {
      if (request.method !== "GET") {
        return json({ error: { code: "method_not_allowed", message: "Method must be GET" } }, 405, {
          ...auth.cors,
          Allow: "GET",
        });
      }
      const unknown = hasUnknownQueryParam(url.searchParams, DLQ_ALLOWED_QUERY_PARAMS);
      if (unknown) {
        return json({ error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } }, 400, auth.cors);
      }
      const limit = parseLimit(url.searchParams.get("limit"), 50);
      if (limit === null) {
        return json({ error: { code: "invalid_limit", message: "limit must be an integer between 1 and 500" } }, 400, auth.cors);
      }
      const includeResolved = parseBoolean(url.searchParams.get("include_resolved"));
      if (includeResolved === null && url.searchParams.has("include_resolved")) {
        return json({ error: { code: "invalid_include_resolved", message: "include_resolved must be true or false" } }, 400, auth.cors);
      }
      const items = await deps.store.listDlq({
        limit,
        include_resolved: includeResolved ?? false,
      });
      return json({ items }, 200, auth.cors);
    }

    if (url.pathname === DLQ_RESOLVE_PATH) {
      if (request.method !== "POST") {
        return json({ error: { code: "method_not_allowed", message: "Method must be POST" } }, 405, {
          ...auth.cors,
          Allow: "POST",
        });
      }
      const unknown = hasUnknownQueryParam(url.searchParams, DLQ_RESOLVE_ALLOWED_QUERY_PARAMS);
      if (unknown) {
        return json({ error: { code: "unknown_param", message: `Unknown query parameter: ${unknown}` } }, 400, auth.cors);
      }
      const body = (await request.json().catch(() => null)) as
        | { dlq_id?: number; resolution_note?: string }
        | null;
      const dlqId = body?.dlq_id;
      const resolutionNote = body?.resolution_note?.trim() ?? "";
      if (!Number.isInteger(dlqId) || (dlqId ?? 0) <= 0) {
        return json({ error: { code: "invalid_dlq_id", message: "dlq_id must be a positive integer" } }, 400, auth.cors);
      }
      if (!resolutionNote) {
        return json({ error: { code: "missing_resolution_note", message: "resolution_note is required" } }, 400, auth.cors);
      }
      const resolvedBy = request.headers.get("x-admin-actor")?.trim() || null;
      const ok = await deps.store.resolveDlq({
        dlq_id: dlqId,
        resolution_note: resolutionNote,
        resolved_by: resolvedBy,
      });
      if (!ok) {
        return json({ error: { code: "dlq_not_found", message: "DLQ record not found" } }, 404, auth.cors);
      }
      return json({ ok: true }, 200, auth.cors);
    }

    return json({ error: { code: "not_found", message: "Route not found" } }, 404, auth.cors);
  };
}
