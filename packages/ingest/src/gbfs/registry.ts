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

type RawSystemRegistry = {
  version?: number;
  systems?: unknown[];
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

function normalizeSystemEntry(raw: unknown): SystemRegistryEntry {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid system registry entry: expected object");
  }
  const entry = raw as Record<string, unknown>;

  const system_id = String(entry.system_id ?? "").trim();
  if (!system_id) {
    throw new Error("Invalid system registry entry: missing system_id");
  }

  const timezone = String(entry.timezone ?? "").trim();
  if (!timezone) {
    throw new Error(`Invalid system registry entry for ${system_id}: missing timezone`);
  }

  const display_name =
    String(entry.display_name ?? entry.provider_name ?? system_id).trim() || system_id;

  const gbfsNested =
    entry.gbfs && typeof entry.gbfs === "object"
      ? (entry.gbfs as Record<string, unknown>)
      : null;
  const auto_discovery_url = String(
    gbfsNested?.auto_discovery_url ?? entry.gbfs_entrypoint_url ?? ""
  ).trim();
  if (!auto_discovery_url) {
    throw new Error(
      `Invalid system registry entry for ${system_id}: missing gbfs.auto_discovery_url or gbfs_entrypoint_url`
    );
  }

  const boundsObj =
    entry.bounds && typeof entry.bounds === "object"
      ? (entry.bounds as Record<string, unknown>)
      : null;
  const boundsArray = Array.isArray(entry.default_map_bounds)
    ? (entry.default_map_bounds as unknown[])
    : null;

  const min_lon = Number(boundsObj?.min_lon ?? boundsArray?.[0]);
  const min_lat = Number(boundsObj?.min_lat ?? boundsArray?.[1]);
  const max_lon = Number(boundsObj?.max_lon ?? boundsArray?.[2]);
  const max_lat = Number(boundsObj?.max_lat ?? boundsArray?.[3]);
  if (![min_lon, min_lat, max_lon, max_lat].every((v) => Number.isFinite(v))) {
    throw new Error(
      `Invalid system registry entry for ${system_id}: missing bounds/default_map_bounds`
    );
  }

  return {
    system_id,
    display_name,
    timezone,
    gbfs: { auto_discovery_url },
    bounds: { min_lon, min_lat, max_lon, max_lat },
  };
}

function normalizeRegistry(raw: unknown): SystemRegistry {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid system registry: expected object");
  }
  const registry = raw as RawSystemRegistry;
  const rawSystems = Array.isArray(registry.systems) ? registry.systems : [];
  return {
    version: Number(registry.version ?? 1),
    systems: rawSystems.map(normalizeSystemEntry),
  };
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

  const baseRegistry = normalizeRegistry(readJsonFile(resolvedRegistryPath));
  let registry: SystemRegistry = baseRegistry;

  const resolvedOverlayPath = path.resolve(cwd, localOverlayPath);
  if (fs.existsSync(resolvedOverlayPath)) {
    const overlayRegistry = normalizeRegistry(readJsonFile(resolvedOverlayPath));
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
