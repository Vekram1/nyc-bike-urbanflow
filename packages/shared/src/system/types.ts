export type SystemId = string;

export type MapBounds = [number, number, number, number];
export type MapCenter = [number, number];

export interface SystemConfig {
  system_id: SystemId;
  gbfs_entrypoint_url: string;
  default_map_bounds: MapBounds;
  default_center: MapCenter;
  timezone: string;
  provider_name: string;
  provider_region: string;
}

export interface SystemRegistry {
  all: SystemConfig[];
  byId: Map<SystemId, SystemConfig>;
}

export interface RegistryLoadOptions {
  /**
   * JSON string with an array of SystemConfig entries.
   * Overrides file-based loading when provided.
   */
  inlineJson?: string;
  /**
   * Absolute or repo-relative path to a JSON file with SystemConfig[] contents.
   */
  filePath?: string;
}

export interface RegistryLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export class UnknownSystemIdError extends Error {
  readonly systemId: SystemId;

  constructor(systemId: SystemId) {
    super(`Unknown system_id: ${systemId}`);
    this.systemId = systemId;
  }
}

export class SystemRegistryError extends Error {}
