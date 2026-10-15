import { BUILDING_CATALOG, createWorld } from '../src/index.js';
import type { Building, BuildingType, WorldState } from '../src/index.js';
import { AVENUES, STREETS, townRoads } from './transportFixture.js';

export type SocietyTownSpec = Partial<Record<BuildingType, number>>;
// Venues before offices and malls: jobs are filled in building order, so the venues are staffed first.
const ORDER: readonly BuildingType[] = ['apartment', 'townhouse', 'duplex', 'villa', 'cafe', 'shops', 'market', 'cinema', 'nightclub',
  'amusement', 'office', 'mall', 'stage', 'plaza', 'park', 'pool', 'clubhouse'];

/** The Phase 6 test grid (four streets, three avenues) with homes, jobs and entertainment venues, and society on. */
export function societyTown(spec: SocietyTownSpec, options: { seed?: string; maxCitizens?: number; transport?: boolean; economy?: boolean; society?: boolean; funds?: number } = {}): WorldState {
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
  return createWorld({ id: 'society-world', seed: options.seed ?? 'society', startingFunds: options.funds ?? 20_000, clock: { paused: true },
    population: { maxCitizens: options.maxCitizens ?? 1000 }, ...(options.economy === false ? {} : { economy: {} }), transport: options.transport ?? true,
    society: options.society ?? true,
    plan: { id: 'society-plan', name: 'Society town', width: 64, height: 64, blockedTiles: [], roads: townRoads(), buildings } });
}

/** A lively mixed town: about 60 residents, jobs, and one of every venue. */
export const LIVELY: SocietyTownSpec = { townhouse: 6, villa: 8, duplex: 4, office: 1, cafe: 2, shops: 1, market: 1, cinema: 1, nightclub: 1,
  amusement: 1, stage: 1, plaza: 1, park: 1, pool: 1, clubhouse: 1 };
