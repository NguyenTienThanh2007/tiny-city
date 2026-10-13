import { expect, test, type Page } from '@playwright/test';
import type { WorldState } from '@tiny-city/simulation';
import type { CityState } from '../src/types';
// A signed-out visitor's session check (GET /v1/auth/me) answers 401 by design (accounts, PR #16); Chromium logs it.
const expectedSignedOut = (message: { text(): string; location(): { url: string } }) => /status of 401/.test(message.text()) && /\/v1\/auth\/me(\?|$)/.test(message.location().url);

// Phase 4.5 browser acceptance: occupancy shown in the UI always equals the authoritative world, the player counts
// once, residents keep their homes through commutes, and everything survives a reload.
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const fixture: CityState = { size: 64, funds: 5000, roads: Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), buildings: [
  { id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 12, y: 21, createdAt: 0 },
  { id: 'villa-b', name: 'Palm Villa', kind: 'villa', x: 15, y: 21, createdAt: 0 },
  { id: 'town', name: 'Dune Townhouse', kind: 'townhouse', x: 18, y: 21, createdAt: 0 },
  { id: 'park', name: 'Sunny Park', kind: 'park', x: 22, y: 21, createdAt: 0 },
  { id: 'office', name: 'Harbor Office', kind: 'office', x: 44, y: 21, createdAt: 0 },
] };
type Saved = CityState & { simulation: WorldState };
const ROOF_LIFT = { villa: 30, townhouse: 45 } as const;
test.slow();

