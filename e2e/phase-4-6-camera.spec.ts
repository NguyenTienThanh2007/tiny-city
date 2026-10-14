import { expect, test, type Page } from '@playwright/test';
import type { WorldState } from '@tiny-city/simulation';
import type { CityState } from '../src/types';
import { untilClock, untilText } from './support/gameTime';

/**
 * Phase 4.6: camera stability, City View / Life View, Focus and Follow, through the real UI. Positions come from the
 * renderer's camera (`window.__tinyCityCamera`: the world point at the focal point, the zoom, the focal point and the
 * followed subject), so every check is exact rather than read off screenshots.
 */
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const design = (model: string) => ({ collection: 'luxury-minimalist' as const, model });
// One long street; Luxury Minimalist homes, mall and office on both sides (3.1 designs), a park, and open land. Walks
// go to street tiles with nothing tall in front of them (x 29–37), so the click lands on the road, not a building.
const fixture: CityState = { size: 64, funds: 9000, roads: Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), buildings: [
  { id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 12, y: 21, createdAt: 0, design: design('lm.villa.glass-pavilion') },
  { id: 'villa-b', name: 'Palm Villa', kind: 'villa', x: 15, y: 21, createdAt: 0, design: design('lm.villa.sky-terrace') },
  { id: 'town', name: 'Dune Townhouse', kind: 'townhouse', x: 18, y: 21, createdAt: 0, design: design('lm.townhouse.urban-glass') },
  { id: 'park', name: 'Sunny Park', kind: 'park', x: 22, y: 21, createdAt: 0 },
  { id: 'duplex', name: 'Twin Duplex', kind: 'duplex', x: 26, y: 21, createdAt: 0, design: design('lm.duplex.twin-glass') },
  { id: 'apartment', name: 'Glass Apartments', kind: 'apartment', x: 30, y: 16, createdAt: 0, design: design('lm.apartment.premium-glass') },
  { id: 'mall', name: 'Boutique Mall', kind: 'mall', x: 35, y: 15, createdAt: 0, design: design('lm.mall.boutique-frontage') },
  { id: 'office', name: 'Harbor Office', kind: 'office', x: 44, y: 21, createdAt: 0, design: design('lm.office.architectural-concrete') },
] };
const FOOTPRINTS = { villa: [2, 2], townhouse: [2, 3], park: [4, 4], duplex: [3, 2], apartment: [4, 4], mall: [6, 5], office: [4, 4] } as const;
type Saved = CityState & { simulation: WorldState };
type Point = { x: number; y: number };
type Camera = Point & { zoom: number; following: boolean; moving: boolean; width: number; height: number; focalX: number; focalY: number;
  minZoom: number; maxZoom: number; subject?: Point | null };
type Stats = { art?: string; bakedBuildings?: number; vectorBuildings?: number; drawnModels?: Record<string, number>; nearbyTags?: number };
test.slow();

