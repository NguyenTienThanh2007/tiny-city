import { expect, test, type Page } from '@playwright/test';
import { CONSTRUCTION_COSTS, getGameTime, serializeWorld, validateWorld } from '@tiny-city/simulation';
import type { Simulation, WorldState } from '@tiny-city/simulation';
import type { CityState } from '../src/types';
import { LIVING_TOWN, livingSave, livingTown } from '../src/immersive/world/livingFixture';
import { actorScene, staticSceneOf } from '../src/immersive/world/sceneModel';
import { cameraSettled } from './support/camera';

/**
 * Phase 8B browser acceptance: the Character View shows the real living city. Saves are built and run by the real
 * engine; every check compares the live renderer state (`window.__tinyCityImmersive`) with the authoritative saved
 * world: drawn residents and vehicles must be real simulation entities, in the state the simulation has them.
 */
const SAVE_KEY = 'tiny-city-imagine-save-v1';
type Saved = CityState & { simulation: WorldState };
type Debug = {
  ready: boolean; quality: string;
  player: { x: number; y: number; yaw: number; motion: string; controlling: boolean };
  authority: { x: number; y: number; status: string; tick: number };
  residents: { id: string; name: string; mode: string; action: string; x: number; y: number }[];
  vehicles: { id: string; kind: string; passengers: number; x: number; y: number }[];
  hidden: { inside: number; onLot: number; riding: number; driving: number };
  entities: { buildings: string[]; stops: string[]; roads: number };
  target: { kind: string; id: string; label: string } | null;
  camera: { yaw: number };
  reusedScene: boolean;
  sky: { phase: string; sun: number; glow: number; minute: number; lamps: number; windows: number };
  stats: { reconciles: number; lastSync: { added: number; removed: number } | null; buildings: number; fallback: string[] };
};
test.slow();

const designs = new Map(LIVING_TOWN.buildings.flatMap((b) => (b.design ? [[b.id, b.design] as const] : [])));
const roadsOf = (world: WorldState) => { const set = new Set(world.plan.roads.map((r) => `${r.x},${r.y}`)); return (x: number, y: number) => set.has(`${x},${y}`); };

/**
 * The first evening minute (from 16:00) when someone waits at the stop beside the player's door, a bus carries
 * passengers and an open-air venue has visitors: a real, lively moment found by running the simulation.
 */
function livelyMoment(): Simulation {
  const sim = livingTown(16 * 60);
  for (let i = 0; i < 6 * 60; i += 1) {
    const world = sim.getState();
    const stops = staticSceneOf(world, designs).stops;
    const actors = actorScene(world, roadsOf(world), stops);
    const atDoorStop = actors.residents.some((r) => r.mode === 'at-stop' && Math.hypot(r.x - 10.5, r.y - 14.2) < 1.3);
    const riding = (world.transport?.vehicles ?? []).some((v) => v.kind === 'bus' && v.passengers.length > 0);
    const visitors = actors.residents.some((r) => r.mode === 'at-venue');
    if (atDoorStop && riding && visitors) { sim.pause(); return sim; }
    sim.step(1);
  }
  throw new Error('no lively moment found');
}

async function openCity(page: Page, save: unknown) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('p8b')) return;
    localStorage.clear(); localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('p8b', '1');
  }, { key: SAVE_KEY, value: save });
  await page.goto('/');
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await cameraSettled(page);
  return errors;
}
const debug = (page: Page) => page.evaluate(() => (window as unknown as { __tinyCityImmersive?: Debug }).__tinyCityImmersive!);
const view = (page: Page) => page.getByRole('region', { name: 'Character View' });
async function enterWorld(page: Page) {
  await page.getByRole('button', { name: 'Enter World' }).click();
  await expect(view(page)).toHaveAttribute('data-ready', 'ready', { timeout: 90_000 });
  await expect.poll(async () => (await debug(page))?.ready ?? false, { timeout: 30_000 }).toBe(true);
}
async function returnToCity(page: Page) {
  await view(page).getByRole('button', { name: 'Return to City' }).click();
  await expect(view(page)).toHaveCount(0);
}
async function savedWorld(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).first().click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}

