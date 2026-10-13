// Visual World 3.0C evidence: node scripts/capture_vw3c.mjs [baseUrl] [outDir] [--only=01,02]
// Seeds Coral Bay (scripts/vw3b_city.mjs), welcomes residents and captures the character, animation and lighting
// views at fixed scripted cameras and clock times, so 3.0B (main) and 3.0C shots line up. Also records short frame
// sequences (walk, idle, venue) into <outDir>/sequences/*.png for animation review. Real UI interactions only.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { coralBay } from './vw3b_city.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const base = args[0] ?? 'http://127.0.0.1:5181';
const out = args[1] ?? 'docs/visual-world-3/screenshots/3c-after';
mkdirSync(`${out}/sequences`, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const want = (name) => !only || only.some((prefix) => name.startsWith(prefix));

/** Character close-up street: homes, a park and an office north of one long road, open lawn to the south. */
function street() {
  const roads = Array.from({ length: 27 }, (_, i) => ({ x: 8 + i, y: 22 }));
  const b = (id, kind, x, y, name) => ({ id, kind, x, y, name, createdAt: 0 });
  return { size: 64, funds: 20_000, roads, buildings: [
    b('st-v1', 'villa', 9, 20, 'Shell Villa'), b('st-v2', 'villa', 12, 20, 'Reef Villa'), b('st-d1', 'duplex', 15, 20, 'Tern Duplex'),
    b('st-v3', 'villa', 19, 20, 'Cove Villa'), b('st-t1', 'townhouse', 22, 19, 'Harbour Row'), b('st-p', 'park', 25, 18, 'Lagoon Park'),
    b('st-o', 'office', 30, 18, 'Tide House'),
  ] };
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
  await page.locator('.city-viewport[data-art]').waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(800);
  return { context, page };
}
const shot = async (page, name, hover = false) => {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  if (!hover) await page.mouse.move(2, 2);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 90 });
  console.log('captured', name);
};
const minutes = async (page) => { const [, h, m] = /(\d\d):(\d\d)/.exec(await page.getByLabel('Simulation clock').textContent()); return Number(h) * 60 + Number(m); };
async function until(page, minute, speed = 'Speed 4x') {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: speed }).click();
  for (let i = 0; i < 3000 && await minutes(page) < minute; i += 1) await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(300);
}
async function center(page) { await page.getByRole('button', { name: 'Center neighborhood' }).click(); await page.waitForTimeout(600); }
async function zoom(page, steps) {
  const name = steps > 0 ? 'Zoom in' : 'Zoom out';
  for (let i = 0; i < Math.abs(steps); i += 1) { await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(220); }
  await page.waitForTimeout(300);
}
async function screenOf(page, gx, gy) {
  const bounds = await page.locator('canvas').boundingBox();
  const points = (await page.getByTestId('minimap-camera').getAttribute('points')).split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const world = (x, y) => ({ x: (x - y) * 28, y: (x + y) * 14 });
  const origin = world(points[0][0], points[0][1]), right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x), target = world(gx, gy);
  return { x: bounds.x + (target.x - origin.x) * scale, y: bounds.y + (target.y - origin.y) * scale };
}
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
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(300);
}
async function welcome(page) {
  // The tab gains a notification count ("Live 3") once residents exist.
  await page.getByRole('button', { name: /^Live\b/ }).first().click();
  // Moving a character in can already have welcomed residents; only click when the button is offered.
  const button = page.getByRole('button', { name: 'Welcome residents' });
  if (await button.isVisible({ timeout: 1500 }).catch(() => false)) await button.click();
  await page.waitForTimeout(400);
}
/** Frame sequence while the clock runs at 1×: proof of motion, reviewed as a contact sheet. */
async function sequence(page, name, frames = 6, gap = 160, clip = { x: 330, y: 250, width: 500, height: 420 }) {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  if (await resume.isVisible()) await resume.click();
  await page.mouse.move(2, 2);
  for (let i = 0; i < frames; i += 1) { await page.waitForTimeout(gap); await page.screenshot({ path: `${out}/sequences/${name}-${i}.png`, clip }); }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  console.log('sequence', name);
}