async function openCity(page: Page, city: unknown = fixture) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('p46')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('p46', '1'); }
  }, { key: SAVE_KEY, value: city });
  await page.goto('/');
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await settle(page);
  return errors;
}
const camera = (page: Page) => page.evaluate(() => (window as unknown as { __tinyCityCamera?: Camera }).__tinyCityCamera!);
/** Waits until the camera has stopped gliding/zooming (three still samples in a row). */
async function settle(page: Page) {
  // A camera command applies on the next React commit and render frame; give it a few frames to start moving.
  await page.waitForTimeout(300);
  let still = 0, last = '';
  await expect.poll(async () => {
    const c = await camera(page);
    const key = c ? `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.zoom.toFixed(5)}` : '';
    still = c && !c.moving && key === last ? still + 1 : 0;
    last = key;
    return still >= 2;
  }, { intervals: [120], timeout: 20_000 }).toBe(true);
}
const iso = (gx: number, gy: number): Point => ({ x: 32 * 56 + (gx - gy) * 28, y: (gx + gy) * 14 });
const toGrid = (p: Point): Point => { const a = (p.x - 32 * 56) / 28, b = p.y / 14; return { x: (a + b) / 2, y: (b - a) / 2 }; };
/** Page coordinates of a world point under the current camera. */
async function screenOfWorld(page: Page, world: Point) {
  const c = await camera(page);
  const box = (await page.locator('canvas').boundingBox())!;
  return { x: box.x + c.focalX + (world.x - c.x) * c.zoom, y: box.y + c.focalY + (world.y - c.y) * c.zoom };
}
const screenOf = (page: Page, gx: number, gy: number) => screenOfWorld(page, iso(gx, gy));
/** Screen distance of the followed character from the focal point. */
async function subjectOffset(page: Page) {
  const c = await camera(page);
  expect(c.subject, 'the character is in the world').toBeTruthy();
  return Math.hypot((c.subject!.x - c.x) * c.zoom, (c.subject!.y - c.y) * c.zoom);
}
async function save(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
const readStats = (page: Page) => page.evaluate(() => (window as unknown as { __tinyCityRenderer?: Stats }).__tinyCityRenderer ?? {});
const notice = (page: Page) => page.getByRole('status', { name: 'City notice' });
const status = (page: Page) => page.getByRole('status', { name: 'Current activity' });
const cameraGroup = (page: Page) => page.getByRole('group', { name: 'Character camera' });
const followButton = (page: Page) => cameraGroup(page).getByRole('button', { name: 'Follow your character' });

async function createCharacter(page: Page, name = 'Mai', home = /Lagoon Villa/) {
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  const creator = page.getByRole('dialog', { name: 'Create your character' });
  await creator.getByLabel('Character name').fill(name);
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: home }).click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await expect(notice(page)).toContainText(`Welcome home, ${name}!`);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await settle(page);
}
/** Picks a far street tile the way a player would: frame the neighbourhood, click the tile, back to Life view. */
async function walkTo(page: Page, gx: number, gy: number) {
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await expect.poll(async () => (await camera(page)).following).toBe(false);
  await expect(cameraGroup(page).getByRole('button', { name: 'City view' })).toHaveAttribute('aria-pressed', 'true');
  await settle(page);
  const target = await screenOf(page, gx + 0.5, gy + 0.5);
  await page.mouse.click(target.x, target.y);
  await expect(status(page)).toContainText(`Walking to the street at ${gx}, ${gy}`);
  await cameraGroup(page).getByRole('button', { name: 'Life view' }).click();
  await expect.poll(async () => (await camera(page)).following).toBe(true);
  await settle(page);
}
/** A left-button drag on the map (pans with the select tool, in Build and Life modes). */
async function drag(page: Page, from: Point, dx: number, dy: number, shift = false) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}
async function selectBuilding(page: Page, id: string, name: string) {
  const building = fixture.buildings.find((entry) => entry.id === id)!;
  const [w, h] = FOOTPRINTS[building.kind as keyof typeof FOOTPRINTS];
  const point = await screenOf(page, building.x + w / 2, building.y + h / 2);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#building-name')).toHaveText(name);
}

