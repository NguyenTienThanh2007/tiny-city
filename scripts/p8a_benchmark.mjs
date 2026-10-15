// Phase 8A Character View benchmark: node scripts/p8a_benchmark.mjs [url] [--quick]
// Hardware-accelerated Chromium against the dev server. For a small street, the dense Palm Terrace villa neighbourhood
// (scripts/p8a_city.mjs) and the large Coral Bay Nights city (scripts/p7_city.mjs, 62 buildings, ~240 residents), it
// measures entering the 3D view (click → first playable frame), then samples the renderer's own stats while idle,
// walking/running with WASD + Shift, and orbiting with mouse drags. Then repeated view switching (heap after a forced
// GC each round trip) and an extended walking session. Numbers come only from the running game.
import { chromium } from '@playwright/test';
import { BUILDING_CATALOG, createWorld, serializeWorld, Simulation } from '@tiny-city/simulation';
import { palmTerrace, PLAYER, toCityPlan } from './p8a_city.mjs';
import { coralBayNights } from './p7_city.mjs';

const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173';
const quick = process.argv.includes('--quick');
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });

function smallStreet() {
  const roads = [];
  for (let x = 9; x <= 30; x += 1) roads.push({ x, y: 20 });
  for (let y = 14; y <= 28; y += 1) if (y !== 20) roads.push({ x: 9, y });
  const v = (id, x, y, model) => ({ id, name: id, kind: 'villa', x, y, createdAt: 0, design: { collection: 'luxury-minimalist', model: `lm.villa.${model}` } });
  return { size: 64, funds: 30_000, roads, buildings: [v('glass', 12, 18, 'glass-pavilion'), v('concrete', 15, 18, 'sculptural-concrete'), v('court', 18, 18, 'minimal-courtyard'),
    v('terrace', 12, 21, 'sky-terrace'), v('linear', 15, 21, 'linear-modern'), v('tropical', 18, 21, 'tropical-minimalist'), { id: 'park', name: 'Palm Park', kind: 'park', x: 22, y: 21, createdAt: 0 }] };
}
/** A save at 10:00 with the player at home (moved in before residents arrive) and residents living their day. */
function saveFor(city, home) {
  const sim = new Simulation(createWorld({ id: 'villa-gardens-world', plan: toCityPlan(city), seed: 'p8a-bench', clock: { paused: true }, startingFunds: city.funds, economy: {}, transport: true, society: true }));
  const result = sim.executeLife({ type: 'player.create', name: PLAYER.name, appearance: PLAYER.appearance, homeBuildingId: home });
  if (!result.applied) throw new Error(`player: ${result.reason}`);
  sim.enablePopulation({ maxCitizens: 1000 });
  sim.step(10 * 60);
  sim.pause();
  const state = sim.getState();
  return { save: { ...city, funds: state.budget.balance, saveVersion: 3, simulation: JSON.parse(serializeWorld(state)) }, residents: state.citizens.length };
}
const coral = coralBayNights();
const coralHome = coral.buildings.find((b) => BUILDING_CATALOG[b.kind].kind === 'home' && b.kind === 'villa').id;
const scenarios = [
  { name: 'Small street (7 buildings)', ...saveFor(smallStreet(), 'glass'), buildings: 7 },
  { name: 'Palm Terrace (25 buildings, dense villas)', ...saveFor(palmTerrace(), 'pt-villa-1'), buildings: 25 },
  { name: `Coral Bay Nights (${coral.buildings.length} buildings)`, ...saveFor(coral, coralHome), buildings: coral.buildings.length },
];

