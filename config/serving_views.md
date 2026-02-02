# Serving Views (sv) and Token Rotation

This doc summarizes how serving view tokens (`sv`) bind dataset watermarks and how
key rotation should work. It is a reference for API implementation and audits.

## sv contents (opaque to clients)

An `sv` token pins:
- `system_id`
- GBFS watermarks: `gbfs.station_status`, `gbfs.station_information` (`publisher_last_updated`)
- Trips baseline dataset id + checksum (e.g., `trips.2026-01@sha256=...`)
- `severity_version` + `severity_spec_sha256`
- `tile_schema_version`

The server is the only issuer of valid `sv` (via `/api/time` and `/api/timeline`).
Clients treat `sv` as opaque; the API validates it and derives view metadata via
`serving_tokens` and `serving_views`.

## Token storage

- Store **only** a hash of the token (`token_sha256`), not the raw token.
- Track `token_hmac_kid`, `issued_at`, `expires_at`, and `view_spec_sha256` for
  reproducible serving.
- Record mint/validate outcomes in `serving_token_audit`.

## Rotation policy (kid-based)

- At any time, each system should have:
  - one `active` key (used to mint new tokens)
  - optionally one `retiring` key (valid for verification only)
- Rotation steps:
  1) Create new key as `active`
  2) Mark previous `active` as `retiring` with `valid_to`
  3) After grace window, mark `retiring` as `retired`
- Validation accepts `active` + `retiring` keys only.

## Expiry policy (default)

- Live-mode `sv` should be short-lived (e.g., hours).
- Replay `sv` may be long-lived (days or longer) but still bounded.
- `expires_at` must be enforced at validation time.

## Validation outcomes (audit)

Audit event types:
- `mint`
- `validate_ok`
- `validate_fail`
- `revoke`

Recommended failure `reason_code` values:
- `token_expired`
- `kid_unknown`
- `signature_invalid`
- `token_revoked`
- `view_mismatch`

## Determinism + cache keys

Tiles and policy results must be keyed by `sv` (not raw dataset ids).
Any change to bound specs or datasets must produce a new `sv` to avoid cache drift.
