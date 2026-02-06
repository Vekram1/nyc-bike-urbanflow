# System registry config

Default path: `config/systems.json`

Override path (full replace): set `SYSTEM_REGISTRY_PATH` to a JSON file path.
Optional local overlay: `config/systems.local.json` (merged by `system_id`).

Expected JSON shape:
```json
{
  "version": 1,
  "systems": [
    {
      "system_id": "example-system",
      "display_name": "Example System",
      "timezone": "America/New_York",
      "gbfs": {
        "auto_discovery_url": "https://example.com/gbfs/gbfs.json"
      },
      "bounds": {
        "min_lon": -74.05,
        "min_lat": 40.68,
        "max_lon": -73.85,
        "max_lat": 40.85
      }
    }
  ]
}
```

Other config docs:
- `config/station_neighbors.md`: rebuild cadence + determinism for station neighbor index.
- `config/serving_aggregates.md`: refresh cadence + lineage + quality metrics for serving aggregates.
- `config/tiles.md`: immutable tile cache keys, canonical SQL shape, and tile degrade caps.
- `config/stations.md`: station detail/series endpoint bounds and logging behavior.
- `config/policy_outputs.md`: policy run/move persistence keys and eval-daily refresh logging.
- `config/policy_plane.md`: policy HTTP endpoints, async 202 behavior, and policy-moves tile contract.