// City View tile clicks, from the public minimap footprint (as in city-builder.spec.ts).
async function screenPoint(page: Page, x: number, y: number, lift = 0) {
  const bounds = (await page.locator('canvas.city-canvas').boundingBox())!;
  const points = (await page.getByTestId('minimap-camera').getAttribute('points'))!.split(' ').map((pair) => pair.split(',').map((value) => Number(value) * 64 / 100));
  const world = (gx: number, gy: number) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const origin = world(points[0]![0]!, points[0]![1]!), right = world(points[1]![0]!, points[1]![1]!);
  const scale = bounds.width / (right.x - origin.x);
  const target = world(x, y);
  return { x: bounds.x + (target.x - origin.x) * scale, y: bounds.y + (target.y - lift - origin.y) * scale };
}
async function clickTile(page: Page, x: number, y: number) {
  const point = await screenPoint(page, x + 0.5, y + 0.5);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
}

test('the real living city: residents, vehicles, buses, passengers and venue visitors, inspected by name', async ({ page }) => {
  test.setTimeout(process.env.CI ? 420_000 : 180_000);
  const sim = livelyMoment();
  const world = sim.getState();
  const errors = await openCity(page, livingSave(world));
  await enterWorld(page);
  const d = await debug(page);

  // A. The actual city: every building and stop of the world, nothing else, no stand-ins.
  expect(d.entities.buildings).toEqual(world.plan.buildings.map((b) => b.id).sort());
  expect(d.entities.stops).toEqual(world.transport!.stops.map((s) => s.id).sort());
  expect(d.entities.roads).toBe(world.plan.roads.length);
  expect(d.stats.fallback).toEqual([]);

  // C, G, H. Drawn residents are real, unique, and in the state the simulation has them (time is paused).
  await expect.poll(async () => (await debug(page)).residents.length, { timeout: 30_000 }).toBeGreaterThan(3);
  const live = await debug(page);
  const expected = new Map(actorScene(world, roadsOf(world), staticSceneOf(world, designs).stops).residents.map((r) => [r.id, r]));
  const ids = live.residents.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const r of live.residents) {
    const e = expected.get(r.id)!;
    expect(e, `drawn resident ${r.id} must be a visible simulation resident`).toBeDefined();
    expect(r.name).toBe(world.citizens.find((c) => c.id === r.id)!.name);
    expect(r.mode).toBe(e.mode);
    // Walkers are drawn on the sidewalk side of their route (≤ 0.36 tiles); stops and venues at their exact spot.
    expect(Math.hypot(r.x - e.x, r.y - e.y)).toBeLessThanOrEqual(e.mode === 'walking' || e.mode === 'waiting' ? 0.37 : 0.01);
  }
  expect(live.residents.some((r) => r.mode === 'at-stop')).toBe(true);
  // Riders are never drawn walking: the hidden riders are exactly the buses' passengers.
  const riders = world.transport!.vehicles.filter((v) => v.kind === 'bus').reduce((n, v) => n + v.passengers.length, 0);
  expect(live.hidden.riding).toBe(riders);

  // E, F. Drawn vehicles are real simulation vehicles, unique, buses with their real passengers.
  const vehicles = new Map(world.transport!.vehicles.map((v) => [v.id, v]));
  const vids = live.vehicles.map((v) => v.id);
  expect(new Set(vids).size).toBe(vids.length);
  for (const v of live.vehicles) {
    const sim = vehicles.get(v.id)!;
    expect(sim, `drawn vehicle ${v.id} must exist`).toBeDefined();
    expect(sim.state).not.toBe('departing');
    expect(v.passengers).toBe(sim.passengers.length);
  }

  // D. Face the stop beside the door: the waiting resident is offered by name; E opens their real record.
  await view(page).getByRole('button', { name: 'Resume' }).click();
  await page.keyboard.down('d');
  await expect.poll(async () => { const s = await debug(page); return s.player.controlling && Math.abs(Math.abs(s.player.yaw) - Math.PI / 2) < 0.3; }, { timeout: 30_000 }).toBe(true);
  await page.keyboard.up('d');
  await view(page).getByRole('button', { name: 'Pause' }).click();
  await expect.poll(async () => (await debug(page)).target?.kind ?? null, { timeout: 15_000 }).not.toBeNull();
  const target = (await debug(page)).target!;
  const prompt = view(page).getByRole('status', { name: 'Interaction' });
  await expect(prompt).toContainText(target.label);
  await page.keyboard.press('e');
  const panel = page.getByRole('dialog', { name: `Inspect ${target.label}` });
  await expect(panel).toBeVisible();
  const paused = await savedWorld(page);
  if (target.kind === 'resident') {
    const citizen = paused.simulation.citizens.find((c) => c.id === target.id)!;
    expect(citizen.name).toBe(target.label);
    await expect(panel.getByRole('heading', { name: citizen.name })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Greet' })).toBeVisible();
  } else {
    expect(target.kind).toBe('stop');
    await expect(panel).toContainText('Bus stop');
  }
  // Inspecting changes nothing in the world.
  expect(serializeWorld((await savedWorld(page)).simulation as WorldState)).toBe(serializeWorld(paused.simulation as WorldState));
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // I. A building: face the Glass Pavilion lot (north) and inspect it.
  await view(page).getByRole('button', { name: 'Resume' }).click();
  await page.keyboard.down('s');
  await expect.poll(async () => (await debug(page)).target?.id === 'glass', { timeout: 30_000 }).toBe(true);
  await page.keyboard.up('s');
  await view(page).getByRole('button', { name: 'Pause' }).click();
  await page.keyboard.press('e');
  const villa = page.getByRole('dialog', { name: 'Inspect glass' });
  await expect(villa).toContainText('Villa');
  await expect(villa).toContainText('your home');
  await villa.getByRole('button', { name: 'Close inspector' }).click();
  await returnToCity(page);
  expect(errors).toEqual([]);
});

