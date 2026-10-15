import { expect, test, type Page } from '@playwright/test';
import { createWorld, playerWalkCheck, RoadNavigator, serializeWorld, Simulation, validateWorld } from '@tiny-city/simulation';
import type { PlayerAppearance, WorldState } from '@tiny-city/simulation';
import { createCityWorld, toCityPlan } from '../src/simulation/cityAdapter';
import type { CityState } from '../src/types';
import { buildWalkGrid, isWalkablePoint } from '../src/immersive/collision';
import { MOVEMENT } from '../src/immersive/controller';
import { ORBIT } from '../src/immersive/orbitCamera';
import { resolveSpawn } from '../src/immersive/spawn';
import { planDecor } from '../src/game/worldDecor';
import { cameraSettled } from './support/camera';

/**
 * Phase 8A browser acceptance: the third-person Character View through the real game. Saves are built with the real
 * engine; every check reads the live renderer state (`window.__tinyCityImmersive`) or the authoritative saved world.
 * 3D movement is real time (not game time), so waits poll for the state they need with bounded timeouts; on a
 * software-rendered runner frames are slow but the controller integrates real elapsed time, so the same checks hold.
 */
const SAVE_KEY = 'tiny-city-imagine-save-v1';
type Saved = CityState & { simulation: WorldState };
type Debug = {
  ready: boolean; quality: string;
  player: { x: number; y: number; yaw: number; motion: string; speed: number; controlling: boolean; blocked: boolean };
  authority: { x: number; y: number; status: string; tick: number };
  camera: { yaw: number; pitch: number; distance: number; actual: number; x: number; y: number; z: number };
  commits: number; rejected: number; character: string[];
  stats: { buildings: number; models: number; modelIds: string[]; fallback: string[]; geometries: number; textures: number; drawCalls: number; fps: number };
};
test.slow();

const LM = 'luxury-minimalist' as const;
const road = (x0: number, y0: number, x1: number, y1: number) => {
  const tiles: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) tiles.push({ x, y });
  return tiles;
};
const villa = (id: string, x: number, y: number, model: string) => ({ id, name: id, kind: 'villa' as const, x, y, createdAt: 0, design: { collection: LM, model: `lm.villa.${model}` } });
// A Luxury Minimalist street (y = 20) with a cross street (x = 9): the player's Glass Pavilion faces it from the
// north; villas across the street (south) and a park on the corner.
const fixture: CityState = { size: 64, funds: 30_000, roads: [...road(9, 20, 30, 20), ...road(9, 14, 9, 19), ...road(9, 21, 9, 28)],
  buildings: [villa('glass', 12, 18, 'glass-pavilion'), villa('concrete', 15, 18, 'sculptural-concrete'), villa('court', 18, 18, 'minimal-courtyard'),
    villa('terrace', 12, 21, 'sky-terrace'), villa('linear', 15, 21, 'linear-modern'), villa('tropical', 18, 21, 'tropical-minimalist'),
    { id: 'park', name: 'Palm Park', kind: 'park', x: 22, y: 21, createdAt: 0 }] };
const look: PlayerAppearance = { skinTone: 2, hairStyle: 'bun', hairColor: 1, outfit: 'jacket', outfitColor: 1, accessory: 'glasses' };

/** The fixture with the player at home in the Glass Pavilion and residents welcomed, run to `minute`. */
function lmSave(minute = 10 * 60): Saved {
  const sim = new Simulation(createCityWorld(fixture));
  expect(sim.executeLife({ type: 'player.create', name: 'Linh', appearance: look, homeBuildingId: 'glass' }).reason).toBeNull();
  sim.enablePopulation({ maxCitizens: 1000 });
  sim.step(minute);
  sim.pause();
  const world = sim.getState();
  validateWorld(world);
  return { ...fixture, funds: world.budget.balance, saveVersion: 3, simulation: JSON.parse(serializeWorld(world)) } as Saved;
}

