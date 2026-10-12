// Phase 4 engine benchmark: identical commuting cities with and without a walking player.
// Usage: npm run build:architect && node scripts/life_benchmark.mjs
import { performance } from 'node:perf_hooks';
import { BUILDING_CATALOG, createWorld, Simulation, validateWorld } from '../packages/simulation/dist/index.js';

const fixture = (count) => {
  // One spare room so the player can always move in; both runs use the same city.
  const houses = Math.ceil((count + 1) / 24), jobs = Math.ceil(count / 60), width = Math.max(houses, jobs) * 6 + 6;
  const building = (id, type, x, y) => { const b = BUILDING_CATALOG[type]; return { id, name: id, type, kind: b.kind, capacity: b.capacity, position: { x, y }, footprint: b.footprint }; };
  return createWorld({ id: 'bench', seed: 123, startingFunds: 100000, clock: { paused: true },
    plan: { id: 'bench-plan', name: 'Bench', width, height: 22, blockedTiles: [], roads: [
      ...Array.from({ length: width - 2 }, (_, i) => ({ x: i + 1, y: 4 })), ...Array.from({ length: width - 2 }, (_, i) => ({ x: i + 1, y: 14 })), ...Array.from({ length: 9 }, (_, i) => ({ x: 1, y: i + 5 }))],
      buildings: [...Array.from({ length: houses }, (_, i) => building(`home-${String(i).padStart(3, '0')}`, 'apartment', i * 6 + 2, 5)),
        ...Array.from({ length: jobs }, (_, i) => building(`job-${String(i).padStart(3, '0')}`, 'office', i * 6 + 2, 15))] } });
};
const look = { skinTone: 2, hairStyle: 'curly', hairColor: 1, outfit: 'tee', outfitColor: 0, accessory: 'none' };
const round = (v) => Math.round(v * 1000) / 1000;
const measurements = [];
for (const count of [100, 1000, 3000]) {
  for (const player of [false, true]) {
    const sim = new Simulation(fixture(count));
    if (player) {
      const result = sim.executeLife({ type: 'player.create', name: 'Bench', appearance: look, homeBuildingId: 'home-000' });
      if (!result.applied) throw new Error(`player could not move in: ${result.reason}`);
    }
    sim.enablePopulation({ maxCitizens: count });
    for (const c of sim.getState().citizens) sim.enqueue({ type: 'citizen.set-schedule', citizenId: c.id, schedule: { entries: [{ startMinute: 0, activity: 'work', targetBuildingId: c.workBuildingId }] } });
    const width = sim.getState().plan.width;
    // The player keeps walking back and forth along the whole street (a re-route every leg).
    let leg = 0;
    const walk = () => sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: leg++ % 2 ? 2 : width - 3, y: 14 } } });
    if (player) walk();
    sim.step();
    const times = [];
    for (let i = 0; i < 400; i += 1) {
      if (player && sim.getPlayer().activity.kind === 'idle') walk();
      const start = performance.now(); sim.step(); times.push(performance.now() - start);
    }
    validateWorld(sim.getState());
    const sorted = [...times].sort((a, b) => a - b);
    measurements.push({ count: sim.getPopulationCount(), player, ticks: 400, meanTickMs: round(times.reduce((a, b) => a + b, 0) / times.length),
      p95TickMs: round(sorted[Math.floor(sorted.length * 0.95)]), maxTickMs: round(sorted.at(-1)), playerLegs: player ? leg : 0,
      serializedKB: Math.round(JSON.stringify(sim.getState()).length / 1024) });
  }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, measurements }, null, 2));
