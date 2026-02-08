import {
  base64UrlToJson,
  hmacSign,
  hmacVerify,
  jsonToBase64Url,
  sha256Hex,
} from "./encoding";
import type {
  MintResult,
  ServingKey,
  ServingTokenPayload,
  ServingTokenRecord,
  ServingTokenStore,
  ValidateResult,
} from "./types";

const TOKEN_PREFIX = "sv1";

type Clock = () => Date;

function nowSeconds(clock: Clock): number {
  return Math.floor(clock().getTime() / 1000);
}

function buildPayload(
  systemId: string,
  viewId: number,
  viewSpecSha256: string,
  ttlSeconds: number,
  clock: Clock
): ServingTokenPayload {
  const issuedAt = nowSeconds(clock);
  return {
    v: 1,
    system_id: systemId,
    view_id: viewId,
    view_spec_sha256: viewSpecSha256,
    issued_at_s: issuedAt,
    expires_at_s: issuedAt + ttlSeconds,
  };
}

function tokenDataToSign(kid: string, payloadB64: string): string {
  return `${TOKEN_PREFIX}.${kid}.${payloadB64}`;
}

function buildToken(kid: string, payloadB64: string, signatureB64: string): string {
  return `${TOKEN_PREFIX}.${kid}.${payloadB64}.${signatureB64}`;
}

export class ServingTokenService {
  private readonly store: ServingTokenStore;
  private readonly clock: Clock;
  private readonly clockSkewSeconds: number;

  constructor(
    store: ServingTokenStore,
    clock: Clock = () => new Date(),
    opts?: { clockSkewSeconds?: number }
  ) {
    this.store = store;
    this.clock = clock;
    this.clockSkewSeconds = Math.max(0, Math.floor(opts?.clockSkewSeconds ?? 30));
  }

  async mint({
    systemId,
    viewId,
    viewSpecSha256,
    ttlSeconds,
  }: {
    systemId: string;
    viewId: number;
    viewSpecSha256: string;
    ttlSeconds: number;
  }): Promise<MintResult> {
    const key = await this.store.getActiveKey(systemId);
    if (!key) {
      const audit = {
        event_type: "mint" as const,
        event_ts: this.clock(),
        system_id: systemId,
        reason_code: "no_active_key",
      };
      await this.store.saveAuditEvent(audit);
      return { ok: false, reason: "no_active_key", audit };
    }

    const payload = buildPayload(systemId, viewId, viewSpecSha256, ttlSeconds, this.clock);
    const payloadB64 = jsonToBase64Url(payload);
    const data = tokenDataToSign(key.kid, payloadB64);
    const signatureB64 = hmacSign(key.algo, key.secret, data);
    const token = buildToken(key.kid, payloadB64, signatureB64);
    const tokenSha256 = sha256Hex(token);

    const record: ServingTokenRecord = {
      token_sha256: tokenSha256,
      system_id: systemId,
      view_id: viewId,
      view_spec_sha256: viewSpecSha256,
      issued_at: new Date(payload.issued_at_s * 1000),
      expires_at: new Date(payload.expires_at_s * 1000),
      token_hmac_kid: key.kid,
    };

    await this.store.saveTokenRecord(record);
    await this.store.saveAuditEvent({
      event_type: "mint",
      event_ts: this.clock(),
      system_id: systemId,
      token_hmac_kid: key.kid,
      token_sha256: tokenSha256,
    });

    return {
      ok: true,
      token,
      token_sha256: tokenSha256,
      kid: key.kid,
      payload,
      audit: {
        event_type: "mint",
        event_ts: this.clock(),
        system_id: systemId,
        token_hmac_kid: key.kid,
        token_sha256: tokenSha256,
      },
    };
  }

  async validate(token: string): Promise<ValidateResult> {
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) {
      return await this.failAudit("token_format", { token_prefix: parts[0] });
    }

    const kid = parts[1];
    const payloadB64 = parts[2];
    const signatureB64 = parts[3];

    const key = await this.store.getKey(kid);
    if (!key || key.status === "retired") {
      return await this.failAudit("kid_unknown", { kid });
    }

    const now = nowSeconds(this.clock);
    if (now + this.clockSkewSeconds < Math.floor(key.valid_from.getTime() / 1000)) {
      return await this.failAudit("key_not_yet_valid", { kid });
    }
    if (key.valid_to && now - this.clockSkewSeconds > Math.floor(key.valid_to.getTime() / 1000)) {
      return await this.failAudit("key_expired", { kid });
    }

    const data = tokenDataToSign(kid, payloadB64);
    if (!hmacVerify(key.algo, key.secret, data, signatureB64)) {
      return await this.failAudit("signature_invalid", { kid });
    }

    let payload: ServingTokenPayload;
    try {
      payload = base64UrlToJson<ServingTokenPayload>(payloadB64);
    } catch {
      return await this.failAudit("payload_invalid", { kid });
    }

    if (payload.v !== 1) {
      return await this.failAudit("version_invalid", { kid, v: payload.v });
    }

    if (payload.expires_at_s + this.clockSkewSeconds <= now) {
      return await this.failAudit("token_expired", { kid, exp: payload.expires_at_s });
    }

    const tokenSha256 = sha256Hex(token);
    const record = await this.store.getTokenRecord(tokenSha256);
    if (!record) {
      return await this.failAudit("token_unknown", { kid, token_sha256: tokenSha256 });
    }

    if (record.revoked_at) {
      return await this.failAudit("token_revoked", { kid, token_sha256: tokenSha256 });
    }

    if (record.system_id !== payload.system_id) {
      return await this.failAudit("system_mismatch", {
        kid,
        token_sha256: tokenSha256,
        system_id: payload.system_id,
      });
    }

    if (record.view_id !== payload.view_id) {
      return await this.failAudit("view_id_mismatch", { kid, token_sha256: tokenSha256 });
    }

    if (record.view_spec_sha256 !== payload.view_spec_sha256) {
      return await this.failAudit("view_mismatch", { kid, token_sha256: tokenSha256 });
    }

    await this.store.saveAuditEvent({
      event_type: "validate_ok",
      event_ts: this.clock(),
      system_id: payload.system_id,
      token_hmac_kid: kid,
      token_sha256: tokenSha256,
    });

    return {
      ok: true,
      payload,
      token_sha256: tokenSha256,
      kid,
      audit: {
        event_type: "validate_ok",
        event_ts: this.clock(),
        system_id: payload.system_id,
        token_hmac_kid: kid,
        token_sha256: tokenSha256,
      },
    };
  }

  private async failAudit(
    reason: string,
    details?: Record<string, unknown>
  ): Promise<ValidateResult> {
    const kid =
      typeof details?.kid === "string" ? (details.kid as string) : undefined;
    const systemId =
      typeof details?.system_id === "string" ? (details.system_id as string) : undefined;
    const tokenSha256 =
      typeof details?.token_sha256 === "string" ? (details.token_sha256 as string) : undefined;
    const event = {
      event_type: "validate_fail" as const,
      event_ts: this.clock(),
      system_id: systemId,
      token_hmac_kid: kid,
      token_sha256: tokenSha256,
      reason_code: reason,
      details,
    };
    await this.store.saveAuditEvent(event);
    return { ok: false, reason, audit: event };
  }
}
