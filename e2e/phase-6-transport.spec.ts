import { expect, test, type Page } from '@playwright/test';
import { decodePath, deserializeWorld, serializeWorld, Simulation, validateWorld } from '@tiny-city/simulation';
import type { Vehicle, WorldState } from '@tiny-city/simulation';
import { createCityWorld } from '../src/simulation/cityAdapter';
import type { CityState } from '../src/types';
import { cameraSettled } from './support/camera';
import { untilInGameTime } from './support/gameTime';

/**
 * Phase 6 browser acceptance: transportation through the real game. Saves are built with the real engine (so tests
 * start in the morning rush without long waits on slow runners); every check reads the authoritative saved world or
 * the renderer's debug view of what it draws, never fixtures of expected numbers.
 */
const SAVE_KEY = 'tiny-city-imagine-save-v1';
type Saved = CityState & { simulation: WorldState };
type Drawn = { id: string; kind: string; state: string; x: number; y: number; visible: boolean };

// Two streets (y = 14 and y = 26) joined by three avenues (x = 8, 28, 48): homes on the north street, jobs on the
// south street, so commuters drive across the grid.
const road = (x0: number, y0: number, x1: number, y1: number) => {
  const tiles: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) tiles.push({ x, y });
  return tiles;
};
const roads = [...road(8, 14, 48, 14), ...road(8, 26, 48, 26), ...road(8, 15, 8, 25), ...road(28, 15, 28, 25), ...road(48, 15, 48, 25)];
const fixture: CityState = { size: 64, funds: 9000, roads, buildings: [
  { id: 'apt-a', name: 'North Flats', kind: 'apartment', x: 10, y: 10, createdAt: 0 },
  { id: 'apt-b', name: 'Hill Flats', kind: 'apartment', x: 15, y: 10, createdAt: 0 },
  { id: 'apt-c', name: 'Garden Flats', kind: 'apartment', x: 31, y: 10, createdAt: 0 },
  { id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 22, y: 12, createdAt: 0 },
  { id: 'villa-b', name: 'Palm Villa', kind: 'villa', x: 25, y: 12, createdAt: 0 },
  { id: 'office-a', name: 'Harbor Office', kind: 'office', x: 12, y: 27, createdAt: 0 },
  { id: 'office-b', name: 'Bay Office', kind: 'office', x: 33, y: 27, createdAt: 0 },
  { id: 'mall', name: 'Boutique Mall', kind: 'mall', x: 40, y: 27, createdAt: 0 },
  { id: 'park', name: 'Sunny Park', kind: 'park', x: 20, y: 16, createdAt: 0 },
] };
const STOPS = [{ x: 20, y: 14 }, { x: 38, y: 14 }, { x: 38, y: 26 }, { x: 20, y: 26 }];
test.slow();

/** A save of the fixture whose simulation has residents (and optionally a bus line) and has run to `minute`. */
function snapshotAt(minute: number, line = false): Saved {
  const sim = new Simulation(createCityWorld(fixture));
  sim.enablePopulation({ maxCitizens: 1000 });
  sim.enableTransport();
  if (line) expect(sim.executeTransport({ type: 'transport.create-line', stops: STOPS, buses: 4 }).applied).toBe(true);
  sim.step(minute);
  sim.pause();
  return { ...fixture, saveVersion: 3, simulation: JSON.parse(serializeWorld(sim.getState())) } as Saved;
}

async function openCity(page: Page, save: unknown) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('p6')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('p6', '1'); }
  }, { key: SAVE_KEY, value: save });
  await page.goto('/');
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await cameraSettled(page);
  return errors;
}
async function saveNow(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
const drawn = (page: Page) => page.evaluate(() => (window as unknown as { __tinyCityTransport?: { tick: number; vehicles: Drawn[] } }).__tinyCityTransport);
async function screenOf(page: Page, gx: number, gy: number) {
  const c = await page.evaluate(() => (window as unknown as { __tinyCityCamera: { x: number; y: number; zoom: number; focalX: number; focalY: number } }).__tinyCityCamera);
  const box = (await page.locator('canvas').boundingBox())!;
  const world = { x: 32 * 56 + (gx - gy) * 28, y: (gx + gy) * 14 };
  return { x: box.x + c.focalX + (world.x - c.x) * c.zoom, y: box.y + c.focalY + (world.y - c.y) * c.zoom };
}
const resume = (page: Page) => page.getByRole('button', { name: 'Resume', exact: true }).click();
const pause = (page: Page) => page.getByRole('button', { name: 'Pause', exact: true }).click();
/** Waits until the debug view reflects the current paused tick. */
async function drawnAt(page: Page, tick: number) {
  await expect.poll(async () => (await drawn(page))?.tick, { timeout: 10_000 }).toBe(tick);
  return (await drawn(page))!;
}
const onRoad = (v: Drawn, roadSet: Set<string>) => {
  // The drawn centre stays within its lane: never more than 0.75 tiles from a road tile centre.
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
    const tx = Math.floor(v.x) + dx, ty = Math.floor(v.y) + dy;
    if (roadSet.has(`${tx},${ty}`) && Math.hypot(v.x - (tx + 0.5), v.y - (ty + 0.5)) <= 0.75) return true;
  }
  return false;
};

