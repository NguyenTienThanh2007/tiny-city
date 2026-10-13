// Visual World 3.0B evidence: node scripts/capture_vw3b.mjs [baseUrl] [outDir] [--only=01,02]
// Seeds Coral Bay (every building type, plaza, districts) and captures the 14 required views at fixed cameras so
// 3.0A (main) and 3.0B shots line up. Needs a running dev or preview server. Real UI interactions only.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { coralBay } from './vw3b_city.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const base = args[0] ?? 'http://127.0.0.1:5181';
const out = args[1] ?? 'docs/visual-world-3/screenshots/3b-after';
mkdirSync(out, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const want = (name) => !only || only.some((prefix) => name.startsWith(prefix));

function dense() {
  const roads = new Map(); const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  for (let x = 14; x <= 40; x += 1) for (const y of [16, 21, 26, 31]) add(x, y);
  for (let y = 12; y <= 34; y += 1) for (const x of [14, 27, 40]) add(x, y);
  const buildings = []; let n = 0;
  for (const y of [17, 22, 27]) {
    for (let x = 15; x + 2 <= 27; x += 2) buildings.push({ id: `dn-v-${n++}`, kind: 'villa', x, y: y + 2, name: `Villa ${n}`, createdAt: 0 });
    buildings.push({ id: `dn-a-${n++}`, kind: 'apartment', x: 28, y, name: `Tower ${n}`, createdAt: 0 });
    buildings.push({ id: `dn-t-${n++}`, kind: 'townhouse', x: 32, y: y + 1, name: `Row ${n}`, createdAt: 0 });
    buildings.push({ id: `dn-t-${n++}`, kind: 'townhouse', x: 34, y: y + 1, name: `Row ${n}`, createdAt: 0 });
    buildings.push({ id: `dn-p-${n++}`, kind: y === 22 ? 'park' : 'office', x: 36, y, name: `Block ${n}`, createdAt: 0 });
  }
  return { size: 64, funds: 18_000, roads: [...roads.values()], buildings };
}
const sparse = () => ({ size: 64, funds: 18_000, roads: Array.from({ length: 9 }, (_, i) => ({ x: 26 + i, y: 24 })),
  buildings: [{ id: 'sp-villa', kind: 'villa', x: 28, y: 22, name: 'Lone Villa', createdAt: 0 }, { id: 'sp-dup', kind: 'duplex', x: 31, y: 25, name: 'Lone Duplex', createdAt: 0 }] });

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
async function open(seed, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 600 ? 2 : 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('seeded')) return;
    if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.clear();
    sessionStorage.setItem('seeded', '1');
  }, { key: SAVE_KEY, value: seed ?? null });
  await page.goto(base);
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(2200);
  return { context, page };
}
const shot = async (page, name, hover = false) => { await page.evaluate(() => getSelection()?.removeAllRanges()); if (!hover) await page.mouse.move(2, 2); await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 }); console.log('captured', name); };
const minutes = async (page) => { const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(h) * 60 + Number(m); };
async function until(page, minute) {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 3000 && await minutes(page) < minute; i += 1) await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(300);
}
async function center(page) { await page.getByRole('button', { name: 'Center neighborhood' }).click(); await page.waitForTimeout(700); }
async function zoom(page, steps) {
  const name = steps > 0 ? 'Zoom in' : 'Zoom out';
  for (let i = 0; i < Math.abs(steps); i += 1) { await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(250); }
  await page.waitForTimeout(400);
}
async function screenOf(page, gx, gy) {
  const bounds = await page.locator('canvas').boundingBox();
  const points = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const world = (x, y) => ({ x: (x - y) * 28, y: (x + y) * 14 });
  const origin = world(points[0][0], points[0][1]), right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x), target = world(gx, gy);
  return { x: bounds.x + (target.x - origin.x) * scale, y: bounds.y + (target.y - origin.y) * scale };
}
/**
 * Centres the camera on a grid point: zoom with the buttons first, then pan with shift-drags that start from a safe
 * point in the map centre (never over the HUD), moving the world by the needed offset in chunks.
 */