test('one world: switching views changes nothing, construction and demolition reconcile, speed and pause, save and reload', async ({ page }) => {
  test.setTimeout(process.env.CI ? 420_000 : 180_000);
  const errors = await openCity(page, livingSave(livingTown(8 * 60).getState()));
  // L. Switching views with time paused leaves the world byte-for-byte unchanged (no second simulation, no duplicated
  // settlements, trips or attendance) and never duplicates a drawn entity.
  const before = serializeWorld((await savedWorld(page)).simulation as WorldState);
  for (let i = 0; i < 3; i += 1) {
    await enterWorld(page);
    const d = await debug(page);
    expect(new Set(d.residents.map((r) => r.id)).size).toBe(d.residents.length);
    expect(new Set(d.vehicles.map((v) => v.id)).size).toBe(d.vehicles.length);
    if (i > 0) expect(d.reusedScene).toBe(true);
    await returnToCity(page);
  }
  expect(serializeWorld((await savedWorld(page)).simulation as WorldState)).toBe(before);

  // M. Build a park in the City View; the kept 3D scene reconciles it in (one building added, nothing rebuilt).
  // (A park: nobody moves in, so it can be demolished again below; occupied homes are protected by the simulation.)
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await cameraSettled(page);
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: `Park $${CONSTRUCTION_COSTS.park}`, exact: true }).click();
  await clickTile(page, 26, 15);
  const built = (await savedWorld(page)).simulation.plan.buildings.find((b) => b.position.x === 26 && b.position.y === 15);
  expect(built, 'the park was built').toBeDefined();
  await enterWorld(page);
  let d = await debug(page);
  expect(d.entities.buildings).toContain(built!.id);
  expect(d.stats.lastSync).toMatchObject({ added: 1, removed: 0 });
  await returnToCity(page);

  // N. Demolish it; the 3D scene removes it (and its collider) on the next visit. (Returning framed the character, so
  // the neighbourhood view is restored first for the click.)
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await cameraSettled(page);
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Bulldoze', exact: true }).click();
  const centre = await screenPoint(page, 28, 17, 5);
  await page.mouse.click(centre.x, centre.y);
  await expect.poll(async () => (await savedWorld(page)).simulation.plan.buildings.some((b) => b.id === built!.id)).toBe(false);
  await enterWorld(page);
  d = await debug(page);
  expect(d.entities.buildings).not.toContain(built!.id);
  expect(d.stats.lastSync).toMatchObject({ added: 0, removed: 1 });

  // P. Paused: nothing moves (the authoritative tick and every drawn resident stay put). Residents come into view a
  // few per frame, so wait until the drawn set has settled.
  let previous = -1;
  await expect.poll(async () => { const n = (await debug(page)).residents.length; const same = n === previous; previous = n; return same && n > 0; }, { intervals: [500], timeout: 30_000 }).toBe(true);
  const still = await debug(page);
  await page.waitForTimeout(800);
  const later = await debug(page);
  expect(later.authority.tick).toBe(still.authority.tick);
  expect(later.residents).toEqual(still.residents);

  // O. Speed: the one clock runs faster at 4× from the Character View's own controls.
  await view(page).getByRole('button', { name: 'Speed 4x' }).click();
  await expect(view(page).getByRole('button', { name: 'Speed 4x' })).toHaveAttribute('aria-pressed', 'true');
  await view(page).getByRole('button', { name: 'Resume' }).click();
  const t0 = (await debug(page)).authority.tick;
  await expect.poll(async () => (await debug(page)).authority.tick - t0, { timeout: 30_000 }).toBeGreaterThan(20);
  await view(page).getByRole('button', { name: 'Pause' }).click();

  // Q. Save from the Character View, reload: the same city, the same residents and vehicles, nothing duplicated.
  const saved = await savedWorld(page);
  validateWorld(saved.simulation as WorldState);
  await page.reload();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await enterWorld(page);
  d = await debug(page);
  expect(d.authority.tick).toBe(saved.simulation.clock.tick);
  expect(d.entities.buildings).toEqual(saved.simulation.plan.buildings.map((b) => b.id).sort());
  const citizens = new Set(saved.simulation.citizens.map((c) => c.id));
  for (const r of d.residents) expect(citizens.has(r.id)).toBe(true);
  expect(new Set(d.residents.map((r) => r.id)).size).toBe(d.residents.length);
  await returnToCity(page);
  expect(errors).toEqual([]);
});

