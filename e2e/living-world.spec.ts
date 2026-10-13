import { expect, test, type Page } from '@playwright/test';
import type { Citizen, WorldState } from '@tiny-city/simulation';
import type { CityState } from '../src/types';
// A signed-out visitor's session check (GET /v1/auth/me) answers 401 by design (accounts, PR #16); Chromium logs it.
const expectedSignedOut = (message: { text(): string; location(): { url: string } }) => /status of 401/.test(message.text()) && /\/v1\/auth\/me(\?|$)/.test(message.location().url);

const SAVE_KEY = 'tiny-city-imagine-save-v1';
// Homes and an office share one street, so morning commutes are visible on the road.
const fixture: CityState = { size: 64, funds: 5000, roads: Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), buildings: [
  { id: 'home-a', name: 'Lagoon Villa', kind: 'villa', x: 12, y: 21, createdAt: 0 },
  { id: 'home-b', name: 'Palm Villa', kind: 'villa', x: 15, y: 21, createdAt: 0 },
  { id: 'home-c', name: 'Dune Townhouse', kind: 'townhouse', x: 18, y: 21, createdAt: 0 },
  { id: 'office', name: 'Harbor Office', kind: 'office', x: 44, y: 21, createdAt: 0 },
] };
// These specs run hours of game time through the real UI; under CI software rendering they need the slow budget.
test.slow();
type Renderer = { fps: number; frameMs: number; residents: number; visibleResidents: number };

async function openCity(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message/.test(message.text()) && !expectedSignedOut(message)) errors.push(message.text()); });
  await page.addInitScript(({ key, city }) => {
    if (!sessionStorage.getItem('living-fixture')) { localStorage.setItem(key, JSON.stringify(city)); sessionStorage.setItem('living-fixture', '1'); }
  }, { key: SAVE_KEY, city: fixture });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('minimap-camera')).toHaveAttribute('points', /,/);
  return errors;
}
async function screenPoint(page: Page, x: number, y: number, lift = 0) {
  const bounds = (await page.locator('canvas').boundingBox())!;
  const points = (await page.getByTestId('minimap-camera').getAttribute('points'))!
    .split(' ').map((pair) => pair.split(',').map((value) => Number(value) * 64 / 100));
  const world = (gx: number, gy: number) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const origin = world(points[0][0], points[0][1]);
  const right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x);
  const target = world(x, y);
  return { x: bounds.x + (target.x - origin.x) * scale, y: bounds.y + (target.y - origin.y) * scale - lift * scale };
}
async function minutes(page: Page) {
  const [, h, m] = /(\d\d):(\d\d)/.exec((await page.getByLabel('Simulation clock').textContent())!)!;
  return Number(h) * 60 + Number(m);
}
async function save(page: Page): Promise<CityState & { simulation: WorldState }> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
const renderer = (page: Page) => page.evaluate(() => (window as unknown as { __tinyCityRenderer?: Renderer }).__tinyCityRenderer ?? null);
const outdoors = (citizen: Citizen) => citizen.movement?.status === 'travelling' && citizen.movement.currentBuildingId === null;