async function openCity(page: Page, save: unknown | null) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('p8a')) return;
    localStorage.clear();
    if (value) localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.setItem('p8a', '1');
  }, { key: SAVE_KEY, value: save });
  await page.goto('/');
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await cameraSettled(page);
  return errors;
}
const debug = (page: Page) => page.evaluate(() => (window as unknown as { __tinyCityImmersive?: Debug }).__tinyCityImmersive!);
async function enterWorld(page: Page) {
  await page.getByRole('button', { name: 'Enter World' }).click();
  const view = page.getByRole('region', { name: 'Character View' });
  await expect(view).toHaveAttribute('data-ready', 'ready', { timeout: 90_000 });
  await expect.poll(async () => (await debug(page))?.ready ?? false, { timeout: 30_000 }).toBe(true);
  return view;
}
async function savedWorld(page: Page): Promise<Saved> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
const canvas = (page: Page) => page.locator('canvas.immersive-canvas');
async function drag(page: Page, dx: number, dy: number) {
  const box = (await canvas(page).boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}
/** Holds keys until `done(debug)` (polling the live renderer), then releases them. */
async function holdUntil(page: Page, keys: string[], done: (d: Debug) => boolean, timeout = 60_000) {
  for (const key of keys) await page.keyboard.down(key);
  try { await expect.poll(async () => done(await debug(page)), { timeout, intervals: [100] }).toBe(true); }
  finally { for (const key of [...keys].reverse()) await page.keyboard.up(key); }
}
async function standing(page: Page) {
  await expect.poll(async () => { const d = await debug(page); return d.player.motion === 'standing' && Math.hypot(d.player.x - d.authority.x, d.player.y - d.authority.y) < 2e-3; },
    { timeout: 20_000 }).toBe(true);
  return debug(page);
}

test('third person: enter, spawn at the door, walk, run, look around, collide, return and re-enter as the same character', async ({ page }) => {
  test.setTimeout(process.env.CI ? 420_000 : 180_000);
  const save = lmSave();
  const errors = await openCity(page, save);

  // A. Enter World from the City View.
  const view = await enterWorld(page);
  await expect(view.getByRole('button', { name: 'Return to City' })).toBeVisible();
  await expect(view.getByText('Linh', { exact: true })).toBeVisible();
  for (const need of ['Energy', 'Hunger', 'Social', 'Mood']) await expect(view.getByRole('meter', { name: need })).toBeVisible();
  let d = await debug(page);
  expect(d.stats.fallback).toEqual([]);
  expect(d.stats.modelIds).toEqual(expect.arrayContaining(['lm.villa.glass-pavilion.S', 'lm.villa.sculptural-concrete.S', 'lm.villa.minimal-courtyard.S',
    'lm.villa.sky-terrace.S', 'lm.villa.linear-modern.S', 'lm.villa.tropical-minimalist.S']));
  const firstLayers = d.character;
  expect(firstLayers).toEqual(expect.arrayContaining(['glasses:base:-', 'hair:bun:-', 'torso:jacket:-']));

  // B. Spawn: the sidewalk in front of the Glass Pavilion's door, exactly the rule's door spawn; the world is unchanged.
  const world = save.simulation;
  const grid = buildWalkGrid(world.plan, planDecor(world.plan));
  const expected = resolveSpawn(world, new RoadNavigator(world.plan), grid);
  if (!expected.ok) throw new Error(expected.reason);
  expect(d.player.x).toBeCloseTo(expected.position.x, 6); expect(d.player.y).toBeCloseTo(expected.position.y, 6);
  expect(Math.floor(d.player.y)).toBe(20);
  expect(d.player.x).toBeGreaterThanOrEqual(12); expect(d.player.x).toBeLessThan(14);
  expect(d.authority.status).toBe('inside');
  expect(d.commits).toBe(0);

  // Time runs; movement needs it (paused, the character does not move).
  await holdUntil(page, ['w'], () => true, 2_000);
  expect((await debug(page)).player.controlling).toBe(false);
  await view.getByRole('button', { name: 'Resume' }).click();

  // C + H. W walks away from the camera (south, across the street) and stops at the lot edge of the villa opposite.
  const start = await debug(page);
  await holdUntil(page, ['w'], (s) => s.player.y > start.player.y + 0.4);
  expect((await debug(page)).player.controlling).toBe(true);
  // Pushing on until the character is stopped (by the lot edge or the lamp post on its curb), never inside the lot.
  await holdUntil(page, ['w'], (s) => s.player.blocked && s.player.speed < 0.01 && s.player.y > 20.6);
  d = await standing(page);
  expect(d.player.y).toBeLessThanOrEqual(21 - MOVEMENT.radius + 1e-6);
  expect(d.authority.status).toBe('standing');
  expect(d.rejected).toBe(0);
  // I. The character is on the street, and the simulation accepts where it is.
  expect(isWalkablePoint(grid, { x: d.player.x, y: d.player.y })).toBe(true);

  // D. Walking and running speeds: strafe along the street (camera looks +y, so D walks toward −x).
  let walkPeak = 0;
  await holdUntil(page, ['d'], (s) => { walkPeak = Math.max(walkPeak, s.player.speed); return s.player.x < d.player.x - 0.4; });
  expect(walkPeak).toBeGreaterThan(MOVEMENT.walkSpeed * 0.6);
  expect(walkPeak).toBeLessThanOrEqual(MOVEMENT.walkSpeed + 1e-6);
  const beforeRun = await standing(page);
  let runPeak = 0;
  await holdUntil(page, ['Shift', 'a'], (s) => { runPeak = Math.max(runPeak, s.player.speed); return s.player.x > beforeRun.player.x + 1.5; });
  expect(runPeak).toBeGreaterThan(MOVEMENT.walkSpeed * 1.5);
  expect(runPeak).toBeLessThanOrEqual(MOVEMENT.runSpeed + 1e-6);
  d = await standing(page);

  // E. The camera follows: it sits `actual` away from the look-at point above the character.
  const offset = Math.hypot(d.camera.x - d.player.x, d.camera.y - ORBIT.targetHeight, d.camera.z - d.player.y);
  expect(Math.abs(offset - d.camera.actual)).toBeLessThan(0.05);

  // F. Mouse/trackpad drag orbits the camera (right turns the view right: yaw decreases) and never moves the character.
  const yaw0 = d.camera.yaw;
  await drag(page, 220, 0);
  await expect.poll(async () => (await debug(page)).camera.yaw, { timeout: 10_000 }).toBeLessThan(yaw0 - 0.4);
  const afterOrbit = await debug(page);
  expect(afterOrbit.player.x).toBeCloseTo(d.player.x, 6); expect(afterOrbit.player.y).toBeCloseTo(d.player.y, 6);

  // G. Pitch and zoom limits.
  await drag(page, 0, 400);
  await expect.poll(async () => (await debug(page)).camera.pitch, { timeout: 10_000 }).toBeCloseTo(ORBIT.pitch.max, 2);
  await drag(page, 0, -400);
  await expect.poll(async () => (await debug(page)).camera.pitch, { timeout: 10_000 }).toBeCloseTo(ORBIT.pitch.min, 2);
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await debug(page)).camera.distance, { timeout: 10_000 }).toBe(ORBIT.distance.max);
  for (let i = 0; i < 16; i += 1) await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await debug(page)).camera.distance, { timeout: 10_000 }).toBe(ORBIT.distance.min);
  await drag(page, 0, 300);

  // J. Return to City: the City View is back and frames the character where they stopped; identity is unchanged.
  d = await standing(page);
  await view.getByRole('button', { name: 'Return to City' }).click();
  await expect(view).toHaveCount(0);
  await expect(page.locator('canvas.immersive-canvas')).toHaveCount(0);
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  const saved = await savedWorld(page);
  const player = saved.simulation.player!;
  expect(player.position.x).toBeCloseTo(d.player.x, 3); expect(player.position.y).toBeCloseTo(d.player.y, 3);
  expect(player).toMatchObject({ id: 'player-1', name: 'Linh', appearance: look, homeBuildingId: 'glass', movement: { status: 'standing' } });
  validateWorld(saved.simulation as unknown as WorldState);
  expect(playerWalkCheck(saved.simulation, new RoadNavigator(saved.simulation.plan), player.position)).toBeNull();
  await cameraSettled(page);
  const cam = await page.evaluate(() => (window as unknown as { __tinyCityCamera: { x: number; y: number } }).__tinyCityCamera);
  const a = (cam.x - 32 * 56) / 28, b = cam.y / 14;
  expect(Math.hypot((a + b) / 2 - player.position.x, (b - a) / 2 - player.position.y)).toBeLessThan(1.5);

  // K. Re-enter: the same character appears exactly where they were.
  await enterWorld(page);
  d = await debug(page);
  expect(d.player.x).toBeCloseTo(player.position.x, 3); expect(d.player.y).toBeCloseTo(player.position.y, 3);
  expect(d.character).toEqual(firstLayers);
  await page.getByRole('button', { name: 'Return to City' }).click();
  expect(errors).toEqual([]);
});

