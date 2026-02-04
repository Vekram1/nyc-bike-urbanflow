# GBFS fixtures

These fixtures provide raw GBFS payload bytes alongside manifests that record
canonical hashes and parser fingerprints.

Hashing rationale:
- raw_object_sha256 is SHA-256 of the exact response bytes (content-addressed
  storage); it is stable across runs and supports dedupe.
- parser_fingerprint is SHA-256 of "<parse_schema_id>:<loader_schema_version>".
  This pins deterministic parsing behavior to the schema + loader version.

Fixtures:
- raw/station_status.json
- raw/station_information.json
- manifests/*.manifest.json
