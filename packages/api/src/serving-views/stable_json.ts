// Minimal stable JSON stringify (sorted object keys) for hashing view specs.
// Avoids dependency additions and keeps sv reproducible.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeForJson(value: unknown): unknown {
  if (value === undefined) {
    // JSON omits undefined object properties, but arrays preserve position as null.
    // For hashing, treat top-level undefined as null (we avoid emitting bare "undefined").
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : normalizeForJson(v)));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) {
        continue;
      }
      out[k] = normalizeForJson(v);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  const normalized = normalizeForJson(value);
  if (Array.isArray(normalized)) {
    return `[${normalized.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (isPlainObject(normalized)) {
    const keys = Object.keys(normalized).sort();
    const props = keys.map((k) => {
      const v = (normalized as Record<string, unknown>)[k];
      return `${JSON.stringify(k)}:${stableStringify(v)}`;
    });
    return `{${props.join(",")}}`;
  }
  // JSON.stringify never returns "undefined" as text; normalized ensures we always stringify.
  return JSON.stringify(normalized) ?? "null";
}