test('A/B: 100 wheel and 40 button zoom cycles keep the framing; pans and zoom-out stay on the map; selection still works', async ({ page }) => {
  test.setTimeout(process.env.CI ? 420_000 : 200_000);
  const errors = await openCity(page);
  const start = await camera(page);
  const mallCentre = iso(38, 17.5);
  const mallBefore = await screenOfWorld(page, mallCentre);
  // 100 mouse-wheel cycles over an off-centre building (zoom is anchored at the cursor).
  await page.mouse.move(mallBefore.x, mallBefore.y);
  for (let i = 0; i < 100; i += 1) { await page.mouse.wheel(0, -100); await page.mouse.wheel(0, 100); }
  await settle(page);
  let after = await camera(page);
  expect(Math.abs(after.zoom - start.zoom) / start.zoom).toBeLessThan(1e-6);
  expect(Math.hypot(after.x - start.x, after.y - start.y) * after.zoom).toBeLessThan(0.5);
  const mallAfter = await screenOfWorld(page, mallCentre);
  expect(Math.hypot(mallAfter.x - mallBefore.x, mallAfter.y - mallBefore.y)).toBeLessThan(0.5);
  // 40 button cycles (clicked faster than the zoom animation finishes).
  for (let i = 0; i < 40; i += 1) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  }
  await settle(page);
  after = await camera(page);
  expect(Math.abs(after.zoom - start.zoom) / start.zoom).toBeLessThan(1e-6);
  expect(Math.hypot(after.x - start.x, after.y - start.y) * after.zoom).toBeLessThan(0.5);
  await selectBuilding(page, 'mall', 'Boutique Mall');

  // Trackpad-style bursts: sideways swipes and zero deltas never zoom; a symmetric scroll returns exactly.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const send = (deltaX: number, deltaY: number) => canvas.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, clientX: 500, clientY: 500, bubbles: true, cancelable: true }));
    for (let i = 0; i < 30; i += 1) send(8, 0);
    for (const d of [-1, -2, -4, -6, -8, -6, -4, -2, -1, 0, 0, 1, 2, 4, 6, 8, 6, 4, 2, 1, 0, 0]) send(0, d);
  });
  await settle(page);
  after = await camera(page);
  expect(Math.abs(after.zoom - start.zoom) / start.zoom).toBeLessThan(1e-6);

  // B: pan hard in every direction; the visible centre never leaves the map.
  const centre = { x: 600, y: 450 };
  for (const [dx, dy] of [[700, 0], [-700, 0], [0, 600], [0, -600]] as const) {
    for (let i = 0; i < 6; i += 1) await drag(page, centre, dx, dy, i % 2 === 0);
    const c = await camera(page);
    const grid = toGrid(c);
    for (const value of [grid.x, grid.y]) { expect(value).toBeGreaterThanOrEqual(-1.6); expect(value).toBeLessThanOrEqual(65.6); }
  }
  // Zoom all the way out at a map edge: zoom stops where the whole map fits, and the map stays on screen.
  await page.mouse.move(200, 300);
  for (let i = 0; i < 25; i += 1) await page.mouse.wheel(0, 240);
  await settle(page);
  const wide = await camera(page);
  expect(wide.zoom).toBeCloseTo(wide.minZoom, 6);
  const left = await screenOfWorld(page, iso(0, 64)), right = await screenOfWorld(page, iso(64, 0));
  const box = (await page.locator('canvas').boundingBox())!;
  expect(left.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(right.x).toBeLessThanOrEqual(box.x + box.width + 1);
  // Back to the city: the neighbourhood framing is exactly the start, and selection works.
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await settle(page);
  after = await camera(page);
  expect(Math.hypot(after.x - start.x, after.y - start.y)).toBeLessThan(1e-6);
  expect(after.zoom).toBeCloseTo(start.zoom, 9);
  await selectBuilding(page, 'office', 'Harbor Office');
  expect(errors).toEqual([]);
});

