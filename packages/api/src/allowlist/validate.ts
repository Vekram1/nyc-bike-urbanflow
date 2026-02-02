import type { AllowlistKind, AllowlistStore } from "./types";

export type AllowlistValidationOk = { ok: true };
export type AllowlistValidationErr = {
  ok: false;
  status: 400;
  code: "param_not_allowlisted";
  message: string;
  kind: AllowlistKind;
  value: string;
};

export type AllowlistValidationResult = AllowlistValidationOk | AllowlistValidationErr;

export async function requireAllowlisted(
  store: AllowlistStore,
  query: { kind: AllowlistKind; value: string; system_id?: string }
): Promise<AllowlistValidationResult> {
  const ok = await store.isAllowed(query);
  if (ok) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 400,
    code: "param_not_allowlisted",
    message: `Unknown ${query.kind}: ${query.value}`,
    kind: query.kind,
    value: query.value,
  };
}

