// Phase 8B evidence: node scripts/capture_p8b.mjs [url] [outDir] [--only=01,motion]
// Real browser captures of the living 3D city in Coral Bay Nights (scripts/p8b_city.mjs): residents, traffic, buses,
// venues and events are the simulation's own, at moments the engine reached by running. The player is driven with
// real keyboard and mouse input (WASD, Shift, drags, the wheel, E). Motion evidence is recorded as browser videos.
import { chromium } from '@playwright/test';
import { mkdirSync, renameSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Simulation, serializeWorld } from '@tiny-city/simulation';
import { livingCityAt } from './p8b_city.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const base = args[0] ?? 'http://127.0.0.1:5173';
const out = args[1] ?? 'docs/phase-8b-living-world-3d/screenshots';
const motionDir = join(out, 'motion');
mkdirSync(motionDir, { recursive: true });
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const SENS = 0.0034;
const want = (...names) => !only || names.some((n) => only.some((p) => n.startsWith(p)));
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const evidencePath = join(out, 'evidence.json');
const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : {};
const DAY = 1440;
const MOMENTS = { rush: 17 * 60 + 20, sunset: 18 * 60 + 25, friday: 4 * DAY + 20 * 60 + 40, night: 21 * 60 + 50, morning: 10 * 60 };
const saves = new Map();
/** A save at `minute` with the player already standing at `at` (walked there by the simulation), cached per scene. */
const saveAt = (minute, at = null) => {
  const key = `${minute}@${at ? `${at.x},${at.y}` : 'home'}`;
  if (!saves.has(key)) saves.set(key, livingCityAt(minute, at ? { at } : {}).save);
  return saves.get(key);
};
const STEP = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const busAt = (v) => { let x = v.origin.x, y = v.origin.y; for (let i = 0; i < v.edge; i += 1) { const d = STEP[v.path[i]]; x += d[0]; y += d[1]; } const d = STEP[v.path[v.edge]] ?? [0, 0]; return { x: x + d[0] * v.offset / 100, y: y + d[1] * v.offset / 100 }; };
/** A stop on the east–west road y = 30 with a resident waiting (trip phase "waiting") and a real bus pulling in. */
function busArrival(world) {
  for (const stop of world.transport.stops) {
    if (stop.tile.y !== 30) continue;
    const waiting = world.transport.trips.filter((t) => t.phase === 'waiting' && t.boardStopId === stop.id).length;
    const bus = world.transport.vehicles.find((v) => v.kind === 'bus' && v.state === 'moving' && v.path[v.edge] === 'E' && (() => { const p = busAt(v); return p.y === 30 && stop.tile.x - p.x > 0.8 && stop.tile.x - p.x < 2.2; })());
    if (waiting > 0 && bus) return { stop, bus };
  }
  return null;
}
/**
 * The first moment from 17:00 when a bus is about to stop for a waiting resident, with the player already standing
 * one tile east of that stop, facing the bus (walked there by the simulation). Returns the save and the stop.
 */
