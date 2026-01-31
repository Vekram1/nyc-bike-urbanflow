# System registry

This module provides the system registry used to validate `system_id` and load
system configuration in a deterministic, allowlisted way.

## Load order

1. `URBANFLOW_SYSTEMS_JSON` (inline JSON string)
2. `URBANFLOW_SYSTEMS_PATH` (path to JSON file)
3. `DEFAULT_SYSTEMS` fallback

Both `loadSystemRegistry` and `getSystemConfig` are exported from
`packages/shared/src/system`.

## Expected JSON shape

The registry JSON must be an array of objects matching:

- system_id (string)
- gbfs_entrypoint_url (string, https://)
- default_map_bounds ([minLng, minLat, maxLng, maxLat])
- default_center ([lng, lat])
- timezone (string)
- provider_name (string)
- provider_region (string)
