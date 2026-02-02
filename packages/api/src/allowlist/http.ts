import type { AllowlistEnforcementResult } from "./enforce";
import { enforceAllowlist } from "./enforce";
import type { AllowlistKind, AllowlistStore } from "./types";

export type AllowlistedQueryKey =
  | "system_id"
  | "tile_schema"
  | "severity_version"
  | "policy_version"
  | "layers"
  | "compare_mode";

export type AllowlistHttpContext = {
  request_id?: string;
  ip?: string;
  path?: string;
};

function kindForKey(key: AllowlistedQueryKey): AllowlistKind {
  switch (key) {
    case "system_id":
      return "system_id";
    case "tile_schema":
      return "tile_schema";
    case "severity_version":
      return "severity_version";
    case "policy_version":
      return "policy_version";
    case "layers":
      return "layers_set";
    case "compare_mode":
      return "compare_mode";
  }
}

export function canonicalizeLayersSet(layers: string): string {
  // Treat "inv,sev,press" and "sev,inv,press" as the same allowlist dimension.
  // Canonical form is CSV with stable sort and no empties.
  const parts = layers
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  parts.sort();
  return parts.join(",");
}

export async function enforceAllowlistedQueryParams(
  store: AllowlistStore,
  searchParams: URLSearchParams,
  keys: AllowlistedQueryKey[],
  opts?: {
    system_id?: string;
    ctx?: AllowlistHttpContext;
  }
): Promise<AllowlistEnforcementResult> {
  const checks: Array<{ kind: AllowlistKind; value: string; system_id?: string }> = [];

  for (const key of keys) {
    const raw = searchParams.get(key) ?? "";
    if (raw.trim().length === 0) {
      continue;
    }
    const value = key === "layers" ? canonicalizeLayersSet(raw) : raw;
    checks.push({ kind: kindForKey(key), value, system_id: opts?.system_id });
  }

  return enforceAllowlist(store, checks, {
    request_id: opts?.ctx?.request_id,
    ip: opts?.ctx?.ip,
    path: opts?.ctx?.path,
  });
}

