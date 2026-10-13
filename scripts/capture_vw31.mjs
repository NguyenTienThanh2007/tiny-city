// Visual World 3.1 evidence: node scripts/capture_vw31.mjs [afterUrl] [beforeUrl] [outDir] [--only=01,cmp]
// Real browser captures through the real UI only: the architecture gallery and Coral Bay 3.1 (scripts/vw31_city.mjs)
// at fixed scripted cameras and clock times, the Style Selector, placement preview, construction result, an AI
// Architect styled plan (offline rules API) and the phone layout. `beforeUrl` (a 3.0C build of main) supplies the
// matched before/after pairs of the same Coral Bay layout without designs.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { coralBay } from './vw3b_city.mjs';
import { coralBay31, gallery } from './vw31_city.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const after = args[0] ?? 'http://127.0.0.1:5173';
const before = args[1] ?? 'http://127.0.0.1:4190';
const out = args[2] ?? 'docs/visual-world-3/architecture-expansion/screenshots';
mkdirSync(out, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const want = (...names) => !only || names.some((name) => only.some((prefix) => name.startsWith(prefix)));

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
async function open(base, seed, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 600 ? 2 : 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    if (value) localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.setItem('seeded', '1');
  }, { key: SAVE_KEY, value: seed });
  await page.goto(base);
  await page.locator('canvas').waitFor();
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  return { context, page };
}
const shot = async (page, name, { hover = false, clip } = {}) => {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  if (!hover) await page.mouse.move(2, 2);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 90, clip });
  console.log('captured', name);
};
const minutes = async (page) => { const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(h) * 60 + Number(m); };
async function until(page, minute) {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 4000 && await minutes(page) < minute; i += 1) await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(400);
}
/** The camera glides; wait until the minimap footprint stops changing. */
async function settle(page) {
  let previous = '';
  for (let i = 0; i < 60; i += 1) {
    const current = (await page.getByTestId('minimap-camera').getAttribute('points')) ?? '';
    if (current === previous) return;
    previous = current;
    await page.waitForTimeout(200);
  }
}
async function center(page) { await page.getByRole('button', { name: 'Center neighborhood' }).click(); await settle(page); }
async function zoom(page, steps) {
  const name = steps > 0 ? 'Zoom in' : 'Zoom out';
  for (let i = 0; i < Math.abs(steps); i += 1) { await page.getByRole('button', { name, exact: true }).click(); await settle(page); }
}
async function screenOf(page, gx, gy) {
  const bounds = await page.locator('canvas').boundingBox();
  const points = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const world = (x, y) => ({ x: (x - y) * 28, y: (x + y) * 14 });
  const origin = world(points[0][0], points[0][1]), right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x), target = world(gx, gy);
  return { x: bounds.x + (target.x - origin.x) * scale, y: bounds.y + (target.y - origin.y) * scale };
}
/** Visible width of the camera footprint, in tiles (from the minimap's camera polygon). */
async function spanOf(page) {
  const p = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((q) => q.split(',').map(Number));
  return Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) * 64 / 100;
}
/**
 * Frames grid point (gx, gy) at a safe screen spot showing about `span` tiles across: zoom buttons until the camera
 * footprint matches, then Shift-drag the map (the real pan gesture) until the point sits at the spot.
 */
