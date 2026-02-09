# Policy fixtures

These fixtures define deterministic inputs/expected outputs for the greedy v1
policy engine. The data is intentionally tiny but fully specified so tests can
enforce invariants before the engine is implemented.

Files:
- greedy_v1_input.json: policy spec + station state + neighborhood edges
- greedy_v1_expected.json: expected moves + station before/after summaries
- greedy_v1_tiebreak_input.json: tie-break-focused topology for deterministic edge ranking
- greedy_v1_tiebreak_expected.json: expected tie-break winner + bounded transfer output
- greedy_v1.manifest.json: checksums for the input/expected fixtures

Hashing rationale:
- checksum_sha256 is SHA-256 of the exact fixture bytes to prevent silent drift.
