// Phase 4.6 evidence: node scripts/capture_p46.mjs [afterUrl] [beforeUrl] [outDir] [--only=01,10]
// Real browser captures through the real UI of Coral Bay 3.1 (scripts/vw31_city.mjs). `beforeUrl` is a build of the
// 3.1 baseline (main at 57225d0), giving matched before/after pairs of the overview, the repeated-zoom result and
// the Life Mode camera. Camera positions on the after build come from `window.__tinyCityCamera`.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { coralBay31 } from './vw31_city.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const after = args[0] ?? 'http://127.0.0.1:4193';
const before = args[1] ?? 'http://127.0.0.1:4192';
const out = args[2] ?? 'docs/phase-4-6-camera-life/screenshots';
mkdirSync(out, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const want = (...names) => !only || names.some((name) => only.some((prefix) => name.startsWith(prefix)));
const city = coralBay31();

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
async function open(base, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 600 ? 2 : 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.setItem('seeded', '1');
  }, { key: SAVE_KEY, value: city });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  return { context, page };
}
const shot = async (page, name, { hover = false } = {}) => {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  if (!hover) await page.mouse.move(2, 2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 });
  console.log('captured', name);
};
const camera = (page) => page.evaluate(() => window.__tinyCityCamera ?? null);
async function settle(page) {
  await page.waitForTimeout(300);
  let last = '';
  for (let i = 0; i < 60; i += 1) {
    const c = await camera(page);
    const key = c ? `${c.x},${c.y},${c.zoom},${c.moving}` : (await page.getByTestId('minimap-camera').getAttribute('points')) ?? '';
    if (key === last && !(c?.moving)) return;
    last = key;
    await page.waitForTimeout(150);
  }
}
const iso = (gx, gy) => ({ x: 32 * 56 + (gx - gy) * 28, y: (gx + gy) * 14 });
async function screenOf(page, gx, gy) {
  const c = await camera(page);
  const box = await page.locator('canvas').boundingBox();
  const w = iso(gx, gy);
  return { x: box.x + c.focalX + (w.x - c.x) * c.zoom, y: box.y + c.focalY + (w.y - c.y) * c.zoom };
}
async function createCharacter(page, home = 0) {
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  const creator = page.getByRole('dialog', { name: 'Create your character' });
  await creator.getByLabel('Character name').fill('Mai');
  await creator.getByRole('radio', { name: 'Outfit Overalls' }).check().catch(() => {});
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { disabled: false }).nth(home).click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await settle(page);
}
const savedPlayer = (page) => page.evaluate(async (key) => {
  [...document.querySelectorAll('button')].find((b) => /^(Save|Saved)$/.test(b.textContent?.trim() ?? ''))?.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  return JSON.parse(localStorage.getItem(key)).simulation.player;
}, SAVE_KEY);
/** Sends the character to a visible street tile a few tiles away (tries nearby road tiles until one is a walk). */
async function walkNearby(page, minDistance = 4, maxDistance = 7) {
  const player = await savedPlayer(page);
  const roads = city.roads.map((r) => ({ ...r, d: Math.hypot(r.x + 0.5 - player.position.x, r.y + 0.5 - player.position.y) }))
    .filter((r) => r.d >= minDistance && r.d <= maxDistance).sort((a, b) => b.d - a.d);
  for (const road of roads) {
    const point = await screenOf(page, road.x + 0.5, road.y + 0.5);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(250);
    const status = await page.getByRole('status', { name: 'Current activity' }).textContent().catch(() => '');
    if (/Walking to the street/.test(status ?? '')) return road;
    if (/Walking to/.test(status ?? '')) await page.getByRole('button', { name: 'Cancel', exact: true }).first().click().catch(() => {});
    await page.getByRole('button', { name: 'Back to needs & actions' }).click().catch(() => {});
  }
  throw new Error('no walkable street tile in view');
}
/** The baseline drift reproduction: 100 symmetric trackpad scrolls at a lower-left cursor plus 100 mouse-notch cycles. */
async function zoomCycles(page) {
  await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const send = (deltaY, x, y) => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const gesture = [-1, -2, -4, -6, -8, -6, -4, -2, -1, 0, 0, 1, 2, 4, 6, 8, 6, 4, 2, 1, 0, 0];
    for (let cycle = 0; cycle < 100; cycle += 1) {
      for (const d of gesture) send(d, 420, 660);
      send(-100, 900, 300); send(100, 900, 300);
      if (cycle % 10 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
  await page.waitForTimeout(800);
  await settle(page);
}

// Matched pairs: overview, repeated zoom, Life Mode default camera.
for (const [tag, base] of [['before', before], ['after', after]]) {
  if (want('01', '02', '10')) {
    const { context, page } = await open(base);
    if (want('01', '02')) await shot(page, tag === 'before' ? '01-city-overview-before' : '02-city-overview-after');
    if (want('10')) { await zoomCycles(page); await shot(page, `10-zoom-cycles-final-${tag}`); }
    await context.close();
  }
  if (want('03')) {
    const { context, page } = await open(base);
    await createCharacter(page);
    await shot(page, `03-life-default-camera-${tag}`);
    await context.close();
  }
}

// After only.
{
  const { context, page } = await open(after);
  await createCharacter(page);
  if (want('04', '06')) {
    // Walk out and follow: a frame sequence, then a close-up of the character on the street.
    await walkNearby(page, 5, 8);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    for (let i = 0; i < 4; i += 1) { await page.waitForTimeout(700); await shot(page, `06-follow-walking-${i + 1}`); }
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.mouse.move(600, 450);
    for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, -100);
    await settle(page);
    await shot(page, '04-player-close-up');
    for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, 100);
    await settle(page);
  }
  if (want('05')) {
    // Drag the map away, then Focus.
    for (let i = 0; i < 2; i += 1) { await page.mouse.move(700, 600); await page.mouse.down(); await page.mouse.move(450, 400, { steps: 8 }); await page.mouse.move(200, 200, { steps: 8 }); await page.mouse.up(); }
    await settle(page);
    await shot(page, '05a-panned-away-locator');
    await page.getByRole('group', { name: 'Character camera' }).getByRole('button', { name: 'Focus on your character' }).click();
    await settle(page);
    await shot(page, '05b-focus-result');
  }
  if (want('07')) {
    await page.getByRole('group', { name: 'Character camera' }).getByRole('button', { name: 'City view' }).click();
    await settle(page);
    await page.mouse.move(600, 420);
    for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, 240);
    await settle(page);
    await shot(page, '07-zoomed-out-city');
  }
  if (want('08')) {
    // A Luxury Minimalist street (the north-west villa rows), zoomed in.
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await settle(page);
    const villas = city.buildings.filter((b) => b.design?.collection === 'luxury-minimalist' && b.kind === 'villa');
    const at = villas[Math.min(3, villas.length - 1)];
    const minimap = await page.getByRole('button', { name: 'Navigate neighborhood overview' }).boundingBox();
    await page.mouse.click(minimap.x + (at.x + 1) / 64 * minimap.width, minimap.y + (at.y + 1) / 64 * minimap.height);
    for (let i = 0; i < 12 && (await camera(page)).zoom < 1.9; i += 1) { await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await page.waitForTimeout(200); }
    await settle(page);
    await shot(page, '08-luxury-minimalist-zoomed-in');
  }
  await context.close();
}
if (want('11')) {
  // Morning commute in Life View: the residents closest to the character get quiet name tags.
  const { context, page } = await open(after);
  await createCharacter(page);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  const minutes = async () => { const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(h) * 60 + Number(m); };
  for (let i = 0; i < 3000 && await minutes() < 7 * 60 + 20; i += 1) await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  await walkNearby(page, 4, 7).catch(() => {});
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(250);
    if ((await page.evaluate(() => window.__tinyCityRenderer?.nearbyTags ?? 0)) >= 2) break;
  }
  await shot(page, '11-life-nearby-residents');
  await context.close();
}
if (want('09')) {
  for (const [tag, base] of [['before', before], ['after', after]]) {
    const { context, page } = await open(base, { width: 390, height: 844 });
    await createCharacter(page);
    await shot(page, `09-mobile-life-mode-${tag}`);
    await context.close();
  }
}
await browser.close();
