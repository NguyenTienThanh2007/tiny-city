import { expect, test, type Page } from '@playwright/test';
import type { CityState } from '../src/types';
import { BUILDING_CATALOG, CONSTRUCTION_COSTS, type BuildingType } from '../packages/simulation/src/index';

const SAVE_KEY = 'tiny-city-imagine-save-v1';
const toolNames: Record<BuildingType, string> = {
  villa: 'Villa', duplex: 'Duplex', townhouse: 'Townhouse', apartment: 'Apt',
  park: 'Park', clubhouse: 'Clubhouse', pool: 'Pool', mall: 'Mall', office: 'Office',
};
const fixture = { size: 64, funds: 5000, buildings: [],
  roads: Array.from({ length: 41 }, (_, index) => ({ x: index + 8, y: 20 })) };

async function openCity(page: Page, city: CityState = fixture) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if ((message.type() === 'warning' || message.type() === 'error') && !/GL Driver Message.*GPU stall due to ReadPixels/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, city }) => {
    if (!sessionStorage.getItem('acceptance-fixture')) {
      localStorage.setItem(key, JSON.stringify(city));
      sessionStorage.setItem('acceptance-fixture', '1');
    }
  }, { key: SAVE_KEY, city });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('minimap-camera')).toHaveAttribute('points', /,/);
  return errors;
}

