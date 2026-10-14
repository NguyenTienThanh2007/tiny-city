import { BUILDING_CATALOG, createWorld } from '../src/index.js';
import type { Building, BuildingType, EconomyOptions, Position, WorldState } from '../src/index.js';

/** Buildings to place, by type, in a fixed order (deterministic layout). */
export type CitySpec = Partial<Record<BuildingType, number>>;
const ORDER: readonly BuildingType[] = ['apartment', 'townhouse', 'duplex', 'villa', 'office', 'mall', 'park', 'pool', 'clubhouse'];
const STREETS = [7, 20, 33, 46, 59];

/**
 * A 64 × 64 town: five east–west streets joined by a north–south avenue, with the requested buildings packed along
 * both sides of each street. Every building touches a road.
 */
export function economyCity(spec: CitySpec, options: { funds?: number; seed?: string; economy?: EconomyOptions | null; maxCitizens?: number } = {}): WorldState {
  const roads: Position[] = [];
  for (const y of STREETS) for (let x = 2; x <= 62; x += 1) roads.push({ x, y });
  for (let y = STREETS[0]!; y <= STREETS.at(-1)!; y += 1) if (!STREETS.includes(y)) roads.push({ x: 1, y });
  const buildings: Building[] = [];
  const queue = ORDER.flatMap((type) => Array.from({ length: spec[type] ?? 0 }, () => type));
  let slot = 0;
  const sides = STREETS.flatMap((y) => [{ y, north: true }, { y, north: false }]);
  let cursor = 3;
  for (const type of queue) {
    const def = BUILDING_CATALOG[type];
    let side = sides[slot];
    if (side && cursor + def.footprint.width > 62) { slot += 1; cursor = 3; side = sides[slot]; }
    if (!side) throw new RangeError('city spec does not fit the map');
    const y = side.north ? side.y - def.footprint.height : side.y + 1;
    buildings.push({ id: `b-${String(buildings.length).padStart(3, "0")}`, name: `${def.label} ${buildings.length}`, type, kind: def.kind,
      capacity: def.capacity, footprint: def.footprint, position: { x: cursor, y } });
    cursor += def.footprint.width + 1;
  }
  return createWorld({ id: 'economy-world', seed: options.seed ?? 'economy', startingFunds: options.funds ?? 20_000, clock: { paused: true },
    population: { maxCitizens: options.maxCitizens ?? 1000 }, ...(options.economy === null ? {} : { economy: options.economy ?? {} }),
    plan: { id: 'economy-plan', name: 'Economy town', width: 64, height: 64, blockedTiles: [], roads, buildings } });
}
