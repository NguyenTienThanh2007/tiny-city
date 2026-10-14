#!/usr/bin/env node
// Phase 5 browser benchmark: node scripts/p5_benchmark.mjs <url> [--label=x] [--out=f.json] [--sizes=20,100,300,1000]
// Real UI only, on a production build. For each population: a generated city whose housing holds N residents (one
// room is the character's), filled through the real create-character flow with "welcome residents", then:
//   city-running     clock at 4×, City View, nothing touched: rAF pacing and renderer JS per frame
//   midnight         the frames around a midnight settlement (worst frame within ±2 s of the day change)
//   economy-panel    (builds with the economy) the City economy panel open while the clock runs at 4×:
//                    pacing, plus DOM mutations per second inside the panel (its update frequency)
//   save             serialized save size after the session
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const base = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:4195';
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'run';
const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
const sizes = (process.argv.find((arg) => arg.startsWith('--sizes='))?.slice(8) ?? '20,100,300,1000').split(',').map(Number);
const SAVE_KEY = 'tiny-city-imagine-save-v1';

function populationCity(residents) {
  const rows = [10, 22, 34, 46];
  const roads = new Map();
  for (const y of rows) for (let x = 4; x <= 56; x += 1) roads.set(`${x},${y}`, { x, y });
  for (let y = 10; y <= 46; y += 1) roads.set(`4,${y}`, { x: 4, y });
  const buildings = [];
  let rooms = 0, slot = 0, n = 0;
  const lots = rows.flatMap((y) => Array.from({ length: 10 }, (_, i) => ({ x: 6 + i * 5, y })));
  while (rooms < residents + 1 && slot < lots.length) {
    const lot = lots[slot++];
    const apartment = residents + 1 - rooms >= 24;
    buildings.push({ id: `h-${n}`, name: `Home ${n}`, kind: apartment ? 'apartment' : 'villa', x: lot.x, y: lot.y - (apartment ? 4 : 2), createdAt: 0 });
    rooms += apartment ? 24 : 2; n += 1;
  }
  const jobs = Math.max(1, Math.ceil(residents / 60));
  for (let j = 0; j < jobs + 2; j += 1) {
    const row = rows[j % rows.length], x = 6 + Math.floor(j / rows.length) * 5;
    buildings.push({ id: `w-${j}`, name: j < jobs ? `Office ${j}` : `Park ${j}`, kind: j < jobs ? 'office' : 'park', x, y: row + 1, createdAt: 0 });
  }
  return { size: 64, funds: 1_000_000, roads: [...roads.values()], buildings };
}

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const result = { label, base, date: new Date().toISOString(), viewport: '1440x900@1x', scenarios: [] };
const pacing = (page, ms = 4000) => page.evaluate((duration) => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); const end = last + duration;
  const tick = (now) => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(deltas.slice(5)); };
  requestAnimationFrame(tick);
}), ms);
const stats = (d) => { const s = [...d].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))], avg = d.reduce((a, b) => a + b, 0) / d.length;
  return { avgMs: +avg.toFixed(2), p95Ms: +q(0.95).toFixed(2), maxMs: +s.at(-1).toFixed(1), fps: +(1000 / avg).toFixed(1) }; };
const record = async (page, name, extra) => {
  const r = await page.evaluate(() => window.__tinyCityRenderer ?? null);
  const entry = { name, rendererMs: r?.frameMs ?? null, residents: r?.residents ?? null, vectorBuildings: r?.vectorBuildings ?? null, ...extra };
  console.log(JSON.stringify(entry)); result.scenarios.push(entry);
};
const clock = async (page) => { const [, d, h, m] = /DAY\s+(\d+)\D+(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(d) * 1440 + Number(h) * 60 + Number(m); };

for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('b')) { localStorage.clear(); localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('b', '1'); } }, { key: SAVE_KEY, value: populationCity(size) });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Mai');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { disabled: false }).first().click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('group', { name: 'Character camera' }).getByRole('button', { name: 'City view' }).click().catch(() => {});
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  // Run to 22:30 so the measurements below include an evening and a midnight settlement.
  for (let i = 0; i < 2000 && (await clock(page)) % 1440 < 22 * 60 + 30; i += 1) await page.waitForTimeout(100);
  await record(page, `city-running-${size}`, { population: size, ...stats(await pacing(page)) });
  // Midnight: sample frames until the day changes, then 2 s more; report the worst frame near the change.
  const day = Math.floor((await clock(page)) / 1440);
  const midnight = await page.evaluate((startDay) => new Promise((resolve) => {
    const frames = []; let last = performance.now(), changedAt = null;
    const read = () => /DAY\s+(\d+)/.exec(document.querySelector('[aria-label="Simulation clock"]')?.textContent ?? '')?.[1];
    const tick = (now) => {
      frames.push({ t: now, d: now - last }); last = now;
      if (changedAt === null && Number(read()) - 1 > startDay) changedAt = now;
      if (changedAt !== null && now - changedAt > 2000 || frames.length > 20000) resolve({ changedAt, frames }); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), day);
  const near = midnight.frames.filter((f) => midnight.changedAt !== null && Math.abs(f.t - midnight.changedAt) <= 2000).map((f) => f.d);
  await record(page, `midnight-${size}`, { population: size, settled: midnight.changedAt !== null, ...stats(near) });
  const economyButton = page.getByRole('button', { name: 'City economy' });
  if (await economyButton.count()) {
    await economyButton.click();
    const [panelPacing, mutations] = await Promise.all([pacing(page, 5000), page.evaluate((duration) => new Promise((resolve) => {
      let count = 0; const root = document.querySelector('.economy-panel');
      const observer = new MutationObserver((records) => { count += records.length; });
      if (root) observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
      setTimeout(() => { observer.disconnect(); resolve(+(count * 1000 / duration).toFixed(1)); }, duration);
    }), 5000)]);
    await record(page, `economy-panel-${size}`, { population: size, ...stats(panelPacing), panelMutationsPerSecond: mutations });
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  const bytes = await page.evaluate((key) => localStorage.getItem(key)?.length ?? 0, SAVE_KEY);
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  await record(page, `save-${size}`, { population: size, saveBytes: bytes, jsHeapMB: heap ? +(heap / 1048576).toFixed(1) : null });
  await page.close();
}
await browser.close();
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
