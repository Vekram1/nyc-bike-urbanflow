import fs from "fs";
import path from "path";

export type SystemBounds = {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
};

export type SystemGbfs = {
  auto_discovery_url: string;
};

export type SystemConfig = {
  system_id: string;
  display_name: string;
  timezone: string;
  gbfs: SystemGbfs;
  bounds: SystemBounds;
};

export type SystemRegistry = {
  version: number;
  systems: SystemConfig[];
};

type RegistryLoadOptions = {
  registryPath?: string;
  localOverlayPath?: string;
  cwd?: string;
};

const DEFAULT_REGISTRY_PATH = "config/systems.json";
const DEFAULT_LOCAL_OVERLAY_PATH = "config/systems.local.json";

function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  data: Record<string, unknown>
): void {
  const payload = {
    level,
    event,
    ts: new Date().toISOString(),
    ...data,
  };
  if (level === "error") {
    console.error(JSON.stringify(payload));
  } else if (level === "warn") {
    console.warn(JSON.stringify(payload));
  } else {
    console.info(JSON.stringify(payload));
  }
}

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function validateTimezone(timezone: string): void {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
}

function validateBounds(bounds: SystemBounds, systemId: string): void {
  const { min_lon, min_lat, max_lon, max_lat } = bounds;
  if (
    min_lon < -180 ||
    min_lon > 180 ||
    max_lon < -180 ||
    max_lon > 180 ||
    min_lat < -90 ||
    min_lat > 90 ||
    max_lat < -90 ||
    max_lat > 90
  ) {
    throw new Error(`Bounds out of range for system_id=${systemId}`);
  }
  if (min_lon >= max_lon || min_lat >= max_lat) {
    throw new Error(`Bounds invalid (min >= max) for system_id=${systemId}`);
  }
}

function validateSystemConfig(system: SystemConfig): void {
  if (!system.system_id || system.system_id.trim().length === 0) {
    throw new Error("system_id must be a non-empty string");
  }
  if (!system.display_name || system.display_name.trim().length === 0) {
    throw new Error(`display_name missing for system_id=${system.system_id}`);
  }
  if (!system.gbfs?.auto_discovery_url) {
    throw new Error(`gbfs.auto_discovery_url missing for system_id=${system.system_id}`);
  }
  if (!system.bounds) {
    throw new Error(`bounds missing for system_id=${system.system_id}`);
  }
  validateTimezone(system.timezone);
  validateBounds(system.bounds, system.system_id);
}

function validateRegistry(registry: SystemRegistry): SystemRegistry {
  if (typeof registry !== "object" || registry === null) {
    throw new Error("registry must be an object");
  }
  if (typeof registry.version !== "number") {
    throw new Error("registry.version must be a number");
  }
  if (!Array.isArray(registry.systems)) {
    throw new Error("registry.systems must be an array");
  }

  const seen = new Set<string>();
  for (const system of registry.systems) {
    validateSystemConfig(system);
    if (seen.has(system.system_id)) {
      throw new Error(`Duplicate system_id: ${system.system_id}`);
    }
    seen.add(system.system_id);
  }

  return registry;
}

function mergeSystems(baseSystems: SystemConfig[], overlaySystems: SystemConfig[]): SystemConfig[] {
  const byId = new Map<string, SystemConfig>();
  for (const system of baseSystems) {
    byId.set(system.system_id, system);
  }
  for (const system of overlaySystems) {
    byId.set(system.system_id, system);
  }
  return Array.from(byId.values());
}

export function loadSystemRegistry(options: RegistryLoadOptions = {}): SystemRegistry {
  const cwd = options.cwd ?? process.cwd();
  const registryPath =
    options.registryPath ?? process.env.SYSTEM_REGISTRY_PATH ?? DEFAULT_REGISTRY_PATH;
  const localOverlayPath =
    options.localOverlayPath ?? DEFAULT_LOCAL_OVERLAY_PATH;

  const resolvedRegistryPath = path.resolve(cwd, registryPath);
  if (!fs.existsSync(resolvedRegistryPath)) {
    logEvent("error", "system_registry_missing", {
      path: resolvedRegistryPath,
    });
    throw new Error(`System registry not found at ${resolvedRegistryPath}`);
  }

  const baseRegistry = readJsonFile(resolvedRegistryPath) as SystemRegistry;
  let registry: SystemRegistry = validateRegistry(baseRegistry);

  const resolvedOverlayPath = path.resolve(cwd, localOverlayPath);
  if (fs.existsSync(resolvedOverlayPath)) {
    const overlayRegistry = readJsonFile(resolvedOverlayPath) as SystemRegistry;
    const validatedOverlay = validateRegistry(overlayRegistry);
    registry = {
      ...registry,
      systems: mergeSystems(registry.systems, validatedOverlay.systems),
    };
    logEvent("info", "system_registry_overlay_applied", {
      path: resolvedOverlayPath,
      system_count: validatedOverlay.systems.length,
    });
  }

  logEvent("info", "system_registry_loaded", {
    path: resolvedRegistryPath,
    system_count: registry.systems.length,
  });

  if (registry.systems.length === 0) {
    logEvent("warn", "system_registry_empty", {
      path: resolvedRegistryPath,
    });
  }

  return registry;
}

export function getSystemById(
  registry: SystemRegistry,
  systemId: string
): SystemConfig | undefined {
  return registry.systems.find((system) => system.system_id === systemId);
}

export function requireSystemById(
  registry: SystemRegistry,
  systemId: string
): SystemConfig {
  const system = getSystemById(registry, systemId);
  if (!system) {
    logEvent("warn", "system_registry_miss", { system_id: systemId });
    throw new Error(`Unknown system_id: ${systemId}`);
  }
  return system;
}

export function listSystemIds(registry: SystemRegistry): string[] {
  return registry.systems.map((system) => system.system_id);
}
