# Tile fixtures

Contract fixtures for tile schemas and required properties. These fixtures are
not generated from code yet; they define the expected contract surface so later
tile builders can be validated against stable, reviewable inputs.

Files:
- composite_tile.contract.json: required + optional properties per layer
- composite_tile.manifest.json: checksum for the contract fixture

Hashing rationale:
- checksum_sha256 is SHA-256 of the exact fixture bytes to prevent silent drift.
