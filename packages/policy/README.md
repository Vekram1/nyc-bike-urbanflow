# Policy Engine (`rebal.greedy.v1`)

This package implements deterministic greedy rebalancing for decision buckets.

## Determinism contract

- Candidate ordering:
  1. minimum `dist_m`
  2. maximum transferable bikes
  3. lexicographic `(from_station_key, to_station_key)`
- Station bounds are enforced via per-station band:
  - `L_s = ceil(alpha * capacity)`
  - `U_s = floor(beta * capacity)`
- Move conservation:
  - bikes moved out of donors always equals bikes moved into receivers
  - station bike counts remain within `[0, capacity]`

## Version + spec hash

- Policy version is explicit in input (`policy_version`).
- Spec hash is derived from stable JSON serialization of `spec`:
  - `policy_spec_sha256 = sha256(stableStringify(spec))`

## Fixture-backed validation

- Primary fixture regression:
  - `fixtures/policy/greedy_v1_input.json`
  - `fixtures/policy/greedy_v1_expected.json`
- Run:
  - `bun test packages/policy/src/greedy_v1.test.ts`
