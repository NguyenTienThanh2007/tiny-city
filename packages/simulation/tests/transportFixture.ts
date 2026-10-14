import { BUILDING_CATALOG, createWorld } from '../src/index.js';
import type { Building, BuildingType, Position, WorldState } from '../src/index.js';

/** Buildings to place, by type, in a fixed order (deterministic layout). */
export type TownSpec = Partial<Record<BuildingType, number>>;
const ORDER: readonly BuildingType[] = ['apartment', 'townhouse', 'duplex', 'villa', 'office', 'mall', 'park', 'pool', 'clubhouse'];
export const STREETS = [8, 22, 36, 50] as const;
export const AVENUES = [2, 32, 61] as const;

/** Road tiles of the test town: four east–west streets joined by three north–south avenues (one connected grid). */
export function townRoads(): Position[] {
  const roads = new Map<string, Position>();
  for (const y of STREETS) for (let x = AVENUES[0]; x <= AVENUES[2]; x += 1) roads.set(`${x},${y}`, { x, y });
  for (const x of AVENUES) for (let y = STREETS[0]; y <= STREETS[3]; y += 1) roads.set(`${x},${y}`, { x, y });
  return [...roads.values()];
}

/**
 * A 64 × 64 town on a connected street grid with the requested buildings packed along both sides of each street,
 * never across an avenue. Every building touches a street.
 */
export function transportTown(spec: TownSpec, options: { funds?: number; seed?: string; maxCitizens?: number; transport?: boolean; economy?: boolean } = {}): WorldState {
  const buildings: Building[] = [];
  const queue = ORDER.flatMap((type) => Array.from({ length: spec[type] ?? 0 }, () => type));
  const sides = STREETS.flatMap((y) => [{ y, north: true }, { y, north: false }]);
  let slot = 0, cursor = AVENUES[0] + 2;
  for (const type of queue) {
    const def = BUILDING_CATALOG[type];
    for (;;) {
      const side = sides[slot];
      if (!side) throw new RangeError('town spec does not fit the map');
      const last = cursor + def.footprint.width - 1;
      if (last >= AVENUES[2]) { slot += 1; cursor = AVENUES[0] + 2; continue; }
      const avenue = AVENUES.find((x) => cursor <= x && last >= x);
      if (avenue !== undefined) { cursor = avenue + 2; continue; }
      const y = side.north ? side.y - def.footprint.height : side.y + 1;
      buildings.push({ id: `b-${String(buildings.length).padStart(3, '0')}`, name: `${def.label} ${buildings.length}`, type, kind: def.kind,
        capacity: def.capacity, footprint: def.footprint, position: { x: cursor, y } });
      cursor += def.footprint.width + 1;
      break;
    }
  }
  return createWorld({ id: 'transport-world', seed: options.seed ?? 'transport', startingFunds: options.funds ?? 20_000, clock: { paused: true },
    population: { maxCitizens: options.maxCitizens ?? 1000 }, ...(options.economy === false ? {} : { economy: {} }), transport: options.transport ?? true,
    plan: { id: 'transport-plan', name: 'Transport town', width: 64, height: 64, blockedTiles: [], roads: townRoads(), buildings } });
}
