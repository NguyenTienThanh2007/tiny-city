#!/usr/bin/env node
// Captures design-review screenshots of the running app.
// Usage: node scripts/capture_ui.mjs [baseUrl] [outDir]
// Requires a running frontend (npm run dev) and, for AI scenes, a mock-mode planning API.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outDir = process.argv[3] ?? 'docs/design/screenshots/after';
mkdirSync(outDir, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';

// The sample neighborhood plus a road-connected office tower, so residents commute.
function showcaseCity() {
  const roads = new Map();
  const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  for (let y = 10; y <= 29; y += 1) add(18, y);
  for (let x = 10; x <= 27; x += 1) add(x, 20);
  for (let y = 14; y <= 26; y += 1) { add(12, y); add(25, y); }
  for (let x = 13; x <= 23; x += 1) { add(x, 12); add(x, 27); }
  for (let x = 26; x <= 28; x += 1) add(x, 20);
  for (const [x, y] of [[13, 14], [13, 17], [13, 22], [19, 14], [19, 17], [19, 22], [11, 15], [26, 24]]) add(x, y);
  const homes = [[14, 14], [20, 14], [14, 17], [20, 17], [14, 22], [20, 22], [14, 25], [20, 25], [9, 15], [27, 24]];
  return {
    size: 64, funds: 24680, roads: [...roads.values()],
    buildings: [
      ...homes.map(([x, y], index) => ({ id: `villa-seed-${index + 1}`, kind: 'villa', x, y, name: `Villa ${String(index + 1).padStart(2, '0')}`, createdAt: 0 })),
      { id: 'clubhouse-seed', kind: 'clubhouse', x: 8, y: 21, name: 'Garden Clubhouse', createdAt: 0 },
      { id: 'park-seed', kind: 'park', x: 29, y: 17, name: 'Coastal Park', createdAt: 0 },
      { id: 'office-seed', kind: 'office', x: 26, y: 13, name: 'Harbor Office', createdAt: 0 },
      { id: 'apartment-seed', kind: 'apartment', x: 19, y: 7, name: 'Sea View Apartments', createdAt: 0 },
    ],
  };
}

const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7) ?? 'all';
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(viewport, city) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  if (city) await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('capture-fixture')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('capture-fixture', '1'); }
  }, { key: SAVE_KEY, value: city });
  await page.goto(baseUrl);
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1500);
  return page;
}
async function shot(page, name) {
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('captured', name);
}
async function clockMinutes(page) {
  const text = await page.getByLabel('Simulation clock').textContent();
  const [, h, m] = /(\d\d):(\d\d)/.exec(text);
  return Number(h) * 60 + Number(m);
}
async function runUntil(page, minute) {
  for (let i = 0; i < 400 && await clockMinutes(page) < minute; i += 1) await page.waitForTimeout(150);
}

// World close-ups, night lighting, placement feedback and AI connectivity.
if (only === 'all' || only === 'extra') {
  const page = await open({ width: 1440, height: 900 }, showcaseCity());
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await runUntil(page, 7 * 60 + 20);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(700);
  await shot(page, 'desktop-11-closeup-day');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await runUntil(page, 21 * 60 + 30);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(1600);
  await shot(page, 'desktop-12-closeup-night');
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await page.waitForTimeout(500);
  await shot(page, 'desktop-13-night');
  await page.close();
}
if (only === 'all' || only === 'extra') {
  const page = await open({ width: 1440, height: 900 });
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Office $640', exact: true }).click();
  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width * 0.36, canvas.y + canvas.height * 0.47);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/desktop-14-invalid-placement.png` });
  await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.72);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/desktop-15-valid-placement.png` });
  console.log('captured placement previews');
  await page.keyboard.press('Escape');
  await page.route('**/v1/city/plan', (route) => route.abort('connectionrefused'));
  await page.route('**/v1/city/status', (route) => route.abort('connectionrefused'));
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill('Add a small park near the villas');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  await page.waitForTimeout(1500);
  await shot(page, 'desktop-16-ai-unavailable');
  await page.close();
}
if (only === 'extra') { await browser.close(); process.exit(0); }

// Desktop: initial, build, plan, preview, error.
{
  const page = await open({ width: 1440, height: 900 });
  await shot(page, 'desktop-01-initial');
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Townhouse $160', exact: true }).click();
  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width * 0.42, canvas.y + canvas.height * 0.55);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/desktop-02-build-ghost.png` });
  console.log('captured desktop-02-build-ghost');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await shot(page, 'desktop-03-plan');
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill('Build two villas and one park; preserve existing roads.');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  try {
    await page.getByRole('button', { name: 'Approve & build' }).waitFor({ timeout: 20000 });
    await shot(page, 'desktop-04-ai-preview');
  } catch { await shot(page, 'desktop-04-ai-preview-unavailable'); }
  await page.route('**/v1/city/plan', (route) => route.fulfill({ status: 503, json: { requestId: 'design-review', error: { code: 'PROVIDER_TIMEOUT', message: 'The AI provider timed out. Retry when ready.', retryable: true } } }));
  if (await page.getByRole('button', { name: 'Reject', exact: true }).count()) await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  await page.getByText('The AI provider timed out. Retry when ready.').waitFor();
  await shot(page, 'desktop-05-ai-error');
  await page.close();
}

// Desktop: living world.
{
  const page = await open({ width: 1440, height: 900 }, showcaseCity());
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await shot(page, 'desktop-06-live-welcome');
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await runUntil(page, 7 * 60 + 8);
  await shot(page, 'desktop-07-living-city');
  const walker = page.locator('.walker').first();
  if (await walker.count()) {
    await walker.click();
    await page.waitForTimeout(900);
    await shot(page, 'desktop-08-citizen-inspector');
    await page.getByRole('button', { name: 'Follow', exact: true }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'desktop-09-follow');
    await page.locator('.citizen-inspector .fact-list .link-button').first().click();
    await page.waitForTimeout(400);
    await shot(page, 'desktop-10-building-inspector');
  }
  const stats = await page.evaluate(() => window.__tinyCityRenderer);
  console.log('renderer', JSON.stringify(stats));
  await page.close();
}

// Tablet and phone.
{
  const page = await open({ width: 820, height: 1180 }, showcaseCity());
  await shot(page, 'tablet-01-initial');
  await page.close();
}
{
  const page = await open({ width: 390, height: 844 });
  await shot(page, 'mobile-01-initial');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await shot(page, 'mobile-02-build-sheet');
  await page.close();
}
{
  const page = await open({ width: 390, height: 844 }, showcaseCity());
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await runUntil(page, 7 * 60 + 8);
  await shot(page, 'mobile-03-live-sheet');
  const walker = page.locator('.walker').first();
  if (await walker.count()) { await walker.click(); await page.waitForTimeout(800); await shot(page, 'mobile-04-citizen'); }
  await page.getByRole('button', { name: 'Show AI Architect panel' }).click().catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, 'mobile-05-ai-panel');
  await page.close();
}
await browser.close();