test('C/D/E: Life View frames the character; Focus finds them; Follow tracks walking, survives zoom and stops on pan', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 150_000);
  const errors = await openCity(page);
  const city = await camera(page);
  await createCharacter(page);
  // C: a close, readable Life View centred on the real character, following.
  let c = await camera(page);
  expect(c.zoom).toBeGreaterThan(1.4);
  expect(c.zoom).toBeGreaterThan(city.zoom * 2);
  expect(c.following).toBe(true);
  const saved = (await save(page)).simulation.player!;
  expect(c.subject!.x).toBeCloseTo(iso(saved.position.x, saved.position.y).x, 0);
  expect(await subjectOffset(page)).toBeLessThan(1.5);
  await expect(cameraGroup(page)).toBeVisible();
  await expect(cameraGroup(page).getByRole('button', { name: 'Life view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Life HUD' })).toBeVisible();

  // D: drag the map away (ends Follow), then Focus brings the camera back to the character at the same zoom.
  await drag(page, { x: 500, y: 450 }, -260, -180);
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await subjectOffset(page)).toBeGreaterThan(150);
  const zoomBeforeFocus = (await camera(page)).zoom;
  await cameraGroup(page).getByRole('button', { name: 'Focus on your character' }).click();
  await settle(page);
  expect(await subjectOffset(page)).toBeLessThan(1.5);
  expect((await camera(page)).zoom).toBeCloseTo(zoomBeforeFocus, 9);
  expect((await camera(page)).following).toBe(false);
  // Far away, an edge marker points at the character and brings them back.
  await drag(page, { x: 300, y: 300 }, 700, 450);
  const locator = page.getByRole('button', { name: 'Your character is off screen · show them' });
  await expect(locator).toBeVisible();
  await locator.click();
  await settle(page);
  expect(await subjectOffset(page)).toBeLessThan(1.5);
  await expect(locator).toBeHidden();

  // E: Follow on, walk along the street; the camera keeps the walker centred (within the follow lag).
  await followButton(page).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  await settle(page);
  await walkTo(page, 36, 20);
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  let samples = 0;
  for (let i = 0; i < 40 && samples < 6; i += 1) {
    await page.waitForTimeout(250);
    c = await camera(page);
    if (!c.following) break;
    expect(await subjectOffset(page)).toBeLessThan(60);
    samples += 1;
    if (samples === 3) {
      // Zooming while following stays on the character (no jump to the cursor).
      await page.mouse.move(150, 150);
      await page.mouse.wheel(0, -100);
    }
  }
  expect(samples).toBeGreaterThanOrEqual(3);
  await untilText(page, status(page), 'Free to explore', { within: 240 });
  await settle(page);
  expect(await subjectOffset(page)).toBeLessThan(1.5); // a standing character: the camera rests exactly on them
  // Follow off, then a manual pan: the camera stays where it was put (no snap-back), even as time runs.
  await followButton(page).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await drag(page, { x: 500, y: 450 }, 120, 60);
  const parked = await camera(page);
  await page.waitForTimeout(1500);
  const later = await camera(page);
  expect(later.x).toBe(parked.x);
  expect(later.y).toBe(parked.y);
  expect(later.zoom).toBe(parked.zoom);
  expect(errors).toEqual([]);
});

test('F: Build → Plan → Live → Life → City View cycles keep camera, previews and state', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 150_000);
  const errors = await openCity(page);
  await createCharacter(page);
  const lifeZoom = (await camera(page)).zoom;
  const before = await save(page);
  // City View inside Life Mode: back to the overview camera, Follow off; Life View returns to the character.
  await cameraGroup(page).getByRole('button', { name: 'City view' }).click();
  await settle(page);
  let c = await camera(page);
  expect(c.following).toBe(false);
  expect(c.zoom).toBeLessThan(lifeZoom);
  await cameraGroup(page).getByRole('button', { name: 'Life view' }).click();
  await settle(page);
  c = await camera(page);
  expect(c.following).toBe(true);
  expect(c.zoom).toBeCloseTo(lifeZoom, 6);
  expect(await subjectOffset(page)).toBeLessThan(1.5);

  for (let round = 0; round < 3; round += 1) {
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await settle(page);
    const cityPose = await camera(page);
    expect(cityPose.following).toBe(false);
    // The placement preview still lands on the hovered tile.
    await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
    const lot = await screenOf(page, 22.5, 18.5); // a 2 × 2 lot at (22, 18) touching the street
    await page.mouse.move(lot.x - 4, lot.y - 4);
    await page.mouse.move(lot.x, lot.y);
    await expect(page.getByLabel('Placement preview')).toContainText('Villa · 2 × 2 · Ready to build');
    await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await page.getByRole('button', { name: /^Live\b/ }).first().click();
    await page.getByRole('button', { name: 'Life', exact: true }).click();
    await settle(page);
    c = await camera(page);
    expect(c.following).toBe(true);
    expect(c.zoom).toBeCloseTo(lifeZoom, 6);
    expect(await subjectOffset(page)).toBeLessThan(1.5);
    // Leaving Life Mode restores exactly the City View camera it left.
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await settle(page);
    const back = await camera(page);
    expect(Math.hypot(back.x - cityPose.x, back.y - cityPose.y)).toBeLessThan(1e-6);
    expect(back.zoom).toBeCloseTo(cityPose.zoom, 9);
    await page.getByRole('button', { name: 'Life', exact: true }).click();
    await settle(page);
  }
  // No gameplay state changed: same buildings, funds, character and clock.
  const after = await save(page);
  expect(after.buildings).toEqual(before.buildings);
  expect(after.funds).toBe(before.funds);
  expect(after.simulation.player).toEqual(before.simulation.player);
  expect(after.simulation.clock.tick).toBe(before.simulation.clock.tick);
  expect(errors).toEqual([]);
});

