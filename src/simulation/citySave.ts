import { deserializeWorld, serializeWorld, validateWorld } from '@tiny-city/simulation';
import type { WorldState } from '@tiny-city/simulation';
import { initialCity } from '../data/initialCity';
import { BUILDINGS, MAP_SIZE } from '../types';
import type { CityState } from '../types';
import { createCityWorld, plansMatch, projectCity, toCityPlan } from './cityAdapter';

export const SAVE_KEY = 'tiny-city-imagine-save-v1';

export interface LoadedCity {
  city: CityState;
  world: WorldState;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isCity(value: unknown): value is CityState {
  if (!record(value) || value.size !== MAP_SIZE || !Array.isArray(value.roads) ||
      !Array.isArray(value.buildings) || typeof value.funds !== 'number' ||
      !Number.isSafeInteger(value.funds) || value.funds < 0) return false;
  if (!value.roads.every((cell: unknown) => record(cell) && Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) && Number(cell.x) >= 0 && Number(cell.x) < MAP_SIZE &&
    Number(cell.y) >= 0 && Number(cell.y) < MAP_SIZE)) return false;
  return value.buildings.every((building: unknown) => record(building) &&
    typeof building.id === 'string' && typeof building.name === 'string' &&
    typeof building.kind === 'string' && Object.hasOwn(BUILDINGS, building.kind) &&
    Number.isInteger(building.x) && Number.isInteger(building.y) &&
    typeof building.createdAt === 'number' && Number.isFinite(building.createdAt) && building.createdAt >= 0);
}

/** Keep the original save key and top-level map fields for v1 compatibility. */
export function loadCitySave(storage?: Pick<Storage, 'getItem'>): LoadedCity {
  try {
    const saved = (storage ?? localStorage).getItem(SAVE_KEY);
    const parsed: unknown = saved === null ? null : JSON.parse(saved);
    if (record(parsed) && parsed.saveVersion === 3 && parsed.simulation !== undefined) {
      try {
        const world = deserializeWorld(JSON.stringify(parsed.simulation));
        const city = projectCity(world, isCity(parsed) ? parsed : undefined);
        if (world.citizens.length === 0 && city.size === MAP_SIZE && world.plan.height === MAP_SIZE &&
            plansMatch(world.plan, toCityPlan(city))) return { city, world };
      } catch { /* fall back to the compatible editor map below */ }
    }
    if (isCity(parsed)) {
      const city: CityState = { size: parsed.size, roads: parsed.roads, buildings: parsed.buildings, funds: parsed.funds };
      const fallbackWorld = createCityWorld(city);
      if (record(parsed) && parsed.saveVersion === 2 && parsed.simulation !== undefined) {
        try {
          const plan = toCityPlan(city);
          const world = deserializeWorld(JSON.stringify(parsed.simulation), {
            startingFunds: city.funds, roads: plan.roads, blockedTiles: plan.blockedTiles,
          });
          if (world.citizens.length === 0 && world.budget.balance === city.funds && plansMatch(world.plan, plan)) return { city, world };
        } catch { /* preserve a valid map even when its optional simulation snapshot is corrupt */ }
      }
      return { city, world: fallbackWorld };
    }
  } catch { /* missing/unavailable/corrupt storage starts with the existing sample */ }
  return { city: initialCity, world: createCityWorld(initialCity) };
}

export function saveCity(storage: Pick<Storage, 'setItem'>, city: CityState, world: WorldState): void {
  validateWorld(world);
  if (!plansMatch(world.plan, toCityPlan(city)) || city.funds !== world.budget.balance) throw new Error('City and simulation layouts and budget must match before saving');
  storage.setItem(SAVE_KEY, JSON.stringify({ ...city, saveVersion: 3, simulation: JSON.parse(serializeWorld(world)) }));
}
