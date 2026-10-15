// Phase 8A showcase: "Palm Terrace" — a Luxury Minimalist neighbourhood for the third-person Character View.
// Two tree-lined streets of villas (all six Luxury Minimalist villa models), Luxury Minimalist duplexes and
// townhouses, a park, a pool and an office, with the player living in the Glass Pavilion Villa.
// `node scripts/p8a_city.mjs` validates every lot against the real simulation placement rules.
import { pathToFileURL } from 'node:url';
import { BUILDING_CATALOG, createWorld, serializeWorld, Simulation } from '@tiny-city/simulation';

const LM = 'luxury-minimalist';
const VILLAS = ['glass-pavilion', 'sculptural-concrete', 'minimal-courtyard', 'sky-terrace', 'linear-modern', 'tropical-minimalist'];

export function palmTerrace() {
  const roads = new Map();
  const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  for (let x = 10; x <= 41; x += 1) { add(x, 20); add(x, 27); }
  for (let y = 13; y <= 34; y += 1) { add(10, y); add(24, y); add(41, y); }
  let n = 0;
  const b = (kind, x, y, name, model) => ({ id: `pt-${kind}-${++n}`, kind, x, y, name, createdAt: 0,
    ...(model ? { design: { collection: LM, model: `lm.${kind}.${model}` } } : {}) });
  const villa = (x, y, i, name) => b('villa', x, y, name, VILLAS[i % VILLAS.length]);
  const buildings = [
    // North side of Terrace Road (y 18–19): the player's Glass Pavilion first, then the other five models.
    villa(12, 18, 0, 'Glass Pavilion'), villa(15, 18, 1, 'Concrete House'), villa(18, 18, 2, 'Courtyard House'), villa(21, 18, 3, 'Sky Terrace'),
    villa(26, 18, 4, 'Linear House'), villa(29, 18, 5, 'Tropical House'), villa(32, 18, 0, 'Glass House'), villa(35, 18, 2, 'Garden Court'), villa(38, 18, 1, 'Cantilever House'),
    // South side: Palm Park on the corner, villas, and the neighbourhood pool by the avenue.
    b('park', 11, 21, 'Palm Park'), villa(16, 21, 4, 'Long House'), villa(19, 21, 5, 'Palm House'),
    villa(26, 21, 3, 'Terrace House'), villa(29, 21, 1, 'Stone House'), villa(32, 21, 0, 'Lantern House'), b('pool', 36, 21, 'Terrace Pool'),
    // Along Garden Road (y 27): duplexes and townhouses north, townhouses and the office south.
    b('duplex', 13, 25, 'Twin Glass', 'twin-glass'), b('duplex', 17, 25, 'Courtyard Pair', 'courtyard'),
    b('townhouse', 26, 24, 'Vertical House', 'vertical-minimalist'), b('townhouse', 29, 24, 'Urban Glass', 'urban-glass'), b('townhouse', 32, 24, 'Timber House', 'warm-timber'),
    b('townhouse', 12, 28, 'Rooftop House', 'rooftop-terrace'), b('townhouse', 15, 28, 'Warm Timber', 'warm-timber'), b('duplex', 18, 28, 'Urban Terrace', 'urban-terrace'),
    b('office', 36, 28, 'Terrace Studio', 'architectural-concrete'),
  ];
  return { size: 64, funds: 60_000, roads: [...roads.values()], buildings };
}

export const PLAYER = { name: 'Linh', appearance: { skinTone: 2, hairStyle: 'bun', hairColor: 1, outfit: 'jacket', outfitColor: 1, accessory: 'none' } };

/** src/simulation/cityAdapter.ts `toCityPlan`, for a node script. */
export function toCityPlan(city) {
  const blockedTiles = [];
  for (let y = 0; y < city.size; y += 1) for (let x = 0; x < city.size; x += 1) if (!(x + y < city.size * 2 - 8)) blockedTiles.push({ x, y });
  return { id: 'villa-gardens-plan', name: 'Villa Gardens', width: city.size, height: city.size, roads: city.roads.map((t) => ({ ...t })), blockedTiles,
    buildings: city.buildings.map((b) => ({ id: b.id, name: b.name, kind: BUILDING_CATALOG[b.kind].kind, type: b.kind, position: { x: b.x, y: b.y },
      footprint: { ...BUILDING_CATALOG[b.kind].footprint }, capacity: BUILDING_CATALOG[b.kind].capacity })) };
}

/**
 * Palm Terrace at `minute` (absolute game minutes): the player moves into the Glass Pavilion first (holding a room),
 * then residents arrive and the world runs to that minute. `player: false` leaves the character out (recovery tests).
 */
export function palmTerraceAt(minute, { player = true, population = true } = {}) {
  const city = palmTerrace();
  const sim = new Simulation(createWorld({ id: 'villa-gardens-world', plan: toCityPlan(city), seed: 'palm-terrace', clock: { paused: true },
    startingFunds: city.funds, economy: {}, transport: true, society: true }));
  if (player) {
    const result = sim.executeLife({ type: 'player.create', name: PLAYER.name, appearance: PLAYER.appearance, homeBuildingId: city.buildings[0].id });
    if (!result.applied) throw new Error(`player not created: ${result.reason}`);
  }
  if (population) sim.enablePopulation({ maxCitizens: 1000 });
  if (minute > 0) sim.step(minute);
  const state = sim.getState();
  return { save: { size: city.size, funds: state.budget.balance, roads: city.roads, buildings: city.buildings, saveVersion: 3, simulation: JSON.parse(serializeWorld(state)) }, state, city };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { validateBuildingPlacement } = await import('@tiny-city/simulation');
  const city = palmTerrace();
  const plan = toCityPlan({ ...city, buildings: [] });
  let placed = { ...plan };
  for (const b of toCityPlan(city).buildings) {
    const result = validateBuildingPlacement(createWorld({ id: 'check', plan: placed, seed: 1, startingFunds: 1e6 }), b.type, b.position);
    if (!result.valid) { console.error(`invalid lot ${b.id} at ${b.position.x},${b.position.y}: ${JSON.stringify(result)}`); process.exitCode = 1; }
    placed = { ...placed, buildings: [...placed.buildings, b] };
  }
  const { state } = palmTerraceAt(10 * 60);
  console.log(JSON.stringify({ buildings: city.buildings.length, roads: city.roads.length, residents: state.citizens.length, player: state.player?.position, home: state.player?.homeBuildingId }));
}
