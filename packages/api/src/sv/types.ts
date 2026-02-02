export type SvAlgo = "HS256" | "HS512";

export type SvKeyStatus = "active" | "retiring" | "retired";

export type ServingKey = {
  kid: string;
  system_id: string;
  algo: SvAlgo;
  status: SvKeyStatus;
  secret: Uint8Array;
  valid_from: Date;
  valid_to?: Date | null;
};

// Kept separate from serving-views/ServingViewSpec to avoid barrel export collisions.
export type SvViewSpec = {
  system_id: string;
  datasets: Record<string, string>;
  severity_version: string;
  severity_spec_sha256: string;
  tile_schema_version: string;
  trips_baseline_id?: string;
  trips_baseline_sha256?: string;
};

export type ServingTokenPayload = {
  v: number;
  system_id: string;
  view_id: number;
  view_spec_sha256: string;
  issued_at_s: number;
  expires_at_s: number;
};

export type ServingTokenRecord = {
  token_sha256: string;
  system_id: string;
  view_id: number;
  view_spec_sha256: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at?: Date | null;
  token_hmac_kid: string;
};

export type AuditEventType = "mint" | "validate_ok" | "validate_fail" | "revoke";

export type AuditEvent = {
  event_type: AuditEventType;
  event_ts: Date;
  system_id?: string;
  token_hmac_kid?: string;
  token_sha256?: string;
  reason_code?: string;
  details?: Record<string, unknown>;
};

export type MintResult =
  | {
      ok: true;
      token: string;
      token_sha256: string;
      kid: string;
      payload: ServingTokenPayload;
      audit: AuditEvent;
    }
  | {
      ok: false;
      reason: string;
      audit: AuditEvent;
    };

export type ValidateResult =
  | {
      ok: true;
      payload: ServingTokenPayload;
      token_sha256: string;
      kid: string;
      audit: AuditEvent;
    }
  | {
      ok: false;
      reason: string;
      audit: AuditEvent;
    };

export type ServingTokenStore = {
  getActiveKey(system_id: string): Promise<ServingKey | null>;
  getKey(kid: string): Promise<ServingKey | null>;
  getTokenRecord(token_sha256: string): Promise<ServingTokenRecord | null>;
  saveTokenRecord(record: ServingTokenRecord): Promise<void>;
  saveAuditEvent(event: AuditEvent): Promise<void>;
};
