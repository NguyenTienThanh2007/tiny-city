#!/usr/bin/env node
// Visual World 3.1 benchmark: node scripts/vw31_benchmark.mjs <baseUrl> [--label=x] [--out=f.json] [--uncapped] [--software] [--designs=off]
// Scenarios (real UI only): the default sample city; a dense residential district and a large mixed-use city (Coral
// Bay 3.1 / a generated 74-building grid, with designs unless --designs=off, so the same layout runs on 3.0C);
// zoomed-in, gameplay and overview cameras; day and night; Life Mode; repeated camera movement; a long session.
// Reports frame pacing (rAF deltas: avg / p95 / p99 / fps), renderer JS per frame, load time to data-art=ready,
// downloaded art bytes, atlas pages and estimated atlas GPU memory, and whether every building stayed baked.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { coralBay } from './vw3b_city.mjs';
import { coralBay31 } from './vw31_city.mjs';

const base = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:4191';
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'run';
const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
const uncapped = process.argv.includes('--uncapped');
const software = process.argv.includes('--software');
const designs = !process.argv.includes('--designs=off');
const SAVE_KEY = 'tiny-city-imagine-save-v1';

/** A generated mixed-use grid: 74 buildings of every type on a road grid (designs cycle through the collections). */
function mixedGrid() {
  const roads = new Map(); const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  const rows = [6, 13, 20, 27, 34, 41, 48];
  for (const y of rows) for (let x = 4; x <= 58; x += 1) add(x, y);
  for (let y = 6; y <= 48; y += 1) { add(4, y); add(58, y); }
  const kinds = [['villa', 2, 2], ['duplex', 3, 2], ['townhouse', 2, 3], ['apartment', 4, 4], ['office', 4, 4], ['villa', 2, 2], ['clubhouse', 3, 3], ['villa', 2, 2], ['pool', 3, 4], ['mall', 6, 5]];
  const models = {
    villa: ['lm.villa.glass-pavilion', 'lm.villa.sky-terrace', 'mc.villa.shoreline', 'tc.villa.lanai', 'fg.villa.garden-porch', 'lm.villa.linear-modern'],
    duplex: ['lm.duplex.twin-glass', 'lm.duplex.urban-terrace'], townhouse: ['lm.townhouse.urban-glass', 'lm.townhouse.warm-timber'],
    apartment: ['lm.apartment.premium-glass', 'lm.apartment.green-terrace'], office: ['up.office.glass', 'up.office.premium-tower', 'tc.office.rooftop-garden'],
    clubhouse: ['tc.clubhouse.resort', 'mc.clubhouse.leisure'], pool: ['lm.pool.geometric', 'fg.pool.community'], mall: ['up.mall.glass', 'lm.mall.boutique-frontage'],
  };
  const collectionOf = (m) => ({ lm: 'luxury-minimalist', mc: 'modern-coastal', tc: 'tropical-contemporary', up: 'urban-premium', fg: 'family-garden' })[m.split('.')[0]];
  const buildings = []; let n = 0;
  for (const y of rows.slice(1)) {
    let x = 6, k = rows.indexOf(y);
    while (x < 56) {
      const [kind, w, h] = kinds[k++ % kinds.length];
      if (x + w > 57 || h > 5) { x += 1; continue; }
      const model = models[kind][n % models[kind].length];
      buildings.push({ id: `g-${n}`, kind, x, y: y - h, name: `${kind} ${n}`, createdAt: 0, ...(designs ? { design: { collection: collectionOf(model), model } } : {}) });
      n += 1; x += w + 1;
    }
  }
  return { size: 64, funds: 1_000_000, roads: [...roads.values()], buildings };
}

const gpu = software ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: [...gpu, ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const result = { label, base, uncapped, software, designs, date: new Date().toISOString(), scenarios: [] };
const pacing = (page, ms = 4000) => page.evaluate((duration) => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); const end = last + duration;
  const tick = (now) => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(deltas.slice(5)); };
  requestAnimationFrame(tick);
}), ms);
const stats = (d) => { const s = [...d].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))], avg = d.reduce((a, b) => a + b, 0) / d.length;
  return { avgMs: +avg.toFixed(2), p95Ms: +q(0.95).toFixed(2), p99Ms: +q(0.99).toFixed(2), fps: +(1000 / avg).toFixed(1) }; };
const renderer = (page) => page.evaluate(() => window.__tinyCityRenderer ?? null);

