#!/usr/bin/env node
// Phase 5 economy benchmark (headless, the real simulation package): node scripts/p5_economy_benchmark.mjs [--out=f.json]
// For 20, 100, 300 and 1000 residents (homes, offices, a mall, amenities on a street grid):
//   settlement      median time of one daily settlement (settleEconomyDay) over 15 days of real play
//   projection      median time of projectEconomyDay (what the dashboard and AI estimates call)
//   tick overhead   one game day of ticks with the economy vs the same world without it
//   save size       serialized world with and without the economy; growth over 60 days (history/ledger are bounded)
// Build the packages first (npm run build:architect).
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { BUILDING_CATALOG, Simulation, createWorld, projectEconomyDay, serializeWorld, settleEconomyDay } from '../packages/simulation/dist/index.js';

const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
const sizes = [20, 100, 300, 1000];
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const ms = (value) => +value.toFixed(3);

/** Apartments for `residents`, offices and a mall for most of them, parks, a pool and a clubhouse, along streets. */
function city(residents, economy) {
  const roads = [], buildings = [];
  const streets = [6, 18, 30, 42, 54];
  for (const y of streets) for (let x = 2; x <= 62; x += 1) roads.push({ x, y });
  for (let y = 6; y <= 54; y += 1) if (!streets.includes(y)) roads.push({ x: 1, y });
  const lots = streets.flatMap((y) => [{ y, north: true }, { y, north: false }]);
  let side = 0, cursor = 3;
  const place = (type) => {
    const def = BUILDING_CATALOG[type];
    if (cursor + def.footprint.width > 62) { side += 1; cursor = 3; }
    const lot = lots[side];
    buildings.push({ id: `b-${String(buildings.length).padStart(3, '0')}`, name: `${def.label} ${buildings.length}`, type, kind: def.kind, capacity: def.capacity,
      footprint: def.footprint, position: { x: cursor, y: lot.north ? lot.y - def.footprint.height : lot.y + 1 } });
    cursor += def.footprint.width + 1;
  };
  for (let rooms = 0; rooms < residents;) { const type = rooms + 24 <= residents ? 'apartment' : 'villa'; place(type); rooms += BUILDING_CATALOG[type].capacity; }
  for (let jobs = 0; jobs < residents * 0.6; jobs += 60) place('office');
  if (residents >= 100) place('mall');
  for (let i = 0; i < Math.max(1, Math.round(residents / 100)); i += 1) place('park');
  place('pool'); place('clubhouse');
  return createWorld({ id: 'bench', seed: 'bench', startingFunds: 50_000, clock: { paused: true }, population: { maxCitizens: residents },
    ...(economy ? { economy: {} } : {}), plan: { id: 'bench-plan', name: 'Bench', width: 64, height: 64, blockedTiles: [], roads, buildings } });
}

const result = { date: new Date().toISOString(), node: process.version, sizes: [] };
for (const residents of sizes) {
  const withEconomy = new Simulation(city(residents, true));
  const without = new Simulation(city(residents, false));
  // Warm up both (route caches, JIT) with one day.
  withEconomy.step(1440); without.step(1440);
  const dayWith = [], dayWithout = [], settle = [], project = [];
  for (let d = 0; d < 6; d += 1) {
    let t = performance.now(); withEconomy.step(1440); dayWith.push(performance.now() - t);
    t = performance.now(); without.step(1440); dayWithout.push(performance.now() - t);
  }
  for (let d = 0; d < 15; d += 1) {
    const state = withEconomy.getState();
    let t = performance.now(); projectEconomyDay(state); project.push(performance.now() - t);
    // Time the settlement on the real end-of-day world (a pure call; the simulation then settles it itself).
    withEconomy.step(1439);
    const eve = withEconomy.getState();
    t = performance.now(); settleEconomyDay(eve, eve.economy.lastSettledDay + 1, eve.clock.tick + 1); settle.push(performance.now() - t);
    withEconomy.step(1);
  }
  const sizeWith = serializeWorld(withEconomy.getState()).length;
  const { economy: _e, ...plain } = withEconomy.getState();
  const sizeWithout = serializeWorld(plain).length;
  for (let d = 0; d < 39; d += 1) withEconomy.step(1440);
  const e = withEconomy.getState().economy;
  const entry = {
    residents: withEconomy.getState().citizens.length, buildings: withEconomy.getState().plan.buildings.length,
    settlementMs: ms(median(settle)), projectionMs: ms(median(project)),
    dayOfTicksMs: { withEconomy: ms(median(dayWith)), without: ms(median(dayWithout)) },
    economyTickOverheadPercent: +((median(dayWith) / median(dayWithout) - 1) * 100).toFixed(1),
    saveBytes: { withEconomy: sizeWith, without: sizeWithout, economyShare: +((sizeWith - sizeWithout) / sizeWith * 100).toFixed(1) },
    after60Days: { saveBytes: serializeWorld(withEconomy.getState()).length, history: e.history.length, ledger: e.ledger.length, transactions: e.nextTransactionId - 1 },
  };
  console.log(JSON.stringify(entry));
  result.sizes.push(entry);
}
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
