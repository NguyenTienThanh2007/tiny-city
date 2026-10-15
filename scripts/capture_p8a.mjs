// Phase 8A evidence: node scripts/capture_p8a.mjs [url] [outDir] [--only=01,motion]
// Real browser captures of the third-person Character View in "Palm Terrace" (scripts/p8a_city.mjs). Each scene's
// city is advanced by the real simulation engine to its moment, loaded into the real game (dev server), and driven
// with real keyboard and mouse input: WASD, Shift, drags and the wheel. Nothing is posed by script except through
// those inputs. Motion evidence is recorded as browser videos (WebM) of the same real sessions.
import { chromium } from '@playwright/test';
import { mkdirSync, renameSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { palmTerraceAt } from './p8a_city.mjs';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
const base = args[0] ?? 'http://127.0.0.1:5173';
const out = args[1] ?? 'docs/phase-8a-immersive/screenshots';
const motionDir = join(out, 'motion');
mkdirSync(motionDir, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const SENSITIVITY = 0.0034;
const want = (...names) => !only || names.some((name) => only.some((prefix) => name.startsWith(prefix)));
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const evidencePath = join(out, 'evidence.json');
const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : {};

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });

async function open(minute, { video = null } = {}) {
  const { save } = palmTerraceAt(minute);
  const viewport = video ? { width: 1280, height: 720 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: motionDir, size: { width: 854, height: 480 } } } : {}) });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error('pageerror', error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver|Failed to load resource/.test(message.text())) console.error('console', message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear(); localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1');
  }, { key: SAVE_KEY, value: JSON.stringify(save) });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  return { context, page };
}
const debug = (page) => page.evaluate(() => window.__tinyCityImmersive);
async function enter(page) {
  await page.getByRole('button', { name: 'Enter World' }).click();
  await page.locator('.immersive[data-ready="ready"]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__tinyCityImmersive?.ready === true, null, { timeout: 30_000 });
  await page.waitForTimeout(900);
}
async function resume(page) {
  const button = page.getByRole('region', { name: 'Character View' }).getByRole('button', { name: 'Resume' });
  if (await button.count()) await button.click();
}
async function drag(page, dx, dy) {
  const box = await page.locator('canvas.immersive-canvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height * 0.45;
  await page.mouse.move(x, y); await page.mouse.down();
  const steps = Math.max(4, Math.ceil(Math.hypot(dx, dy) / 30));
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(x + dx * i / steps, y + dy * i / steps);
  await page.mouse.up();
}
/** Turns the camera with real drags and wheel input to a yaw / pitch / distance. */
async function look(page, { yaw, pitch, distance }) {
  const d = await debug(page);
  let delta = yaw === undefined ? 0 : yaw - d.camera.yaw;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const dx = yaw === undefined ? 0 : -delta / SENSITIVITY, dy = pitch === undefined ? 0 : (pitch - d.camera.pitch) / SENSITIVITY;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) await drag(page, dx, dy);
  if (distance !== undefined) {
    const box = await page.locator('canvas.immersive-canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    let steps = Math.log(distance / d.camera.distance) / 0.0015;
    while (Math.abs(steps) > 1) { const s = Math.max(-300, Math.min(300, steps)); await page.mouse.wheel(0, s); steps -= s; await page.waitForTimeout(30); }
  }
  await page.waitForTimeout(700);
}
async function hold(page, keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}
async function holdUntil(page, keys, predicate, timeout = 20_000) {
  for (const k of keys) await page.keyboard.down(k);
  const started = Date.now();
  while (Date.now() - started < timeout && !predicate(await debug(page))) await page.waitForTimeout(50);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}
async function shot(page, name, note) {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${name}.png`) });
  const d = await debug(page).catch(() => null);
  evidence[name] = { note, ...(d?.ready ? { player: { x: +d.player.x.toFixed(3), y: +d.player.y.toFixed(3), motion: d.player.motion, speed: +d.player.speed.toFixed(3), blocked: d.player.blocked },
    authority: d.authority, camera: { yaw: +d.camera.yaw.toFixed(3), pitch: +d.camera.pitch.toFixed(3), distance: +d.camera.actual.toFixed(3) },
    fps: d.stats.fps, drawCalls: d.stats.drawCalls, residents: d.residents.length, vehicles: d.vehicles.length, models: d.stats.modelIds } : {}) };
  log('shot', name);
}

if (want('01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '13', '14', '15')) {
  const { context, page } = await open(10 * 60);
  // 14. City View before entering: Life Mode frames the character's home.
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.waitForTimeout(2500);
  if (want('14')) await shot(page, '14-city-view-before', 'City View (Life Mode) before entering: the Glass Pavilion and the character at home.');
  await enter(page);
  if (want('01')) await shot(page, '01-third-person-behind', 'Spawn: on the sidewalk in front of the Glass Pavilion door, camera behind the character, facing the street and Palm Park.');
  // 04 / 07. The player's villa: turn around to the Glass Pavilion.
  await look(page, { yaw: Math.PI, pitch: 0.22, distance: 1.25 });
  if (want('04')) await shot(page, '04-luxury-villa-closeup', 'Glass Pavilion Villa (lm.villa.glass-pavilion), the same model the City View shows, built in real time.');
  await look(page, { yaw: Math.PI - 0.75, pitch: 0.42, distance: 0.8 });
  if (want('07')) await shot(page, '07-sidewalk-entrance', 'Sidewalk and building entrance: the lot gap, the stepping-stone path and the pivot door.');
  await resume(page);
  // 02 / 09. Walk east along the north sidewalk, camera behind.
  await look(page, { yaw: Math.PI / 2, pitch: 0.3, distance: 0.95 });
  await page.keyboard.down('w');
  await page.waitForTimeout(1600);
  if (want('09')) await shot(page, '09-camera-behind-player', 'Third-person camera behind the walking character (W).');
  await page.keyboard.up('w');
  await look(page, { yaw: Math.PI / 2 + 0.95, pitch: 0.18 });
  await page.keyboard.down('d'); await page.waitForTimeout(250);
  if (want('02')) await shot(page, '02-walking-sidewalk', 'Walking on the sidewalk past the villas (camera to the side).');
  await page.keyboard.up('d');
  await page.waitForTimeout(400);
  // 03. Run (Shift + W).
  await look(page, { yaw: Math.PI / 2 + 0.35, pitch: 0.25, distance: 1.05 });
  await page.keyboard.down('Shift'); await page.keyboard.down('w');
  await page.waitForTimeout(1100);
  if (want('03')) await shot(page, '03-running', 'Running (Shift + W): longer strides, bent arms, forward lean; 0.78 tiles/s.');
  await page.keyboard.up('w'); await page.keyboard.up('Shift');
  await page.waitForTimeout(500);
  // 05. Several villa models along the row: step into the street, run east to the Courtyard House, look back
  // north-west across the lots.
  await look(page, { yaw: 0, pitch: 0.3, distance: 0.95 });
  await holdUntil(page, ['w'], (s) => s.player.y > 20.45);
  await look(page, { yaw: Math.PI / 2, pitch: 0.3, distance: 0.95 });
  await holdUntil(page, ['Shift', 'w'], (s) => s.player.x > 19.6);
  await page.waitForTimeout(500);
  await look(page, { yaw: -2.45, pitch: 0.12, distance: 2.0 });
  if (want('05')) await shot(page, '05-villa-variants', 'Several Luxury Minimalist villa models along Terrace Road (each building keeps its City View model).');
  // 06. Tree-lined street.
  await look(page, { yaw: Math.PI / 2 - 0.12, pitch: 0.08, distance: 1.2 });
  if (want('06')) await shot(page, '06-tree-lined-street', 'Terrace Road at eye level: sidewalks, curb lamps, street trees, villas and the park.');
  // 08. Orbit to the side.
  const d8 = await debug(page);
  await look(page, { yaw: d8.player.yaw + Math.PI / 2, pitch: 0.2, distance: 1.1 });
  if (want('08')) await shot(page, '08-camera-orbit-side', 'Camera orbited to the side of the character (mouse drag); the character did not move.');
  // 10. Collision: walk south into the lot of the Palm House across the street until blocked.
  await look(page, { yaw: 0, pitch: 0.3, distance: 0.95 });
  await holdUntil(page, ['w'], (s) => s.player.blocked && s.player.speed < 0.01 && s.player.y > 20.6);
  await page.keyboard.down('w');
  await look(page, { yaw: 0.55, pitch: 0.4, distance: 1.1 });
  if (want('10')) await shot(page, '10-collision', 'Collision: W held toward the Palm House across the street; the character stops at its lot edge (blocked) and never enters the lot.');
  await page.keyboard.up('w');
  // 13. The HUD while walking.
  await look(page, { yaw: Math.PI / 2, pitch: 0.3, distance: 0.95 });
  await page.keyboard.down('w'); await page.waitForTimeout(700);
  if (want('13')) await shot(page, '13-character-view-hud', 'Character View HUD: name, activity and motion, clock and pause, Save, settings, Return to City, needs, control hints.');
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  // 15. Return to City: the City View frames the character where they stopped.
  await page.getByRole('button', { name: 'Return to City' }).click();
  await page.waitForTimeout(3000);
  if (want('15')) await shot(page, '15-city-view-after', 'City View after returning: Life View frames the character on Terrace Road, exactly where they stopped in 3D.');
  await context.close();
}

for (const [name, minute, note] of [['11-golden-hour', 18 * 60 + 25, 'Terrace Road at golden hour (18:25): low western sun, warm sky, windows starting to glow.'],
  ['12-night', 21 * 60 + 50, 'Night (21:50): lit windows, street lamps and their light pools under a moonlit sky.']]) {
  if (!want(name)) continue;
  const { context, page } = await open(minute);
  await enter(page);
  await look(page, { yaw: Math.PI - 0.55, pitch: 0.18, distance: 1.35 });
  await shot(page, name, note);
  await context.close();
}

// Motion evidence (WebM videos of real sessions).
const videos = [
  ['motion-walk-turn', async (page) => { await resume(page); await hold(page, ['d'], 1800); await hold(page, ['w'], 900); await hold(page, ['a'], 2600); await hold(page, ['s'], 900); await page.waitForTimeout(500); }],
  ['motion-run', async (page) => { await resume(page); await look(page, { yaw: Math.PI / 2 + 0.3 }); await hold(page, ['Shift', 'w'], 3200); await page.waitForTimeout(600); }],
  ['motion-orbit', async (page) => { for (let i = 0; i < 6; i += 1) await drag(page, 300, i % 2 ? 40 : -40); await page.waitForTimeout(500); }],
  ['motion-collision', async (page) => { await resume(page); await look(page, { yaw: 0.35, pitch: 0.35, distance: 1.2 }); await hold(page, ['w'], 3500); await hold(page, ['w', 'd'], 1500); await page.waitForTimeout(500); }],
  ['motion-view-switch', async (page) => { await resume(page); await hold(page, ['d'], 1500); await page.getByRole('button', { name: 'Return to City' }).click(); await page.waitForTimeout(3500); await enter(page); await page.waitForTimeout(1200); }],
];
for (const [name, run] of videos) {
  if (!want(name)) continue;
  const { context, page } = await open(10 * 60, { video: true });
  if (name === 'motion-view-switch') { await page.getByRole('button', { name: 'Life', exact: true }).click(); await page.waitForTimeout(1500); }
  await enter(page);
  await run(page);
  const video = page.video();
  await context.close();
  const path = await video.path();
  renameSync(path, join(motionDir, `${name}.webm`));
  evidence[name] = { note: 'Browser recording (WebM, 854×480 from a 1280×720 viewport) of the real session driven by keyboard and mouse.' };
  log('video', name);
}

writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
await browser.close();
