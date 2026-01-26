# Replay Data

Use this directory for locally recorded GBFS snapshots.

Suggested layout:
- `data/replay/<date>/station_information.json`
- `data/replay/<date>/station_status.json`

Record snapshots with the ingest recorder, then point the replay process at the
recorded files for deterministic local testing.
