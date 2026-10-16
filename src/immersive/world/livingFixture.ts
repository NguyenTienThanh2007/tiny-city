import { Simulation, serializeWorld } from '@tiny-city/simulation';
import type { PlayerAppearance, WorldState } from '@tiny-city/simulation';
import { createCityWorld } from '../../simulation/cityAdapter';
import type { CityState } from '../../types';

/**
 * Phase 8B test town (unit tests and e2e): a villa street, an office and a commercial street with a café, shops, a
 * night market and a park, a concert stage and a plaza, joined by two avenues, served by a real bus line. Built and
 * run only by the real engine.
 */
const road = (x0: number, y0: number, x1: number, y1: number) => {
  const tiles: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) tiles.push({ x, y });
  return tiles;
};
const LM = 'luxury-minimalist' as const;
const villa = (id: string, x: number, y: number, model: string) => ({ id, name: id, kind: 'villa' as const, x, y, createdAt: 0, design: { collection: LM, model: `lm.villa.${model}` } });
const b = (id: string, name: string, kind: CityState['buildings'][number]['kind'], x: number, y: number) => ({ id, name, kind, x, y, createdAt: 0 });

export const LIVING_TOWN: CityState = {
  size: 64, funds: 40_000,
  // Terrace Road (y = 14, villas), Market Street (y = 24, commerce), joined by avenues at x = 8 and x = 30.
  roads: [...road(8, 14, 30, 14), ...road(8, 24, 30, 24), ...road(8, 15, 8, 23), ...road(30, 15, 30, 23)],
  buildings: [
    villa('glass', 10, 12, 'glass-pavilion'), villa('concrete', 13, 12, 'sculptural-concrete'), villa('court', 16, 12, 'minimal-courtyard'),
    villa('sky', 19, 12, 'sky-terrace'), villa('linear', 22, 12, 'linear-modern'), villa('tropical', 25, 12, 'tropical-minimalist'),
    b('apt', 'Harbour Residences', 'apartment', 10, 15), b('apt-2', 'Lagoon Residences', 'apartment', 15, 15),
    b('office', 'Terrace Studio', 'office', 22, 15),
    b('cafe', 'Corner Café', 'cafe', 10, 25), b('shops', 'Seaglass Arcade', 'shops', 13, 25), b('market', 'Lantern Market', 'market', 18, 25),
    b('park', 'Palm Park', 'park', 23, 25), b('stage', 'Bayside Stage', 'stage', 9, 19), b('plaza', 'Fountain Plaza', 'plaza', 27, 20),
  ],
};
export const LIVING_LINE = [{ x: 9, y: 14 }, { x: 29, y: 14 }, { x: 29, y: 24 }, { x: 9, y: 24 }];
export const LIVING_LOOK: PlayerAppearance = { skinTone: 2, hairStyle: 'bun', hairColor: 1, outfit: 'jacket', outfitColor: 1, accessory: 'glasses' };

/** The town with the player at home in the Glass Pavilion, residents welcomed and the bus line running, at `minute`. */
export function livingTown(minute: number, options: { player?: boolean } = {}): Simulation {
  const sim = new Simulation(createCityWorld(LIVING_TOWN));
  if (options.player !== false) {
    const created = sim.executeLife({ type: 'player.create', name: 'Linh', appearance: LIVING_LOOK, homeBuildingId: 'glass' });
    if (!created.applied) throw new Error(`player: ${created.reason}`);
  }
  sim.enablePopulation({ maxCitizens: 1000 });
  const line = sim.executeTransport({ type: 'transport.create-line', stops: LIVING_LINE, buses: 2 });
  if (!line.applied) throw new Error(`line: ${line.reason}`);
  if (minute > 0) sim.step(minute);
  sim.pause();
  return sim;
}
export const livingSave = (world: WorldState) => ({ ...LIVING_TOWN, funds: world.budget.balance, saveVersion: 3, simulation: JSON.parse(serializeWorld(world)) });
