-- nyc-bike-urbanflow-gtk.17: sv storage tables + token rotation/audit
-- Serving view registry + opaque token tracking (no raw token storage).

BEGIN;

CREATE TABLE serving_views (
  view_id BIGSERIAL PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  view_version TEXT NOT NULL,
  view_spec_json JSONB NOT NULL,
  view_spec_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (system_id, view_version, view_spec_sha256)
);

CREATE INDEX serving_views_system_idx
  ON serving_views (system_id, created_at DESC);

CREATE TABLE serving_keys (
  kid TEXT PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  algo TEXT NOT NULL,
  status TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  CHECK (algo IN ('HS256', 'HS512')),
  CHECK (status IN ('active', 'retiring', 'retired'))
);

CREATE INDEX serving_keys_system_idx
  ON serving_keys (system_id, status);

CREATE TABLE serving_tokens (
  token_id BIGSERIAL PRIMARY KEY,
  system_id TEXT NOT NULL REFERENCES systems(system_id),
  view_id BIGINT NOT NULL REFERENCES serving_views(view_id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  view_spec_sha256 TEXT NOT NULL,
  token_hmac_kid TEXT NOT NULL REFERENCES serving_keys(kid),
  token_sha256 TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > issued_at)
);

CREATE UNIQUE INDEX serving_tokens_sha256_idx
  ON serving_tokens (token_sha256);
CREATE INDEX serving_tokens_system_idx
  ON serving_tokens (system_id, expires_at DESC);
CREATE INDEX serving_tokens_kid_idx
  ON serving_tokens (token_hmac_kid, expires_at DESC);

CREATE TABLE serving_token_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type TEXT NOT NULL,
  system_id TEXT,
  token_hmac_kid TEXT,
  token_sha256 TEXT,
  reason_code TEXT,
  ip_addr INET,
  user_agent TEXT,
  details_json JSONB,
  CHECK (event_type IN ('mint', 'validate_ok', 'validate_fail', 'revoke'))
);

CREATE INDEX serving_token_audit_ts_idx
  ON serving_token_audit (event_ts DESC);
CREATE INDEX serving_token_audit_kid_idx
  ON serving_token_audit (token_hmac_kid, event_ts DESC);

COMMIT;
