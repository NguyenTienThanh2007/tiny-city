#!/usr/bin/env node
// Phase 4.6 camera benchmark: node scripts/p46_benchmark.mjs <url> [--label=x] [--out=f.json] [--sizes=20,100,300,1000] [--software]
// Real UI only. For each population: a generated city whose housing holds about N residents, filled by creating a
// character with "welcome residents" (the real flow), then:
//   (every scenario runs during the 07:20 morning commute, residents walking)
//   city-idle     City View framing, clock running at 1×, nobody touched
//   city-zoom     continuous wheel zoom in/out at the cursor while measuring
//   life-follow   the character walks a long street with the camera following (Life View on 4.6; Focus + Follow on 4.5)
// Reports rAF frame pacing (avg / p95 / fps), renderer JS per frame (`__tinyCityRenderer.frameMs`), wheel-to-frame
// latency (wheel event → first animation frame with a changed camera footprint), DOM mutations per second in the
// React tree while following (a proxy for React commits), JS heap and GPU textures after a 45 s 4× session.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const base = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:4193';
const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? 'run';
const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6);
const sizes = (process.argv.find((arg) => arg.startsWith('--sizes='))?.slice(8) ?? '20,100,300,1000').split(',').map(Number);
const software = process.argv.includes('--software');
const SAVE_KEY = 'tiny-city-imagine-save-v1';

/** Streets at y = 10, 22, 34, 46; apartments (24 rooms) and villas (2) north of them, offices and parks south. */
function populationCity(residents) {
  const rows = [10, 22, 34, 46];
  const roads = new Map();
  for (const y of rows) for (let x = 4; x <= 56; x += 1) roads.set(`${x},${y}`, { x, y });
  for (let y = 10; y <= 46; y += 1) roads.set(`4,${y}`, { x: 4, y });
  const buildings = [];
  let rooms = 0, slot = 0, n = 0;
  const lots = rows.flatMap((y) => Array.from({ length: 10 }, (_, i) => ({ x: 6 + i * 5, y })));
  // The character takes one room; residents fill the rest.
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

const gpu = software ? ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: gpu });
const result = { label, base, software, date: new Date().toISOString(), viewport: '1440x900@1x', scenarios: [] };
const pacing = (page, ms = 4000) => page.evaluate((duration) => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); const end = last + duration;
  const tick = (now) => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(deltas.slice(5)); };
  requestAnimationFrame(tick);
}), ms);
const stats = (d) => { const s = [...d].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))], avg = d.reduce((a, b) => a + b, 0) / d.length;
  return { avgMs: +avg.toFixed(2), p95Ms: +q(0.95).toFixed(2), fps: +(1000 / avg).toFixed(1) }; };
const renderer = (page) => page.evaluate(() => window.__tinyCityRenderer ?? null);

async function open(seed) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('b')) { localStorage.clear(); localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('b', '1'); } }, { key: SAVE_KEY, value: seed });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  return page;
}
async function createCharacter(page) {
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Mai');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { disabled: false }).first().click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await page.waitForTimeout(2500);
}
/** Wheel event → first animation frame whose minimap footprint differs (median of 15). */
async function wheelLatency(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const footprint = () => document.querySelector('[data-testid="minimap-camera"]')?.getAttribute('points');
    const samples = [];
    for (let i = 0; i < 15; i += 1) {
      const before = footprint();
      const start = performance.now();
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 2 ? 100 : -100, clientX: 700, clientY: 450, bubbles: true, cancelable: true }));
      const changed = await new Promise((resolve) => { const check = (now) => { if (footprint() !== before || now - start > 1000) resolve(now - start); else requestAnimationFrame(check); }; requestAnimationFrame(check); });
      samples.push(changed);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    samples.sort((a, b) => a - b);
    return +samples[7].toFixed(1);
  });
}
/** DOM mutations per second under `.app-shell` (React commits touch the DOM) over `ms`. */
const domMutationsPerSecond = (page, ms = 4000) => page.evaluate((duration) => new Promise((resolve) => {
  let count = 0;
  const observer = new MutationObserver((records) => { count += records.length; });
  observer.observe(document.querySelector('.app-shell'), { subtree: true, childList: true, attributes: true, characterData: true });
  setTimeout(() => { observer.disconnect(); resolve(+(count * 1000 / duration).toFixed(1)); }, duration);
}), ms);
async function record(page, name, extra = {}) {
  const r = await renderer(page);
  const entry = { name, rendererMs: r?.frameMs ?? null, residents: r?.residents ?? null, visibleResidents: r?.visibleResidents ?? null,
    vectorBuildings: r?.vectorBuildings ?? null, gpuTextureMB: r?.gpuTextureBytes ? +(r.gpuTextureBytes / 1048576).toFixed(1) : null, ...extra };
  console.log(JSON.stringify(entry));
  result.scenarios.push(entry);
}

