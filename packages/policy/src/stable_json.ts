import crypto from "crypto";

function stableStringifyValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  const t = typeof value;
  if (t === "string") {
    return JSON.stringify(value);
  }
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("non_finite_number");
    }
    return String(value);
  }
  if (t === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyValue(item)).join(",")}]`;
  }
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const body = entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringifyValue(v)}`).join(",");
    return `{${body}}`;
  }
  throw new Error("unsupported_type");
}

export function stableStringify(value: unknown): string {
  return stableStringifyValue(value);
}

export function sha256Hex(value: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(value);
  return hash.digest("hex");
}