// Derive screen coordinates from the public minimap footprint after any zoom, pan or resize.
async function screenPoint(page: Page, x: number, y: number, lift = 0) {
  const bounds = (await page.locator('canvas').boundingBox())!;
  const points = (await page.getByTestId('minimap-camera').getAttribute('points'))!
    .split(' ').map((pair) => pair.split(',').map((value) => Number(value) * 64 / 100));
  const world = (gx: number, gy: number) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const origin = world(points[0][0], points[0][1]);
  const right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x);
  const target = world(x, y);
  return { x: bounds.x + (target.x - origin.x) * scale, y: bounds.y + (target.y - lift - origin.y) * scale };
}
async function hoverTile(page: Page, x: number, y: number) {
  const point = await screenPoint(page, x + 0.5, y + 0.5);
  await page.mouse.move(point.x, point.y);
  return point;
}
async function clickTile(page: Page, x: number, y: number) {
  const point = await hoverTile(page, x, y);
  await page.mouse.click(point.x, point.y);
}
async function choose(page: Page, type: BuildingType | 'select' | 'road' | 'move' | 'bulldoze') {
  const name = type in toolNames ? `${toolNames[type as BuildingType]} $${CONSTRUCTION_COSTS[type as BuildingType]}` :
    type === 'road' ? 'Road $8' : type[0].toUpperCase() + type.slice(1);
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name, exact: true }).click();
}
async function saveData(page: Page) {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
async function selectRoof(page: Page, kind: BuildingType, x: number, y: number) {
  await choose(page, 'select');
  const spec = BUILDING_CATALOG[kind];
  const lift = { villa: 30, duplex: 40, townhouse: 45, apartment: 87, park: 5, clubhouse: 40, pool: 5, mall: 39, office: 101 }[kind];
  const point = await screenPoint(page, x + spec.footprint.width / 2, y + spec.footprint.height / 2, lift);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.building-details')).toBeVisible();
}

for (const kind of Object.keys(toolNames) as BuildingType[]) {
  test(`${kind}: real pointer preview, build, roof selection, move, history, demolish and persistence`, async ({ page }) => {
    const errors = await openCity(page);
    const spec = BUILDING_CATALOG[kind];
    await choose(page, kind);
    await expect(page.getByRole('button', { name: `${toolNames[kind]} $${spec.cost}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await hoverTile(page, 10, 20);
    await expect(page.getByLabel('Placement preview')).toContainText('overlaps');
    await clickTile(page, 10, 20);
    await expect(page.getByRole('status', { name: 'City notice' })).toContainText('overlaps');
    expect((await saveData(page)).funds).toBe(5000);
    await page.mouse.move(1100, 50);
    const empty = await page.locator('canvas').screenshot();
    await hoverTile(page, 12, 21);
    await expect(page.getByLabel('Placement preview')).toContainText(`${spec.footprint.width} × ${spec.footprint.height} · Ready to build`);
    expect((await page.locator('canvas').screenshot()).equals(empty)).toBe(false);
    await clickTile(page, 12, 21);
    await expect(page.getByLabel('Latest simulation event')).toContainText('city.building-built');
    await expect(page.locator('.building-details')).toContainText(`${spec.capacity} places`);
    await expect(page.locator('.building-details')).toContainText(`${spec.footprint.width} × ${spec.footprint.height} tiles`);
    await page.mouse.move(1100, 50);
    const duringConstruction = await page.locator('canvas').screenshot();
    await expect(page.locator('.condition')).toHaveText(/Ready/, { timeout: 8000 });
    await expect.poll(async () => (await page.locator('canvas').screenshot()).equals(duringConstruction)).toBe(false);
    await page.mouse.move(1100, 50);
    expect((await page.locator('canvas').screenshot()).equals(empty)).toBe(false);
    await selectRoof(page, kind, 12, 21);
    await page.locator('.inspector').getByRole('button', { name: 'Move', exact: true }).click();
    await clickTile(page, 10, 20);
    await expect(page.getByRole('status', { name: 'City notice' })).toContainText('overlaps');
    await clickTile(page, 24, 21);
    await expect(page.getByLabel('Latest simulation event')).toContainText('city.building-moved');
    await expect(page.locator('.building-details')).toContainText('24, 21');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await selectRoof(page, kind, 12, 21);
    await expect(page.locator('.building-details')).toContainText('12, 21');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    const saved = await saveData(page);
    expect(saved.buildings[0]).toMatchObject({ id: 'building-1', kind, x: 24, y: 21 });
    expect(saved.simulation.budget).toEqual({ openingBalance: 5000, balance: 5000 - spec.cost, totalSpent: spec.cost });
    await page.reload();
    await expect(page.getByTestId('minimap-building-building-1')).toBeVisible();
    await selectRoof(page, kind, 24, 21);
    await choose(page, 'bulldoze');
    const roof = await screenPoint(page, 24 + spec.footprint.width / 2, 21 + spec.footprint.height / 2, 5);
    await page.mouse.click(roof.x, roof.y);
    await expect(page.getByTestId('minimap-building-building-1')).toHaveCount(0);
    await expect(page.getByLabel('Latest simulation event')).toContainText('city.building-demolished');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByTestId('minimap-building-building-1')).toBeVisible();
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    const demolished = await saveData(page);
    expect(demolished.buildings).toEqual([]);
    expect(demolished.funds).toBe(5000 - spec.cost);
    await page.reload();
    await expect(page.getByTestId('minimap-building-building-1')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('road drag fills skipped tiles; one undo restores the whole gesture and budget', async ({ page }) => {
  await openCity(page);
  await choose(page, 'road');
  const from = await hoverTile(page, 12, 21);
  const to = await screenPoint(page, 12.5, 27.5);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  const saved = await saveData(page);
  for (let y = 21; y <= 27; y++) expect(saved.roads).toContainEqual({ x: 12, y });
  expect(saved.funds).toBe(5000 - 7 * 8);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saveData(page)).roads).toEqual(fixture.roads);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await saveData(page)).roads).toEqual(saved.roads);
  expect(from.x).toBeGreaterThan(0);
});

test('zoom and pan preserve pointer coordinates; minimap navigation and home recover the neighborhood', async ({ page }) => {
  await openCity(page);
  const original = await page.getByTestId('minimap-camera').getAttribute('points');
  await hoverTile(page, 12, 21);
  await page.mouse.wheel(0, -300);
  await expect(page.getByTestId('minimap-camera')).not.toHaveAttribute('points', original!);
  const from = await screenPoint(page, 16, 23);
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const beforeResize = await page.getByTestId('minimap-camera').getAttribute('points');
  await page.setViewportSize({ width: 1100, height: 740 });
  await expect(page.getByTestId('minimap-camera')).not.toHaveAttribute('points', beforeResize!);
  await choose(page, 'park');
  await clickTile(page, 30, 23);
  await expect(page.locator('.building-details')).toContainText('30, 23');
  const beforeMinimap = await page.getByTestId('minimap-camera').getAttribute('points');
  await page.getByRole('button', { name: 'Navigate neighborhood overview' }).click();
  await expect(page.getByTestId('minimap-camera')).not.toHaveAttribute('points', beforeMinimap!);
  const beforeHome = await page.getByTestId('minimap-camera').getAttribute('points');
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await expect(page.getByTestId('minimap-camera')).not.toHaveAttribute('points', beforeHome!);
  await selectRoof(page, 'park', 30, 23);
  await expect(page.locator('.building-details')).toContainText('30, 23');
});

test('preview refreshes without mouse motion when the keyboard tool changes and clears on exit', async ({ page }) => {
  await openCity(page);
  await hoverTile(page, 12, 21);
  await page.keyboard.press('1');
  await expect(page.getByLabel('Placement preview')).toContainText('Villa · 2 × 2');
  await page.keyboard.press('8');
  await expect(page.getByLabel('Placement preview')).toContainText('Shopping mall · 6 × 5');
  await page.mouse.move(1100, 50);
  await expect(page.getByLabel('Placement preview')).toHaveCount(0);
});

test('small viewport keeps all tools, selection and inspector actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCity(page);
  await choose(page, 'park');
  const beforeSmallNavigation = await page.getByTestId('minimap-camera').getAttribute('points');
  await page.getByRole('button', { name: 'Navigate neighborhood overview' }).click();
  await expect(page.getByTestId('minimap-camera')).not.toHaveAttribute('points', beforeSmallNavigation!);
  // Center map's unoccupied middle area, so a full park fits behind the compact HUD.
  await clickTile(page, 31, 31);
  await expect(page.locator('.building-details')).toContainText('4 × 4 tiles');
  await page.getByRole('button', { name: 'Close building inspector' }).click();
  await expect(page.locator('.building-details')).toHaveCount(0);
  await choose(page, 'office');
  await expect(page.getByRole('button', { name: 'Office $640' })).toHaveAttribute('aria-pressed', 'true');
  await choose(page, 'bulldoze');
  await expect(page.getByRole('button', { name: 'Bulldoze' })).toHaveAttribute('aria-pressed', 'true');
});


test('missing roads, insufficient funds, water and map boundaries produce explicit feedback without state changes', async ({ page }) => {
  await openCity(page, { ...fixture, funds: 8 });
  await choose(page, 'villa');
  await clickTile(page, 12, 25);
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('touch a road');
  await clickTile(page, 12, 21);
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('Not enough funds');
  await choose(page, 'road');
  await clickTile(page, 12, 21);
  expect((await saveData(page)).funds).toBe(0);
  await choose(page, 'park');
  const minimap = (await page.getByRole('button', { name: 'Navigate neighborhood overview' }).boundingBox())!;
  const beforeCoastNavigation = await page.getByTestId('minimap-camera').getAttribute('points');
  await page.mouse.click(minimap.x + minimap.width * 61 / 64, minimap.y + minimap.height * 61 / 64);
  await expect(page.getByTestId('minimap-camera')).not.toHaveAttribute('points', beforeCoastNavigation!);
  await clickTile(page, 60, 60);
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('Water tiles');
  await clickTile(page, 62, 62);
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('entire footprint');
  const saved = await saveData(page);
  expect(saved.buildings).toEqual([]);
  expect(saved.simulation.nextBuildingId).toBe(1);
  expect(saved.simulation.budget.totalSpent).toBe(8);
});

test('initial camera finds buildings saved far from the sample; leaving a drag stops road painting', async ({ page }) => {
  await openCity(page, { ...fixture, roads: [], buildings: [
    { id: 'remote', name: 'Remote Park', kind: 'park', x: 50, y: 50, createdAt: 0 },
  ] });
  await selectRoof(page, 'park', 50, 50);
  await expect(page.getByRole('heading', { name: 'Remote Park' })).toBeVisible();
  await choose(page, 'road');
  await hoverTile(page, 49, 50);
  await page.mouse.down();
  await page.mouse.move(1100, 50);
  await page.mouse.up();
  await hoverTile(page, 49, 52);
  const saved = await saveData(page);
  expect(saved.roads).toEqual([{ x: 49, y: 50 }]);
});

test.describe('retina pointer mapping', () => {
  test.use({ deviceScaleFactor: 2 });
  test('high-DPI canvas places the same footprint at the clicked grid coordinates', async ({ page }) => {
    const errors = await openCity(page);
    await choose(page, 'villa');
    await clickTile(page, 12, 21);
    await expect(page.locator('.building-details')).toContainText('12, 21');
    const saved = await saveData(page);
    expect(saved.buildings[0]).toMatchObject({ x: 12, y: 21, kind: 'villa' });
    expect(saved.funds).toBe(4880);
    expect(errors).toEqual([]);
  });
});
