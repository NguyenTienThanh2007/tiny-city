// Phase 8B living-world benchmark: node scripts/p8b_benchmark.mjs [url] [--quick] [--software] [--only=small,medium]
// Four cities (scripts/p8b_bench_cities.mjs: ~20, ~100, ~300 and ~1,000 residents) at 17:20, the evening rush, with
// real traffic and buses. For each: entering (click → first playable frame, building the whole city), then the
// renderer's own stats while idle, walking/running and orbiting with the clock running, then view-switch latency on
// the kept scene and memory after repeated switching. Hardware Chromium by default; --software uses SwiftShader.
import { chromium } from '@playwright/test';
import { benchCityAt } from './p8b_bench_cities.mjs';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173';
const quick = args.includes('--quick'), software = args.includes('--software');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const browser = await chromium.launch({ args: software ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const SAVE_KEY = 'tiny-city-imagine-save-v1';

async function open(save) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value }) => { if (sessionStorage.getItem('seeded')) return; localStorage.clear(); localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); }, { key: SAVE_KEY, value: JSON.stringify(save) });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  return { context, page, cdp: await context.newCDPSession(page) };
}
const debug = (page) => page.evaluate(() => window.__tinyCityImmersive);
const heapMB = async (cdp) => { await cdp.send('HeapProfiler.collectGarbage'); return +((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(1); };
async function enter(page) {
  const started = Date.now();
  await page.getByRole('button', { name: 'Enter World' }).click();
  await page.waitForFunction(() => window.__tinyCityImmersive?.ready === true && document.querySelector('.immersive')?.getAttribute('data-ready') === 'ready', null, { timeout: 180_000 });
  return Date.now() - started;
}
async function leave(page) { await page.getByRole('button', { name: 'Return to City' }).click(); await page.waitForFunction(() => !document.querySelector('canvas.immersive-canvas')); }
async function sample(page, seconds, action) {
  const rows = [];
  const done = action?.() ?? Promise.resolve();
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { await page.waitForTimeout(250); rows.push(await debug(page)); }
  await done;
  const avg = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
  const tail = rows.slice(Math.min(4, rows.length - 1));
  return { fps: avg(tail.map((r) => r.stats.fps)), fpsMin: Math.min(...tail.map((r) => r.stats.fps)), p95Ms: Math.max(...tail.map((r) => r.stats.p95Ms)),
    cpuMs: avg(tail.map((r) => r.stats.cpuMs)), simMs: avg(tail.map((r) => r.stats.simMs)), syncMs: avg(tail.map((r) => r.stats.syncMs)), renderMs: avg(tail.map((r) => r.stats.renderMs)),
    drawCalls: Math.max(...tail.map((r) => r.stats.drawCalls)), triangles: Math.max(...tail.map((r) => r.stats.frameTriangles)),
    residents: Math.max(...tail.map((r) => r.residents.length)), vehicles: Math.max(...tail.map((r) => r.vehicles.length)),
    near: Math.max(...tail.map((r) => r.stats.nearBuildings)), mid: Math.max(...tail.map((r) => r.stats.midBuildings)), far: Math.max(...tail.map((r) => r.stats.farBuildings)) };
}
async function walkLoop(page, seconds) {
  const end = Date.now() + seconds * 1000;
  const pattern = [['Shift', 'd'], ['d'], ['Shift', 'a'], ['a'], ['w'], ['s']];
  for (let i = 0; Date.now() < end; i += 1) { const keys = pattern[i % pattern.length]; for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(900); for (const k of [...keys].reverse()) await page.keyboard.up(k); }
}
async function orbitLoop(page, seconds) {
  const box = await page.locator('canvas.immersive-canvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2, end = Date.now() + seconds * 1000;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let t = 0; Date.now() < end; t += 1) { await page.mouse.move(x + Math.sin(t / 8) * 300, y + Math.cos(t / 11) * 60); await page.waitForTimeout(16); }
  await page.mouse.up();
}

for (const name of ['small', 'medium', 'large', 'stress']) {
  if (only && !only.includes(name)) continue;
  const { save, state } = benchCityAt(name, 17 * 60 + 20);
  const { context, page, cdp } = await open(save);
  const heapCity = await heapMB(cdp);
  const enterMs = await enter(page);
  await page.waitForTimeout(1500);
  const first = await debug(page);
  await page.getByRole('region', { name: 'Character View' }).getByRole('button', { name: 'Resume' }).click();
  const idle = await sample(page, quick ? 4 : 8);
  const walking = await sample(page, quick ? 5 : 10, () => walkLoop(page, quick ? 5 : 10));
  const orbit = await sample(page, quick ? 4 : 8, () => orbitLoop(page, quick ? 4 : 8));
  const heapWorld = await heapMB(cdp);
  // View switching on the kept scene.
  await page.getByRole('region', { name: 'Character View' }).getByRole('button', { name: 'Pause' }).click();
  const switches = [];
  for (let i = 0; i < (quick ? 2 : 5); i += 1) { await leave(page); await page.waitForTimeout(300); switches.push(await enter(page)); await page.waitForTimeout(500); }
  const last = await debug(page);
  await leave(page);
  const heapAfter = await heapMB(cdp);
  const row = { city: name, residents: state.citizens.length, vehicles: state.transport.vehicles.length, buildings: state.plan.buildings.length, quality: first.quality,
    enterMs, hydrateMs: first.stats.buildMs, models: first.stats.models, gpuMB: +(first.stats.gpuBytes / 1048576).toFixed(1),
    idle, walking, orbit, switchMs: switches, reconcileMs: last.stats.lastSync?.ms ?? null, reused: last.reusedScene,
    heapMB: { city: heapCity, inWorld: heapWorld, afterSwitching: heapAfter } };
  console.log(JSON.stringify(row));
  await context.close();
}
await browser.close();
