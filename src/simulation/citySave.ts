import { validateWorld } from '@tiny-city/simulation';
import type { WorldState } from '@tiny-city/simulation';
import { initialCity } from '../data/initialCity';
import { BUILDINGS, MAP_SIZE } from '../types';
import type { CityState } from '../types';
import { createCityWorld, plansMatch, toCityPlan } from './cityAdapter';

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
      !Number.isFinite(value.funds) || value.funds < 0) return false;
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
    if (isCity(parsed)) {
      const city: CityState = { size: parsed.size, roads: parsed.roads, buildings: parsed.buildings, funds: parsed.funds };
      const fallbackWorld = createCityWorld(city);
      if (record(parsed) && parsed.saveVersion === 2 && parsed.simulation !== undefined) {
        try {
          const world = parsed.simulation as WorldState;
          validateWorld(world);
          // Phase 0 has no residents; do not load future-phase worlds into this editor.
          if (world.citizens.length === 0 && plansMatch(world.plan, toCityPlan(city))) return { city, world };
        } catch { /* preserve a valid map even when its optional simulation snapshot is corrupt */ }
      }
      return { city, world: fallbackWorld };
    }
  } catch { /* missing/unavailable/corrupt storage starts with the existing sample */ }
  return { city: initialCity, world: createCityWorld(initialCity) };
}

export function saveCity(storage: Pick<Storage, 'setItem'>, city: CityState, world: WorldState): void {
  validateWorld(world);
  if (!plansMatch(world.plan, toCityPlan(city))) throw new Error('City and simulation layouts must match before saving');
  storage.setItem(SAVE_KEY, JSON.stringify({ ...city, saveVersion: 2, simulation: world }));
}
