-- nyc-bike-urbanflow-lav.1: Namespace allowlist registry + enforcement
-- Bounded keyspace enforcement for cache-key dimensions.

BEGIN;

CREATE TABLE namespace_allowlist (
  allow_id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  system_id TEXT REFERENCES systems(system_id),
  value TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ,
  CHECK (kind IN (
    'system_id',
    'tile_schema',
    'severity_version',
    'policy_version',
    'layers_set',
    'compare_mode'
  ))
);

-- Uniqueness is scoped by kind and optional system_id (NULL treated as global).
CREATE UNIQUE INDEX namespace_allowlist_uniq_global_idx
  ON namespace_allowlist (kind, value)
  WHERE system_id IS NULL;
CREATE UNIQUE INDEX namespace_allowlist_uniq_system_idx
  ON namespace_allowlist (kind, system_id, value)
  WHERE system_id IS NOT NULL;
CREATE INDEX namespace_allowlist_kind_idx
  ON namespace_allowlist (kind, system_id, created_at DESC);
CREATE INDEX namespace_allowlist_enabled_idx
  ON namespace_allowlist (kind, system_id)
  WHERE disabled_at IS NULL;

COMMIT;