let busMomentCache = null;
function busMoment() {
  if (busMomentCache) return busMomentCache;
  const scan = (sim, limit) => { for (let i = 0; i < limit; i += 1) { const hit = busArrival(sim.getState()); if (hit) return { minute: sim.getState().clock.tick, ...hit }; sim.step(1); } return null; };
  const first = scan(new Simulation(livingCityAt(17 * 60).state), 240);
  if (!first) throw new Error('no bus arrival between 17:00 and 21:00');
  const at = { x: first.stop.tile.x + 1, y: 30 };
  const start = livingCityAt(17 * 60, { at });
  const sim = new Simulation(start.state);
  sim.step(Math.max(0, first.minute - 17 * 60 - 3));
  const hit = scan(sim, 60);
  if (!hit) throw new Error('bus arrival not reproduced with the player there');
  sim.pause();
  const state = sim.getState();
  log('bus moment', hit.minute, hit.stop.id, hit.bus.id);
  busMomentCache = { save: { ...start.save, funds: state.budget.balance, simulation: JSON.parse(serializeWorld(state)) }, stop: hit.stop };
  return busMomentCache;
}
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=metal', '--ignore-gpu-blocklist'] });
async function open(minute, { video = false, at = null, save = null } = {}) {
  const viewport = video ? { width: 1280, height: 720 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: motionDir, size: { width: 854, height: 480 } } } : {}) });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.addInitScript(({ key, value }) => { if (sessionStorage.getItem('seeded')) return; localStorage.clear(); localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); },
    { key: SAVE_KEY, value: JSON.stringify(save ?? saveAt(minute, at)) });
  await page.goto(base);
  await page.locator('.city-viewport[data-art="ready"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(600);
  return { context, page };
}
const debug = (page) => page.evaluate(() => window.__tinyCityImmersive);
const hud = (page) => page.getByRole('region', { name: 'Character View' });
async function enter(page) {
  await page.getByRole('button', { name: 'Enter World' }).click();
  await page.waitForFunction(() => window.__tinyCityImmersive?.ready === true && document.querySelector('.immersive')?.getAttribute('data-ready') === 'ready', null, { timeout: 90_000 });
  await page.waitForTimeout(1200);
}
async function resume(page) { const b = hud(page).getByRole('button', { name: 'Resume' }); if (await b.count()) await b.click(); }
async function pause(page) { const b = hud(page).getByRole('button', { name: 'Pause' }); if (await b.count()) await b.click(); }
async function drag(page, dx, dy) {
  const box = await page.locator('canvas.immersive-canvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height * 0.45;
  await page.mouse.move(x, y); await page.mouse.down();
  const steps = Math.max(4, Math.ceil(Math.hypot(dx, dy) / 30));
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(x + dx * i / steps, y + dy * i / steps);
  await page.mouse.up();
}
async function look(page, { yaw, pitch, distance }) {
  const d = await debug(page);
  let delta = yaw === undefined ? 0 : yaw - d.camera.yaw;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const dx = yaw === undefined ? 0 : -delta / SENS, dy = pitch === undefined ? 0 : (pitch - d.camera.pitch) / SENS;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) await drag(page, dx, dy);
  if (distance !== undefined) {
    const box = await page.locator('canvas.immersive-canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    let steps = Math.log(distance / d.camera.distance) / 0.0015;
    while (Math.abs(steps) > 1) { const s = Math.max(-300, Math.min(300, steps)); await page.mouse.wheel(0, s); steps -= s; await page.waitForTimeout(30); }
  }
  await page.waitForTimeout(700);
}
/** Walks (running) along one axis to a coordinate: the camera faces the way, W is held until there. */
async function walkTo(page, axis, target, timeout = 40_000) {
  const d = await debug(page);
  const sign = Math.sign(target - d.player[axis]);
  if (!sign) return;
  await look(page, { yaw: axis === 'x' ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : (sign > 0 ? 0 : Math.PI), pitch: 0.28 });
  await page.keyboard.down('Shift'); await page.keyboard.down('w');
  const started = Date.now();
  while (Date.now() - started < timeout) { const p = (await debug(page)).player; if ((p[axis] - target) * sign >= -0.15) break; await page.waitForTimeout(60); }
  await page.keyboard.up('w'); await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
}
async function shot(page, name, note) {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}.png`) });
  const d = await debug(page).catch(() => null);
  evidence[name] = { note, ...(d?.ready ? { tick: d.authority.tick, minute: d.sky.minute, player: { x: +d.player.x.toFixed(2), y: +d.player.y.toFixed(2) },
    residentsDrawn: d.residents.length, residentModes: d.residents.reduce((m, r) => ((m[r.mode] = (m[r.mode] ?? 0) + 1), m), {}), vehiclesDrawn: d.vehicles.length,
    busesDrawn: d.vehicles.filter((v) => v.kind === 'bus').map((v) => ({ id: v.id, passengers: v.passengers })), hidden: d.hidden, target: d.target,
    fps: d.stats.fps, drawCalls: d.stats.drawCalls, levels: { near: d.stats.nearBuildings, mid: d.stats.midBuildings, far: d.stats.farBuildings } } : {}) };
  log('shot', name);
}

const AT = { door: null, junction: { x: 37, y: 30 }, stop: { x: 43, y: 30 }, highStreet: { x: 42, y: 20 }, concert: { x: 41, y: 30 }, market: { x: 48, y: 20 } };

// Rush hour on the residential street: the villa, the sidewalks and the junction (and the matching City View).
if (want('01', '02', '03', '15')) {
  const { context, page } = await open(MOMENTS.rush);
  if (want('15')) { await page.getByRole('button', { name: 'Life', exact: true }).click(); await page.waitForTimeout(2500); await page.mouse.move(2, 2); await page.screenshot({ path: join(out, '15a-city-view.png') }); evidence['15a-city-view'] = { note: 'City View (Life View) at the same moment as 15b: the character at Wave Villa on the same street.' }; log('shot', '15a'); }
  await enter(page);
  await look(page, { yaw: Math.PI - 0.35, pitch: 0.24, distance: 1.25 });
  if (want('01')) await shot(page, '01-luxury-street-player', 'Wave Villa (Luxury Minimalist) and its street at the evening rush, the player at the door.');
  if (want('15')) { await look(page, { yaw: Math.PI / 4, pitch: 0.55, distance: 1.9 }); await shot(page, '15b-character-view', 'Character View at the same moment and place as 15a.'); }
  await context.close();
}
if (want('03')) {
  const { context, page } = await open(MOMENTS.rush, { at: AT.junction });
  await enter(page);
  await resume(page); await page.waitForTimeout(1500); await pause(page);
  await look(page, { yaw: Math.PI / 2 + 0.75, pitch: 0.38, distance: 1.9 });
  if (want('03')) await shot(page, '03-traffic-at-intersection', 'Rush-hour traffic at the junction (38, 30): real cars queuing and turning, kept to their lanes.');
  await context.close();
}
// A real bus at Stop 3 with residents waiting.
if (want('04', '05')) {
  const { context, page } = await open(MOMENTS.rush, { save: busMoment().save });
  await enter(page);
  const stopName = busMoment().stop.name ?? busMoment().stop.id;
  await look(page, { yaw: -Math.PI / 2 - 0.25, pitch: 0.26, distance: 1.5 });
  if (want('05')) await shot(page, '05-npc-at-bus-stop', `A resident waiting at ${stopName} beside the shelter (Phase 6 trip phase “waiting”) as the Line 1 bus pulls in.`);
  await resume(page);
  for (let i = 0; i < 40; i += 1) { await page.waitForTimeout(250); const d = await debug(page); if (d.vehicles.some((v) => v.kind === 'bus' && v.passengers > 0 && Math.hypot(v.x - d.player.x, v.y - d.player.y) < 4)) break; }
  await pause(page);
  await look(page, { yaw: -Math.PI / 2 - 0.1, pitch: 0.4, distance: 1.9 });
  if (want('04')) await shot(page, '04-bus-on-route', `The Line 1 bus at ${stopName} moments later: the resident who was waiting (05) has boarded, so they are counted on the bus and no longer drawn at the shelter.`);
  await context.close();
}
// The high street after work: commerce, the café terrace, inspection, and the city from above.
if (want('02', '06', '10', '14')) {
  const { context, page } = await open(18 * 60 + 30, { at: AT.highStreet });
  await enter(page);
  await look(page, { yaw: Math.PI / 2 + 0.25, pitch: 0.18, distance: 1.6 });
  if (want('02')) await shot(page, '02-npcs-on-sidewalks', 'Residents on the high-street sidewalks after work, each drawn on the curb side of its heading at its simulated position.');
  await look(page, { yaw: Math.PI / 2 + 0.45, pitch: 0.42, distance: 2.3 });
  if (want('06')) await shot(page, '06-commercial-district', 'The commercial district: Corner Café, Harbour Arcade, Bayside Cinema and Blue Note Club, with real shoppers and traffic.');
  await look(page, { yaw: -Math.PI / 2 - 0.3, pitch: 0.32, distance: 1.4 });
  if (want('10')) {
    for (let i = 0; i < 16; i += 1) {
      await resume(page); await page.keyboard.down(i % 2 ? 'a' : 'd'); await page.waitForTimeout(220); await page.keyboard.up(i % 2 ? 'a' : 'd'); await pause(page);
      if ((await debug(page)).target?.kind === 'resident') break;
    }
    const t = (await debug(page)).target;
    if (t) { await page.keyboard.press('e'); await page.waitForTimeout(500); await look(page, { pitch: 0.3 }); await shot(page, '10-inspect-citizen', `Inspecting ${t.label} (${t.kind}): the live record from the simulation.`); await page.keyboard.press('Escape'); }
  }
  if (want('14')) { await look(page, { yaw: Math.PI / 2 + 0.2, pitch: 0.7, distance: 3 }); await shot(page, '14-large-city-distance', 'The city from above the character: near buildings in full detail, mid ones simplified, far ones as massing.'); }
  await context.close();
}
// The busiest café of the evening: real visitors at the terrace spots.
if (want('07')) {
  const { context, page } = await open(19 * 60 + 45, { at: { x: 53, y: 20 } });
  await enter(page);
  await look(page, { yaw: Math.PI + 0.2, pitch: 0.34, distance: 1.4 });
  const d = await debug(page);
  await shot(page, '07-cafe-activity', `Dune Café terrace at 19:45: ${d.residents.filter((r) => r.mode === 'at-venue').length} residents drawn at venues, each a real visitor whose outing is “present”.`);
  await context.close();
}
// Inspecting a shop: Harbour Arcade on the high street (its shoppers are inside, so its lot is easy to face).
if (want('11')) {
  const { context, page } = await open(19 * 60 + 45, { at: { x: 44, y: 20 } });
  await enter(page);
  await look(page, { yaw: 0, pitch: 0.3, distance: 1.4 });
  // Step toward the arcade until its lot is what E acts on; let passers-by walk on if one is in front.
  for (let i = 0; i < 20 && (await debug(page)).target?.id !== 'cn-shops-7'; i += 1) {
    await resume(page);
    if ((await debug(page)).target?.kind === 'resident') await page.waitForTimeout(400);
    else { await page.keyboard.down('w'); await page.waitForTimeout(150); await page.keyboard.up('w'); }
    await pause(page);
  }
  const t = (await debug(page)).target;
  if (t?.id !== 'cn-shops-7') throw new Error(`11: expected Harbour Arcade as the target, got ${JSON.stringify(t)}`);
  await page.keyboard.press('e'); await page.waitForTimeout(500);
  await look(page, { yaw: -0.5, pitch: 0.3, distance: 1.6 });
  await shot(page, '11-inspect-building', `Inspecting ${t.label}: opening hours, shoppers inside, staff, prices and yesterday’s accounts, all from the simulation.`);
  await context.close();
}
// Friday night: the concert and the night market festival.
if (want('09')) {
  const { context, page } = await open(MOMENTS.friday, { at: { x: 43, y: 30 } });
  await enter(page);
  await look(page, { yaw: Math.PI + 0.25, pitch: 0.24, distance: 1.5 });
  await shot(page, '09-concert', 'Friday concert at Bayside Stage: the cheering audience is exactly the event’s real attendees.');
  await context.close();
}
if (want('08')) {
  const { context, page } = await open(MOMENTS.friday, { at: AT.market });
  await enter(page);
  await look(page, { yaw: Math.PI + 0.38, pitch: 0.26, distance: 1.5 });
  await shot(page, '08-night-market', 'Lantern Night Market during its Friday festival: real visitors under the lanterns.');
  await context.close();
}
for (const [name, minute, note] of [['12-sunset', MOMENTS.sunset, 'Sunset on the residential street (18:25): low western sun, warm sky, windows and venue lights coming on.'],
  ['13-night-lights', MOMENTS.night, 'Night (21:50): street lamps and their pools, lit windows, vehicle lamps, under a moonlit sky.']]) {
  if (!want(name)) continue;
  const { context, page } = await open(minute, { at: AT.junction });
  await enter(page);
  await look(page, { yaw: Math.PI / 2 + 0.75, pitch: 0.38, distance: 1.9 });
  await shot(page, name, note);
  await context.close();
}

const videos = [
  ['motion-npc-walking', 18 * 60 + 30, { at: AT.highStreet }, async (page) => { await look(page, { yaw: Math.PI / 2 + 0.25, pitch: 0.18, distance: 1.6 }); await resume(page); await page.waitForTimeout(6000); }],
  ['motion-cars-turning', MOMENTS.rush, { at: AT.junction }, async (page) => { await look(page, { yaw: Math.PI / 2 + 0.75, pitch: 0.4, distance: 1.9 }); await resume(page); await page.waitForTimeout(7000); }],
  ['motion-bus-movement', MOMENTS.rush, () => ({ save: busMoment().save }), async (page) => { await look(page, { yaw: Math.PI / 2 + 0.6, pitch: 0.32, distance: 1.8 }); await resume(page); await page.waitForTimeout(7000); }],
  ['motion-districts-walk', 17 * 60 + 50, { at: AT.junction }, async (page) => { await resume(page); await walkTo(page, 'x', 38.5); await walkTo(page, 'y', 20.6); await walkTo(page, 'x', 45); }],
  ['motion-day-night', MOMENTS.sunset, { at: AT.junction }, async (page) => { await look(page, { yaw: Math.PI / 2 + 0.75, pitch: 0.38, distance: 1.9 }); await hud(page).getByRole('button', { name: 'Speed 4x' }).click(); await resume(page); await page.waitForTimeout(9000); }],
  ['motion-mode-switching', MOMENTS.rush, { at: AT.junction }, async (page) => { await resume(page); await page.keyboard.down('d'); await page.waitForTimeout(1200); await page.keyboard.up('d'); await page.getByRole('button', { name: 'Return to City' }).click(); await page.waitForTimeout(3000); await enter(page); await page.waitForTimeout(1500); }],
];
for (const [name, minute, options, run] of videos) {
  if (!want(name)) continue;
  const { context, page } = await open(minute, { video: true, ...(typeof options === 'function' ? options() : options) });
  if (name === 'motion-mode-switching') { await page.getByRole('button', { name: 'Life', exact: true }).click(); await page.waitForTimeout(1500); }
  await enter(page);
  await run(page);
  const video = page.video();
  await context.close();
  renameSync(await video.path(), join(motionDir, `${name}.webm`));
  evidence[name] = { note: 'Browser recording (WebM, 854×480 from a 1280×720 viewport) of the real session.' };
  log('video', name);
}
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
await browser.close();
