import { readFile } from "fs/promises";

export type SystemId = string;

export type SystemConfig = {
  system_id: SystemId;
  gbfs_entrypoint_url: string;
  default_map_bounds: [number, number, number, number];
  default_center: [number, number];
  timezone: string;
  provider_name: string;
  provider_region: string;
};

export type SystemRegistry = {
  version: number;
  systems: SystemConfig[];
};

export type SystemRegistryIndex = {
  version: number;
  systems: SystemConfig[];
  systemsById: Record<SystemId, SystemConfig>;
};

export type SystemRegistryOverrides = {
  overrides?: Partial<SystemConfig>[];
};

export type Logger = {
  info: (event: string, meta?: Record<string, unknown>) => void;
  warn: (event: string, meta?: Record<string, unknown>) => void;
  error: (event: string, meta?: Record<string, unknown>) => void;
};

export const DEFAULT_SYSTEM_REGISTRY_PATH = "config/systems.json";

const SYSTEM_ID_RE = /^[a-z0-9-]+$/;
const TIMEZONE_RE = /^[A-Za-z0-9_+-]+\/[A-Za-z0-9_+-]+$/;

const noopLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export async function loadSystemRegistryFromFile(
  filePath: string = DEFAULT_SYSTEM_REGISTRY_PATH,
  options: SystemRegistryOverrides & { logger?: Logger } = {},
): Promise<SystemRegistryIndex> {
  const logger = options.logger ?? noopLogger;
  logger.info("system_registry.load.start", { filePath });
  const raw = await readFile(filePath, "utf8");
  const registry = parseSystemRegistry(raw, options);
  logger.info("system_registry.load.ok", {
    filePath,
    system_count: registry.systems.length,
    version: registry.version,
  });
  return registry;
}

export function parseSystemRegistry(
  rawJson: string,
  options: SystemRegistryOverrides & { logger?: Logger } = {},
): SystemRegistryIndex {
  const logger = options.logger ?? noopLogger;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    logger.error("system_registry.parse.error", { error: String(error) });
    throw error;
  }

  const normalized = normalizeRegistry(parsed);
  const merged = applyOverrides(normalized, options.overrides, logger);
  const errors = validateSystemRegistry(merged);
  if (errors.length > 0) {
    logger.error("system_registry.validate.error", { errors });
    throw new Error(`System registry validation failed: ${errors.join("; ")}`);
  }

  return indexSystemRegistry(merged);
}

export function indexSystemRegistry(registry: SystemRegistry): SystemRegistryIndex {
  const systemsById: Record<SystemId, SystemConfig> = {};
  for (const system of registry.systems) {
    systemsById[system.system_id] = system;
  }
  return { version: registry.version, systems: registry.systems, systemsById };
}

export function getSystemOrThrow(
  registry: SystemRegistryIndex,
  systemId: SystemId,
  logger: Logger = noopLogger,
): SystemConfig {
  const system = registry.systemsById[systemId];
  if (!system) {
    logger.warn("system_registry.system.missing", { system_id: systemId });
    throw new Error(`Unknown system_id: ${systemId}`);
  }
  return system;
}

export function validateSystemRegistry(registry: SystemRegistry): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(registry.version) || registry.version <= 0) {
    errors.push("version must be a positive integer");
  }
  if (!Array.isArray(registry.systems) || registry.systems.length === 0) {
    errors.push("systems must be a non-empty array");
    return errors;
  }
  const seen = new Set<string>();
  registry.systems.forEach((system, index) => {
    const prefix = `systems[${index}]`;
    if (seen.has(system.system_id)) {
      errors.push(`${prefix}.system_id duplicate: ${system.system_id}`);
    }
    seen.add(system.system_id);
    errors.push(...validateSystemConfig(system, prefix));
  });
  return errors;
}

export function validateSystemConfig(system: SystemConfig, prefix = "system"): string[] {
  const errors: string[] = [];
  if (!system.system_id || !SYSTEM_ID_RE.test(system.system_id)) {
    errors.push(`${prefix}.system_id must match ${SYSTEM_ID_RE.source}`);
  }
  if (!system.gbfs_entrypoint_url) {
    errors.push(`${prefix}.gbfs_entrypoint_url is required`);
  } else {
    try {
      new URL(system.gbfs_entrypoint_url);
    } catch {
      errors.push(`${prefix}.gbfs_entrypoint_url must be a valid URL`);
    }
  }
  if (!Array.isArray(system.default_map_bounds) || system.default_map_bounds.length !== 4) {
    errors.push(`${prefix}.default_map_bounds must be [minLng, minLat, maxLng, maxLat]`);
  } else {
    const [minLng, minLat, maxLng, maxLat] = system.default_map_bounds;
    if (!isLngLat(minLng, minLat) || !isLngLat(maxLng, maxLat)) {
      errors.push(`${prefix}.default_map_bounds values must be valid lng/lat`);
    } else if (minLng >= maxLng || minLat >= maxLat) {
      errors.push(`${prefix}.default_map_bounds must be ordered min < max`);
    }
  }
  if (!Array.isArray(system.default_center) || system.default_center.length !== 2) {
    errors.push(`${prefix}.default_center must be [lng, lat]`);
  } else {
    const [lng, lat] = system.default_center;
    if (!isLngLat(lng, lat)) {
      errors.push(`${prefix}.default_center values must be valid lng/lat`);
    }
  }
  if (!system.timezone || !TIMEZONE_RE.test(system.timezone)) {
    errors.push(`${prefix}.timezone must look like "Area/Location"`);
  }
  if (!system.provider_name) {
    errors.push(`${prefix}.provider_name is required`);
  }
  if (!system.provider_region) {
    errors.push(`${prefix}.provider_region is required`);
  }
  return errors;
}

function normalizeRegistry(parsed: unknown): SystemRegistry {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("System registry must be a JSON object");
  }
  const registry = parsed as Partial<SystemRegistry>;
  return {
    version: registry.version ?? 1,
    systems: (registry.systems ?? []) as SystemConfig[],
  };
}

function applyOverrides(
  registry: SystemRegistry,
  overrides: Partial<SystemConfig>[] | undefined,
  logger: Logger,
): SystemRegistry {
  if (!overrides || overrides.length === 0) {
    return registry;
  }
  const systems = [...registry.systems];
  for (const override of overrides) {
    if (!override.system_id) {
      logger.warn("system_registry.override.skip", {
        reason: "missing system_id",
      });
      continue;
    }
    const index = systems.findIndex((system) => system.system_id === override.system_id);
    if (index === -1) {
      logger.info("system_registry.override.add", { system_id: override.system_id });
      systems.push(override as SystemConfig);
    } else {
      logger.info("system_registry.override.merge", { system_id: override.system_id });
      systems[index] = { ...systems[index], ...override };
    }
  }
  return { ...registry, systems };
}

function isLngLat(lng: number, lat: number): boolean {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}