test('G: after a walk, save and reload, Life View, Focus and Follow find the character where they were', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 150_000);
  const errors = await openCity(page);
  await createCharacter(page);
  await walkTo(page, 33, 20);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await untilText(page, status(page), 'Free to explore', { within: 240 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const saved = (await save(page)).simulation.player!;
  expect(saved.position).toEqual({ x: 33.5, y: 20.5 });
  await page.reload();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await settle(page);
  const c = await camera(page);
  expect(c.following).toBe(true);
  expect(Math.hypot(c.subject!.x - iso(33.5, 20.5).x, c.subject!.y - iso(33.5, 20.5).y)).toBeLessThan(0.01);
  expect(await subjectOffset(page)).toBeLessThan(1.5);
  await drag(page, { x: 500, y: 450 }, 200, 100);
  await cameraGroup(page).getByRole('button', { name: 'Focus on your character' }).click();
  await settle(page);
  expect(await subjectOffset(page)).toBeLessThan(1.5);
  await followButton(page).click();
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect((await save(page)).simulation.player).toEqual({ ...saved });
  expect(errors).toEqual([]);
});

test('H: Luxury Minimalist villa, duplex, townhouse, apartment, mall and office stay baked and selectable at every zoom', async ({ page }) => {
  const errors = await openCity(page);
  const targets: [string, string][] = [['villa-a', 'Lagoon Villa'], ['duplex', 'Twin Duplex'], ['town', 'Dune Townhouse'],
    ['apartment', 'Glass Apartments'], ['mall', 'Boutique Mall'], ['office', 'Harbor Office']];
  for (const steps of [-2, 0, 3]) {
    await page.getByRole('button', { name: 'Center neighborhood' }).click();
    await settle(page);
    for (let i = 0; i < Math.abs(steps); i += 1) await page.getByRole('button', { name: steps > 0 ? 'Zoom in' : 'Zoom out', exact: true }).click();
    await settle(page);
    for (const [id, name] of targets) {
      const building = fixture.buildings.find((entry) => entry.id === id)!;
      const [w, h] = FOOTPRINTS[building.kind as keyof typeof FOOTPRINTS];
      // Close up, bring each building into view with the minimap first (an instant jump).
      if (steps > 0) {
        const minimap = (await page.getByRole('button', { name: 'Navigate neighborhood overview' }).boundingBox())!;
        await page.mouse.click(minimap.x + (building.x + w / 2) / 64 * minimap.width, minimap.y + (building.y + h / 2) / 64 * minimap.height);
        await settle(page);
      }
      await selectBuilding(page, id, name);
      await expect(page.locator('.inspector [aria-label="Architecture"]')).toContainText('Luxury Minimalist');
    }
  }
  await expect.poll(async () => Object.keys((await readStats(page)).drawnModels ?? {}), { timeout: 30_000, intervals: [500] })
    .toEqual(expect.arrayContaining(['lm.villa.glass-pavilion', 'lm.duplex.twin-glass', 'lm.townhouse.urban-glass', 'lm.apartment.premium-glass', 'lm.mall.boutique-frontage', 'lm.office.architectural-concrete']));
  expect((await readStats(page)).vectorBuildings).toBe(0);
  expect(errors).toEqual([]);
});