// 01 player + NPC close-up, 02 creator, 06 social, 17 Life follow (street scene: nothing tall in front of the road).
if (['01', '02', '06', '17'].some(want)) {
  const { context, page } = await open(street());
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Mai Nguyen');
  await page.getByRole('radio', { name: 'Hairstyle Curly' }).check().catch(() => {});
  await page.getByRole('radio', { name: 'Accessory Sun hat' }).check().catch(() => {});
  if (want('02')) await shot(page, '02-character-creator');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { disabled: false }).first().click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: /Move in/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => {});
  // Residents move in after the player, then the morning starts.
  await welcome(page);
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await until(page, 7 * 60 + 5);
  // "Visit a park": the player walks east along the street to Lagoon Park among the morning commuters.
  await page.getByRole('button', { name: /Visit a park/ }).click();
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  if (await page.getByRole('button', { name: 'Resume', exact: true }).isVisible()) await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByText(/Walking to/).first().waitFor({ timeout: 10_000 }).catch(() => console.warn('walk did not start'));
  await page.waitForTimeout(4500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const wheel = async (notches) => { await page.mouse.move(580, 470); for (let i = 0; i < notches; i += 1) { await page.mouse.wheel(0, -100); await page.waitForTimeout(50); } await page.waitForTimeout(600); };
  if (want('17')) await shot(page, '17-life-follow');
  await wheel(6);
  if (want('01')) { await shot(page, '01-player-npc-closeup'); await sequence(page, 'player-walk', 6, 140); }
  if (want('06')) {
    // Greet the nearest resident through the real Life Mode flow and capture the wave / chat poses.
    await page.getByText(/Enjoying/).first().waitFor({ timeout: 1000 }).catch(() => {});
    if (await page.getByRole('button', { name: 'Resume', exact: true }).isVisible()) await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.getByText(/Enjoying/).first().waitFor({ timeout: 30_000 }).catch(() => console.warn('not at the park'));
    await page.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => {});
    const nearby = page.getByRole('list', { name: 'Nearby residents' }).getByRole('button').first();
    if (await nearby.isVisible().catch(() => false)) {
      await nearby.click();
      await page.locator('.citizen-inspector').getByRole('region', { name: 'Interact' }).getByRole('button', { name: /^Greet/ }).click().catch(() => {});
      await page.getByRole('button', { name: 'Close resident profile' }).click().catch(() => {});
      await page.getByRole('button', { name: 'Speed 1x' }).click();
      if (await page.getByRole('button', { name: 'Resume', exact: true }).isVisible()) await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page.getByText(/Greeting|Saying hello|Chatting|Said hello/).first().waitFor({ timeout: 20_000 }).catch(() => {});
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await shot(page, '06-social');
      await sequence(page, 'social', 6, 160);
    }
  }
  await context.close();
}

// 03 appearances, 04 walking, 05 idle, 06 social, 07 parks, 08 occlusion, 09–13 lighting, 15 normal zoom.
if (['03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '15'].some(want)) {
  const { context, page } = await open(coralBay());
  await welcome(page);
  await until(page, 7 * 60 + 15);
  await focus(page, 20, 21, 5);
  if (want('03')) await shot(page, '03-distinct-npcs');
  if (want('04')) { await shot(page, '04-walking'); await sequence(page, 'walk'); }
  await focus(page, 21, 24, 1);
  if (want('09')) await shot(page, '09-morning');
  if (want('15')) { await center(page); await shot(page, '15-normal-gameplay-zoom'); }
  await until(page, 12 * 60 + 30);
  await focus(page, 21, 24, 1);
  if (want('10')) await shot(page, '10-midday');
  await until(page, 17 * 60 + 50);
  await focus(page, 28, 24, 5);
  if (want('07')) { await shot(page, '07-park-visitors'); await sequence(page, 'park', 6, 220); }
  if (want('06')) { await focus(page, 29, 25, 6); await shot(page, '06b-park-conversations'); }
  if (want('05')) { await focus(page, 9, 16, 5); await shot(page, '05-idle-terrace'); await sequence(page, 'idle', 6, 260); }
  if (want('08')) { await focus(page, 18, 26, 5); await shot(page, '08-behind-buildings-trees'); }
  await until(page, 18 * 60 + 45);
  await focus(page, 21, 24, 1);
  if (want('11')) await shot(page, '11-golden-hour');
  await until(page, 21 * 60 + 50);
  if (want('12')) { await focus(page, 10, 24, 3); await shot(page, '12-night-residential'); }
  if (want('13')) { await focus(page, 20, 22, 3); await shot(page, '13-night-commercial'); }
  await context.close();
}

if (want('14')) {
  // Dense city: the 300-resident benchmark grid at the morning commute.
  const roads = new Map(); const add = (x, y) => roads.set(`${x},${y}`, { x, y });
  const rows = [6, 11, 16, 21, 26, 31, 36, 41, 46];
  for (const y of rows) for (let x = 6; x <= 58; x += 1) add(x, y);
  for (let y = 6; y <= 46; y += 1) add(6, y);
  const slots = rows.slice(0, -1).flatMap((y) => Array.from({ length: 12 }, (_, i) => ({ x: 7 + i * 4, y: y + 1 })));
  const kinds = [...Array(12).fill('apartment'), ...Array(6).fill('villa'), ...Array(5).fill('office'), 'park', 'park', 'mall'];
  const city = { size: 64, funds: 1_000_000, roads: [...roads.values()], buildings: kinds.map((kind, i) => ({ id: `${kind}-${i}`, kind, name: `${kind} ${i}`, x: slots[(i * 7) % slots.length].x, y: slots[(i * 7) % slots.length].y, createdAt: 0 })) };
  const valid = city.buildings.filter((b) => b.kind !== 'mall');
  const { context, page } = await open({ ...city, buildings: valid });
  await welcome(page);
  await until(page, 7 * 60 + 20);
  await center(page); await zoom(page, 2);
  await shot(page, '14-dense-city');
  await context.close();
}
if (want('16')) {
  const { context, page } = await open(coralBay(), { width: 390, height: 844 });
  await shot(page, '16-mobile');
  await context.close();
}
await browser.close();