test('save and reload keep the authoritative character; a legacy save without designs still enters', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors = await openCity(page, lmSave(9 * 60));
  const view = await enterWorld(page);
  await view.getByRole('button', { name: 'Resume' }).click();
  const start = await debug(page);
  await holdUntil(page, ['ArrowRight'], (s) => s.player.x < start.player.x - 0.5);
  const moved = await standing(page);
  // L. Save from the Character View, reload the page, and enter again.
  await view.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  await expect(view.getByRole('button', { name: 'Saved' })).toBeVisible();
  const saved = await savedWorld(page);
  expect(saved.simulation.player!.position.x).toBeCloseTo(moved.player.x, 3);
  await page.reload();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await enterWorld(page);
  const again = await debug(page);
  expect(again.player.x).toBeCloseTo(moved.player.x, 3); expect(again.player.y).toBeCloseTo(moved.player.y, 3);
  await page.getByRole('button', { name: 'Return to City' }).click();
  expect(errors).toEqual([]);

  // M (legacy). A pre-Phase-5 save (no economy, transport, society or designs) loads, migrates, and enters with the
  // classic models: nothing is substituted or invented.
  const legacyCity: CityState = { ...fixture, buildings: fixture.buildings.map((b) => { const { design, ...rest } = b; void design; return rest; }) };
  const legacy = new Simulation(createWorld({ id: 'villa-gardens-world', plan: toCityPlan(legacyCity), seed: 'legacy', clock: { paused: true }, startingFunds: 20_000 }));
  legacy.executeLife({ type: 'player.create', name: 'Bao', appearance: { ...look, accessory: 'none' }, homeBuildingId: 'terrace' });
  const legacySave = { ...legacyCity, saveVersion: 3, simulation: JSON.parse(serializeWorld(legacy.getState())) };
  await page.evaluate(({ key, value }) => { localStorage.setItem(key, JSON.stringify(value)); }, { key: SAVE_KEY, value: legacySave });
  await page.reload();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await enterWorld(page);
  const classic = await debug(page);
  expect(classic.stats.fallback).toEqual([]);
  expect(classic.stats.modelIds.some((id) => id.startsWith('villa.'))).toBe(true);
  expect(classic.stats.modelIds.some((id) => id.startsWith('lm.'))).toBe(false);
  // terrace (south of the street) turns its door north to the road: the spawn is the door rule's, on the street.
  const legacyWorld = legacy.getState();
  const legacySpawn = resolveSpawn(legacyWorld, new RoadNavigator(legacyWorld.plan), buildWalkGrid(legacyWorld.plan, planDecor(legacyWorld.plan)));
  if (!legacySpawn.ok) throw new Error(legacySpawn.reason);
  expect(classic.player.x).toBeCloseTo(legacySpawn.position.x, 6); expect(classic.player.y).toBeCloseTo(legacySpawn.position.y, 6);
  expect(Math.floor(classic.player.y)).toBe(20);
  await page.getByRole('button', { name: 'Return to City' }).click();
  expect(errors).toEqual([]);
});