test('vehicles on screen are exactly the simulated ones, stay on roads, pause exactly and replay deterministically', async ({ page }) => {
  const errors = await openCity(page, snapshotAt(7 * 60 + 25));
  await resume(page);
  await untilInGameTime(page, 'morning traffic', async () => (await drawn(page))?.vehicles.length ?? 0, (n) => n >= 5, { within: 120 });
  await pause(page);
  const saved = await saveNow(page);
  const world = deserializeWorld(JSON.stringify(saved.simulation));
  const view = await drawnAt(page, world.clock.tick);
  const street = world.transport!.vehicles.filter((v: Vehicle) => v.state !== 'departing');
  // One drawn vehicle per simulated vehicle on the street, and nothing else.
  expect(view.vehicles.map((v) => v.id).sort()).toEqual(street.map((v) => v.id).sort());
  const roadSet = new Set(world.plan.roads.map((t) => `${t.x},${t.y}`));
  for (const v of view.vehicles) {
    expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
    expect(onRoad(v, roadSet)).toBe(true);
  }
  for (const v of street) for (const tile of decodePath(v.origin, v.path)) expect(roadSet.has(`${tile.x},${tile.y}`)).toBe(true);
  // Paused: nothing moves.
  await page.waitForTimeout(1200);
  expect((await drawn(page))!.vehicles).toEqual(view.vehicles);
  // One Step equals the simulation package stepping the saved world once (the browser runs the same engine).
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  const stepped = await saveNow(page);
  const replay = new Simulation(world);
  replay.step(1);
  expect(serializeWorld(deserializeWorld(JSON.stringify(stepped.simulation)))).toBe(serializeWorld(replay.getState()));
  // The HUD counts the vehicles on the street; the transport panel shows the authoritative figures.
  await expect(page.getByTestId('hud-vehicles')).toHaveText(String(replay.getState().transport!.vehicles.filter((v) => v.state !== 'departing').length));
  await page.getByRole('button', { name: 'City transport' }).click();
  const panel = page.getByRole('region', { name: 'Transportation' });
  await expect(panel.getByTestId('transport-vehicles')).toContainText(String(replay.getState().transport!.vehicles.filter((v) => v.state !== 'departing').length));
  expect(errors).toEqual([]);
});