async function focus(page, gx, gy, zoomSteps) {
  await center(page);
  if (zoomSteps) await zoom(page, zoomSteps);
  const safe = { x: 580, y: 470 };
  for (let i = 0; i < 8; i += 1) {
    const at = await screenOf(page, gx, gy);
    const dx = safe.x - at.x, dy = safe.y - at.y;
    if (Math.hypot(dx, dy) < 6) break;
    const k = Math.min(1, 300 / Math.hypot(dx, dy));
    await page.keyboard.down('Shift');
    await page.mouse.move(safe.x, safe.y); await page.mouse.down();
    await page.mouse.move(safe.x + dx * k, safe.y + dy * k, { steps: 6 }); await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);
}
async function welcome(page) {
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.waitForTimeout(500);
}

if (['01', '02', '03', '04', '05', '12'].some(want)) {
  const { context, page } = await open(coralBay());
  await center(page);
  if (want('01')) await shot(page, '01-city-gameplay-zoom');
  await focus(page, 10, 24, 3); if (want('02')) await shot(page, '02-residential-district');
  await focus(page, 21, 21, 2); if (want('03')) await shot(page, '03-commercial-district');
  await focus(page, 28, 23, 3); if (want('04')) await shot(page, '04-park-and-plaza');
  await focus(page, 9, 15, 3); if (want('05')) await shot(page, '05-pool-and-clubhouse');
  if (want('12')) {
    await focus(page, 23, 22, 2);
    const roof = await screenOf(page, 23, 23);
    await page.mouse.click(roof.x, roof.y - 120);
    await page.locator('.building-details').waitFor().catch(() => {});
    await shot(page, '12-building-selection');
  }
  await context.close();
}
if (want('06')) { const { context, page } = await open(dense()); await center(page); await shot(page, '06-dense'); await context.close(); }
if (want('07')) { const { context, page } = await open(sparse()); await center(page); await shot(page, '07-sparse'); await context.close(); }
if (want('08') || want('09') || want('10')) {
  const { context, page } = await open(coralBay());
  await welcome(page);
  await focus(page, 21, 24, 1);
  await until(page, 6 * 60 + 40); if (want('08')) await shot(page, '08-morning');
  await until(page, 15 * 60 + 30); if (want('09')) await shot(page, '09-afternoon');
  await until(page, 21 * 60 + 40); if (want('10')) await shot(page, '10-night');
  await context.close();
}
if (want('11')) {
  const { context, page } = await open(coralBay());
  await focus(page, 41, 25, 2);
  await page.getByRole('button', { name: /^Office \$/ }).click();
  const lot = await screenOf(page, 39.5, 22.5);
  await page.mouse.move(lot.x, lot.y);
  await shot(page, '11-construction-preview', true);
  await context.close();
}
if (want('13')) {
  const { context, page } = await open(coralBay());
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Mai Nguyen');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button').first().click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: /Move in/ }).click();
  await page.waitForTimeout(800);
  await until(page, 17 * 60 + 20);
  await page.getByRole('button', { name: 'Following' }).click().catch(() => {});
  await zoom(page, 2);
  // Walk to the avenue in front of the home so the player is outdoors among the new art.
  const target = await screenOf(page, 9.5, 20.5);
  await page.mouse.click(target.x, target.y);
  // The click may land on a neighbouring building's card; its "Walk here" action sends the player outside too.
  const walk = page.getByRole('button', { name: /Walk here/ });
  if (await walk.isVisible().catch(() => false)) await walk.click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await shot(page, '13-life-mode');
  await context.close();
}
if (want('14')) { const { context, page } = await open(coralBay(), { width: 390, height: 844 }); await shot(page, '14-mobile'); await context.close(); }
await browser.close();
