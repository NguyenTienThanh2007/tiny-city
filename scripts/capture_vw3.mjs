// Visual World 3.0 evidence: node scripts/capture_vw3.mjs [baseUrl] [outDir] [--only=name,name]
// Needs a running dev or preview server (and the mock API). Seeds the Lagoon Quarter vertical slice and the sample
// city, then captures the same camera positions so before/after shots line up. Real UI interactions only.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const base = args[0] ?? 'http://127.0.0.1:5181';
const out = args[1] ?? 'docs/visual-world-3/screenshots/after';
mkdirSync(out, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';

/** The 3.0A vertical slice: villas, townhouses, an apartment block and a park on a connected street grid. */
export function lagoonQuarter() {
  const roads = new Map();
  const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  for (let x = 13; x <= 35; x += 1) { add(x, 20); add(x, 27); }
  for (let y = 13; y <= 32; y += 1) add(25, y);
  for (let y = 21; y <= 26; y += 1) add(13, y);
  const b = (id, kind, x, y, name) => ({ id, kind, x, y, name, createdAt: 0 });
  return { size: 64, funds: 18_000, roads: [...roads.values()], buildings: [
    b('lq-villa-1', 'villa', 15, 18, 'Coral Villa'), b('lq-villa-2', 'villa', 18, 18, 'Seabreeze Villa'),
    b('lq-town-1', 'townhouse', 21, 17, 'Harbour Row'), b('lq-apt-1', 'apartment', 26, 16, 'Lagoon Residences'),
    b('lq-villa-3', 'villa', 15, 21, 'Palm Villa'), b('lq-villa-4', 'villa', 18, 21, 'Driftwood Villa'),
    b('lq-town-2', 'townhouse', 21, 21, 'Saltmarsh Row'), b('lq-park', 'park', 26, 21, 'Lagoon Park'),
    b('lq-villa-5', 'villa', 15, 25, 'Shell Villa'), b('lq-villa-6', 'villa', 18, 25, 'Dune Villa'),
    b('lq-town-3', 'townhouse', 21, 24, 'Tide Row'), b('lq-apt-2', 'apartment', 30, 16, 'Marina Court'),
    b('lq-villa-7', 'villa', 26, 28, 'Cove Villa'), b('lq-villa-8', 'villa', 29, 28, 'Reef Villa'),
  ] };
}
/** Sparse: one villa on a short street. Dense: a packed block of every slice building. */
const sparse = () => ({ size: 64, funds: 18_000, roads: Array.from({ length: 9 }, (_, i) => ({ x: 26 + i, y: 24 })),
  buildings: [{ id: 'sp-villa', kind: 'villa', x: 28, y: 22, name: 'Lone Villa', createdAt: 0 }] });
function dense() {
  const roads = new Map();
  const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  for (let x = 14; x <= 40; x += 1) for (const y of [16, 21, 26, 31]) add(x, y);
  for (let y = 12; y <= 34; y += 1) for (const x of [14, 27, 40]) add(x, y);
  const buildings = [];
  let n = 0;
  for (const y of [17, 22, 27]) {
    for (let x = 15; x + 2 <= 27; x += 2) buildings.push({ id: `dn-v-${n++}`, kind: 'villa', x, y: y + 2, name: `Villa ${n}`, createdAt: 0 });
    buildings.push({ id: `dn-a-${n++}`, kind: 'apartment', x: 28, y, name: `Tower ${n}`, createdAt: 0 });
    buildings.push({ id: `dn-t-${n++}`, kind: 'townhouse', x: 32, y: y + 1, name: `Row ${n}`, createdAt: 0 });
    buildings.push({ id: `dn-t-${n++}`, kind: 'townhouse', x: 34, y: y + 1, name: `Row ${n}`, createdAt: 0 });
    buildings.push({ id: `dn-p-${n++}`, kind: y === 22 ? 'park' : 'apartment', x: 36, y, name: `Block ${n}`, createdAt: 0 });
  }
  return { size: 64, funds: 18_000, roads: [...roads.values()], buildings };
}

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
  await page.waitForTimeout(1500);
  return { context, page };
}
const want = (name) => !only || only.some((prefix) => name.startsWith(prefix));
const shot = async (page, name) => { await page.mouse.move(2, 2); await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 }); console.log('captured', name); };
const minutes = async (page) => { const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(h) * 60 + Number(m); };
async function until(page, minute) {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 2400 && await minutes(page) < minute; i += 1) await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(300);
}
async function center(page) { await page.getByRole('button', { name: 'Center neighborhood' }).click(); await page.waitForTimeout(700); }
async function zoom(page, steps) {
  const name = steps > 0 ? 'Zoom in' : 'Zoom out';
  for (let i = 0; i < Math.abs(steps); i += 1) await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(400);
}
/** Drag the map by a screen offset with the pan gesture (shift + drag). */
async function pan(page, dx, dy) {
  const box = await page.locator('canvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.keyboard.down('Shift');
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
}
/** Screen position of a grid point, derived from the minimap's camera footprint (same math as the e2e helpers). */
async function screenOf(page, gx, gy, lift = 0) {
  const bounds = await page.locator('canvas').boundingBox();
  const points = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const world = (x, y) => ({ x: (x - y) * 28, y: (x + y) * 14 });
  const origin = world(points[0][0], points[0][1]), right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x), target = world(gx, gy);
  return { x: bounds.x + (target.x - origin.x) * scale, y: bounds.y + (target.y - origin.y) * scale - lift * scale };
}
async function welcome(page) {
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.waitForTimeout(500);
}

