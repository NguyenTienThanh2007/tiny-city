import { expect, test, type Page } from '@playwright/test';
import { cameraSettled } from './support/camera';
import { untilClock, untilInGameTime, untilText } from './support/gameTime';
import type { WorldState } from '@tiny-city/simulation';
import type { CityState } from '../src/types';

const SAVE_KEY = 'tiny-city-imagine-save-v1';
// One street: three homes, a park and an office all touch it; a separate road stub is unreachable on purpose.
const fixture: CityState = { size: 64, funds: 5000, roads: [
  ...Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })),
  { x: 30, y: 30 }, { x: 31, y: 30 }, { x: 32, y: 30 },
], buildings: [
  { id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 12, y: 21, createdAt: 0 },
  { id: 'villa-b', name: 'Palm Villa', kind: 'villa', x: 15, y: 21, createdAt: 0 },
  { id: 'town', name: 'Dune Townhouse', kind: 'townhouse', x: 18, y: 21, createdAt: 0 },
  { id: 'park', name: 'Sunny Park', kind: 'park', x: 22, y: 21, createdAt: 0 },
  { id: 'office', name: 'Harbor Office', kind: 'office', x: 44, y: 21, createdAt: 0 },
] };
type Saved = CityState & { simulation: WorldState };
// Hours of game time run through the real UI; under CI software rendering these need the slow budget.
test.slow();

async function openCity(page: Page, city: unknown = fixture) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('life-fixture')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('life-fixture', '1'); }
  }, { key: SAVE_KEY, value: city });
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
/** Frames the whole city and waits for the minimap camera to settle before screen positions are computed. */
async function centerCity(page: Page) {
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await cameraSettled(page);
}
async function clickTile(page: Page, x: number, y: number) {
  const point = await screenPoint(page, x + 0.5, y + 0.5);
  await page.mouse.click(point.x, point.y);
}
async function save(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
const status = (page: Page) => page.getByRole('status', { name: 'Current activity' });
const notice = (page: Page) => page.getByRole('status', { name: 'City notice' });
const diary = (page: Page) => page.locator('.player-log');

async function createCharacter(page: Page, name: string, home: RegExp, welcome = true) {
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  const creator = page.getByRole('dialog', { name: 'Create your character' });
  await creator.getByLabel('Character name').fill(name);
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();
  await expect(page.getByRole('heading', { name: 'Choose your home' })).toBeVisible();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: home }).click();
  const confirm = page.getByRole('region', { name: 'Confirm home' });
  if (!welcome) await confirm.getByRole('checkbox').uncheck();
  await confirm.getByRole('button', { name: 'Move in & start' }).click();
  await expect(notice(page)).toContainText(`Welcome home, ${name}!`);
}

