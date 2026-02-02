import type { AllowlistKind, AllowlistStore } from "./types";
import { requireAllowlisted } from "./validate";

export type AllowlistLogger = {
  info(event: string, data: Record<string, unknown>): void;
  warn(event: string, data: Record<string, unknown>): void;
};

const defaultLogger: AllowlistLogger = {
  info(event, data) {
    console.info(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...data }));
  },
  warn(event, data) {
    console.warn(JSON.stringify({ level: "warn", event, ts: new Date().toISOString(), ...data }));
  },
};

export type AllowlistEnforcementError = {
  ok: false;
  status: 400;
  code: "param_not_allowlisted";
  message: string;
  kind: AllowlistKind;
  value: string;
  headers: Record<string, string>;
};

export type AllowlistEnforcementOk = { ok: true };

export type AllowlistEnforcementResult = AllowlistEnforcementOk | AllowlistEnforcementError;

export async function enforceAllowlist(
  store: AllowlistStore,
  checks: Array<{ kind: AllowlistKind; value: string; system_id?: string }>,
  opts?: {
    logger?: AllowlistLogger;
    request_id?: string;
    ip?: string;
    path?: string;
  }
): Promise<AllowlistEnforcementResult> {
  const logger = opts?.logger ?? defaultLogger;

  for (const check of checks) {
    if (!check.value || check.value.trim().length === 0) {
      return {
        ok: false,
        status: 400,
        code: "param_not_allowlisted",
        message: `Missing ${check.kind}`,
        kind: check.kind,
        value: check.value,
        headers: { "Cache-Control": "no-store" },
      };
    }

    const res = await requireAllowlisted(store, check);
    if (!res.ok) {
      logger.warn("allowlist_reject", {
        request_id: opts?.request_id,
        ip: opts?.ip,
        path: opts?.path,
        kind: res.kind,
        value: res.value,
        system_id: check.system_id,
        code: res.code,
      });
      return {
        ok: false,
        status: 400,
        code: res.code,
        message: res.message,
        kind: res.kind,
        value: res.value,
        headers: { "Cache-Control": "no-store" },
      };
    }
  }

  logger.info("allowlist_ok", {
    request_id: opts?.request_id,
    path: opts?.path,
    checked: checks.map((c) => ({ kind: c.kind, system_id: c.system_id ?? null })),
  });
  return { ok: true };
}