if (want('01') || want('02') || want('03')) {
  const { context, page } = await open(lagoonQuarter());
  await center(page);
  if (want('01')) await shot(page, '01-slice-gameplay-zoom');
  await zoom(page, 2);
  if (want('02')) await shot(page, '02-slice-close');
  await pan(page, -260, 40); await zoom(page, 1);
  if (want('03')) await shot(page, '03-slice-closeup-apartment');
  await context.close();
}
if (want('04')) {
  const { context, page } = await open(null);
  await center(page);
  await shot(page, '04-sample-city');
  await context.close();
}
if (want('05')) { const { context, page } = await open(dense()); await center(page); await shot(page, '05-dense'); await context.close(); }
if (want('06')) { const { context, page } = await open(sparse()); await center(page); await zoom(page, 1); await shot(page, '06-sparse'); await context.close(); }
if (want('07') || want('08') || want('09') || want('10')) {
  const { context, page } = await open(lagoonQuarter());
  await welcome(page);
  await center(page); await zoom(page, 1);
  await until(page, 6 * 60 + 40);
  if (want('07')) await shot(page, '07-morning');
  await until(page, 18 * 60 + 40);
  if (want('08')) await shot(page, '08-sunset');
  await until(page, 21 * 60 + 40);
  if (want('09')) await shot(page, '09-night');
  if (want('10')) { await zoom(page, 2); await shot(page, '10-night-close'); }
  await context.close();
}
if (want('11') || want('12')) {
  const { context, page } = await open(lagoonQuarter());
  await welcome(page);
  await center(page); await zoom(page, 3);
  await until(page, 18 * 60 + 44);
  if (want('11')) await shot(page, '11-residents-walking');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: /^Villa \$/ }).click();
  // An open lot south of the lower street: the ghost shows the real baked villa and the road it connects to.
  const lot = await screenOf(page, 20.5, 28.5);
  await page.mouse.move(lot.x, lot.y);
  await page.waitForTimeout(500);
  if (want('12')) await page.screenshot({ path: `${out}/12-placement-preview.jpg`, type: 'jpeg', quality: 88 }), console.log('captured 12-placement-preview');
  await context.close();
}
if (want('13')) {
  const { context, page } = await open(lagoonQuarter(), { width: 390, height: 844 });
  await shot(page, '13-mobile');
  await context.close();
}
if (want('14') || want('15')) {
  // Life Mode in the slice: the player character with residents, plus a selected building.
  const { context, page } = await open(lagoonQuarter());
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Mai Nguyen');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: /^Seabreeze Villa/ }).click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: /Move in/ }).click();
  await page.waitForTimeout(800);
  await zoom(page, 2);
  await until(page, 17 * 60 + 30);
  // Walk to the corner of the street so the player is outdoors among the new art.
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  const corner = await screenOf(page, 25.5, 20.5);
  await page.mouse.click(corner.x, corner.y);
  await page.waitForTimeout(2600);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  if (want('14')) await shot(page, '14-life-mode-player');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await center(page); await zoom(page, 2);
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.42);
  await page.waitForTimeout(500);
  if (want('15')) await page.screenshot({ path: `${out}/15-building-selected.jpg`, type: 'jpeg', quality: 88 }), console.log('captured 15-building-selected');
  await context.close();
}
await browser.close();
