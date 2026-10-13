#!/usr/bin/env node
// Visual World 3.0 browser benchmark: node scripts/vw3_benchmark.mjs [baseUrl] [--label=name] [--out=file.json]
// Measures real frame pacing (requestAnimationFrame deltas → avg / p95 / p99 / fps), the renderer's own CPU cost
// per frame (window.__tinyCityRenderer), load-to-interactive time, and camera responsiveness (wheel zoom → next
// frame) for the slice, a dense block, the sample city, and a 300-resident commute zoomed out. Run on an idle
// machine; compare runs made with the same browser flags only.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { coralBay } from './vw3b_city.mjs';

const baseUrl = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:5181/';
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'run';
const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
const SAVE_KEY = 'tiny-city-imagine-save-v1';
// --uncapped disables vsync and the frame-rate limit, so frame times show real render cost instead of 16.7 ms.
const uncapped = process.argv.includes('--uncapped');
// --software renders with SwiftShader (CPU only): a pessimistic stand-in for weak integrated GPUs.
const software = process.argv.includes('--software');
const [vw, vh] = (process.argv.find((arg) => arg.startsWith('--viewport='))?.slice(11) ?? '1440x900').split('x').map(Number);

function slice() {
  const roads = new Map(); const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  for (let x = 13; x <= 35; x += 1) { add(x, 20); add(x, 27); }
  for (let y = 13; y <= 32; y += 1) add(25, y);
  for (let y = 21; y <= 26; y += 1) add(13, y);
  const b = (id, kind, x, y) => ({ id, kind, x, y, name: id, createdAt: 0 });
  return { size: 64, funds: 18_000, roads: [...roads.values()], buildings: [
    b('lq-villa-1', 'villa', 15, 18), b('lq-villa-2', 'villa', 18, 18), b('lq-town-1', 'townhouse', 21, 17), b('lq-apt-1', 'apartment', 26, 16),
    b('lq-villa-3', 'villa', 15, 21), b('lq-villa-4', 'villa', 18, 21), b('lq-town-2', 'townhouse', 21, 21), b('lq-park', 'park', 26, 21),
    b('lq-villa-5', 'villa', 15, 25), b('lq-villa-6', 'villa', 18, 25), b('lq-town-3', 'townhouse', 21, 24), b('lq-apt-2', 'apartment', 30, 16),
    b('lq-villa-7', 'villa', 26, 28), b('lq-villa-8', 'villa', 29, 28)] };
}
/** ~300 residents on a 9-row street grid with offices so people commute (same generator as npc_render_benchmark). */
function commuteCity(target = 300) {
  const roads = new Map(); const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  const rows = [6, 11, 16, 21, 26, 31, 36, 41, 46];
  for (const y of rows) for (let x = 6; x <= 58; x += 1) add(x, y);
  for (let y = 6; y <= 46; y += 1) add(6, y);
  const slots = rows.slice(0, -1).flatMap((y) => Array.from({ length: 12 }, (_, i) => ({ x: 7 + i * 4, y: y + 1 })));
  const apartments = Math.floor(target / 24), villas = Math.ceil((target - apartments * 24) / 2), offices = Math.max(1, Math.ceil(target / 60));
  const kinds = [...Array(apartments).fill('apartment'), ...Array(villas).fill('villa'), ...Array(offices).fill('office')];
  const order = kinds.map((kind, index) => ({ kind, key: (index * 37) % kinds.length })).sort((a, b) => a.key - b.key);
  return { size: 64, funds: 1_000_000, roads: [...roads.values()],
    buildings: order.map(({ kind }, index) => ({ id: `${kind}-${index}`, kind, name: `${kind} ${index}`, x: slots[index].x, y: slots[index].y, createdAt: 0 })) };
}

const gpuArgs = software ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: [...gpuArgs, ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const results = { label, baseUrl, uncapped, software, viewport: `${vw}x${vh}`, date: new Date().toISOString(), scenarios: [] };

async function measureFrames(page, ms = 6000) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const deltas = []; let last = performance.now(); const end = last + duration;
    const tick = (now) => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(deltas.slice(5)); };
    requestAnimationFrame(tick);
  }), ms);
}
const stats = (deltas) => {
  const sorted = [...deltas].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  return { frames: deltas.length, avgMs: +avg.toFixed(2), p95Ms: +pick(0.95).toFixed(2), p99Ms: +pick(0.99).toFixed(2), fps: +(1000 / avg).toFixed(1) };
};

async function scenario(name, seed, prepare) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error(`[${name}] ${error.message}`));
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('bench')) return;
    if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.clear();
    sessionStorage.setItem('bench', '1');
  }, { key: SAVE_KEY, value: seed });
  const started = Date.now();
  await page.goto(baseUrl);
  await page.waitForSelector('canvas');
  // Interactive = first renderer stats published (one full second of frames rendered).
  await page.waitForFunction(() => Boolean(window.__tinyCityRenderer), null, { timeout: 30_000 });
  const interactiveMs = Date.now() - started - 1000;
  const artMs = await page.evaluate(() => {
    const entry = performance.getEntriesByType('resource').filter((e) => e.name.includes('/art/vw3/')).sort((a, b) => b.responseEnd - a.responseEnd)[0];
    return entry ? Math.round(entry.responseEnd) : null;
  });
  if (prepare) await prepare(page);
  await page.waitForTimeout(1500);
  const frames = stats(await measureFrames(page));
  const renderer = await page.evaluate(() => window.__tinyCityRenderer);
  // Camera responsiveness: wheel zoom → next two frames presented.
  const box = await page.locator('canvas').boundingBox();
  const zoomLatency = [];
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const t = await page.evaluate((direction) => new Promise((resolve) => {
      const start = performance.now();
      const canvas = document.querySelector('canvas');
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: direction, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true }));
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
    }), i % 2 ? 120 : -120).catch(() => null);
    if (t !== null) zoomLatency.push(+t.toFixed(1));
  }
  const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'); const info = gl?.getExtension('WEBGL_debug_renderer_info'); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  const result = { name, interactiveMs, artLoadedAtMs: artMs, ...frames, rendererCpuMs: renderer?.frameMs ?? null, residents: renderer?.residents ?? 0,
    visibleResidents: renderer?.visibleResidents ?? 0, zoomLatencyMs: zoomLatency, gpu };
  console.log(JSON.stringify(result));
  results.scenarios.push(result);
  await page.close();
}

const welcome = async (page) => {
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 600; i += 1) {
    const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent());
    if (Number(h) * 60 + Number(m) >= 7 * 60 + 15) break;
    await page.waitForTimeout(100);
  }
  await page.getByRole('button', { name: 'Speed 1x' }).click();
};
await scenario('slice-gameplay', slice(), async (page) => { await page.getByRole('button', { name: 'Center neighborhood' }).click(); });
await scenario('slice-close-zoom', slice(), async (page) => {
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
});
await scenario('sample-city', null, null);
await scenario('coral-bay-dense', coralBay(), async (page) => { await page.getByRole('button', { name: 'Center neighborhood' }).click(); });
await scenario('coral-bay-close', coralBay(), async (page) => {
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
});
await scenario('commute-300-zoomed-out', commuteCity(300), async (page) => {
  await welcome(page);
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Zoom out' }).click();
});
await browser.close();
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
