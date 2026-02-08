import { describe, expect, it } from "bun:test";

import { ServingTokenService } from "./service";
import type { AuditEvent, ServingKey, ServingTokenRecord, ServingTokenStore } from "./types";

class MemoryStore implements ServingTokenStore {
  keysByKid = new Map<string, ServingKey>();
  activeKidBySystem = new Map<string, string>();
  records = new Map<string, ServingTokenRecord>();
  audits: AuditEvent[] = [];

  async getActiveKey(system_id: string): Promise<ServingKey | null> {
    const kid = this.activeKidBySystem.get(system_id);
    if (!kid) {
      return null;
    }
    return this.keysByKid.get(kid) ?? null;
  }

  async getKey(kid: string): Promise<ServingKey | null> {
    return this.keysByKid.get(kid) ?? null;
  }

  async getTokenRecord(token_sha256: string): Promise<ServingTokenRecord | null> {
    return this.records.get(token_sha256) ?? null;
  }

  async saveTokenRecord(record: ServingTokenRecord): Promise<void> {
    this.records.set(record.token_sha256, record);
  }

  async saveAuditEvent(event: AuditEvent): Promise<void> {
    this.audits.push(event);
  }
}

function makeKey(args: {
  kid: string;
  system_id?: string;
  status?: "active" | "retiring" | "retired";
  valid_from?: Date;
  valid_to?: Date | null;
}): ServingKey {
  return {
    kid: args.kid,
    system_id: args.system_id ?? "citibike-nyc",
    algo: "HS256",
    status: args.status ?? "active",
    secret: new TextEncoder().encode(`secret-${args.kid}`),
    valid_from: args.valid_from ?? new Date("2026-02-06T18:00:00.000Z"),
    valid_to: args.valid_to ?? null,
  };
}

describe("ServingTokenService", () => {
  it("mints and validates token with audit trail", async () => {
    const store = new MemoryStore();
    const key = makeKey({ kid: "kid-a" });
    store.keysByKid.set(key.kid, key);
    store.activeKidBySystem.set("citibike-nyc", key.kid);

    const svc = new ServingTokenService(store, () => new Date("2026-02-06T18:30:10.000Z"));
    const minted = await svc.mint({
      systemId: "citibike-nyc",
      viewId: 7,
      viewSpecSha256: "spec-hash",
      ttlSeconds: 600,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) {
      return;
    }
    const validated = await svc.validate(minted.token);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.payload.system_id).toBe("citibike-nyc");
    expect(validated.payload.view_id).toBe(7);
    expect(store.audits.some((a) => a.event_type === "mint")).toBe(true);
    expect(store.audits.some((a) => a.event_type === "validate_ok")).toBe(true);
  });

  it("accepts retiring key tokens after active key rotation", async () => {
    const store = new MemoryStore();
    const oldKey = makeKey({ kid: "kid-old", status: "active" });
    const newKey = makeKey({ kid: "kid-new", status: "active" });
    store.keysByKid.set(oldKey.kid, oldKey);
    store.keysByKid.set(newKey.kid, newKey);
    store.activeKidBySystem.set("citibike-nyc", oldKey.kid);

    const svc = new ServingTokenService(store, () => new Date("2026-02-06T18:30:10.000Z"));
    const minted = await svc.mint({
      systemId: "citibike-nyc",
      viewId: 11,
      viewSpecSha256: "spec-hash",
      ttlSeconds: 600,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) {
      return;
    }

    store.activeKidBySystem.set("citibike-nyc", newKey.kid);
    store.keysByKid.set(
      oldKey.kid,
      makeKey({
        kid: "kid-old",
        status: "retiring",
        valid_to: new Date("2026-02-06T19:00:00.000Z"),
      })
    );

    const validated = await svc.validate(minted.token);
    expect(validated.ok).toBe(true);
  });

  it("applies clock skew tolerance for token expiry boundaries", async () => {
    const store = new MemoryStore();
    const key = makeKey({ kid: "kid-a" });
    store.keysByKid.set(key.kid, key);
    store.activeKidBySystem.set("citibike-nyc", key.kid);

    let now = new Date("2026-02-06T18:30:10.000Z");
    const svc = new ServingTokenService(store, () => now, { clockSkewSeconds: 30 });

    const minted = await svc.mint({
      systemId: "citibike-nyc",
      viewId: 7,
      viewSpecSha256: "spec-hash",
      ttlSeconds: 10,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) {
      return;
    }

    now = new Date("2026-02-06T18:30:35.000Z");
    const withinSkew = await svc.validate(minted.token);
    expect(withinSkew.ok).toBe(true);

    now = new Date("2026-02-06T18:30:51.000Z");
    const expired = await svc.validate(minted.token);
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.reason).toBe("token_expired");
    }
  });
});
