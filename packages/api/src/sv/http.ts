import type { ServingTokenService } from "./service";

export type SvValidationContext = {
  request_id?: string;
  ip?: string;
  path?: string;
};

export type SvValidationResult =
  | {
      ok: true;
      sv: string;
      system_id: string;
      view_id: number;
      view_spec_sha256: string;
      issued_at_s?: number;
      expires_at_s?: number;
    }
  | {
      ok: false;
      status: 401 | 403;
      code: string;
      message: string;
      headers: Record<string, string>;
    };

const defaultLogger = {
  info(event: string, data: Record<string, unknown>): void {
    console.info(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...data }));
  },
  warn(event: string, data: Record<string, unknown>): void {
    console.warn(JSON.stringify({ level: "warn", event, ts: new Date().toISOString(), ...data }));
  },
};

export function originShieldHeaders(
  reason: string,
  retryAfterSeconds?: number
): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Origin-Block-Reason": reason,
  };
  if (retryAfterSeconds) {
    headers["Retry-After"] = String(retryAfterSeconds);
  }
  return headers;
}

export async function validateSvQuery(
  tokens: ServingTokenService,
  searchParams: URLSearchParams,
  opts?: {
    ctx?: SvValidationContext;
    logger?: { info: (event: string, data: Record<string, unknown>) => void; warn: (event: string, data: Record<string, unknown>) => void };
  }
): Promise<SvValidationResult> {
  const logger = opts?.logger ?? defaultLogger;
  const sv = searchParams.get("sv")?.trim() ?? "";
  if (sv.length === 0) {
    logger.warn("sv.missing", { request_id: opts?.ctx?.request_id, path: opts?.ctx?.path });
    return {
      ok: false,
      status: 401,
      code: "sv_missing",
      message: "Missing sv token",
      headers: originShieldHeaders("sv_missing"),
    };
  }

  const result = await tokens.validate(sv);
  if (!result.ok) {
    logger.warn("sv.invalid", {
      request_id: opts?.ctx?.request_id,
      path: opts?.ctx?.path,
      reason: result.reason,
    });
    return {
      ok: false,
      status: result.reason === "token_revoked" ? 403 : 401,
      code: result.reason,
      message: "Invalid sv token",
      headers: originShieldHeaders(result.reason),
    };
  }

  logger.info("sv.ok", {
    request_id: opts?.ctx?.request_id,
    path: opts?.ctx?.path,
    system_id: result.payload.system_id,
    view_id: result.payload.view_id,
  });

  return {
    ok: true,
    sv,
    system_id: result.payload.system_id,
    view_id: result.payload.view_id,
    view_spec_sha256: result.payload.view_spec_sha256,
    issued_at_s: result.payload.issued_at_s,
    expires_at_s: result.payload.expires_at_s,
  };
}
