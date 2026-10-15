// Phase 6 evidence: node scripts/capture_p6.mjs [url] [outDir] [--only=01,08]
// Real browser captures through the real UI: Coral Bay 3.1 (scripts/vw31_city.mjs) welcomes its residents, a bus
// line is drawn stop by stop on the map in the Transport panel, and the city runs at 4× to the moment captured.
// Every vehicle on screen is a simulated vehicle; every number is read from the simulation.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { coralBay31 } from './vw31_city.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const base = args[0] ?? 'http://127.0.0.1:5173';
const out = args[1] ?? 'docs/phase-6-transportation/screenshots';
mkdirSync(out, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
/** The bus line used in every capture: south-west villas → south villas → east → downtown → mall → west avenue. */
export const LINE_STOPS = [[9, 30], [20, 30], [32, 30], [38, 25], [32, 20], [20, 20], [14, 25]];
const want = (...names) => !only || names.some((name) => only.some((prefix) => name.startsWith(prefix)));
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });

async function open(viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 600 ? 2 : 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear(); localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('seeded', '1');
  }, { key: SAVE_KEY, value: coralBay31() });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  return { context, page };
}
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const shot = async (page, name) => {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.mouse.move(2, 2);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 });
  log('captured', name);
};
async function screenOf(page, gx, gy) {
  const c = await page.evaluate(() => window.__tinyCityCamera);
  const box = await page.locator('canvas').boundingBox();
  const w = { x: 32 * 56 + (gx - gy) * 28, y: (gx + gy) * 14 };
  return { x: box.x + c.focalX + (w.x - c.x) * c.zoom, y: box.y + c.focalY + (w.y - c.y) * c.zoom };
}
const minute = async (page) => {
  const t = /DAY\s+(\d+)\s+·\s+(\d+):(\d+)/.exec(await page.getByLabel('Simulation clock').textContent());
  return (Number(t[1]) - 1) * 1440 + Number(t[2]) * 60 + Number(t[3]);
};
const transport = (page) => page.getByRole('region', { name: 'Transportation' });
async function openTransport(page) {
  if (!(await transport(page).isVisible())) await page.getByRole('button', { name: 'City transport' }).click();
  await transport(page).waitFor();
}
/** Residents move in and a 7-stop line with `buses` buses is drawn on the map through the Transport panel. */
async function setup(page, buses = 6) {
  await page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: /^Live/ }).click();
  await page.waitForTimeout(500);
  const welcome = page.getByRole('button', { name: 'Welcome residents' });
  if (await welcome.isVisible().catch(() => false)) await welcome.click();
  await openTransport(page);
  await page.getByRole('button', { name: 'New bus line' }).click();
  for (const [x, y] of LINE_STOPS) {
    const p = await screenOf(page, x + 0.5, y + 0.5);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
  }
  for (let i = 3; i < buses; i += 1) await page.getByRole('button', { name: 'More buses' }).click();
  await page.getByRole('button', { name: 'Create line' }).click();
  await transport(page).getByRole('button', { name: 'No overlay' }).click();
}
/** Runs at 4× (1× for the last half hour, so the moment is exact) until the absolute game minute, then pauses. */
async function runTo(page, until) {
  log('running to', Math.floor(until / 60) + ':' + String(until % 60).padStart(2, '0'));
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  while (await minute(page) < until - 30) await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  while (await minute(page) < until) await page.waitForTimeout(60);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(400);
}
/** Waits until the camera has stopped gliding (twice in a row). */
async function settle(page) {
  await page.waitForTimeout(200);
  for (let still = 0, i = 0; still < 2 && i < 60; i += 1) {
    still = (await page.evaluate(() => window.__tinyCityCamera?.moving)) ? 0 : still + 1;
    await page.waitForTimeout(150);
  }
}
async function focusStop(page, n, zoomIns = 0) {
  await openTransport(page);
  await transport(page).getByRole('button', { name: `Show Stop ${n}` }).click();
  await settle(page);
  // Zooming keeps the centre of the view still, so the stop stays centred.
  for (let i = 0; i < zoomIns; i += 1) { await page.getByRole('button', { name: 'Zoom in' }).click(); await settle(page); }
}
const vehicles = (page) => page.evaluate(() => window.__tinyCityTransport?.vehicles ?? []);
async function selectVehicle(page, predicate) {
  for (const v of await vehicles(page)) {
    if (!v.visible || !predicate(v)) continue;
    const p = await screenOf(page, v.x, v.y);
    await page.mouse.click(p.x, p.y - 6);
    await page.waitForTimeout(300);
    if (await page.getByRole('region', { name: /bus|car|van/i }).first().isVisible().catch(() => false)) return v;
    if (await page.locator('.vehicle-inspector').isVisible()) return v;
  }
  return null;
}