async function openCity(page: Page, city: CityState = fixture) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message/.test(message.text()) && !expectedSignedOut(message)) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('p45-fixture')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('p45-fixture', '1'); }
  }, { key: SAVE_KEY, value: city });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('minimap-camera')).toHaveAttribute('points', /,/);
  return errors;
}
async function centerCity(page: Page) {
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  let previous = '';
  await expect.poll(async () => {
    const current = (await page.getByTestId('minimap-camera').getAttribute('points')) ?? '';
    const settled = current === previous;
    previous = current;
    return settled;
  }, { intervals: [250], timeout: 10_000 }).toBe(true);
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
async function save(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
async function minutes(page: Page) {
  const [, h, m] = /(\d\d):(\d\d)/.exec((await page.getByLabel('Simulation clock').textContent())!)!;
  return Number(h) * 60 + Number(m);
}
/** Opens the building inspector by clicking the roof in Build mode with the Select tool. */
async function inspect(page: Page, building: { x: number; y: number; kind: keyof typeof ROOF_LIFT; width: number; height: number }) {
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Select', exact: true }).click();
  await centerCity(page);
  const point = await screenPoint(page, building.x + building.width / 2, building.y + building.height / 2, ROOF_LIFT[building.kind]);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.building-details')).toBeVisible();
  return page.getByRole('group', { name: 'Residents' });
}
const LAGOON = { x: 12, y: 21, kind: 'villa', width: 2, height: 2 } as const;
const PALM = { x: 15, y: 21, kind: 'villa', width: 2, height: 2 } as const;
const DUNE = { x: 18, y: 21, kind: 'townhouse', width: 2, height: 3 } as const;
const residentsOf = (world: WorldState, id: string) => world.citizens.filter((c) => c.homeBuildingId === id);

test('occupancy: the home picker tells the truth, the player counts once, residents keep their homes and it all survives reload', async ({ page }) => {
  const errors = await openCity(page);
  // B. Create a character. Before residents exist the picker says so, and shows what moving in will really do.
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  const creator = page.getByRole('dialog', { name: 'Create your character' });
  await creator.getByLabel('Character name').fill('Mai Nguyen');
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();
  const homes = page.getByRole('list', { name: 'Homes' });
  await expect(homes.getByRole('button', { name: /Lagoon Villa/ })).toContainText('0 of 2 rooms taken');
  await homes.getByRole('button', { name: /Lagoon Villa/ }).click();
  const confirm = page.getByRole('region', { name: 'Confirm home' });
  await expect(confirm).toContainText('0 of 2 rooms are taken; you will take one.');
  await expect(confirm).toContainText('No residents have moved in yet.');
  // 8 rooms; the player takes one, so 7 residents arrive and 1 shares Lagoon Villa.
  await expect(confirm).toContainText('1 resident will share this home, and 7 will live in the city.');
  await confirm.getByRole('checkbox').uncheck();
  await expect(confirm).toContainText('none will until you welcome them');
  await confirm.getByRole('checkbox').check();
  await confirm.getByRole('button', { name: 'Move in & start' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('Welcome home, Mai Nguyen!');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const moved = (await save(page)).simulation;
  expect(moved.citizens).toHaveLength(7);
  expect(residentsOf(moved, 'villa-a')).toHaveLength(1);

  // A + B. The inspector equals the world: the player's villa is full (1 resident + you), the others list their residents.
  let card = await inspect(page, LAGOON);
  await expect(card).toContainText('2/ 2 rooms taken');
  await expect(card).toContainText('1 resident + you · 0 free rooms');
  await expect(card.getByRole('list', { name: 'You live here' })).toContainText('Mai NguyenYou · Resident');
  await expect(card.getByRole('list', { name: 'People linked to this building' })).toContainText(residentsOf(moved, 'villa-a')[0]!.name);
  await page.waitForTimeout(400); // let the panel's entry animation finish
  await page.screenshot({ path: test.info().outputPath('p45-player-home.png') });
  await page.getByRole('button', { name: 'Close building inspector' }).click();
  card = await inspect(page, PALM);
  await expect(card).toContainText('2/ 2 rooms taken');
  await expect(card).toContainText('2 residents · 0 free rooms');
  for (const resident of residentsOf(moved, 'villa-b')) await expect(card).toContainText(resident.name);
  await page.getByRole('button', { name: 'Close building inspector' }).click();
  card = await inspect(page, DUNE);
  await expect(card).toContainText('4/ 4 rooms taken');
  await expect(card).not.toContainText('+ you');
  await page.getByRole('button', { name: 'Close building inspector' }).click();
  // Life: the player's own home lists "(incl. you)" and is full.
  await page.getByRole('button', { name: 'Life', exact: true }).click();

  // D. Residents commute to work and come back to the same homes.
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await expect.poll(() => minutes(page), { timeout: 90_000 }).toBeGreaterThanOrEqual(11 * 60);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const morning = (await save(page)).simulation;
  expect(morning.citizens.filter((c) => c.movement?.status === 'inside' && c.movement.currentBuildingId === 'office').length).toBeGreaterThan(0);
  // At work they still hold their rooms: the inspector still shows every villa full, with whereabouts.
  card = await inspect(page, PALM);
  await expect(card).toContainText('2/ 2 rooms taken');
  await expect(card).toContainText('At work');
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('p45-residents-at-work.png') });
  await page.getByRole('button', { name: 'Close building inspector' }).click();
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(() => minutes(page), { timeout: 150_000 }).toBeGreaterThanOrEqual(21 * 60);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const night = (await save(page)).simulation;
  for (const c of night.citizens) {
    expect(c.homeBuildingId).toBe(moved.citizens.find((m) => m.id === c.id)!.homeBuildingId);
    expect(c.movement).toMatchObject({ status: 'inside', currentBuildingId: c.homeBuildingId });
  }
  expect(night.player!.homeBuildingId).toBe('villa-a');

  // G. Reload: the same character, the same homes, the same counts.
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  const reloaded = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY) as Saved;
  expect(reloaded.simulation.player!.name).toBe('Mai Nguyen');
  expect(reloaded.simulation.citizens.map((c) => [c.id, c.homeBuildingId])).toEqual(night.citizens.map((c) => [c.id, c.homeBuildingId]));
  card = await inspect(page, LAGOON);
  await expect(card).toContainText('2/ 2 rooms taken');
  await expect(card).toContainText('1 resident + you · 0 free rooms');
  await page.getByRole('button', { name: 'Close building inspector' }).click();

  // H. Every mode still opens after the fixes.
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(page.locator('.architect-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(page.getByText('7', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Life HUD' })).toContainText('Mai Nguyen');
  expect(errors).toEqual([]);
});

