import fs from "fs";
import path from "path";

type SystemBounds = {
  min_lon: number;
  min_lat: number;
  max_lon: number;
  max_lat: number;
};

export type SystemRegistryEntry = {
  system_id: string;
  display_name: string;
  timezone: string;
  gbfs: {
    auto_discovery_url: string;
  };
  bounds: SystemBounds;
};

export type SystemRegistry = {
  version: number;
  systems: SystemRegistryEntry[];
};

type RegistryLoadOptions = {
  cwd?: string;
  registryPath?: string;
  localOverlayPath?: string;
};

const DEFAULT_REGISTRY_PATH = "config/systems.json";
const DEFAULT_LOCAL_OVERLAY_PATH = "config/systems.local.json";

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function mergeSystems(
  baseSystems: SystemRegistryEntry[],
  overlaySystems: SystemRegistryEntry[]
): SystemRegistryEntry[] {
  const byId = new Map<string, SystemRegistryEntry>();
  for (const system of baseSystems) {
    byId.set(system.system_id, system);
  }
  for (const system of overlaySystems) {
    byId.set(system.system_id, system);
  }
  return Array.from(byId.values());
}

export function loadSystemRegistry(
  options: RegistryLoadOptions = {}
): SystemRegistry {
  const cwd = options.cwd ?? process.cwd();
  const registryPath =
    options.registryPath ?? process.env.SYSTEM_REGISTRY_PATH ?? DEFAULT_REGISTRY_PATH;
  const localOverlayPath = options.localOverlayPath ?? DEFAULT_LOCAL_OVERLAY_PATH;

  const resolvedRegistryPath = path.resolve(cwd, registryPath);
  if (!fs.existsSync(resolvedRegistryPath)) {
    throw new Error(`System registry not found at ${resolvedRegistryPath}`);
  }

  const baseRegistry = readJsonFile(resolvedRegistryPath) as SystemRegistry;
  let registry: SystemRegistry = baseRegistry;

  const resolvedOverlayPath = path.resolve(cwd, localOverlayPath);
  if (fs.existsSync(resolvedOverlayPath)) {
    const overlayRegistry = readJsonFile(resolvedOverlayPath) as SystemRegistry;
    registry = {
      ...registry,
      systems: mergeSystems(registry.systems, overlayRegistry.systems),
    };
  }

  return registry;
}

export function requireSystemById(
  registry: SystemRegistry,
  systemId: string
): SystemRegistryEntry {
  const system = registry.systems.find((entry) => entry.system_id === systemId);
  if (!system) {
    throw new Error(`Unknown system_id: ${systemId}`);
  }
  return system;
}
