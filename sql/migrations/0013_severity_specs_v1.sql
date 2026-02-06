-- nyc-bike-urbanflow-gtk.1: severity spec v1 registry + hash persistence
-- Versioned, immutable severity specs with allowlist registration.

BEGIN;

CREATE TABLE IF NOT EXISTS severity_specs (
  severity_version TEXT PRIMARY KEY,
  spec_json JSONB NOT NULL,
  spec_sha256 TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (spec_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION severity_specs_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.severity_version <> OLD.severity_version
     OR NEW.spec_json <> OLD.spec_json
     OR NEW.spec_sha256 <> OLD.spec_sha256 THEN
    RAISE EXCEPTION 'severity_specs rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS severity_specs_immutable_trg ON severity_specs;
CREATE TRIGGER severity_specs_immutable_trg
BEFORE UPDATE ON severity_specs
FOR EACH ROW
EXECUTE FUNCTION severity_specs_block_mutation();

INSERT INTO severity_specs (severity_version, spec_json, spec_sha256, note)
VALUES (
  'sev.v1',
  '{
    "bucket_seconds": 300,
    "components": ["empty_flag", "full_flag", "capacity"],
    "formula": {
      "clamp_max": 1,
      "clamp_min": 0,
      "empty_weight": 1,
      "full_weight": 1,
      "type": "empty_or_full_flag"
    },
    "missing_data": {
      "allowed_bucket_quality": ["ok", "degraded"],
      "on_missing": "zero"
    },
    "version": "sev.v1"
  }'::jsonb,
  'd4bfe310333276632449f487dd974684c81a875d230b2b2cf6e217007e1c3394',
  'Default severity spec for station_severity_5m refresh formula'
)
ON CONFLICT (severity_version) DO NOTHING;

INSERT INTO namespace_allowlist (kind, system_id, value, note)
VALUES ('severity_version', NULL, 'sev.v1', 'Severity spec v1 registered in severity_specs')
ON CONFLICT (kind, value) WHERE system_id IS NULL DO NOTHING;

COMMIT;
