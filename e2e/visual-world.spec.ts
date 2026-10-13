import { expect, test, type Page } from '@playwright/test';
import type { CityState } from '../src/types';

const SAVE_KEY = 'tiny-city-imagine-save-v1';
const fixture: CityState = { size: 64, funds: 5000, roads: Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), buildings: [
  { id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 12, y: 21, createdAt: 0 },
  { id: 'villa-b', name: 'Palm Villa', kind: 'villa', x: 15, y: 21, createdAt: 0 },
  { id: 'office', name: 'Harbor Office', kind: 'office', x: 24, y: 21, createdAt: 0 },
] };

async function openCity(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ key, city }) => {
    if (!sessionStorage.getItem('visual-fixture')) { localStorage.setItem(key, JSON.stringify(city)); sessionStorage.setItem('visual-fixture', '1'); }
  }, { key: SAVE_KEY, city: fixture });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('minimap-camera')).toHaveAttribute('points', /,/);
  return errors;
}
async function hoverTile(page: Page, x: number, y: number) {
  const bounds = (await page.locator('canvas').boundingBox())!;
  const points = (await page.getByTestId('minimap-camera').getAttribute('points'))!.split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const world = (gx: number, gy: number) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const origin = world(points[0][0], points[0][1]), right = world(points[1][0], points[1][1]);
  const scale = bounds.width / (right.x - origin.x), target = world(x + 0.5, y + 0.5);
  await page.mouse.move(bounds.x + (target.x - origin.x) * scale, bounds.y + (target.y - origin.y) * scale);
}

test('planner outage: clear diagnosis, prompt preserved, retry, then recovery without touching the city', async ({ page }) => {
  const errors = await openCity(page);
  let outage = true;
  await page.route('**/v1/city/status', (route) => outage ? route.abort('connectionrefused') : route.continue());
  await page.route('**/v1/city/plan', (route) => outage ? route.abort('connectionrefused') : route.continue());
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Planner connection' })).toContainText('Planner unreachable');
  const prompt = page.getByRole('textbox', { name: 'Describe a city change' });
  await prompt.fill('Build two villas and one park');
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
  const recovery = page.getByRole('region', { name: 'Planner recovery' });
  await expect(recovery).toContainText('Can’t reach the planning server');
  await expect(recovery).toContainText('Your prompt is still in the composer');
  await expect(prompt).toHaveValue('Build two villas and one park');
  await expect(page.getByRole('button', { name: 'Approve & build' })).toHaveCount(0);
  outage = false;
  await recovery.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByRole('status', { name: 'Planner connection' })).toContainText('offline demo mode');
  await recovery.getByRole('button', { name: 'Retry request' }).click();
  await expect(page.getByRole('button', { name: 'Approve & build' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Planner recovery' })).toHaveCount(0);
  await expect(page.getByRole('note')).toContainText('AI preview · not built yet');
  expect(errors).toEqual([]);
});

test('contextual HUD: collapsible overview, tool card, placement guidance and inspectors still open', async ({ page }) => {
  const errors = await openCity(page);
  await page.getByRole('button', { name: 'Collapse side panel' }).click();
  await expect(page.locator('.side-panel')).toBeHidden();
  const handle = page.getByRole('button', { name: 'Show side panel' });
  await expect(handle).toBeVisible();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
  await hoverTile(page, 18, 21);
  await expect(page.getByLabel('Placement preview')).toContainText('Ready to build');
  await hoverTile(page, 18, 25);
  await expect(page.getByLabel('Placement preview')).toContainText('touch a road');
  await hoverTile(page, 18, 21);
  await page.mouse.down(); await page.mouse.up();
  await expect(page.locator('.building-details')).toContainText('2 × 2 tiles');
  await expect(page.locator('.condition')).toHaveText(/Ready/);
  await expect(page.locator('.side-panel')).toContainText('Open');
  await expect(page.locator('.side-panel')).not.toContainText('Under construction');
  await page.getByRole('button', { name: 'Close building inspector' }).click();
  await expect(handle).toBeVisible();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Villa $120', exact: true }).click();
  await handle.click();
  await expect(page.getByLabel('Selected tool')).toContainText('Villa');
  await expect(page.getByLabel('Selected tool')).toContainText('Must touch a road');
  // The preference survives a reload.
  await page.getByRole('button', { name: 'Collapse side panel' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show side panel' })).toBeVisible();
  expect(errors).toEqual([]);
});

// The world area between the HUD panels: only canvas pixels, no DOM overlay text antialiasing.
const WORLD_CLIP = { x: 300, y: 180, width: 520, height: 520 };

/** A frame once drawing has settled (two consecutive identical captures); a busy CI machine may lag a few frames. */
async function settledFrame(page: Page) {
  let previous = await page.screenshot({ clip: WORLD_CLIP });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(250);
    const frame = await page.screenshot({ clip: WORLD_CLIP });
    if (frame.equals(previous)) return frame;
    previous = frame;
  }
  return previous;
}

test('world visuals are deterministic across save and reload', async ({ page }) => {
  const errors = await openCity(page);
  // Baked atlases load asynchronously; compare only once the final art is on screen.
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', /ready|fallback/, { timeout: 15_000 });
  await page.mouse.move(640, 30);
  const first = await settledFrame(page);
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  await page.reload();
  await expect(page.getByTestId('minimap-building-office')).toBeVisible();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', /ready|fallback/, { timeout: 15_000 });
  await page.mouse.move(640, 30);
  const second = await settledFrame(page);
  expect(second.equals(first)).toBe(true);
  expect(errors).toEqual([]);
});