async function welcomeAndCommute(page: Page) {
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bring the city to life' })).toBeVisible();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('8 residents moved in');
  await expect(page.getByRole('heading', { name: '8 residents' })).toBeVisible();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await expect.poll(() => minutes(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(6 * 60 + 50);
  await expect.poll(async () => (await renderer(page))?.visibleResidents ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  // Real-time speed keeps the long commute on screen for the rest of the test.
  await page.getByRole('button', { name: 'Speed 1x' }).click();
}

test('residents walk the roads, can be clicked on the map, inspected, followed and restored after reload', async ({ page }) => {
  const errors = await openCity(page);
  const before = await save(page);
  expect(before.simulation.population).toBeUndefined();
  await welcomeAndCommute(page);
  // Movement is visible frame-to-frame while time runs.
  await page.mouse.move(640, 40);
  const first = await page.locator('canvas').screenshot();
  await page.waitForTimeout(700);
  expect((await page.locator('canvas').screenshot()).equals(first)).toBe(false);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(500);
  const paused = await save(page);
  expect(paused.simulation.population).toMatchObject({ version: 1 });
  expect(paused.simulation.citizens).toHaveLength(8);
  const walkers = paused.simulation.citizens.filter(outdoors);
  expect(walkers.length).toBeGreaterThan(0);
  const loneliest = [...walkers].sort((a, b) => {
    const gap = (c: Citizen) => Math.min(...paused.simulation.citizens.filter((other) => other.id !== c.id && outdoors(other))
      .map((other) => Math.abs(other.position.x - c.position.x) + Math.abs(other.position.y - c.position.y)), 99);
    return gap(b) - gap(a);
  })[0]!;
  // Paused residents settle on their authoritative position; click their body, above the feet.
  const point = await screenPoint(page, loneliest.position.x, loneliest.position.y, 8);
  await page.mouse.click(point.x, point.y);
  const profile = page.locator('.citizen-inspector');
  await expect(profile).toBeVisible();
  const names = new Map(walkers.map((citizen) => [citizen.name, citizen]));
  const shownName = (await profile.getByRole('heading').textContent())!;
  expect(names.has(shownName)).toBe(true);
  const shown = names.get(shownName)!;
  const home = fixture.buildings.find((building) => building.id === shown.homeBuildingId)!;
  await expect(profile.locator('.fact-list')).toContainText(home.name);
  await expect(profile.locator('.fact-list')).toContainText('Harbor Office');
  await expect(profile).toContainText('DAILY ROUTINE');
  await expect(profile.locator('.schedule-list li[aria-current="step"]')).toHaveCount(1);

  await profile.getByRole('button', { name: 'Follow', exact: true }).click();
  await expect(profile.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
  const camera = await page.getByTestId('minimap-camera').getAttribute('points');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(() => page.getByTestId('minimap-camera').getAttribute('points'), { timeout: 15_000 }).not.toBe(camera);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  const saved = await save(page);
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(page.getByRole('heading', { name: '8 residents' })).toBeVisible();
  const restored = await save(page);
  expect(restored.simulation.citizens).toEqual(saved.simulation.citizens);
  expect(restored.simulation.clock.tick).toBe(saved.simulation.clock.tick);
  expect(errors).toEqual([]);
});

test('residents recover when a road under their commute is removed and restored', async ({ page }) => {
  const errors = await openCity(page);
  await welcomeAndCommute(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Bulldoze', exact: true }).click();
  const cut = await screenPoint(page, 30.5, 20.5);
  await page.mouse.click(cut.x, cut.y);
  await expect(page.getByLabel('Latest simulation event')).toContainText(/city\.|citizen\./);
  const severed = await save(page);
  expect(severed.simulation.plan.roads).not.toContainEqual({ x: 30, y: 20 });
  const ids = new Set(severed.simulation.plan.buildings.map((building) => building.id));
  for (const citizen of severed.simulation.citizens) {
    expect(ids.has(citizen.homeBuildingId)).toBe(true);
    expect(citizen.movement?.route.length ?? 0).toBe(0);
  }
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('.life-feed')).toContainText(/linked to Harbor Office|can't find a road to Harbor Office/);
  const waiting = await save(page);
  expect(waiting.simulation.citizens.some((citizen) => citizen.activity === 'work')).toBe(false);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(async () => (await save(page)).simulation.citizens.filter((citizen) => citizen.activity === 'work').length, { timeout: 45_000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('phone layout: live sheet, resident list selection and profile close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openCity(page);
  await welcomeAndCommute(page);
  const walker = page.locator('.walker').first();
  await expect(walker).toBeVisible({ timeout: 20_000 });
  const name = (await walker.textContent())!.trim();
  await walker.click();
  await expect(page.locator('.citizen-inspector')).toBeVisible();
  await expect(page.locator('.citizen-inspector').getByRole('heading')).toHaveText(name);
  await page.getByRole('button', { name: 'Close resident profile' }).click();
  await expect(page.locator('.citizen-inspector')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Road $8', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