async function focus(page, gx, gy, span, safe = { x: 620, y: 470 }) {
  await center(page);
  for (let i = 0; i < 24; i += 1) {
    const now = await spanOf(page);
    if (now > span * 1.12) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    else if (now < span / 1.12) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    else break;
    await page.waitForTimeout(450);
    await settle(page);
  }
  for (let i = 0; i < 12; i += 1) {
    const at = await screenOf(page, gx, gy);
    const dx = safe.x - at.x, dy = safe.y - at.y;
    if (Math.hypot(dx, dy) < 6) break;
    const k = Math.min(1, 300 / Math.hypot(dx, dy));
    await page.keyboard.down('Shift');
    await page.mouse.move(safe.x, safe.y); await page.mouse.down();
    await page.mouse.move(safe.x + dx * k, safe.y + dy * k, { steps: 6 }); await page.mouse.up();
    await page.keyboard.up('Shift');
    await settle(page);
  }
  await page.waitForTimeout(400);
}
async function collapsePanel(page) {
  const collapse = page.getByRole('button', { name: 'Collapse side panel' });
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
  await page.waitForTimeout(300);
}
async function welcome(page) {
  await page.getByRole('button', { name: /^Live\b/ }).first().click();
  const button = page.getByRole('button', { name: 'Welcome residents' });
  await button.waitFor({ timeout: 5000 });
  await button.click();
  await page.getByRole('heading', { name: /residents$/ }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.waitForTimeout(400);
}

// 01–09: the architecture gallery at noon, panel collapsed for a clean frame.
if (want('01', '02', '03', '04', '05', '06', '07', '08', '09')) {
  const { context, page } = await open(after, gallery());
  await collapsePanel(page);
  await until(page, 12 * 60);
  const frames = [
    ['01-luxury-minimalist-villas', 13, 11, 24], ['02-villa-facades-closeup', 8.5, 11, 11], ['03-duplex-collection', 11, 20, 19],
    ['04-townhouse-collection', 26.5, 19.5, 16], ['05-apartment-collection', 14, 29, 24], ['06-malls', 34.5, 40.5, 26],
    ['07-offices', 13, 41, 23], ['08-clubhouses', 9, 53.5, 17], ['09-pools-and-parks', 30, 53, 28],
  ];
  for (const [name, gx, gy, z] of frames) if (want(name.slice(0, 2))) { await focus(page, gx, gy, z); await shot(page, name); }
  await context.close();
}

// 10, 11, 16–19: Coral Bay 3.1 with residents; matched before/after pairs against the 3.0C build.
const districtShots = async (base, seed, suffix) => {
  const { context, page } = await open(base, seed);
  // Residents first (night lighting and window life follow the living city), then a clean frame.
  await welcome(page);
  await collapsePanel(page);
  await until(page, 12 * 60);
  if (want('19')) { await center(page); await shot(page, `19-gameplay-zoom${suffix}`); }
  if (want('11', 'cmp')) { await focus(page, 24, 25, 46); await shot(page, `11-mixed-district${suffix}`); }
  if (want('10', 'cmp')) { await focus(page, 9.5, 24.5, 18); await shot(page, `10-luxury-minimalist-neighbourhood${suffix}`); }
  if (want('16', 'cmp')) { await focus(page, 21, 21, 24); await shot(page, `16-daytime-downtown${suffix}`); }
  if (want('17', 'cmp')) { await until(page, 18 * 60 + 30); await focus(page, 21, 21, 24); await shot(page, `17-golden-hour${suffix}`); }
  if (want('18', 'cmp')) { await until(page, 22 * 60); await focus(page, 21, 21, 24); await shot(page, `18-night${suffix}`); }
  await context.close();
};
if (want('10', '11', '16', '17', '18', '19', 'cmp')) {
  await districtShots(after, coralBay31(), '');
  if (want('cmp')) await districtShots(before, coralBay(), '-before-3.0c');
}

// 12–14: Style Selector, placement preview and the construction result (Coral Bay 3.1 free lots in the south).
if (want('12', '13', '14')) {
  const { context, page } = await open(after, coralBay31());
  await until(page, 12 * 60);
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Architectural collection' }).getByRole('radio', { name: /^Luxury Minimalist/ }).click();
  await page.getByRole('radiogroup', { name: 'Building model' }).getByRole('radio', { name: 'Sky Terrace Villa', exact: true }).click();
  await focus(page, 13, 33, 18);
  const at = await screenOf(page, 12.5, 32.5);
  await page.mouse.move(at.x - 4, at.y - 4); await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(500);
  if (want('12')) await shot(page, '12-style-selector', { hover: true });
  if (want('13')) await shot(page, '13-placement-preview', { hover: true, clip: { x: 200, y: 180, width: 760, height: 560 } });
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(6500);
  if (want('14')) await shot(page, '14-construction-result');
  await context.close();
}

// 15: AI Architect styled plan (the after URL's API runs the offline rules interpreter; no AI provider involved).
if (want('15')) {
  const { context, page } = await open(after, coralBay31());
  await until(page, 12 * 60);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill('Xây 3 biệt thự Luxury Minimalist gần đường');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  await page.getByRole('list', { name: 'Plan architecture' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await shot(page, '15-ai-architect-styled-plan');
  await page.getByRole('button', { name: 'Approve & build' }).click();
  await page.waitForTimeout(7000);
  await shot(page, '15b-ai-architect-styled-result');
  await context.close();
}

// 20: phone layout with the selector in the build sheet.
if (want('20')) {
  const { context, page } = await open(after, coralBay31(), { width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Architectural collection' }).getByRole('radio', { name: /^Luxury Minimalist/ }).click();
  await page.getByRole('radiogroup', { name: 'Building model' }).scrollIntoViewIfNeeded();
  await shot(page, '20-mobile-style-selector');
  await context.close();
}
await browser.close();