test('a new city: entering without a character explains it and leads to creating one, who can then enter', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  const errors = await openCity(page, null);
  // N. No character: an explanation and a recovery path, never a 3D view with an invented character.
  await page.getByRole('button', { name: 'Enter World' }).click();
  const gate = page.getByRole('dialog', { name: 'Create your character first' });
  await expect(gate).toBeVisible();
  await expect(page.getByRole('region', { name: 'Character View' })).toHaveCount(0);
  await gate.getByRole('button', { name: 'Create character' }).click();
  const creator = page.getByRole('dialog', { name: 'Create your character' });
  await expect(creator).toBeVisible();
  await creator.getByLabel('Character name').fill('Mai');
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();
  // Waiting for a home: entering explains that too.
  await page.getByRole('button', { name: 'Enter World' }).click();
  const homeGate = page.getByRole('dialog', { name: 'Choose a home first' });
  await expect(homeGate).toBeVisible();
  await homeGate.getByRole('button', { name: 'Choose a home' }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: /Villa 01/ }).click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  // M (new city). The newly created character enters at their front door.
  await enterWorld(page);
  const d = await debug(page);
  expect(d.authority.status).toBe('inside');
  expect(d.stats.fallback).toEqual([]);
  expect(d.character.length).toBeGreaterThan(8);
  await page.getByRole('button', { name: 'Return to City' }).click();
  expect(errors).toEqual([]);
});