if (want('01', '02', '03', '04', '05', '06', '07', '10', '11')) {
  const { context, page } = await open();
  await setup(page);
  await runTo(page, 7 * 60 + 25);
  if (want('10')) { await openTransport(page); await shot(page, '10-transport-dashboard'); }
  if (want('01')) { await focusStop(page, 1, 1); await page.getByRole('button', { name: 'Close city transport' }).click(); await shot(page, '01-residential-street'); }
  if (want('02')) { await focusStop(page, 5, 1); await page.getByRole('button', { name: 'Close city transport' }).click(); await shot(page, '02-intersection'); }
  await runTo(page, 8 * 60 + 5);
  if (want('03')) { await focusStop(page, 6, 1); await page.getByRole('button', { name: 'Close city transport' }).click(); await shot(page, '03-commercial-district-traffic'); }
  if (want('04')) {
    await focusStop(page, 6, 0);
    await transport(page).getByRole('button', { name: 'Traffic overlay' }).click();
    await shot(page, '04-congestion-overlay');
    await transport(page).getByRole('button', { name: 'No overlay' }).click();
  }
  if (want('06')) {
    await openTransport(page);
    await page.getByRole('button', { name: 'Center neighborhood' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await transport(page).getByRole('button', { name: 'Bus lines overlay' }).click();
    await shot(page, '06-bus-route');
    await transport(page).getByRole('button', { name: 'No overlay' }).click();
  }
  if (want('05', '11')) {
    // A bus serving a stop: select it, focus and follow it.
    await openTransport(page);
    await page.getByRole('button', { name: 'Center neighborhood' }).click();
    await page.waitForTimeout(900);
    let bus = null;
    for (let i = 0; i < 40 && !bus; i += 1) {
      bus = await selectVehicle(page, (v) => v.kind === 'bus' && v.state === 'dwelling');
      if (!bus) { await page.getByRole('button', { name: 'Step', exact: true }).click(); await page.waitForTimeout(150); }
    }
    if (bus) {
      for (let i = 0; i < 3; i += 1) { await page.getByRole('button', { name: 'Zoom in' }).click(); await settle(page); }
      await page.locator('.vehicle-inspector').getByRole('button', { name: 'Focus' }).click();
      await settle(page);
      if (want('05')) await shot(page, '05-bus-stop');
    }
    if (want('11')) {
      await page.keyboard.press('Escape');
      const car = await selectVehicle(page, (v) => v.kind === 'car' && v.state === 'moving');
      if (car) {
        await page.locator('.vehicle-inspector').getByRole('button', { name: 'Follow' }).click();
        await settle(page);
        await shot(page, '11-vehicle-inspector');
      }
    }
  }
  if (want('07')) { await page.keyboard.press('Escape'); await runTo(page, 17 * 60 + 25); await focusStop(page, 3, 0); await page.getByRole('button', { name: 'Close city transport' }).click(); await shot(page, '07-daytime-traffic'); }
  await context.close();
}

if (want('08')) {
  const { context, page } = await open();
  await setup(page);
  await runTo(page, 19 * 60 + 50);
  await focusStop(page, 6, 2);
  await page.getByRole('button', { name: 'Close city transport' }).click();
  await shot(page, '08-night-traffic');
  await context.close();
}

if (want('09')) {
  // The character moves in first (one room is kept for them), then residents arrive and the bus line is drawn.
  const { context, page } = await open();
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  const creator = page.getByRole('dialog', { name: 'Create your character' });
  await creator.getByLabel('Character name').fill('Mai');
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { disabled: false }).nth(2).click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await page.waitForTimeout(400);
  await setup(page);
  await page.getByRole('button', { name: 'Close city transport' }).click();
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await runTo(page, 7 * 60 + 30);
  await settle(page);
  await shot(page, '09-life-mode-traffic');
  await context.close();
}

if (want('12')) {
  const { context, page } = await open({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: /^Live/ }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Close panel' }).click().catch(() => {});
  await runTo(page, 7 * 60 + 40);
  await page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: 'Build' }).click();
  await page.getByRole('button', { name: 'Open city transport' }).click();
  await transport(page).waitFor();
  await shot(page, '12-mobile-transport');
  await context.close();
}
await browser.close();