test('complete life: create, choose a home, walk, visit, meet a resident, rest, save and continue after reload', async ({ page }) => {
  // A whole game day through the real UI. Its waits are in game time, which a slow runner renders slowly; give it
  // more wall time than the file-wide slow budget so only a stalled clock (not a slow machine) fails it.
  test.setTimeout(process.env.CI ? 420_000 : 180_000);
  const errors = await openCity(page);
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Live in your city' })).toBeVisible();
  await page.getByRole('button', { name: 'Create character' }).click();
  const creator = page.getByRole('dialog', { name: 'Create your character' });
  // Validation: an empty name is explained and blocks the next step.
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();
  await expect(creator).toContainText('Use 1–24 letters');
  await creator.getByLabel('Character name').fill('Mai Nguyen');
  await creator.getByRole('radio', { name: 'Hairstyle Curly' }).check();
  await creator.getByRole('radio', { name: 'Outfit Overalls' }).check();
  await creator.getByRole('radio', { name: 'Accessory Glasses' }).check();
  await creator.getByRole('radio', { name: 'Skin tone Tan' }).check();
  await expect(creator.getByRole('img', { name: 'Preview of Mai Nguyen' })).toBeVisible();
  await creator.getByRole('button', { name: /Next: choose a home/ }).click();

  await expect(page.getByRole('heading', { name: 'Choose your home' })).toBeVisible();
  const homes = page.getByRole('list', { name: 'Homes' });
  await expect(homes.getByRole('button')).toHaveCount(3);
  await homes.getByRole('button', { name: /Lagoon Villa/ }).click();
  const confirm = page.getByRole('region', { name: 'Confirm home' });
  await expect(confirm).toContainText('Move into Lagoon Villa?');
  await expect(confirm).toContainText('0 of 2 rooms are taken');
  await confirm.getByRole('button', { name: 'Move in & start' }).click();
  await expect(notice(page)).toContainText('Welcome home, Mai Nguyen!');
  await expect(page.getByRole('region', { name: 'Life HUD' })).toContainText('Mai Nguyen');
  await expect(page.getByRole('meter', { name: 'Energy' }).first()).toHaveAttribute('aria-valuenow', /\d+/);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const created = await save(page);
  expect(created.simulation.player).toMatchObject({ id: 'player-1', name: 'Mai Nguyen', homeBuildingId: 'villa-a',
    appearance: { hairStyle: 'curly', outfit: 'overalls', accessory: 'glasses', skinTone: 3 } });
  // The player holds one of the villa's two rooms; residents filled every other slot.
  expect(created.simulation.citizens).toHaveLength(7);
  expect(created.simulation.citizens.filter((c) => c.homeBuildingId === 'villa-a')).toHaveLength(1);

  // Walk to a clicked road tile.
  await centerCity(page);
  await clickTile(page, 30, 20);
  await expect(status(page)).toContainText('Walking to the street at 30, 20');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await untilText(page, status(page), 'Free to explore', { within: 240 });
  expect((await save(page)).simulation.player!.position).toEqual({ x: 30.5, y: 20.5 });
  // Invalid and unreachable destinations explain themselves and change nothing.
  await clickTile(page, 30, 26);
  await expect(notice(page)).toContainText('You can only walk on roads and paths.');
  await clickTile(page, 31, 30);
  await expect(notice(page)).toContainText('No road connects you to that place.');

  // Evening: residents walk to the park after work.
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await untilClock(page, 17 * 60 + 25);
  await page.getByRole('button', { name: 'Speed 1x' }).click();
  await page.getByRole('button', { name: /Visit a park/ }).click();
  await expect(status(page)).toContainText('Walking to Sunny Park');
  await untilText(page, status(page), 'Enjoying Sunny Park', { within: 240 });
  const nearby = page.getByRole('list', { name: 'Nearby residents' });
  // A resident whose own park visit ends mid-greeting leaves ("they had to go") by design; greet someone else then.
  // The journey still requires one completed greeting.
  let greeted = '';
  for (let attempt = 0; attempt < 3 && !greeted; attempt += 1) {
    await untilInGameTime(page, 'a nearby resident', () => nearby.getByRole('button').count(), (count) => count > 0, { within: 180 });
    // Read the diary before the resident profile replaces the Life panel.
    const stoppedBefore = ((await diary(page).textContent()) ?? '').split('Greeting stopped').length;
    // Phase 7: residents choose their own evenings, so prefer someone whose recorded park outing still has a while to
    // run (they stay put); otherwise the nearest. The list re-sorts by live distance, so click the resident that was read.
    const live = (await save(page)).simulation;
    const park = live.plan.buildings.find((b) => b.name === 'Sunny Park')!.id;
    const staying = new Set(live.citizens.filter((c) => { const o = live.society?.residents[c.id]?.outing; return o?.venueId === park && o.status === 'present' && o.endTick - live.clock.tick > 25; }).map((c) => c.name));
    const names = await nearby.getByRole('button').evaluateAll((els) => els.map((el) => el.querySelector('span')?.firstChild?.textContent ?? ''));
    const neighbour = names.find((n) => staying.has(n)) ?? names[0] ?? '';
    expect(neighbour).not.toBe('');
    await nearby.getByRole('button', { name: new RegExp(`^${neighbour.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`) }).click();
    const profile = page.locator('.citizen-inspector');
    await expect(profile).toBeVisible();
    const residentName = (await profile.getByRole('heading').first().textContent())!;
    expect(residentName).toBe(neighbour);
    await profile.getByRole('region', { name: 'Interact' }).getByRole('button', { name: /^Greet/ }).click();
    await page.getByRole('button', { name: 'Close resident profile' }).click();
    await untilText(page, diary(page), `You met ${residentName}.`, { within: 120 });
    await untilInGameTime(page, `greeting ${residentName}`, async () => {
      const text = (await diary(page).textContent()) ?? '';
      if (text.includes(`Said hello with ${residentName}.`)) return 'greeted';
      return text.split('Greeting stopped').length > stoppedBefore ? 'left' : 'pending';
    }, (result) => result !== 'pending', { within: 120 });
    if (((await diary(page).textContent()) ?? '').includes(`Said hello with ${residentName}.`)) greeted = residentName;
  }
  expect(greeted).not.toBe('');

  // Return home and rest.
  await page.getByRole('button', { name: /^Go home/ }).click();
  await untilText(page, status(page), 'At home · Lagoon Villa', { within: 240 });
  await page.getByRole('button', { name: /^Rest/ }).click();
  await expect(status(page)).toContainText('Resting at home');
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await untilText(page, diary(page), 'Rested.', { within: 900 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  const before = await save(page);
  const player = before.simulation.player!;
  expect(player.homeBuildingId).toBe('villa-a');
  expect(player.acquaintances.length).toBeGreaterThan(0);
  expect(player.lastOutcome).toMatchObject({ kind: 'rest', result: 'completed' });
  expect(player.movement.status).toBe('inside');

  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Life', exact: true })).toHaveAttribute('title', 'Continue life as Mai Nguyen');
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mai Nguyen' })).toBeVisible();
  await expect(diary(page)).toContainText('neighbour');
  const after = await save(page);
  expect(after.simulation.player).toEqual(player);
  expect(after.simulation.clock.tick).toBe(before.simulation.clock.tick);
  expect(errors).toEqual([]);
});

test('Phase 3 saves load without a player, and full housing gets an honest fallback', async ({ page }) => {
  const errors = await openCity(page);
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await expect(notice(page)).toContainText('8 residents moved in');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const phase3 = await save(page);
  expect(phase3.simulation.player).toBeUndefined();
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  expect((await save(page)).simulation.player).toBeUndefined();
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create character' })).toBeVisible();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByRole('dialog', { name: 'Create your character' }).getByLabel('Character name').fill('Sam');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await expect(page.getByRole('region', { name: 'No free home' })).toContainText('Every home is full right now');
  await expect(page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: /Lagoon Villa/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Build a home' }).click();
  await expect(page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // The character is kept (unplaced) instead of being lost when the player leaves to build.
  expect((await save(page)).simulation.player).toMatchObject({ name: 'Sam', homeBuildingId: null, movement: { status: 'unplaced' } });
  await expect(page.getByRole('button', { name: 'Back to home selection' })).toContainText('Sam needs a home');
  expect(errors).toEqual([]);
});

test('cancelled actions, AI previews and a demolished home never corrupt Life mode', async ({ page }) => {
  const errors = await openCity(page);
  await createCharacter(page, 'Linh', /Palm Villa/, false);
  await page.getByRole('button', { name: /^Rest/ }).click();
  await expect(status(page)).toContainText('Resting at home');
  await untilInGameTime(page, 'two minutes of rest', async () => (await save(page)).simulation.player!.activity.elapsedMinutes, (elapsed) => elapsed > 2, { within: 60 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await expect(diary(page)).toContainText('Resting cancelled after');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const beforePlan = (await save(page)).simulation;

  // An AI preview leaves the player untouched; approving runs one atomic batch with reconciliation.
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill('Build two villas and one park');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  await expect(page.getByRole('button', { name: 'Approve & build' })).toBeVisible({ timeout: 30_000 });
  expect((await save(page)).simulation.player).toEqual(beforePlan.player);
  await page.getByRole('button', { name: 'Approve & build' }).click();
  await expect(notice(page)).toContainText('AI city plan applied');
  const applied = (await save(page)).simulation;
  expect(applied.revision).toBeGreaterThan(beforePlan.revision);
  expect(applied.player).toMatchObject({ homeBuildingId: 'villa-b', name: 'Linh' });

  // Demolishing the home relocates the player to the curb and asks for a new home.
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Bulldoze' }).click();
  await centerCity(page);
  const villa = await screenPoint(page, 16, 22);
  await page.mouse.click(villa.x, villa.y);
  await expect(notice(page)).toContainText('Your home was removed');
  const lost = (await save(page)).simulation;
  expect(lost.player!.homeBuildingId).toBeNull();
  expect(lost.plan.roads.some((tile) => tile.x === Math.floor(lost.player!.position.x) && tile.y === Math.floor(lost.player!.position.y))).toBe(true);
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await expect(page.locator('.life-panel')).toContainText('No home · choose one');
  await page.getByRole('button', { name: 'Choose home' }).click();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: /Dune Townhouse/ }).click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move here' }).click();
  await expect(notice(page)).toContainText('You moved into your new home.');
  expect((await save(page)).simulation.player!.homeBuildingId).toBe('town');
  // Undo restores the villa but never rewinds the player.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = (await save(page)).simulation;
  expect(undone.plan.buildings.some((b) => b.id === 'villa-b')).toBe(true);
  expect(undone.player!.homeBuildingId).toBe('town');
  expect(errors).toEqual([]);
});

test('phone layout: Life tab, full-screen creator, home sheet and compact HUD', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openCity(page);
  await createCharacter(page, 'Mai', /Lagoon Villa/);
  const hud = page.getByRole('region', { name: 'Life HUD' });
  await expect(hud).toBeVisible();
  const box = (await hud.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await hud.getByRole('button', { name: "Open Mai's profile" }).click();
  await expect(page.getByRole('heading', { name: 'Mai' })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Hunger' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Go home/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.locator('.life-panel')).toBeHidden();
  // Build mode is still one tap away with every tool.
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Road $8', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

/** The reported bug: a populated city where every room is taken. The player must recover without editing saves. */
async function fullCityRecovery(page: Page, buildAt: { x: number; y: number }) {
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const before = await save(page);
  const residents = new Map(before.simulation.citizens.map((c) => [c.id, c.homeBuildingId]));
  expect(residents.size).toBe(8);
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByRole('dialog', { name: 'Create your character' }).getByLabel('Character name').fill('Mai');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  const recovery = page.getByRole('region', { name: 'No free home' });
  await expect(recovery).toContainText('Every home is full right now');
  await expect(recovery).toContainText('8 of 8 rooms taken in 3 homes');
  await expect(page.getByRole('list', { name: 'Homes' }).getByRole('button', { disabled: false })).toHaveCount(0);
  await recovery.getByRole('button', { name: 'Build a home' }).click();
  await expect(page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (await page.getByRole('button', { name: 'Center neighborhood' }).isVisible()) await centerCity(page);
  else {
    // Phones hide the camera buttons: center the lot through the minimap, then let the camera settle.
    const minimap = (await page.getByRole('button', { name: 'Navigate neighborhood overview' }).boundingBox())!;
    await page.mouse.click(minimap.x + minimap.width * (buildAt.x + 1) / 64, minimap.y + minimap.height * (buildAt.y + 1) / 64);
    await cameraSettled(page);
  }
  await clickTile(page, buildAt.x, buildAt.y);
  await expect(notice(page)).toContainText('has a free room for Mai');
  const built = (await save(page)).simulation;
  const villa = built.plan.buildings.find((b) => !before.simulation.plan.buildings.some((old) => old.id === b.id))!;
  // No resident was moved or removed; the new villa got one resident and kept one room for the player.
  for (const [id, home] of residents) expect(built.citizens.find((c) => c.id === id)?.homeBuildingId).toBe(home);
  expect(built.citizens.filter((c) => c.homeBuildingId === villa.id)).toHaveLength(1);
  expect(built.player).toMatchObject({ name: 'Mai', movement: { status: 'unplaced' } });
  await page.getByRole('button', { name: 'Back to home selection' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your home' })).toBeVisible();
  const fresh = page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: /New/ });
  await expect(fresh).toContainText('1 of 2 rooms taken');
  await fresh.click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await expect(notice(page)).toContainText('Welcome home, Mai!');
  return { residents, villa };
}

test('housing recovery: all homes full, build a home, the held room survives residents, move in, walk and reload', async ({ page }) => {
  const errors = await openCity(page);
  const { residents, villa } = await fullCityRecovery(page, { x: 28, y: 21 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const placed = (await save(page)).simulation;
  expect(placed.player).toMatchObject({ homeBuildingId: villa.id, movement: { status: 'inside', currentBuildingId: villa.id } });
  expect(placed.citizens).toHaveLength(9);
  for (const [id, home] of residents) expect(placed.citizens.find((c) => c.id === id)?.homeBuildingId).toBe(home);
  // Play: walk along the street.
  await centerCity(page);
  await clickTile(page, 36, 20);
  await expect(status(page)).toContainText('Walking to the street at 36, 20');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await untilText(page, status(page), 'Free to explore', { within: 240 });
  // City edits keep housing consistent: another villa now fills completely with residents.
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
  await centerCity(page);
  await clickTile(page, 32, 21);
  await expect.poll(async () => (await save(page)).simulation.plan.buildings.length).toBe(placed.plan.buildings.length + 1);
  const grown = (await save(page)).simulation;
  expect(grown.citizens).toHaveLength(11);
  expect(grown.citizens.filter((c) => c.homeBuildingId === villa.id)).toHaveLength(1);
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Life', exact: true })).toHaveAttribute('title', 'Continue life as Mai');
  const reloaded = (await save(page)).simulation;
  expect(reloaded.player).toEqual(grown.player);
  expect(reloaded.citizens).toHaveLength(11);
  expect(errors).toEqual([]);
});

test('phone: full-housing recovery to a playable character', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openCity(page);
  await fullCityRecovery(page, { x: 28, y: 21 });
  await expect(page.getByRole('region', { name: 'Life HUD' })).toContainText('Mai');
  await expect(page.getByRole('button', { name: 'Back to home selection' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

