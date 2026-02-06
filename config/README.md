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
