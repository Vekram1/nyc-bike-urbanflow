import type { SystemConfig } from "./types";

export const DEFAULT_SYSTEMS: SystemConfig[] = [
  {
    system_id: "citibike-nyc",
    gbfs_entrypoint_url: "https://gbfs.citibikenyc.com/gbfs/gbfs.json",
    default_map_bounds: [-74.25559, 40.49612, -73.70001, 40.91553],
    default_center: [-73.98513, 40.7589],
    timezone: "America/New_York",
    provider_name: "Citi Bike",
    provider_region: "New York City",
  },
];
