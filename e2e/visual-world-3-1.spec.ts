import { expect, test, type Page } from '@playwright/test';
import type { WorldState } from '@tiny-city/simulation';
import type { CityState } from '../src/types';
import { untilClock } from './support/gameTime';

/** Visual World 3.1: Architectural Style Selector, persistent designs, AI styled builds, renderer reliability. */
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const street: CityState = { size: 64, funds: 9_000, roads: Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), buildings: [] };
type Saved = CityState & { simulation: WorldState };
type Stats = { art?: string; bakedBuildings?: number; vectorBuildings?: number; drawnModels?: Record<string, number> };
test.slow();

async function openCity(page: Page, city: unknown = street) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('vw31')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('vw31', '1'); }
  }, { key: SAVE_KEY, value: city });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await expect(page.getByTestId('minimap-camera')).toHaveAttribute('points', /,/);
  return errors;
}
async function screenPoint(page: Page, x: number, y: number) {
  const bounds = (await page.locator('canvas').boundingBox())!;
  const points = (await page.getByTestId('minimap-camera').getAttribute('points'))!.split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const world = (gx: number, gy: number) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const origin = world(points[0][0], points[0][1]), right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x), target = world(x, y);
  return { x: bounds.x + (target.x - origin.x) * scale, y: bounds.y + (target.y - origin.y) * scale };
}
/** Frames the neighbourhood and waits until the camera has settled (it glides). */
async function centerCity(page: Page) {
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  let previous = '';
  await expect.poll(async () => {
    const current = (await page.getByTestId('minimap-camera').getAttribute('points')) ?? '';
    const settled = current === previous; previous = current; return settled;
  }, { intervals: [250], timeout: 10_000 }).toBe(true);
}
async function hoverTile(page: Page, x: number, y: number) {
  const point = await screenPoint(page, x + 0.5, y + 0.5);
  await page.mouse.move(point.x - 3, point.y - 3);
  await page.mouse.move(point.x, point.y);
  return point;
}
async function save(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
/** Renderer stats refresh once per completed one-second frame window (later on slow software rendering): poll them. */
const readStats = (page: Page) => page.evaluate(() => (window as unknown as { __tinyCityRenderer?: Stats }).__tinyCityRenderer ?? {});
async function expectStats(page: Page, expected: Stats) {
  await expect.poll(() => readStats(page), { timeout: 30_000, intervals: [500] }).toMatchObject(expected);
}
const collection = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Architectural collection' }).getByRole('radio', { name: new RegExp(`^${name}`) });
const model = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Building model' }).getByRole('radio', { name, exact: true });

test('Architectural Style Selector: chosen model is previewed, built exactly, and survives undo, redo and reload at catalog cost', async ({ page }) => {
  const errors = await openCity(page);
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
  await collection(page, 'Luxury Minimalist').click();
  await model(page, 'Glass Pavilion Villa').click();
  await expect(model(page, 'Glass Pavilion Villa')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('region', { name: 'Architecture' })).toContainText('SELECTED MODEL');
  await centerCity(page);
  await hoverTile(page, 12, 21);
  await expect(page.getByLabel('Placement preview')).toContainText('Villa · 2 × 2 · Ready to build · $120 · Glass Pavilion Villa');
  const point = await hoverTile(page, 12, 21);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#building-name')).toBeVisible();
  await expect(page.getByLabel('Architecture', { exact: true })).toHaveText('Luxury Minimalist · Glass Pavilion Villa');
  const built = await save(page);
  expect(built.funds).toBe(street.funds - 120);
  expect(built.buildings).toEqual([expect.objectContaining({ kind: 'villa', x: 12, y: 21, design: { collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' } })]);
  expect(built.simulation.plan.buildings[0]).toMatchObject({ footprint: { width: 2, height: 2 }, capacity: 2 });
  await expectStats(page, { art: 'ready', vectorBuildings: 0, drawnModels: { 'lm.villa.glass-pavilion': 1 } });
  // Undo removes it; redo restores the same design.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await save(page)).buildings).toEqual([]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await save(page)).buildings[0]!.design).toEqual({ collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' });
  // Reload: the exact model is drawn again.
  await page.reload();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', 'ready', { timeout: 30_000 });
  await expectStats(page, { vectorBuildings: 0, drawnModels: { 'lm.villa.glass-pavilion': 1 } });
  expect((await save(page)).buildings[0]!.design).toEqual({ collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' });
  expect(errors).toEqual([]);
});

test('a collection mix previews the exact model each new building gets; the classic default and older saves keep their look', async ({ page }) => {
  // An older save without designs: its buildings stay classic.
  const legacy: CityState = { ...street, buildings: [{ id: 'old-1', name: 'Old Villa', kind: 'villa', x: 30, y: 21, createdAt: 0 }] };
  const errors = await openCity(page, legacy);
  await expect.poll(async () => Object.keys((await readStats(page)).drawnModels ?? {}), { timeout: 30_000 }).toEqual([expect.stringMatching(/^classic:villa:v\d$/)]);
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Duplex $180', exact: true }).click();
  await collection(page, 'Luxury Minimalist').click();
  await expect(page.getByRole('radio', { name: 'Mix of Luxury Minimalist' })).toHaveAttribute('aria-checked', 'true');
  await centerCity(page);
  for (const x of [12, 16]) {
    await hoverTile(page, x, 21);
    const label = (await page.getByLabel('Placement preview').textContent())!;
    const previewed = /Semi-detached home · 3 × 2 · Ready to build · \$180 · (.+)$/.exec(label.trim())![1]!.trim();
    const point = await hoverTile(page, x, 21);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByLabel('Architecture', { exact: true })).toHaveText(`Luxury Minimalist · ${previewed}`);
    await page.getByRole('button', { name: 'Close building inspector' }).click();
    await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Duplex $180', exact: true }).click();
  }
  const saved = await save(page);
  expect(saved.buildings.find((b) => b.id === 'old-1')!.design).toBeUndefined();
  expect(saved.buildings.filter((b) => b.kind === 'duplex').every((b) => b.design?.collection === 'luxury-minimalist')).toBe(true);
  await expectStats(page, { vectorBuildings: 0, bakedBuildings: 3 });
  expect(errors).toEqual([]);
});

test('renderer stays on baked art through night and day, zoom cycles and repeated undo/redo (long session)', async ({ page }) => {
  const errors = await openCity(page);
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
  await collection(page, 'Tropical Contemporary').click();
  await expect(model(page, 'Lanai Pavilion Villa')).toHaveAttribute('aria-checked', 'true');
  await centerCity(page);
  for (const x of [12, 15, 18]) { const p = await hoverTile(page, x, 21); await page.mouse.click(p.x, p.y); }
  await page.keyboard.press('Escape');
  // Night (the clock starts at 00:00), then run to day time through the real clock.
  await expectStats(page, { art: 'ready', bakedBuildings: 3, vectorBuildings: 0, drawnModels: { 'tc.villa.lanai': 3 } });
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await untilClock(page, 9 * 60);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
  }
  await expectStats(page, { art: 'ready', bakedBuildings: 3, vectorBuildings: 0, drawnModels: { 'tc.villa.lanai': 3 } });
  expect(errors).toEqual([]);
});

test('phone: the selector works in the build sheet and the placed building is the chosen model', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openCity(page);
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await collection(page, 'Family Garden Homes').click();
  await expect(model(page, 'Garden Porch Home')).toHaveAttribute('aria-checked', 'true');
  await collection(page, 'Luxury Minimalist').click();
  const sky = model(page, 'Sky Terrace Villa');
  await sky.scrollIntoViewIfNeeded();
  await sky.click();
  await expect(sky).toHaveAttribute('aria-checked', 'true');
  // The model strip scrolls sideways instead of overflowing the sheet.
  const grid = page.getByRole('radiogroup', { name: 'Building model' });
  expect(await grid.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  // Phones have no zoom controls; the street's middle is in view beside the tool rail.
  const point = await hoverTile(page, 28, 21);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await save(page)).buildings.map((b) => b.design?.model)).toEqual(['lm.villa.sky-terrace']);
  expect(errors).toEqual([]);
});

test('AI Architect builds requested styles exactly, shows them before approval and refuses unknown models', async ({ page }) => {
  const errors = await openCity(page);
  // These requests go to the real API running the offline rules interpreter (no AI provider, no paid calls).
  await page.route('http://127.0.0.1:8012/v1/city/**', (route) => route.continue({ url: route.request().url().replace(':8012', ':8015') }));
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill('Build two Sculptural Concrete Villas near the road');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  await expect(page.getByRole('list', { name: 'Plan architecture' })).toContainText('2 × Sculptural Concrete Villa', { timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Proposed building locations' })).toContainText('Sculptural Concrete Villa');
  await page.getByRole('button', { name: 'Approve & build' }).click();
  await expect(page.getByRole('status', { name: 'City notice' })).toContainText('AI city plan applied');
  const saved = await save(page);
  expect(saved.buildings.map((b) => b.design)).toEqual(Array(2).fill({ collection: 'luxury-minimalist', model: 'lm.villa.sculptural-concrete' }));
  // Catalog prices only: two villas plus any connecting road tiles.
  expect(street.funds - saved.funds).toBe(2 * 120 + 8 * (saved.simulation.plan.roads.length - street.roads.length));
  // A style without models for that building type is refused with the reason, never replaced by another style.
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill('Xây 2 nhà phố Family Garden gần đường');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  await expect(page.locator('.architect-panel')).toContainText('Family Garden Homes has no townhouse models yet', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Approve & build' })).toHaveCount(0);
  expect((await save(page)).buildings).toHaveLength(2);
  expect(errors).toEqual([]);
});
