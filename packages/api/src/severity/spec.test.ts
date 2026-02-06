import { describe, expect, it } from "bun:test";

import {
  DEFAULT_SEVERITY_SPEC_V1,
  PgSeveritySpecStore,
  sha256Hex,
  stableStringify,
} from "./spec";

type Call = { text: string; params: Array<unknown> };

class FakeDb implements import("../db/types").SqlExecutor {
  calls: Call[] = [];
  existing: { severity_version: string; spec_json: unknown; spec_sha256: string; created_at: string } | null = null;

  async query<Row extends Record<string, unknown>>(text: string, params: Array<unknown> = []) {
    this.calls.push({ text: text.trim(), params });
    if (text.includes("FROM severity_specs")) {
      if (!this.existing || this.existing.severity_version !== String(params[0])) {
        return { rows: [] as Row[] };
      }
      return { rows: [this.existing as unknown as Row] };
    }
    if (text.includes("INSERT INTO severity_specs")) {
      this.existing = {
        severity_version: String(params[0]),
        spec_json: JSON.parse(String(params[1])),
        spec_sha256: String(params[2]),
        created_at: "2026-02-06T18:00:00.000Z",
      };
      return { rows: [] as Row[] };
    }
    return { rows: [] as Row[] };
  }
}

describe("PgSeveritySpecStore", () => {
  it("registers new severity spec and records allowlist insert", async () => {
    const db = new FakeDb();
    const events: string[] = [];
    const store = new PgSeveritySpecStore(db, {
      info(event) {
        events.push(event);
      },
    });

    const out = await store.registerSpec({
      severity_version: "sev.v1",
      spec: DEFAULT_SEVERITY_SPEC_V1,
    });
    expect(out.created).toBe(true);
    expect(out.spec_sha256).toBe(sha256Hex(stableStringify(DEFAULT_SEVERITY_SPEC_V1)));
    expect(db.calls.some((c) => c.text.startsWith("INSERT INTO severity_specs"))).toBe(true);
    expect(db.calls.some((c) => c.text.startsWith("INSERT INTO namespace_allowlist"))).toBe(true);
    expect(events.includes("severity_spec_registered")).toBe(true);
  });

  it("is idempotent when same severity_version/spec hash already exists", async () => {
    const db = new FakeDb();
    const specSha = sha256Hex(stableStringify(DEFAULT_SEVERITY_SPEC_V1));
    db.existing = {
      severity_version: "sev.v1",
      spec_json: DEFAULT_SEVERITY_SPEC_V1,
      spec_sha256: specSha,
      created_at: "2026-02-06T18:00:00.000Z",
    };
    const store = new PgSeveritySpecStore(db, { info() {} });

    const out = await store.registerSpec({
      severity_version: "sev.v1",
      spec: DEFAULT_SEVERITY_SPEC_V1,
    });
    expect(out.created).toBe(false);
    expect(out.spec_sha256).toBe(specSha);
  });

  it("rejects conflicting spec hash for same severity_version", async () => {
    const db = new FakeDb();
    db.existing = {
      severity_version: "sev.v1",
      spec_json: DEFAULT_SEVERITY_SPEC_V1,
      spec_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      created_at: "2026-02-06T18:00:00.000Z",
    };
    const store = new PgSeveritySpecStore(db, { info() {} });

    await expect(
      store.registerSpec({ severity_version: "sev.v1", spec: DEFAULT_SEVERITY_SPEC_V1 })
    ).rejects.toThrow("severity_version_conflict");
  });
});
