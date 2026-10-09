import { BUILDING_CATALOG } from './catalog.js';
import { createBudget } from './budget.js';
import type { Building, BuildingType, Position, WorldState } from './types.js';
import { cloneWorld, freeze, validateWorld } from './world.js';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Stable contract-only JSON; indexes and pending commands remain runtime data. */
export function serializeWorld(world: WorldState): string {
  validateWorld(world);
  const copy = cloneWorld(world);
  return JSON.stringify(canonical(copy));
}

function inferType(building: Building): Building {
  const type = (Object.keys(BUILDING_CATALOG) as BuildingType[]).find((key) => {
    const definition = BUILDING_CATALOG[key];
    return building.kind === definition.kind && building.capacity === definition.capacity &&
      building.footprint.width === definition.footprint.width && building.footprint.height === definition.footprint.height;
  });
  return type === undefined ? building : { ...building, type };
}

export interface LegacyWorldOptions {
  readonly startingFunds?: number;
  readonly roads?: readonly Position[];
  readonly blockedTiles?: readonly Position[];
}

/** Validates schema 2 or migrates schema 1 using optional legacy editor context. */
export function deserializeWorld(serialized: string, legacy: LegacyWorldOptions = {}): WorldState {
  try {
    const raw = JSON.parse(serialized) as WorldState;
    const version: number = raw.schemaVersion;
    let world: WorldState;
    if (version === 1) {
      world = { ...raw, schemaVersion: 2, budget: createBudget(legacy.startingFunds ?? 0), revision: 0, nextBuildingId: 1,
        plan: { ...raw.plan, roads: legacy.roads ?? [], blockedTiles: legacy.blockedTiles ?? [], buildings: raw.plan.buildings.map(inferType) } };
    } else if (version === 2) {
      world = raw;
    } else throw new RangeError('unsupported world schema version');
    validateWorld(world);
    return freeze(cloneWorld(world));
  } catch (error) {
    throw new RangeError(`Invalid world snapshot: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}