async function open(save, quality) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value, quality }) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear(); localStorage.setItem(key, value);
    if (quality) localStorage.setItem('tiny-city-3d-settings-v1', JSON.stringify({ sensitivity: 0.0034, invertY: false, quality }));
    sessionStorage.setItem('seeded', '1');
  }, { key: SAVE_KEY, value: JSON.stringify(save), quality });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  return { context, page, cdp: await context.newCDPSession(page) };
}
const debug = (page) => page.evaluate(() => window.__tinyCityImmersive);
async function enter(page) {
  const started = Date.now();
  await page.getByRole('button', { name: 'Enter World' }).click();
  await page.waitForFunction(() => window.__tinyCityImmersive?.ready === true && document.querySelector('.immersive')?.getAttribute('data-ready') === 'ready', null, { timeout: 90_000 });
  return Date.now() - started;
}
async function heap(page, cdp) { await cdp.send('HeapProfiler.collectGarbage'); return page.evaluate(() => performance.memory.usedJSHeapSize); }
/** Samples the renderer's per-frame stats every 250 ms for `seconds` while `action` runs. */
async function sample(page, seconds, action) {
  const rows = [];
  const done = action?.() ?? Promise.resolve();
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { await page.waitForTimeout(250); rows.push(await debug(page)); }
  await done;
  const fps = rows.map((r) => r.stats.fps), p95 = rows.map((r) => r.stats.p95Ms), cpu = rows.map((r) => r.stats.cpuMs);
  const avg = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
  const last = rows.at(-1);
  return { fpsAvg: avg(fps), fpsMin: Math.min(...fps.slice(4)), frameMsAvg: +(1000 / avg(fps)).toFixed(2), p95Ms: Math.max(...p95.slice(4)), cpuMs: avg(cpu),
    drawCalls: Math.max(...rows.map((r) => r.stats.drawCalls)), triangles: Math.max(...rows.map((r) => r.stats.frameTriangles)),
    residents: Math.max(...rows.map((r) => r.residents.length)), vehicles: Math.max(...rows.map((r) => r.vehicles.length)), speed: Math.max(...rows.map((r) => r.player.speed)), last };
}
async function walkLoop(page, seconds) {
  const end = Date.now() + seconds * 1000;
  const pattern = [['d'], ['Shift', 'd'], ['a'], ['Shift', 'a'], ['w'], ['s']];
  let i = 0;
  while (Date.now() < end) {
    const keys = pattern[i++ % pattern.length];
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(900);
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
  }
}
async function orbitLoop(page, seconds) {
  const box = await page.locator('canvas.immersive-canvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const end = Date.now() + seconds * 1000;
  await page.mouse.move(x, y); await page.mouse.down();
  let t = 0;
  while (Date.now() < end) { t += 1; await page.mouse.move(x + Math.sin(t / 8) * 300, y + Math.cos(t / 11) * 60); await page.waitForTimeout(16); }
  await page.mouse.up();
}

const results = [];
for (const scenario of scenarios) {
  for (const quality of quick ? [null] : [null, 'low']) {
    const { context, page, cdp } = await open(scenario.save, quality);
    const heapBefore = await heap(page, cdp);
    const enterMs = await enter(page);
    await page.waitForTimeout(1500);
    await page.getByRole('region', { name: 'Character View' }).getByRole('button', { name: 'Resume' }).click();
    const idle = await sample(page, quick ? 4 : 8);
    const walking = await sample(page, quick ? 5 : 10, () => walkLoop(page, quick ? 5 : 10));
    const orbit = await sample(page, quick ? 4 : 8, () => orbitLoop(page, quick ? 4 : 8));
    const d = idle.last;
    const row = { scenario: scenario.name, residents: scenario.residents, quality: d.quality, renderer: d.renderer, enterMs, buildMs: d.stats.buildMs, initMs: d.stats.initMs,
      models: d.stats.models, decor: d.stats.decor, sceneTriangles: d.stats.triangles, gpuMB: +(d.stats.gpuBytes / 1048576).toFixed(1), geometries: d.stats.geometries, textures: d.stats.textures,
      heapInWorldMB: +(((await heap(page, cdp)) - heapBefore) / 1048576).toFixed(1),
      idle: { ...idle, last: undefined }, walking: { ...walking, last: undefined }, orbit: { ...orbit, last: undefined } };
    results.push(row);
    console.log(JSON.stringify(row));
    await context.close();
  }
}

// Repeated view switching and an extended session (Palm Terrace, automatic quality).
{
  const { context, page, cdp } = await open(scenarios[1].save, null);
  const heaps = [];
  for (let i = 0; i < (quick ? 4 : 10); i += 1) {
    await enter(page);
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Return to City' }).click();
    await page.waitForFunction(() => !document.querySelector('canvas.immersive-canvas'));
    await page.waitForTimeout(300);
    heaps.push(+((await heap(page, cdp)) / 1048576).toFixed(1));
  }
  console.log(JSON.stringify({ switching: { roundTrips: heaps.length, heapMB: heaps, growthAfterFirstMB: +(heaps.at(-1) - heaps[0]).toFixed(1), canvases: await page.locator('canvas').count() } }));
  await enter(page);
  await page.getByRole('region', { name: 'Character View' }).getByRole('button', { name: 'Resume' }).click();
  const start = await heap(page, cdp);
  const session = await sample(page, quick ? 20 : 120, () => walkLoop(page, quick ? 20 : 120));
  const endHeap = await heap(page, cdp);
  const d = await debug(page);
  console.log(JSON.stringify({ extended: { seconds: quick ? 20 : 120, fpsAvg: session.fpsAvg, fpsMin: session.fpsMin, p95Ms: session.p95Ms, heapGrowthMB: +((endHeap - start) / 1048576).toFixed(1),
    commits: d.commits, rejected: d.rejected, geometries: d.stats.geometries, textures: d.stats.textures } }));
  await context.close();
}
await browser.close();
