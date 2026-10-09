import { BUILDING_CATALOG, createWorld } from '@tiny-city/simulation';
import type { CityPlan, WorldState } from '@tiny-city/simulation';
import { isLandCell } from '../types';
import type { Building, CityState } from '../types';

/** Initial/legacy editor data enters the canonical contract exactly once. */
export function toCityPlan(city: CityState): CityPlan {
  if (!Number.isSafeInteger(city.size) || city.size <= 0 || city.size * city.size > 1_000_000) throw new RangeError('invalid editor map dimensions');
  const blockedTiles = [];
  for (let y = 0; y < city.size; y += 1) {
    for (let x = 0; x < city.size; x += 1) if (!isLandCell(x, y, city.size)) blockedTiles.push({ x, y });
  }
  return {
    id: 'villa-gardens-plan', name: 'Villa Gardens', width: city.size, height: city.size,
    roads: city.roads.map((tile) => ({ ...tile })), blockedTiles,
    buildings: city.buildings.map((building) => ({
      id: building.id, name: building.name, kind: BUILDING_CATALOG[building.kind].kind, type: building.kind,
      position: { x: building.x, y: building.y },
      footprint: { ...BUILDING_CATALOG[building.kind].footprint },
      capacity: BUILDING_CATALOG[building.kind].capacity,
    })),
  };
}

export function createCityWorld(city: CityState): WorldState {
  return createWorld({ id: 'villa-gardens-world', plan: toCityPlan(city), seed: 'villa-gardens', clock: { paused: true }, startingFunds: city.funds });
}

/** Compatibility view; roads, funds, IDs, positions, and names come only from the world. */
export function projectCity(world: WorldState, previous?: CityState, constructedAt = 0): CityState {
  const appearances = new Map(previous?.buildings.map((building) => [building.id, building.createdAt]) ?? []);
  return {
    size: world.plan.width, funds: world.budget.balance,
    roads: world.plan.roads.map((tile) => ({ ...tile })),
    buildings: world.plan.buildings.map((building) => ({ id: building.id, name: building.name,
      kind: building.type ?? (building.kind === 'home' ? 'villa' : building.kind === 'park' ? 'park' : 'clubhouse'),
      x: building.position.x, y: building.position.y, createdAt: appearances.get(building.id) ?? constructedAt })),
  };
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
  const sameTiles = (left: CityPlan['roads'], right: CityPlan['roads']) => left.length === right.length &&
    left.every((tile) => right.some((other) => tile.x === other.x && tile.y === other.y));
  return a.id === b.id && a.name === b.name && a.width === b.width && a.height === b.height &&
    sameTiles(a.roads, b.roads) && sameTiles(a.blockedTiles, b.blockedTiles) &&
    a.buildings.length === b.buildings.length && a.buildings.every((building, index) => {
      const other = b.buildings[index];
      return other !== undefined && building.id === other.id && building.name === other.name &&
        building.kind === other.kind && building.type === other.type && building.capacity === other.capacity &&
        building.position.x === other.position.x && building.position.y === other.position.y &&
        building.footprint.width === other.footprint.width && building.footprint.height === other.footprint.height;
    });
}
