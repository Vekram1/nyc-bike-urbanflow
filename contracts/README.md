# Contract fixtures

This directory documents and anchors contract fixtures for tiles, policy, and
ingestion outputs. Fixtures live under `fixtures/` with checksums and small,
reviewable datasets. Deterministic tests reference these fixtures to prevent
silent contract drift.

Current fixtures:
- `fixtures/gbfs/*`
- `fixtures/trips/*`
- `fixtures/tiles/*`
- `fixtures/policy/*`

Tile contract assertions (backend):
- `packages/api/src/http/tiles.contract.test.ts`
- Validates fixture checksum integrity for `fixtures/tiles/composite_tile.contract.json`.
- Asserts required property coverage for composite SQL shape (inv/sev/press/epi).
- Asserts deterministic replay cache key behavior for fixed `z/x/y/T_bucket/sv` and canonicalized `layers`.
