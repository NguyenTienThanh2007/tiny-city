// Phase 7 headless benchmark: node scripts/p7_benchmark.mjs  (needs `npm run build:simulation`)
// Towns on a connected street grid at about 20, 100, 300 and 1,000 residents with entertainment venues, run for one
// full week (weekdays and the weekend) with the living society on and off (economy and transport on in both).
// Reports tick cost (average, p95, worst), the society's share of it, decisions and outings, relationships, event
// attendance, heap growth and the save size.
import { BUILDING_CATALOG, createWorld, serializeWorld, Simulation } from '@tiny-city/simulation';

const STREETS = [8, 22, 36, 50], AVENUES = [2, 32, 61];
const ORDER = ['apartment', 'townhouse', 'duplex', 'villa', 'cafe', 'shops', 'market', 'cinema', 'nightclub', 'amusement', 'office', 'mall', 'stage', 'plaza', 'park', 'pool', 'clubhouse'];
function town(spec, society) {
  const roads = new Map();
  for (const y of STREETS) for (let x = AVENUES[0]; x <= AVENUES[2]; x += 1) roads.set(`${x},${y}`, { x, y });
  for (const x of AVENUES) for (let y = STREETS[0]; y <= STREETS[3]; y += 1) roads.set(`${x},${y}`, { x, y });
  const buildings = [];
  const queue = ORDER.flatMap((type) => Array.from({ length: spec[type] ?? 0 }, () => type));
  const sides = STREETS.flatMap((y) => [{ y, north: true }, { y, north: false }]);
  let slot = 0, cursor = AVENUES[0] + 2;
  for (const type of queue) {
    const def = BUILDING_CATALOG[type];
    for (;;) {
      const side = sides[slot];
      if (!side) throw new Error('does not fit');
      const last = cursor + def.footprint.width - 1;
      if (last >= AVENUES[2]) { slot += 1; cursor = AVENUES[0] + 2; continue; }
      const avenue = AVENUES.find((x) => cursor <= x && last >= x);
      if (avenue !== undefined) { cursor = avenue + 2; continue; }
      buildings.push({ id: `b-${String(buildings.length).padStart(3, '0')}`, name: `${def.label} ${buildings.length}`, type, kind: def.kind, capacity: def.capacity,
        footprint: def.footprint, position: { x: cursor, y: side.north ? side.y - def.footprint.height : side.y + 1 } });
      cursor += def.footprint.width + 1;
      break;
    }
  }
  return createWorld({ id: 'bench', seed: 'bench', startingFunds: 50_000, clock: { paused: true }, population: { maxCitizens: 1000 }, economy: {}, transport: true, society,
    plan: { id: 'p', name: 'Bench', width: 64, height: 64, blockedTiles: [], roads: [...roads.values()], buildings } });
}
const venues = (n) => ({ cafe: 2 * n, shops: n, market: n, cinema: n, nightclub: n, stage: 1, plaza: n, amusement: n > 1 ? 1 : 0 });
const towns = [
  ['~20', { villa: 4, townhouse: 2, office: 1, cafe: 1, plaza: 1, park: 1 }],
  ['~100', { apartment: 2, townhouse: 6, villa: 8, office: 2, park: 1, ...venues(1) }],
  ['~300', { apartment: 9, townhouse: 8, villa: 10, office: 3, park: 2, pool: 1, ...venues(1), cafe: 3 }],
  ['~1000', { apartment: 36, townhouse: 6, villa: 4, office: 10, mall: 1, park: 2, pool: 1, ...venues(2) }],
];
const WEEK = 7 * 1440;
const rows = [];
for (const [label, spec] of towns) {
  for (const society of [false, true]) {
    globalThis.gc?.();
    const heap0 = process.memoryUsage().heapUsed;
    const sim = new Simulation(town(spec, society));
    const times = [];
    let outings = 0, decisions = 0, attended = 0;
    for (let i = 0; i < WEEK; i += 1) {
      const t0 = performance.now();
      const r = sim.step(1);
      times.push(performance.now() - t0);
      if (society) for (const e of r.events) {
        if (e.type === 'society.outing-planned') outings += 1;
        else if (e.type === 'society.event-ended') attended += e.attendance;
      }
    }
    const state = sim.getState();
    if (society) decisions = Object.values(state.society.residents).filter((p) => p.lastChoice).length;
    times.sort((a, b) => a - b);
    globalThis.gc?.();
    const heap = Math.round((process.memoryUsage().heapUsed - heap0) / 1024 / 1024 * 10) / 10;
    rows.push({ town: label, residents: state.citizens.length, society: society ? 'on' : 'off',
      avgMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(3), maxMs: +times.at(-1).toFixed(2),
      outingsPerDay: society ? Math.round(outings / 7) : '', residentsDecided: society ? decisions : '',
      relationships: society ? state.society.relationships.length : '', friends: society ? state.society.relationships.filter((r) => r.strength >= 40).length : '',
      eventAttendance: society ? attended : '', heapMB: heap, saveKB: Math.round(serializeWorld(state).length / 1024) });
  }
}
console.table(rows);
