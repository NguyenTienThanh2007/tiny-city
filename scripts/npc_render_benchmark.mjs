#!/usr/bin/env node
// Browser rendering benchmark for managed residents.
// Usage: node scripts/npc_render_benchmark.mjs [baseUrl] [--software]
// Generates road-connected cities sized for ~30/100/300/1000 residents, welcomes residents through the UI,
// runs the commute at 4x, and samples the renderer's own once-per-second stats (window.__tinyCityRenderer).
import { chromium } from '@playwright/test';

const baseUrl = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:5173/';
const software = process.argv.includes('--software');
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const targets = (process.argv.find((arg) => arg.startsWith('--targets='))?.slice(10) ?? '30,100,300,1000').split(',').map(Number);

function benchmarkCity(target) {
  const roads = new Map();
  const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  const rows = [6, 11, 16, 21, 26, 31, 36, 41, 46];
  for (const y of rows) for (let x = 6; x <= 58; x += 1) add(x, y);
  for (let y = 6; y <= 46; y += 1) add(6, y);
  const slots = rows.slice(0, -1).flatMap((y) => Array.from({ length: 12 }, (_, i) => ({ x: 7 + i * 4, y: y + 1 })));
  const apartments = Math.floor(target / 24);
  const villas = Math.ceil((target - apartments * 24) / 2);
  const offices = Math.max(1, Math.ceil(target / 60));
  const kinds = [...Array(apartments).fill('apartment'), ...Array(villas).fill('villa'), ...Array(offices).fill('office')];
  if (kinds.length > slots.length) throw new Error('benchmark city too large');
  // Interleave homes and offices so commutes spread over the whole grid.
  const order = kinds.map((kind, index) => ({ kind, key: (index * 37) % kinds.length })).sort((a, b) => a.key - b.key);
  return { size: 64, funds: 1_000_000, roads: [...roads.values()],
    buildings: order.map(({ kind }, index) => ({ id: `${kind}-${index}`, kind, name: `${kind} ${index}`, x: slots[index].x, y: slots[index].y, createdAt: 0 })) };
}

const args = software ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args });
const results = [];
for (const target of targets) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error(`[${target}] page error: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error' || /context lost/i.test(message.text())) console.error(`[${target}] console: ${message.text().slice(0, 200)}`); });
  const city = benchmarkCity(target);
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('bench')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('bench', '1'); }
  }, { key: SAVE_KEY, value: city });
  await page.goto(baseUrl);
  await page.waitForSelector('canvas');
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  // Wait for the morning commute (07:00–08:30), when the most residents are outdoors.
  for (let i = 0; i < 600; i += 1) {
    const text = await page.getByLabel('Simulation clock').textContent();
    const [, h, m] = /(\d\d):(\d\d)/.exec(text);
    if (Number(h) * 60 + Number(m) >= 7 * 60 + 15) break;
    await page.waitForTimeout(100);
  }
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  // Zoom out so the whole grid (and so every resident) is on screen.
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Zoom out' }).click();
  const samples = [];
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(1050);
    samples.push(await page.evaluate(() => window.__tinyCityRenderer));
  }
  const residents = await page.evaluate(() => window.__tinyCityRenderer?.residents ?? 0);
  const fps = samples.map((s) => s.fps);
  const frameMs = samples.map((s) => s.frameMs);
  const visible = Math.max(...samples.map((s) => s.visibleResidents));
  const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  results.push({ target, residents, visibleMax: visible, fpsMedian: fps.sort((a, b) => a - b)[Math.floor(fps.length / 2)],
    fpsMin: Math.min(...fps), sceneUpdateMsMedian: frameMs.sort((a, b) => a - b)[Math.floor(frameMs.length / 2)], heapMB: heap, gpu });
  console.log(JSON.stringify(results.at(-1)));
  await page.close();
}
await browser.close();
console.log(JSON.stringify({ renderer: software ? 'swiftshader' : 'default-gpu', viewport: '1440x900', results }, null, 2));