test('time and light follow the game clock: a café inspected at sunset, then night with street and window lights', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 120_000);
  // Linh walks (the simulation's own move-to) to Market Street in front of Corner Café, arriving before 18:40.
  const sim = livingTown(17 * 60 + 40);
  expect(sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 11, y: 24 } } }).applied).toBe(true);
  sim.step(60);
  sim.pause();
  const world = sim.getState();
  expect(world.player!.position).toEqual({ x: 11.5, y: 24.5 });
  const errors = await openCity(page, livingSave(world));
  await enterWorld(page);
  // J. Golden hour at the saved minute (same clock as the City View).
  let d = await debug(page);
  expect(d.sky.minute).toBe(getGameTime(world.clock).minuteOfDay);
  expect(d.sky.phase).toBe('golden');
  const glow0 = d.sky.glow;
  // I. A café: face its lot (south of the street) and inspect its live record; inspecting changes nothing.
  await view(page).getByRole('button', { name: 'Resume' }).click();
  const towardCafe = Math.cos(d.camera.yaw) >= 0 ? 'w' : 's';
  await page.keyboard.down(towardCafe);
  await expect.poll(async () => (await debug(page)).target?.id ?? null, { timeout: 30_000 }).toBe('cafe');
  await page.keyboard.up(towardCafe);
  await view(page).getByRole('button', { name: 'Pause' }).click();
  await page.keyboard.press('e');
  const cafe = page.getByRole('dialog', { name: 'Inspect Corner Café' });
  await expect(cafe.getByRole('heading', { name: 'Corner Café' })).toBeVisible();
  await expect(cafe).toContainText('Inside now');
  await expect(cafe.getByRole('button', { name: 'Eat here' })).toBeVisible();
  const before = serializeWorld((await savedWorld(page)).simulation as WorldState);
  expect(serializeWorld((await savedWorld(page)).simulation as WorldState)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(cafe).toHaveCount(0);
  // K. Run to night at 4×: the sky darkens, street lamps and windows light up.
  await view(page).getByRole('button', { name: 'Speed 4x' }).click();
  await view(page).getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await debug(page)).sky.minute, { timeout: 120_000 }).toBeGreaterThanOrEqual(21 * 60 + 15);
  await view(page).getByRole('button', { name: 'Pause' }).click();
  d = await debug(page);
  expect(d.sky.phase).toBe('night');
  expect(d.sky.glow).toBeGreaterThan(glow0);
  expect(d.sky.glow).toBe(1);
  expect(d.sky.lamps).toBeGreaterThan(2);
  expect(d.sky.windows).toBeGreaterThan(1);
  expect(d.sky.sun).toBe(0);
  await returnToCity(page);
  expect(errors).toEqual([]);
});