async function open(seed) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  let artBytes = 0;
  page.on('response', async (response) => { if (response.url().includes('/art/vw3/')) { try { artBytes += (await response.body()).length; } catch { /* aborted */ } } });
  await page.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('b')) { localStorage.clear(); if (value) localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('b', '1'); } }, { key: SAVE_KEY, value: seed });
  const started = Date.now();
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 60_000 });
  const loadMs = Date.now() - started;
  await page.waitForTimeout(1500);
  return { page, loadMs, artBytes: () => artBytes };
}
async function settle(page) { let prev = ''; for (let i = 0; i < 40; i += 1) { const cur = await page.getByTestId('minimap-camera').getAttribute('points'); if (cur === prev) return; prev = cur; await page.waitForTimeout(200); } }
async function spanOf(page) { const p = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((q) => q.split(',').map(Number)); return Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) * 64 / 100; }
async function frame(page, span) {
  await page.getByRole('button', { name: 'Center neighborhood' }).click(); await settle(page);
  if (!span) return;
  for (let i = 0; i < 24; i += 1) {
    const now = await spanOf(page);
    if (now > span * 1.12) await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); else if (now < span / 1.12) await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); else break;
    await page.waitForTimeout(350); await settle(page);
  }
}
const minutes = async (page) => { const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(h) * 60 + Number(m); };
async function until(page, minute) {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 4000 && await minutes(page) < minute; i += 1) await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Speed 1x' }).click();
}
async function welcome(page) {
  await page.getByRole('button', { name: /^Live\b/ }).first().click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.waitForTimeout(500);
}
async function measure(page, name, extra = {}) {
  await page.waitForTimeout(1200);
  const p = stats(await pacing(page));
  const r = await renderer(page);
  const entry = { name, ...p, rendererMs: r?.frameMs ?? null, gpuTextureMB: r?.gpuTextureBytes ? +(r.gpuTextureBytes / 1048576).toFixed(1) : null, visibleResidents: r?.visibleResidents ?? 0, bakedBuildings: r?.bakedBuildings ?? null, vectorBuildings: r?.vectorBuildings ?? null, ...extra };
  console.log(JSON.stringify(entry));
  result.scenarios.push(entry);
}

// 1. Default sample city.
{
  const { page, loadMs, artBytes } = await open(null);
  const r = await renderer(page);
  result.load = { loadMs, artBytes: artBytes(), atlasPages: r?.atlasPages ?? null, atlasBytes: r?.atlasBytes ?? null };
  await frame(page, 0);
  await measure(page, 'default-city-gameplay-day');
  await page.close();
}
// 2. Dense residential district (Coral Bay; 3.1 designs unless --designs=off), with residents: day, night, cameras.
{
  const { page } = await open(designs ? coralBay31() : coralBay());
  await welcome(page);
  await until(page, 12 * 60);
  await frame(page, 24); await measure(page, 'dense-residential-gameplay-day');
  await frame(page, 10); await measure(page, 'dense-residential-zoomed-in-day');
  await frame(page, 0); await measure(page, 'dense-residential-overview-day');
  await until(page, 22 * 60);
  await frame(page, 24); await measure(page, 'dense-residential-gameplay-night');
  // Repeated camera movement: zoom and pan while measuring.
  const moving = pacing(page, 6000);
  for (let i = 0; i < 6; i += 1) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await page.waitForTimeout(250);
    await page.keyboard.down('Shift'); await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(820, 520, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Shift');
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); await page.waitForTimeout(250);
  }
  const p = stats(await moving);
  result.scenarios.push({ name: 'dense-residential-camera-movement', ...p });
  console.log(JSON.stringify({ name: 'dense-residential-camera-movement', ...p }));
  await page.close();
}
// 3. Large mixed-use city (~150 buildings) with residents: gameplay, overview, long session.
{
  const city = mixedGrid();
  const { page } = await open(city);
  await welcome(page);
  await until(page, 8 * 60);
  await frame(page, 24); await measure(page, 'large-mixed-use-gameplay-day', { buildings: city.buildings.length });
  await frame(page, 0); await measure(page, 'large-mixed-use-overview-day', { buildings: city.buildings.length });
  // Long session: run the city at 4× for 60 s of wall time, then measure again and record JS heap.
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await page.waitForTimeout(60_000);
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  await frame(page, 24); await measure(page, 'large-mixed-use-after-long-session', { buildings: city.buildings.length, jsHeapMB: heap ? +(heap / 1048576).toFixed(1) : null });
  await page.close();
}
// 4. Life Mode: create a character in the dense district and follow them.
{
  const { page } = await open(designs ? coralBay31() : coralBay());
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Mai');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { disabled: false }).first().click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await page.waitForTimeout(3000);
  await measure(page, 'life-mode-follow');
  await page.close();
}
await browser.close();
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result.load));
