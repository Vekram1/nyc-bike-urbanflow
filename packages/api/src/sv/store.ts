import type { SqlExecutor } from "../db/types";
import type {
  AuditEvent,
  ServingKey,
  ServingTokenRecord,
  ServingTokenStore,
} from "./types";

export type ServingKeyMaterialProvider = {
  getSecret(kid: string, systemId: string): Promise<Uint8Array | null>;
};

type ServingKeyRow = {
  kid: string;
  system_id: string;
  algo: "HS256" | "HS512";
  status: "active" | "retiring" | "retired";
  valid_from: string;
  valid_to: string | null;
};

type ServingTokenRow = {
  token_sha256: string;
  system_id: string;
  view_id: number;
  view_spec_sha256: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  token_hmac_kid: string;
};

export class PgServingTokenStore implements ServingTokenStore {
  private readonly db: SqlExecutor;
  private readonly keyMaterial: ServingKeyMaterialProvider;

  constructor(db: SqlExecutor, keyMaterial: ServingKeyMaterialProvider) {
    this.db = db;
    this.keyMaterial = keyMaterial;
  }

  async getActiveKey(system_id: string): Promise<ServingKey | null> {
    const rows = await this.db.query<ServingKeyRow>(
      `SELECT kid, system_id, algo, status, valid_from, valid_to
       FROM serving_keys
       WHERE system_id = $1
         AND status = 'active'
         AND valid_from <= NOW()
         AND (valid_to IS NULL OR valid_to > NOW())
       ORDER BY valid_from DESC
       LIMIT 1`,
      [system_id]
    );
    if (rows.rows.length === 0) {
      return null;
    }
    return this.hydrateKey(rows.rows[0]);
  }

  async getKey(kid: string): Promise<ServingKey | null> {
    const rows = await this.db.query<ServingKeyRow>(
      `SELECT kid, system_id, algo, status, valid_from, valid_to
       FROM serving_keys
       WHERE kid = $1
       LIMIT 1`,
      [kid]
    );
    if (rows.rows.length === 0) {
      return null;
    }
    return this.hydrateKey(rows.rows[0]);
  }

  async getTokenRecord(token_sha256: string): Promise<ServingTokenRecord | null> {
    const rows = await this.db.query<ServingTokenRow>(
      `SELECT token_sha256, system_id, view_id, view_spec_sha256,
              issued_at, expires_at, revoked_at, token_hmac_kid
       FROM serving_tokens
       WHERE token_sha256 = $1
       LIMIT 1`,
      [token_sha256]
    );
    if (rows.rows.length === 0) {
      return null;
    }
    const row = rows.rows[0];
    return {
      token_sha256: row.token_sha256,
      system_id: row.system_id,
      view_id: row.view_id,
      view_spec_sha256: row.view_spec_sha256,
      issued_at: new Date(row.issued_at),
      expires_at: new Date(row.expires_at),
      revoked_at: row.revoked_at ? new Date(row.revoked_at) : null,
      token_hmac_kid: row.token_hmac_kid,
    };
  }

  async saveTokenRecord(record: ServingTokenRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO serving_tokens (
         token_sha256,
         system_id,
         view_id,
         view_spec_sha256,
         issued_at,
         expires_at,
         token_hmac_kid,
         revoked_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (token_sha256) DO NOTHING`,
      [
        record.token_sha256,
        record.system_id,
        record.view_id,
        record.view_spec_sha256,
        record.issued_at,
        record.expires_at,
        record.token_hmac_kid,
        record.revoked_at ?? null,
      ]
    );
  }

  async saveAuditEvent(event: AuditEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO serving_token_audit (
         event_ts,
         event_type,
         system_id,
         token_hmac_kid,
         token_sha256,
         reason_code,
         details_json
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.event_ts,
        event.event_type,
        event.system_id ?? null,
        event.token_hmac_kid ?? null,
        event.token_sha256 ?? null,
        event.reason_code ?? null,
        event.details ? JSON.stringify(event.details) : null,
      ]
    );
  }

  private async hydrateKey(row: ServingKeyRow): Promise<ServingKey | null> {
    const secret = await this.keyMaterial.getSecret(row.kid, row.system_id);
    if (!secret) {
      return null;
    }
    return {
      kid: row.kid,
      system_id: row.system_id,
      algo: row.algo,
      status: row.status,
      secret,
      valid_from: new Date(row.valid_from),
      valid_to: row.valid_to ? new Date(row.valid_to) : null,
    };
  }
}
