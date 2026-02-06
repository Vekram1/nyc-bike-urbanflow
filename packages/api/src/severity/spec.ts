import crypto from "crypto";

import type { SqlExecutor } from "../db/types";
import {
  validateSeveritySpecV1,
  type SeveritySpecV1,
} from "../../../shared/src/severity/schema";

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
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringifyValue(v)}`).join(",")}}`;
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

export const DEFAULT_SEVERITY_SPEC_V1: SeveritySpecV1 = {
  version: "sev.v1",
  bucket_seconds: 300,
  formula: {
    type: "empty_or_full_flag",
    empty_weight: 1,
    full_weight: 1,
    clamp_min: 0,
    clamp_max: 1,
  },
  missing_data: {
    allowed_bucket_quality: ["ok", "degraded"],
    on_missing: "zero",
  },
  components: ["empty_flag", "full_flag", "capacity"],
};

export type SeveritySpecRecord = {
  severity_version: string;
  spec_json: unknown;
  spec_sha256: string;
  created_at: string;
};

type SeveritySpecRow = {
  severity_version: string;
  spec_json: unknown;
  spec_sha256: string;
  created_at: Date | string;
};

export type SeveritySpecLogger = {
  info(event: string, details: Record<string, unknown>): void;
};

const defaultLogger: SeveritySpecLogger = {
  info(event, details) {
    console.info(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...details }));
  },
};

export class PgSeveritySpecStore {
  private readonly db: SqlExecutor;
  private readonly logger: SeveritySpecLogger;

  constructor(db: SqlExecutor, logger?: SeveritySpecLogger) {
    this.db = db;
    this.logger = logger ?? defaultLogger;
  }

  async getSpec(severityVersion: string): Promise<SeveritySpecRecord | null> {
    const out = await this.db.query<SeveritySpecRow>(
      `SELECT severity_version, spec_json, spec_sha256, created_at
       FROM severity_specs
       WHERE severity_version = $1
       LIMIT 1`,
      [severityVersion]
    );
    const row = out.rows[0];
    if (!row) {
      return null;
    }
    return {
      severity_version: row.severity_version,
      spec_json: row.spec_json,
      spec_sha256: row.spec_sha256,
      created_at: new Date(row.created_at).toISOString(),
    };
  }

  async registerSpec(params: {
    severity_version: string;
    spec: unknown;
    note?: string;
    ensure_allowlist?: boolean;
  }): Promise<{ created: boolean; spec_sha256: string }> {
    const validation = validateSeveritySpecV1(params.spec);
    if (!validation.ok) {
      throw new Error(`invalid_severity_spec:${validation.errors.join(";")}`);
    }

    const canonical = stableStringify(validation.value);
    const specSha = sha256Hex(canonical);

    const existing = await this.getSpec(params.severity_version);
    if (existing) {
      if (existing.spec_sha256 !== specSha) {
        throw new Error("severity_version_conflict");
      }
      this.logger.info("severity_spec_exists", {
        severity_version: params.severity_version,
        spec_sha256: specSha,
      });
      return { created: false, spec_sha256: specSha };
    }

    await this.db.query(
      `INSERT INTO severity_specs (severity_version, spec_json, spec_sha256, note)
       VALUES ($1, $2::jsonb, $3, $4)`,
      [params.severity_version, canonical, specSha, params.note ?? null]
    );

    if (params.ensure_allowlist ?? true) {
      await this.db.query(
        `INSERT INTO namespace_allowlist (kind, system_id, value, note)
         VALUES ('severity_version', NULL, $1, $2)
         ON CONFLICT (kind, value) WHERE system_id IS NULL DO NOTHING`,
        [params.severity_version, "Auto-registered from severity_specs"]
      );
    }

    this.logger.info("severity_spec_registered", {
      severity_version: params.severity_version,
      spec_sha256: specSha,
      allowlist_registered: params.ensure_allowlist ?? true,
    });
    return { created: true, spec_sha256: specSha };
  }
}