for (const size of sizes) {
  const page = await open(populationCity(size));
  await createCharacter(page);
  // Morning commute, so residents are out walking while the camera is measured.
  const resumeNow = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resumeNow.isVisible()) await resumeNow.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  const clock = async () => { const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(h) * 60 + Number(m); };
  for (let i = 0; i < 3000 && await clock() < 7 * 60 + 20; i += 1) await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  // City View: the neighbourhood framing, time running.
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await page.waitForTimeout(1500);
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.waitForTimeout(1200);
  await record(page, `city-idle-${size}`, { population: size, ...stats(await pacing(page)) });
  // Continuous zoom at the cursor.
  const zooming = pacing(page, 4000);
  await page.mouse.move(700, 450);
  for (let i = 0; i < 40; i += 1) { await page.mouse.wheel(0, i % 2 ? 100 : -100); await page.waitForTimeout(90); }
  await record(page, `city-zoom-${size}`, { population: size, ...stats(await zooming) });
  await record(page, `wheel-latency-${size}`, { population: size, wheelToFrameMs: await wheelLatency(page) });
  // Life: walk the whole first street with the camera following.
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await page.waitForTimeout(1200);
  const box = await page.locator('canvas').boundingBox();
  const points = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((p) => p.split(',').map((v) => Number(v) * 64 / 100));
  const world = (gx, gy) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const origin = world(points[0][0], points[0][1]), right = world(points[1][0], points[1][1]), scale = box.width / (right.x - origin.x);
  const target = world(54.5, 10.5);
  await page.mouse.click(box.x + (target.x - origin.x) * scale, box.y + (target.y - origin.y) * scale);
  const lifeView = page.getByRole('group', { name: 'Character camera' });
  if (await lifeView.count()) await lifeView.getByRole('button', { name: 'Life view' }).click();
  else {
    // 4.5: Focus, then Follow from the Life panel.
    await page.getByRole('button', { name: 'Focus', exact: true }).click().catch(() => {});
    const follow = page.getByRole('button', { name: /^(Follow|Following)$/ });
    if ((await follow.getAttribute('aria-pressed').catch(() => 'true')) !== 'true') await follow.click().catch(() => {});
  }
  await page.waitForTimeout(1500);
  const [followPacing, mutations] = await Promise.all([pacing(page, 5000), domMutationsPerSecond(page, 5000)]);
  await record(page, `life-follow-${size}`, { population: size, ...stats(followPacing), domMutationsPerSecond: mutations,
    following: await page.evaluate(() => window.__tinyCityCamera?.following ?? null) });
  // Long session: 4× for 45 s with periodic zoom, then heap and GPU textures.
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 15; i += 1) { await page.mouse.wheel(0, i % 2 ? 100 : -100); await page.waitForTimeout(3000); }
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  await page.waitForTimeout(1200);
  await record(page, `after-long-session-${size}`, { population: size, ...stats(await pacing(page)), jsHeapMB: heap ? +(heap / 1048576).toFixed(1) : null });
  await page.close();
}
await browser.close();
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