test('switching views repeatedly releases the 3D view each time, and the City View resumes (camera, clock, build)', async ({ page }) => {
  test.setTimeout(process.env.CI ? 420_000 : 180_000);
  const errors = await openCity(page, lmSave());
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize); };
  const samples: { heap: number; geometries: number; textures: number }[] = [];
  // O. Five round trips: each entry builds the same scene, each return removes the canvas and frees the renderer.
  for (let i = 0; i < 5; i += 1) {
    await enterWorld(page);
    await expect(page.locator('canvas')).toHaveCount(2);
    const d = await debug(page);
    await page.getByRole('button', { name: 'Return to City' }).click();
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect.poll(async () => (await debug(page))?.ready ?? false).toBe(false);
    samples.push({ heap: await heap(), geometries: d.stats.geometries, textures: d.stats.textures });
  }
  // The scene is identical every time (nothing accumulates), and memory does not grow from round trip 2 to 5.
  for (const s of samples.slice(1)) {
    expect(Math.abs(s.geometries - samples[0]!.geometries)).toBeLessThanOrEqual(samples[0]!.geometries * 0.1);
    expect(s.textures).toBe(samples[0]!.textures);
  }
  expect(samples[4]!.heap - samples[1]!.heap).toBeLessThan(24 * 1024 * 1024);

  // P. The Phase 4.6 camera still works.
  const zoomBefore = await page.evaluate(() => (window as unknown as { __tinyCityCamera: { zoom: number } }).__tinyCityCamera.zoom);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tinyCityCamera: { zoom: number } }).__tinyCityCamera.zoom)).toBeGreaterThan(zoomBefore);
  // The single clock runs from the City View again (the Pixi ticker resumed).
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  const tick = (await savedWorldAfterSave(page)).simulation.clock.tick;
  await expect.poll(async () => (await savedWorldAfterSave(page)).simulation.clock.tick, { timeout: 30_000 }).toBeGreaterThan(tick);
  // Q. Building still works: the Road tool is selectable and the build tools respond.
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: 'Road $8' }).click();
  await expect(page.getByRole('button', { name: 'Road $8' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

async function savedWorldAfterSave(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return savedWorld(page);
}
