// Phase 4.5 simulation benchmark: node scripts/p45_benchmark.mjs [path/to/simulation/dist/index.js]
// Measures daily-life ticks during the commute, city edits that reconcile walking residents (including edits that
// strand them), undo, save/load and the home-option query used by the Life UI, for several population sizes.
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const entry = process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : '../packages/simulation/dist/index.js';
const { BUILDING_CATALOG, createWorld, deserializeWorld, getGameTime, playerHomeOptions, serializeWorld, Simulation } = await import(entry);

const building = (id, type, x, y) => { const b = BUILDING_CATALOG[type]; return { id, name: id, type, kind: b.kind, capacity: b.capacity, position: { x, y }, footprint: b.footprint }; };
/** Two parallel streets joined at both ends: homes above, jobs and parks below (crowded at 3000). */
function fixture(count) {
  const houses = Math.ceil(count / 24), jobs = Math.ceil(count / 60), width = Math.max(houses, jobs + 2) * 6 + 8;
  const roads = [
    ...Array.from({ length: width - 2 }, (_, i) => ({ x: i + 1, y: 4 })), ...Array.from({ length: width - 2 }, (_, i) => ({ x: i + 1, y: 14 })),
    ...Array.from({ length: 9 }, (_, i) => ({ x: 1, y: i + 5 })), ...Array.from({ length: 9 }, (_, i) => ({ x: width - 2, y: i + 5 })),
  ];
  return createWorld({ id: 'p45', seed: 45, startingFunds: 1_000_000, population: { maxCitizens: count }, clock: { paused: true },
    plan: { id: 'p45-plan', name: 'P45', width, height: 24, blockedTiles: [], roads, buildings: [
      ...Array.from({ length: houses }, (_, i) => building(`home-${String(i).padStart(3, '0')}`, 'apartment', i * 6 + 2, 5)),
      ...Array.from({ length: jobs }, (_, i) => building(`job-${String(i).padStart(3, '0')}`, 'office', i * 6 + 2, 15)),
      building('park-a', 'park', jobs * 6 + 2, 15), building('park-b', 'park', jobs * 6 + 8, 15)] } });
}
const round = (v) => Math.round(v * 1000) / 1000;
const stats = (times) => { const s = [...times].sort((a, b) => a - b); return { mean: round(times.reduce((a, b) => a + b, 0) / times.length), p95: round(s[Math.floor(s.length * 0.95)]), max: round(s.at(-1)) }; };
const time = (fn) => { const start = performance.now(); const value = fn(); return [performance.now() - start, value]; };

const measurements = [];
for (const count of [100, 1000, 3000]) {
  const sim = new Simulation(fixture(count));
  // Morning commute: step to 07:30 so most residents are walking.
  while (getGameTime(sim.getState().clock).minuteOfDay < 450) sim.step(5);
  const ticks = []; for (let i = 0; i < 120; i += 1) ticks.push(time(() => sim.step())[0]);
  const walking = sim.getState().citizens.filter((c) => c.movement?.status === 'travelling').length;
  // A road edit far from everyone (reconciles every walker), then one that strands the walkers on a whole street.
  const width = sim.getState().plan.width;
  const edits = []; for (let i = 0; i < 10; i += 1) {
    edits.push(time(() => sim.execute({ type: 'city.edit-roads', add: [{ x: width - 3, y: 22 - (i % 2) }], remove: [] }))[0]);
    sim.execute({ type: 'city.edit-roads', add: [], remove: [{ x: width - 3, y: 22 - (i % 2) }] });
  }
  const before = sim.getCitySnapshot();
  const street = sim.getState().plan.roads.filter((t) => t.y === 4 && t.x > 2 && t.x < width - 3);
  const [strandMs, strand] = time(() => sim.execute({ type: 'city.edit-roads', add: [], remove: street }));
  const stranded = strand.events.filter((e) => e.type === 'citizen.moved').length;
  const [undoMs] = time(() => sim.restoreCity(before));
  const [serializeMs, text] = time(() => serializeWorld(sim.getState()));
  const [loadMs] = time(() => new Simulation(deserializeWorld(text)));
  const [optionsMs] = time(() => playerHomeOptions(sim.getState(), sim.getNavigator()));
  measurements.push({ count, citizens: sim.getState().citizens.length, walkingAtCommute: walking, tickMs: stats(ticks), farRoadEditMs: stats(edits),
    strandingEdit: { ms: round(strandMs), relocated: stranded }, undoMs: round(undoMs), serializeMs: round(serializeMs), saveBytes: text.length,
    loadMs: round(loadMs), homeOptionsMs: round(optionsMs) });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, measurements }, null, 2));
