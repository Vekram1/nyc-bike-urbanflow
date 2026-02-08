# Namespace Allowlist

The namespace allowlist enforces a bounded cache-keyspace for public endpoints by
rejecting unknown dimension values with HTTP 400 (and `Cache-Control: no-store`).

This is a core abuse-defense: clients must not be able to invent arbitrary
`system_id`, version strings, or layer sets to force unbounded origin work or CDN
cache pollution.

## DB table

Migration: `sql/migrations/0003_namespace_allowlist.sql`
Seed defaults: `sql/migrations/0017_allowlist_seed_defaults.sql`

Table: `namespace_allowlist`
- `kind`: one of:
  - `system_id`
  - `tile_schema`
  - `severity_version`
  - `policy_version`
  - `layers_set` (canonical CSV, sorted)
  - `compare_mode`
- `system_id`: optional scope (NULL = global entry)
- `value`: the allowed string value
- `disabled_at`: when set, entry is treated as disallowed

## Global vs system-scoped entries

- Global entries (`system_id IS NULL`) apply to all systems.
- System-scoped entries apply only to that system.
- API lookup treats either as a match when a `system_id` is provided.

## API usage

Use `PgAllowlistStore` + `enforceAllowlistedQueryParams` from `packages/api/src/allowlist/*`.

Rules:
- Reject unknown values with 400.
- For rejected requests, return `Cache-Control: no-store` so intermediaries do not cache.
- Log `allowlist_reject` with `kind`, `value`, and `system_id`.

## Config export

`/api/config` may export allowlist-derived values so clients only request known
cache-key dimensions:
- `system_ids`
- `tile_schemas`
- `severity_versions`
- `policy_versions`
- `layers_sets`
- `compare_modes`

Preferred behavior:
- source values from `namespace_allowlist` (global + system-scoped entries)
- keep output sorted and deterministic for stable client behavior.

## Maintenance workflow (manual)

Add a value:
```sql
INSERT INTO namespace_allowlist(kind, system_id, value, note)
VALUES ('severity_version', NULL, 'sev.v1', 'Initial severity version');
```

Disable a value:
```sql
UPDATE namespace_allowlist
SET disabled_at = NOW()
WHERE kind='severity_version' AND system_id IS NULL AND value='sev.v1';
```

Re-enable:
```sql
UPDATE namespace_allowlist
SET disabled_at = NULL
WHERE kind='severity_version' AND system_id IS NULL AND value='sev.v1';
```