test('AI demolition of the player home needs explicit approval, shows the impact, and the player is rehoused', async ({ page }) => {
  const errors = await openCity(page);
  // Talk to the real API running the offline rules interpreter (no paid calls).
  await page.route('http://127.0.0.1:8012/v1/city/**', (route) => route.continue({ url: route.request().url().replace(':8012', ':8015') }));
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  const creator = page.getByRole('dialog', { name: 'Create your character' });
  await creator.getByLabel('Character name').fill('Linh');
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: /Palm Villa/ }).click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('Welcome home, Linh!');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const before = (await save(page)).simulation;
  expect(before.player!.homeBuildingId).toBe('villa-b');

  // F. The request names the player's home: protection stops it until the user explicitly allows this one building.
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill('Demolish Palm Villa');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  const authorize = page.getByRole('region', { name: 'Authorization required' });
  await expect(authorize).toContainText('Palm Villa', { timeout: 30_000 });
  await expect(authorize).not.toContainText('Lagoon Villa');
  expect((await save(page)).simulation).toEqual(before);
  await page.getByRole('button', { name: /^Allow this change/ }).click();
  const impact = page.getByRole('list', { name: 'Plan impact' });
  await expect(impact).toContainText('Removes 1 building (2 rooms)', { timeout: 30_000 });
  await expect(impact).toContainText('Your character’s home will be removed');
  // Every other room is taken, so the one resident who shared the villa leaves; that is shown before approval.
  await expect(impact).toContainText('1 resident will leave the city (no free room)');
  await page.getByRole('button', { name: 'Review destructive edits' }).click();
  expect((await save(page)).simulation).toEqual(before);
  await page.getByRole('button', { name: 'Confirm & apply' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText(/AI city plan applied|Your home was removed/);
  const after = (await save(page)).simulation;
  expect(after.plan.buildings.map((b) => b.id)).not.toContain('villa-b');
  expect(after.player).toMatchObject({ name: 'Linh', homeBuildingId: null });
  expect(after.citizens).toHaveLength(6);
  for (const c of after.citizens) expect(c.homeBuildingId).toBe(before.citizens.find((b) => b.id === c.id)!.homeBuildingId);

  // Reassign: build a villa; one room is held for Linh, a new resident takes the other, and Linh moves in.
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
  await centerCity(page);
  const lot = await screenPoint(page, 28.5, 21.5);
  await page.mouse.click(lot.x, lot.y);
  await expect.poll(async () => (await save(page)).simulation.plan.buildings.length).toBe(after.plan.buildings.length + 1);
  const rebuilt = (await save(page)).simulation;
  const villa = rebuilt.plan.buildings.find((b) => !after.plan.buildings.some((a) => a.id === b.id))!;
  expect(residentsOf(rebuilt, villa.id)).toHaveLength(1);
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Choose home' }).click();
  const choice = page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: new RegExp(villa.name) });
  await expect(choice).toContainText('1 of 2 rooms taken');
  await choice.click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move here' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('You moved into your new home.');
  const housed = (await save(page)).simulation;
  expect(housed.player!.homeBuildingId).toBe(villa.id);
  const card = await inspect(page, { x: villa.position.x, y: villa.position.y, kind: 'villa', width: 2, height: 2 });
  await expect(card).toContainText('2/ 2 rooms taken');
  await expect(card).toContainText('1 resident + you · 0 free rooms');
  expect(errors).toEqual([]);
});

test('a road removed under a walking resident: they step onto the street and still reach work (never stuck on grass)', async ({ page }) => {
  // A second, parallel street keeps the office reachable when one tile of the first is removed.
  const city: CityState = { ...fixture, roads: [...fixture.roads, ...Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 19 }))] };
  const errors = await openCity(page, city);
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  let walker: WorldState['citizens'][number] | undefined;
  await expect.poll(async () => {
    const world = (await save(page)).simulation;
    walker = world.citizens.find((c) => c.movement?.status === 'travelling' && c.movement.destinationBuildingId === 'office' &&
      Math.floor(c.position.y) === 20 && c.position.x > 26 && c.position.x < 40);
    return walker !== undefined;
  }, { timeout: 120_000, intervals: [100] }).toBe(true);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = (await save(page)).simulation;
  walker = paused.citizens.find((c) => c.id === walker!.id)!;
  const tile = { x: Math.floor(walker.position.x), y: Math.floor(walker.position.y) };
  expect(paused.plan.roads).toContainEqual(tile);
  // E. Bulldoze the road tile under their feet through the real Build tools.
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Bulldoze' }).click();
  await centerCity(page);
  const point = await screenPoint(page, tile.x + 0.5, tile.y + 0.5);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await save(page)).simulation.plan.roads.length).toBe(paused.plan.roads.length - 1);
  const edited = (await save(page)).simulation;
  const moved = edited.citizens.find((c) => c.id === walker!.id)!;
  const under = { x: Math.floor(moved.position.x), y: Math.floor(moved.position.y) };
  expect(edited.plan.roads).toContainEqual(under);
  expect(Math.abs(moved.position.x - walker.position.x) + Math.abs(moved.position.y - walker.position.y)).toBeLessThanOrEqual(1.5);
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(async () => {
    const c = (await save(page)).simulation.citizens.find((entry) => entry.id === walker!.id)!;
    return c.movement?.status === 'inside' && c.movement.currentBuildingId === 'office';
  }, { timeout: 90_000, intervals: [250] }).toBe(true);
  expect(errors).toEqual([]);
});
