#!/usr/bin/env node
// Visual World 3.0C population benchmark: node scripts/vw3c_benchmark.mjs [baseUrl] [--uncapped] [--label=x] [--out=f.json]
// For 20 / 100 / 300 / 1,000 residents: welcomes residents, runs to the morning commute (most residents outdoors),
// then measures frame pacing (rAF deltas: avg / p95 / p99 / fps) and the renderer's own per-frame JS cost and
// on-screen resident count (window.__tinyCityRenderer) at gameplay zoom and zoomed out to the whole grid.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const baseUrl = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:5181/';
const uncapped = process.argv.includes('--uncapped');
const software = process.argv.includes('--software');
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'run';
const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
const targets = (process.argv.find((arg) => arg.startsWith('--targets='))?.slice(10) ?? '20,100,300,1000').split(',').map(Number);
const SAVE_KEY = 'tiny-city-imagine-save-v1';

/** Road-connected city sized for `target` residents with offices so people commute (as npc_render_benchmark). */
function city(target) {
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

const gpu = software ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: [...gpu, ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const results = { label, baseUrl, uncapped, software, date: new Date().toISOString(), runs: [] };
const frames = (page, ms = 5000) => page.evaluate((duration) => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); const end = last + duration;
  const tick = (now) => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(deltas.slice(5)); };
  requestAnimationFrame(tick);
}), ms);
const stats = (d) => { const s = [...d].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))], avg = d.reduce((a, b) => a + b, 0) / d.length;
  return { avgMs: +avg.toFixed(2), p95Ms: +q(0.95).toFixed(2), p99Ms: +q(0.99).toFixed(2), fps: +(1000 / avg).toFixed(1) }; };

for (const target of targets) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error(`[${target}] ${error.message}`));
  await page.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('b')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('b', '1'); } }, { key: SAVE_KEY, value: city(target) });
  await page.goto(baseUrl);
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^Live\b/ }).first().click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 900; i += 1) {
    const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent());
    if (Number(h) * 60 + Number(m) >= 7 * 60 + 15) break;
    await page.waitForTimeout(100);
  }
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  const run = { target, residents: 0, views: [] };
  for (const [view, zoomOut] of [['gameplay', 0], ['zoomed-out', 4]]) {
    await page.getByRole('button', { name: 'Center neighborhood' }).click();
    for (let i = 0; i < zoomOut; i += 1) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.waitForTimeout(1600);
    const pacing = stats(await frames(page));
    const renderer = await page.evaluate(() => window.__tinyCityRenderer);
    run.residents = renderer?.residents ?? 0;
    run.views.push({ view, ...pacing, rendererCpuMs: renderer?.frameMs ?? null, visibleResidents: renderer?.visibleResidents ?? 0 });
  }
  console.log(JSON.stringify(run));
  results.runs.push(run);
  await page.close();
}
await browser.close();
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
