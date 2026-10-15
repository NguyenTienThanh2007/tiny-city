// Phase 6 headless benchmark: node scripts/p6_benchmark.mjs  (needs `npm run build:simulation`)
// Towns on a connected street grid at about 20, 100, 300 and 1,000 residents, one bus line each, run for two full
// days with transportation on and off. Reports tick cost (average, p95, worst), peak vehicles, routing searches and
// cache hits, and the save size.
import { BUILDING_CATALOG, createWorld, serializeWorld, Simulation, TransportNetwork } from '@tiny-city/simulation';

// Routing counters across network rebuilds (a network is rebuilt every routing epoch, so its own stats reset).
const counts = { carRoutes: 0, searches: 0, expanded: 0 };
const carRoute = TransportNetwork.prototype.carRoute, search = TransportNetwork.prototype.search;
TransportNetwork.prototype.carRoute = function (...a) { counts.carRoutes += 1; return carRoute.apply(this, a); };
TransportNetwork.prototype.search = function (...a) { counts.searches += 1; const before = this.expanded; const r = search.apply(this, a); counts.expanded += this.expanded - before; return r; };

const STREETS = [8, 22, 36, 50], AVENUES = [2, 32, 61];
const ORDER = ['apartment', 'townhouse', 'duplex', 'villa', 'office', 'mall', 'park', 'pool', 'clubhouse'];
function town(spec, transport) {
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
  return createWorld({ id: 'bench', seed: 'bench', startingFunds: 50_000, clock: { paused: true }, population: { maxCitizens: 1000 }, economy: {}, transport,
    plan: { id: 'p', name: 'Bench', width: 64, height: 64, blockedTiles: [], roads: [...roads.values()], buildings } });
}
const towns = [
  ['~20', { villa: 4, townhouse: 2, office: 1, park: 1 }],
  ['~100', { apartment: 2, townhouse: 6, villa: 8, office: 2, mall: 1, park: 1 }],
  ['~300', { apartment: 9, townhouse: 8, villa: 10, office: 5, mall: 1, park: 2, pool: 1 }],
  ['~1000', { apartment: 38, townhouse: 8, villa: 6, office: 14, mall: 3, park: 3, pool: 2 }],
];
const rows = [];
for (const [label, spec] of towns) {
  for (const transport of [false, true]) {
    counts.carRoutes = 0; counts.searches = 0; counts.expanded = 0;
    const sim = new Simulation(town(spec, transport));
    if (transport) sim.executeTransport({ type: 'transport.create-line', stops: [{ x: 10, y: 8 }, { x: 45, y: 8 }, { x: 45, y: 22 }, { x: 10, y: 22 }], buses: 4 });
    const times = [];
    let peak = 0;
    for (let i = 0; i < 2880; i += 1) {
      const t0 = performance.now(); sim.step(1); times.push(performance.now() - t0);
      if (transport) peak = Math.max(peak, sim.getState().transport.vehicles.length);
    }
    times.sort((a, b) => a - b);
    const state = sim.getState();
    const days = transport ? state.transport.history : [];
    rows.push({ town: label, residents: state.citizens.length, transport: transport ? 'on' : 'off',
      avgMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(3), maxMs: +times.at(-1).toFixed(2),
      peakVehicles: peak, carTrips: days.reduce((n, d) => n + d.carTrips, 0), busRides: days.reduce((n, d) => n + d.boardings, 0), stalls: days.reduce((n, d) => n + d.stalls, 0),
      routeRequests: transport ? counts.carRoutes : '', searches: transport ? counts.searches : '', avgExpanded: transport && counts.searches ? Math.round(counts.expanded / counts.searches) : '', saveKB: Math.round(serializeWorld(state).length / 1024) });
  }
}
console.table(rows);
