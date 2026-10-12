// Life Mode visual QA: node scripts/capture_life.mjs [baseUrl] [outDir]
// Needs a running dev or preview server. Uses the sample city and real UI interactions only.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = process.argv[3] ?? 'docs/life/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(viewport, seed) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  if (seed) await page.addInitScript(({ value }) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tiny-city-imagine-save-v1', JSON.stringify(value)); sessionStorage.setItem('seeded', '1'); } }, { value: seed });
  else await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } });
  await page.goto(base);
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(1200);
  return { context, page };
}
async function clickTile(page, x, y) {
  const bounds = await page.locator('canvas').boundingBox();
  const points = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const world = (gx, gy) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const origin = world(points[0][0], points[0][1]), right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x), target = world(x + 0.5, y + 0.5);
  await page.mouse.click(bounds.x + (target.x - origin.x) * scale, bounds.y + (target.y - origin.y) * scale);
}
const shot = async (page, name) => { await page.mouse.move(2, 2); await page.waitForTimeout(450); await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 85 }); console.log('captured', name); };
const minutes = async (page) => { const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(h) * 60 + Number(m); };
async function until(page, minute, speed = 'Speed 4x') {
  await page.getByRole('button', { name: speed }).click();
  for (let i = 0; i < 400 && await minutes(page) < minute; i += 1) await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Speed 1x' }).click();
}
async function create(page, { name = 'Mai Nguyen', home = /^Villa 03/, look = true, shots = false } = {}) {
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  if (shots) await shot(page, '01-life-entry');
  await page.getByRole('button', { name: 'Create character' }).click();
  if (shots) await shot(page, '02-creator-default');
  await page.getByLabel('Character name').fill(name);
  if (look) {
    for (const option of ['Hairstyle Curly', 'Outfit Overalls', 'Accessory Glasses', 'Skin tone Tan', 'Outfit color Terracotta']) await page.getByRole('radio', { name: option }).check();
  }
  if (shots) await shot(page, '03-creator-custom');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: home }).click();
  await page.waitForTimeout(600);
  if (shots) await shot(page, '04-home-selection');
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: /Move in/ }).click();
  await page.waitForTimeout(900);
}

// Desktop journey on the sample city.
{
  const { context, page } = await open({ width: 1440, height: 900 });
  await create(page, { shots: true });
  await shot(page, '05-first-spawn-night');
  await until(page, 9 * 60 + 30);
  // A long walk across the sample city, so the route and the walking figure are on screen.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await page.waitForTimeout(600);
  await clickTile(page, 25, 26);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await shot(page, '06-walking-route');
  await page.getByRole('button', { name: /Follow your character/ }).click().catch(() => {});
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(400);
  await shot(page, '07-walking-closeup');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('status', { name: 'Current activity' }).filter({ hasText: /Free to explore/ }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: /Visit a park/ }).click();
  await page.getByRole('status', { name: 'Current activity' }).filter({ hasText: /Enjoying/ }).waitFor({ timeout: 60_000 });
  await shot(page, '08-visit-performing');
  // Evening: residents relax at the clubhouse, the nearest venue to home.
  await page.getByRole('button', { name: /^Go home/ }).click();
  await page.getByRole('status', { name: 'Current activity' }).filter({ hasText: /At home/ }).waitFor({ timeout: 60_000 });
  await until(page, 17 * 60 + 40);
  await page.getByRole('button', { name: /Visit a park/ }).click();
  await page.getByRole('status', { name: 'Current activity' }).filter({ hasText: /Enjoying/ }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const nearby = page.getByRole('list', { name: 'Nearby residents' });
  if (await nearby.count()) {
    await shot(page, '09-nearby-residents');
    await nearby.getByRole('button').first().click();
    await page.waitForTimeout(400);
    await page.getByRole('region', { name: 'Interact' }).getByRole('button', { name: /^Chat/ }).click();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.waitForTimeout(1500);
    await shot(page, '10-chatting-with-resident');
    await page.getByRole('button', { name: 'Close resident profile' }).click();
    await page.waitForTimeout(3000);
    await shot(page, '11-needs-hud-diary');
  } else { console.warn('no residents nearby at the venue'); await page.getByRole('button', { name: 'Resume', exact: true }).click(); }
  await page.getByRole('button', { name: /^Rest/ }).click();
  await page.getByRole('status', { name: 'Current activity' }).filter({ hasText: /Resting/ }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, '12-resting-at-home');
  await page.locator('.map-stage').click({ position: { x: 300, y: 800 } });
  await page.waitForTimeout(400);
  await shot(page, '13-invalid-destination');
  await until(page, 22 * 60 + 10);
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await page.waitForTimeout(600);
  await shot(page, '14-night-city');
  await page.getByRole('button', { name: 'Edit look' }).click();
  await page.waitForTimeout(500);
  await shot(page, '15-edit-look');
  await context.close();
}

// Full housing fallback.
{
  const { context, page } = await open({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Sam');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.waitForTimeout(600);
  await shot(page, '16-no-free-home');
  await context.close();
}

// Tablet and phone.
for (const [label, viewport] of [['17-tablet', { width: 1024, height: 768 }], ['18-phone', { width: 390, height: 844 }]]) {
  const { context, page } = await open(viewport);
  if (label === '18-phone') {
    await page.getByRole('button', { name: 'Life', exact: true }).click();
    await page.getByRole('button', { name: 'Create character' }).click();
    await page.getByLabel('Character name').fill('Mai');
    await page.getByRole('radio', { name: 'Hairstyle Bun' }).check();
    await page.getByRole('radio', { name: 'Accessory Sun hat' }).check();
    await shot(page, '18-phone-creator');
    await page.getByRole('button', { name: /Next: choose a home/ }).click();
    await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: /^Villa 03/ }).click();
    await page.waitForTimeout(500);
    await shot(page, '19-phone-home-sheet');
    await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: /Move in/ }).click();
    await page.waitForTimeout(1000);
    await until(page, 9 * 60);
    await shot(page, '20-phone-hud');
    await page.getByRole('button', { name: "Open Mai's profile" }).click();
    await page.waitForTimeout(500);
    await shot(page, '21-phone-profile');
  } else {
    await create(page, { name: 'Linh', home: /^Villa 05/ });
    await until(page, 10 * 60);
    await shot(page, label);
  }
  await context.close();
}
await browser.close();
