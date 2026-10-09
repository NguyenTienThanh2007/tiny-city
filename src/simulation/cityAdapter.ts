import { createWorld } from '@tiny-city/simulation';
import type { BuildingKind as SimulationBuildingKind, CityPlan, WorldState } from '@tiny-city/simulation';
import { BUILDINGS } from '../types';
import type { Building, BuildingKind, CityState } from '../types';

const roles: Record<BuildingKind, SimulationBuildingKind> = {
  villa: 'home', park: 'park', clubhouse: 'workplace',
};

/** Editor-only roads, funds, styles, and construction timestamps stay in CityState. */
export function toCityPlan(city: CityState): CityPlan {
  return {
    id: 'villa-gardens-plan', name: 'Villa Gardens', width: city.size, height: city.size,
    buildings: city.buildings.map((building) => ({
      id: building.id, name: building.name, kind: roles[building.kind],
      position: { x: building.x, y: building.y },
      footprint: { width: BUILDINGS[building.kind].width, height: BUILDINGS[building.kind].height },
      capacity: building.kind === 'villa' ? 2 : 20,
    })),
  };
}

export function createCityWorld(city: CityState): WorldState {
  return createWorld({ id: 'villa-gardens-world', plan: toCityPlan(city), seed: 'villa-gardens', clock: { paused: true } });
}

/** Render canonical positions/names while retaining the existing visual building styles. */
export function getRenderBuildings(city: CityState, plan: CityPlan): Building[] {
  const appearances = new Map(city.buildings.map((building) => [building.id, building]));
  return plan.buildings.map((building) => {
    const appearance = appearances.get(building.id);
    if (!appearance) throw new Error(`Missing editor metadata for building ${building.id}`);
    return { ...appearance, x: building.position.x, y: building.position.y, name: building.name };
  });
}

export function plansMatch(a: CityPlan, b: CityPlan): boolean {
  return a.id === b.id && a.name === b.name && a.width === b.width && a.height === b.height &&
    a.buildings.length === b.buildings.length && a.buildings.every((building, index) => {
      const other = b.buildings[index];
      return other !== undefined && building.id === other.id && building.name === other.name &&
        building.kind === other.kind && building.capacity === other.capacity &&
        building.position.x === other.position.x && building.position.y === other.position.y &&
        building.footprint.width === other.footprint.width && building.footprint.height === other.footprint.height;
    });
}
