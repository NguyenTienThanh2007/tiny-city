// Phase 8B benchmark cities: about 20, 100, 300 and 1,000 residents with proportional real activity (homes, offices,
// cafés, shops, a park, and a bus line from the medium size up). `node scripts/p8b_bench_cities.mjs` validates every
// lot against the real placement rules and prints the residents each city gets.
import { pathToFileURL } from 'node:url';
import { BUILDING_CATALOG, createWorld, serializeWorld, Simulation, validateBuildingPlacement } from '@tiny-city/simulation';
import { PLAYER, toCityPlan } from './p8a_city.mjs';

const LM = (kind, model) => ({ collection: 'luxury-minimalist', model: `lm.${kind}.${model}` });
const VILLAS = ['glass-pavilion', 'sculptural-concrete', 'minimal-courtyard', 'sky-terrace', 'linear-modern', 'tropical-minimalist'];

/**
 * Streets every 10 tiles (y = 6, 16, …) joined by avenues at x = 4 and x = 57; lots of each requested kind fill the
 * north then south side of each street, west to east. The first lot is a villa for the player.
 */
export function benchCity({ villas = 0, apartments = 0, offices = 0, extras = [], streets = 2, line = false }) {
  const roads = new Map();
  const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  const ys = Array.from({ length: streets }, (_, i) => 6 + i * 10);
  for (const y of ys) for (let x = 4; x <= 57; x += 1) add(x, y);
  for (let y = ys[0]; y <= ys.at(-1); y += 1) { add(4, y); add(57, y); }
  const queue = [...Array.from({ length: villas }, (_, i) => ['villa', i]), ...Array.from({ length: apartments }, () => ['apartment']),
    ...Array.from({ length: offices }, () => ['office']), ...extras.map((k) => [k])];
  const buildings = [];
  let n = 0;
  outer: for (const y of ys) for (const side of ['north', 'south']) {
    let x = 6;
    while (queue.length) {
      const [kind, i] = queue[0];
      const { width, height } = BUILDING_CATALOG[kind].footprint;
      if (x + width > 56) break;
      const ly = side === 'north' ? y - height : y + 1;
      const id = `b-${kind}-${++n}`;
      buildings.push({ id, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`, kind, x, y: ly, createdAt: 0,
        ...(kind === 'villa' ? { design: LM('villa', VILLAS[i % VILLAS.length]) } : {}) });
      queue.shift();
      x += width + 1;
      if (!queue.length) break outer;
    }
  }
  if (queue.length) throw new Error(`${queue.length} lots did not fit`);
  const lineStops = line ? [{ x: 4, y: ys[0] }, { x: 57, y: ys[0] }, { x: 57, y: ys.at(-1) }, { x: 4, y: ys.at(-1) }] : null;
  return { size: 64, funds: 200_000, roads: [...roads.values()], buildings, lineStops };
}

export const BENCH_CITIES = {
  small: () => benchCity({ villas: 6, extras: ['duplex', 'townhouse', 'office', 'cafe', 'park'], streets: 1 }),
  medium: () => benchCity({ villas: 4, apartments: 4, offices: 2, extras: ['cafe', 'shops', 'park', 'market'], streets: 2, line: true }),
  large: () => benchCity({ villas: 6, apartments: 12, offices: 5, extras: ['cafe', 'cafe', 'shops', 'park', 'market', 'plaza', 'cinema'], streets: 3, line: true }),
  stress: () => benchCity({ villas: 6, apartments: 41, offices: 16, extras: ['cafe', 'cafe', 'cafe', 'shops', 'shops', 'park', 'park', 'market', 'plaza', 'cinema', 'nightclub'], streets: 6, line: true }),
};

/** The city at `minute`, the player at home in the first villa (moved in before residents arrive). */
export function benchCityAt(name, minute) {
  const city = BENCH_CITIES[name]();
  const sim = new Simulation(createWorld({ id: 'villa-gardens-world', plan: toCityPlan(city), seed: `bench-${name}`, clock: { paused: true },
    startingFunds: city.funds, economy: {}, transport: true, society: true }));
  const created = sim.executeLife({ type: 'player.create', name: PLAYER.name, appearance: PLAYER.appearance, homeBuildingId: city.buildings[0].id });
  if (!created.applied) throw new Error(`player: ${created.reason}`);
  sim.enablePopulation({ maxCitizens: 2000 });
  if (city.lineStops) {
    const line = sim.executeTransport({ type: 'transport.create-line', stops: city.lineStops, buses: name === 'stress' ? 6 : 3 });
    if (!line.applied) throw new Error(`line: ${line.reason}`);
  }
  if (minute > 0) sim.step(minute);
  sim.pause();
  const state = sim.getState();
  return { save: { size: city.size, funds: state.budget.balance, roads: city.roads, buildings: city.buildings, saveVersion: 3, simulation: JSON.parse(serializeWorld(state)) }, state, city };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const name of Object.keys(BENCH_CITIES)) {
    const city = BENCH_CITIES[name]();
    let placed = { ...toCityPlan({ ...city, buildings: [] }) };
    for (const b of toCityPlan(city).buildings) {
      const result = validateBuildingPlacement(createWorld({ id: 'check', plan: placed, seed: 1, startingFunds: 1e7 }), b.type, b.position);
      if (!result.valid) { console.error(`${name}: invalid lot ${b.id} at ${b.position.x},${b.position.y}: ${JSON.stringify(result)}`); process.exitCode = 1; }
      placed = { ...placed, buildings: [...placed.buildings, b] };
    }
    const { state } = benchCityAt(name, 8 * 60);
    console.log(name, 'buildings', city.buildings.length, 'residents', state.citizens.length, 'vehicles', state.transport.vehicles.length);
  }
}