test('a bus line drawn on the map carries real residents; the overlays and dashboard follow the simulation', async ({ page }) => {
  const errors = await openCity(page, snapshotAt(6 * 60 + 30));
  await page.getByRole('button', { name: 'City transport' }).click();
  const panel = page.getByRole('region', { name: 'Transportation' });
  await panel.getByRole('button', { name: 'New bus line' }).click();
  // An intersection is refused with a reason; road tiles become stops in order.
  const junction = await screenOf(page, 28.5, 14.5);
  await page.mouse.click(junction.x, junction.y);
  await expect(panel.getByRole('alert')).toContainText('intersection');
  for (const stop of STOPS) {
    const point = await screenOf(page, stop.x + 0.5, stop.y + 0.5);
    await page.mouse.click(point.x, point.y);
  }
  await expect(panel.getByRole('list', { name: 'New line stops' }).getByRole('listitem')).toHaveCount(4);
  await panel.getByRole('button', { name: 'More buses' }).click();
  await panel.getByRole('button', { name: 'Create line' }).click();
  await expect(panel.getByRole('listitem', { name: 'Line 1' })).toContainText('4 buses');
  await expect(panel.getByRole('listitem', { name: 'Line 1' })).toContainText('$160/day');
  let saved = await saveNow(page);
  expect(saved.simulation.transport!.lines).toHaveLength(1);
  expect(saved.simulation.transport!.stops.map((s) => s.tile)).toEqual(STOPS);
  // Run the morning until residents really ride (boardings recorded by the simulation).
  await resume(page);
  await untilInGameTime(page, 'a resident boards a bus', async () => {
    const view = await drawn(page);
    return view?.vehicles.filter((v) => v.kind === 'bus').length ?? 0;
  }, (n) => n >= 1, { within: 60 });
  await untilInGameTime(page, 'boardings', async () => Number(/(\d+) boardings/.exec((await panel.textContent()) ?? '')?.[1] ?? 0), (n) => n > 0, { within: 240 });
  await pause(page);
  saved = await saveNow(page);
  const t = saved.simulation.transport!;
  const riders = t.vehicles.filter((v) => v.kind === 'bus').reduce((n, b) => n + b.passengers.length, 0);
  for (const bus of t.vehicles.filter((v) => v.kind === 'bus')) {
    expect(bus.passengers.length).toBeLessThanOrEqual(24);
    for (const id of bus.passengers) expect(saved.simulation.citizens.find((c) => c.id === id)?.movement?.status).toBe('vehicle');
  }
  await expect(panel.getByRole('listitem', { name: 'Line 1' })).toContainText(`${riders} / `);
  expect(t.today.boardings).toBeGreaterThan(0);
  // Overlays: switching never changes the simulation.
  const before = serializeWorld(deserializeWorld(JSON.stringify(saved.simulation)));
  await panel.getByRole('button', { name: 'Traffic overlay' }).click();
  await expect(panel.getByLabel('Congestion legend')).toBeVisible();
  await panel.getByRole('button', { name: 'Bus lines overlay' }).click();
  await expect(panel.getByRole('button', { name: 'Bus lines overlay' })).toHaveAttribute('aria-pressed', 'true');
  const after = await saveNow(page);
  expect(serializeWorld(deserializeWorld(JSON.stringify(after.simulation)))).toBe(before);
  expect(errors).toEqual([]);
});

test('removing a road under traffic re-routes or ends trips safely, survives reload mid-journey and undo', async ({ page }) => {
  const errors = await openCity(page, snapshotAt(7 * 60 + 35, true));
  const before = deserializeWorld(JSON.stringify((await saveNow(page)).simulation));
  // The avenue tile with traffic routed through it.
  const busy = { x: 28, y: 20 };
  expect(before.transport!.vehicles.some((v) => decodePath(v.origin, v.path).some((t) => t.x === busy.x && t.y === busy.y))).toBe(true);
  await page.getByRole('button', { name: 'Bulldoze' }).click();
  const point = await screenOf(page, busy.x + 0.5, busy.y + 0.5);
  await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: 'Select' }).click();
  const edited = await saveNow(page);
  const world = deserializeWorld(JSON.stringify(edited.simulation));     // validates every reference and route
  expect(world.plan.roads.some((t) => t.x === busy.x && t.y === busy.y)).toBe(false);
  for (const v of world.transport!.vehicles) expect(decodePath(v.origin, v.path).slice(v.edge).some((t) => t.x === busy.x && t.y === busy.y)).toBe(false);
  // Undo restores the avenue while vehicles are on the street; every reference stays valid.
  await page.getByRole('button', { name: 'Undo' }).click();
  const undone = deserializeWorld(JSON.stringify((await saveNow(page)).simulation));
  expect(undone.plan.roads.some((t) => t.x === busy.x && t.y === busy.y)).toBe(true);
  validateWorld(undone);
  // Traffic carries on; save mid-journey and reload: the same vehicles continue from where they were.
  await resume(page);
  await untilInGameTime(page, 'traffic after the edit', async () => (await drawn(page))?.vehicles.length ?? 0, (n) => n > 0, { within: 60 });
  await pause(page);
  const midJourney = await saveNow(page);
  await page.reload();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  const reloaded = await saveNow(page);
  expect(serializeWorld(deserializeWorld(JSON.stringify(reloaded.simulation)))).toBe(serializeWorld(deserializeWorld(JSON.stringify(midJourney.simulation))));
  const view = await drawnAt(page, reloaded.simulation.clock.tick);
  expect(view.vehicles.map((v) => v.id).sort()).toEqual(reloaded.simulation.transport!.vehicles.filter((v) => v.state !== 'departing').map((v) => v.id).sort());
  expect(errors).toEqual([]);
});

test('transport panel fits a phone screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openCity(page, snapshotAt(7 * 60 + 30, true));
  // Phones have no top-bar stats: the Build sheet leads to the Transport panel.
  await page.getByRole('navigation', { name: 'Game mode' }).getByRole('button', { name: 'Build' }).click();
  await page.getByRole('button', { name: 'Open city transport' }).click();
  await expect(page.getByRole('region', { name: 'Transportation' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Transportation' }).getByRole('listitem', { name: 'Line 1' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