test('I: responsive layouts: panels and resizes keep the character framed; phones get the camera controls', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300_000 : 150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openCity(page);
  await createCharacter(page);
  expect(await subjectOffset(page)).toBeLessThan(1.5);
  const wide = await camera(page);
  // Collapsing the side panel widens the visible area; Follow re-centres the character in it.
  await page.getByRole('button', { name: 'Collapse side panel' }).click();
  await expect.poll(async () => (await camera(page)).focalX, { timeout: 10_000 }).toBeGreaterThan(wide.focalX + 100);
  await settle(page);
  expect(await subjectOffset(page)).toBeLessThan(1.5);
  await page.getByRole('button', { name: 'Show side panel' }).click();
  await expect.poll(async () => (await camera(page)).focalX, { timeout: 10_000 }).toBeLessThan(wide.focalX + 2);
  for (const size of [{ width: 1280, height: 800 }, { width: 1024, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => (await camera(page)).width, { timeout: 10_000 }).toBe(size.width);
    await settle(page);
    expect(await subjectOffset(page)).toBeLessThan(1.5);
    const c = await camera(page);
    // The character is inside the canvas, away from the edges.
    expect(c.focalX).toBeGreaterThan(40); expect(c.focalX).toBeLessThan(size.width - 40);
  }
  // Phone: the character camera controls are on screen and work; no page overflow.
  await expect(cameraGroup(page)).toBeVisible();
  await drag(page, { x: 200, y: 400 }, -120, -100);
  await expect(followButton(page)).toHaveAttribute('aria-pressed', 'false');
  await cameraGroup(page).getByRole('button', { name: 'Focus on your character' }).click();
  await settle(page);
  expect(await subjectOffset(page)).toBeLessThan(1.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('J: a long session of night-to-day, zooming, mode changes, walking and save/load keeps the premium baked art', async ({ page }) => {
  test.setTimeout(process.env.CI ? 600_000 : 300_000);
  const errors = await openCity(page);
  await createCharacter(page);
  const start = await camera(page);
  const baked = async () => {
    await expect.poll(async () => (await readStats(page)).bakedBuildings ?? 0, { timeout: 30_000, intervals: [500] }).toBeGreaterThanOrEqual(fixture.buildings.length);
    const stats = await readStats(page);
    expect(stats.art).toBe('ready');
    expect(stats.vectorBuildings).toBe(0);
  };
  // The clock starts at night (00:00); run through dawn at 4× while following: the lighting changes, the art does not.
  await baked();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await untilClock(page, 5 * 60 + 40);
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await baked();
  for (let round = 0; round < 2; round += 1) {
    await page.mouse.move(400 + round * 80, 400);
    for (let i = 0; i < 20; i += 1) { await page.mouse.wheel(0, -100); await page.mouse.wheel(0, 100); }
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await page.getByRole('button', { name: /^Live\b/ }).first().click();
    await page.getByRole('button', { name: 'Life', exact: true }).click();
    await settle(page);
    await walkTo(page, round % 2 ? 31 : 36, 20);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await untilText(page, status(page), 'Free to explore', { within: 240 });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await save(page);
    await page.reload();
    await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Life', exact: true }).click();
    await settle(page);
    expect(await subjectOffset(page)).toBeLessThan(1.5);
    expect((await camera(page)).zoom).toBeCloseTo(start.zoom, 6);
    await baked();
  }
  expect(errors).toEqual([]);
});
