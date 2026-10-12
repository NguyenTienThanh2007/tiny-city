// Phase 4.5 visual evidence: node scripts/capture_p45.mjs [baseUrl] [outDir]
// Needs a running dev or preview server (and the mock API for the Plan tab). Real UI interactions only.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = process.argv[3] ?? 'docs/acceptance/screenshots/phase-4-5';
mkdirSync(out, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const street = { size: 64, funds: 5000, roads: Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), buildings: [
  { id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 12, y: 21, createdAt: 0 },
  { id: 'villa-b', name: 'Palm Villa', kind: 'villa', x: 15, y: 21, createdAt: 0 },
  { id: 'town', name: 'Dune Townhouse', kind: 'townhouse', x: 18, y: 21, createdAt: 0 },
  { id: 'park', name: 'Sunny Park', kind: 'park', x: 22, y: 21, createdAt: 0 },
  { id: 'office', name: 'Harbor Office', kind: 'office', x: 44, y: 21, createdAt: 0 },
] };
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(seed) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('seeded')) return;
    if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.clear();
    sessionStorage.setItem('seeded', '1');
  }, { key: SAVE_KEY, value: seed ?? null });
  await page.goto(base);
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(1200);
  return { context, page };
}
const shot = async (page, name) => { await page.mouse.move(2, 2); await page.waitForTimeout(600); await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 85 }); console.log('captured', name); };
const minutes = async (page) => { const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(h) * 60 + Number(m); };
async function until(page, minute) {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  for (let i = 0; i < 1200 && await minutes(page) < minute; i += 1) await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
}
async function center(page) { await page.getByRole('button', { name: 'Center neighborhood' }).click(); await page.waitForTimeout(900); }
async function roof(page, x, y, lift) {
  const bounds = await page.locator('canvas').boundingBox();
  const points = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const world = (gx, gy) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const origin = world(points[0][0], points[0][1]), right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x), target = world(x, y);
  await page.mouse.click(bounds.x + (target.x - origin.x) * scale, bounds.y + (target.y - origin.y) * scale - lift * scale);
  await page.locator('.building-details').waitFor();
}
async function inspect(page, x, y, lift) {
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await center(page);
  await roof(page, x, y, lift);
}
async function createCharacter(page, home, shots) {
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Mai Nguyen');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: home }).click();
  if (shots) await shot(page, shots);
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: /Move in/ }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
}

// 1–2. Sample city: the picker explains what moving in does; the player's home then counts them once.
{
  const { context, page } = await open();
  await createCharacter(page, /^Villa 01/, '01-home-picker-projection');
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: /Change home|Move home/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, '02-home-list-incl-you');
  await context.close();
}
// 3–5. One street with an office: inspector at home, residents at work, evening at home, reload.
{
  const { context, page } = await open(street);
  await createCharacter(page, /Lagoon Villa/);
  await inspect(page, 13, 22, 30);
  await shot(page, '03-player-home-inspector');
  await page.getByRole('button', { name: 'Close building inspector' }).click();
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await until(page, 11 * 60);
  await inspect(page, 16, 22, 30);
  await shot(page, '04-residents-at-work');
  await page.getByRole('button', { name: 'Close building inspector' }).click();
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await until(page, 21 * 60);
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  await page.reload();
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(1200);
  await inspect(page, 19, 22.5, 45);
  await shot(page, '05-after-reload-townhouse');
  await context.close();
}
// 6. Sample city evening: residents now use the park as well as the clubhouse.
{
  const { context, page } = await open();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await until(page, 17 * 60 + 50);
  await center(page);
  await shot(page, '06-evening-leisure-sample-city');
  // The park is used too (before the fix every resident went into the clubhouse, the first venue by ID).
  await until(page, 18 * 60 + 40);
  await inspect(page, 31, 19, 5);
  await shot(page, '07-park-visitors');
  await context.close();
}
await browser.close();
