import { expect, test, type Page } from '@playwright/test';
import { cameraSettled } from './support/camera';
import { untilText } from './support/gameTime';
import type { WorldState } from '@tiny-city/simulation';
import type { CityState } from '../src/types';

const SAVE_KEY = 'tiny-city-imagine-save-v1';
// Two streets; villas and two apartment buildings with names users can refer to.
const fixture: CityState = { size: 64, funds: 20_000, roads: [
  ...Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })),
  ...Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 30 })),
  ...Array.from({ length: 9 }, (_, i) => ({ x: 8, y: i + 21 })),
], buildings: [
  { id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 10, y: 21, createdAt: 0 },
  { id: 'villa-b', name: 'Palm Villa', kind: 'villa', x: 13, y: 21, createdAt: 0 },
  { id: 'apt-a', name: 'Harbor Flats', kind: 'apartment', x: 20, y: 21, createdAt: 0 },
  { id: 'apt-b', name: 'Sea Flats', kind: 'apartment', x: 30, y: 21, createdAt: 0 },
  { id: 'office', name: 'Harbor Office', kind: 'office', x: 40, y: 21, createdAt: 0 },
] };
type Saved = CityState & { simulation: WorldState };
// Full gameplay journeys through the real UI and API; CI software rendering needs the slow budget.
test.slow();

async function openCity(page: Page, city: unknown = fixture) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/GL Driver Message|Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('ai2-fixture')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('ai2-fixture', '1'); }
  }, { key: SAVE_KEY, value: city });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('minimap-camera')).toHaveAttribute('points', /,/);
  return errors;
}
/** The preview build targets the mock API; these specs talk to the real API running the offline rules interpreter. */
async function useOfflineRulesPlanner(page: Page) {
  await page.route('http://127.0.0.1:8012/v1/city/**', (route) => route.continue({ url: route.request().url().replace(':8012', ':8015') }));
}
async function save(page: Page): Promise<Saved> {
  await page.getByRole('button', { name: /^(Save|Saved)$/ }).click();
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
}
async function ask(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: 'Describe a city change' }).fill(prompt);
  await page.getByRole('button', { name: 'Generate AI plan' }).click();
}
const notice = (page: Page) => page.getByRole('status', { name: 'City notice' });

test('Vietnamese build and demolition through the real planning API: choose, authorize, preview, confirm, undo, reload', async ({ page }) => {
  const errors = await openCity(page);
  await useOfflineRulesPlanner(page);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Planner connection' })).toContainText('offline rules interpreter');
  const before = await save(page);

  // Build: exact quantity, previewed without mutating the city, applied atomically.
  await ask(page, 'Xây 2 biệt thự gần đường');
  await expect(page.getByRole('button', { name: 'Approve & build' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Plan impact' })).toContainText('Adds 4 rooms');
  expect((await save(page)).simulation).toEqual(before.simulation);
  await page.getByRole('button', { name: 'Approve & build' }).click();
  await expect(notice(page)).toContainText('AI city plan applied');
  const built = await save(page);
  expect(built.simulation.plan.buildings.filter((b) => b.type === 'villa')).toHaveLength(4);

  // Ambiguous demolition: "the apartment" matches two buildings, so the user chooses.
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await ask(page, 'Phá apartment đi.');
  const choose = page.getByRole('region', { name: 'Choose buildings' });
  await expect(choose).toContainText('2 apartment buildings match. Choose which one to demolish.', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Use these buildings' })).toBeDisabled();
  await choose.getByRole('radio', { name: /Sea Flats/ }).check();
  await page.getByRole('button', { name: 'Use these buildings' }).click();
  // "Protect existing buildings" conflicts: explained, and only explicit consent continues.
  const authorize = page.getByRole('region', { name: 'Authorization required' });
  await expect(authorize).toContainText('Protect existing buildings', { timeout: 30_000 });
  await expect(authorize).toContainText('Sea Flats');
  await expect(authorize).not.toContainText('Harbor Flats');
  expect((await save(page)).simulation).toEqual(built.simulation);
  await page.getByRole('button', { name: 'Allow this change' }).click();
  await expect(page.getByRole('list', { name: 'Plan impact' })).toContainText('Removes 1 building (24 rooms)', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Review destructive edits' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Confirm destructive changes' })).toContainText('Demolish Sea Flats');
  expect((await save(page)).simulation).toEqual(built.simulation);
  await page.getByRole('button', { name: 'Confirm & apply' }).click();
  await expect(notice(page)).toContainText('AI city plan applied');
  const demolished = await save(page);
  expect(demolished.simulation.plan.buildings.map((b) => b.id)).toEqual(expect.not.arrayContaining(['apt-b']));
  expect(demolished.simulation.plan.buildings.map((b) => b.id)).toContain('apt-a');
  expect(demolished.simulation.plan.roads).toEqual(built.simulation.plan.roads);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await save(page)).simulation.plan.buildings.map((b) => b.id)).toContain('apt-b');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const redone = await save(page);
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  expect((await save(page)).simulation).toEqual(redone.simulation);
  expect(errors).toEqual([]);
});

test('English multi-step request, "the left one", impossible counts and stale previews', async ({ page }) => {
  const errors = await openCity(page);
  await useOfflineRulesPlanner(page);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await ask(page, 'Remove three apartments');
  await expect(page.getByText(/You asked for 3 apartment buildings, but the city has 2/).first()).toBeVisible({ timeout: 30_000 });
  await ask(page, 'Phá căn biệt thự bên trái.');
  const authorize = page.getByRole('region', { name: 'Authorization required' });
  await expect(authorize).toContainText('Lagoon Villa', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Keep protection' }).click();
  await expect(page.getByText('Nothing was changed. Your city is unchanged.')).toBeVisible();
  await ask(page, 'Build a residential neighborhood with eight villas and two parks.');
  await expect(page.getByRole('button', { name: 'Approve & build' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Proposed building locations' }).getByRole('listitem')).toHaveCount(10);
  // A manual edit makes the preview stale; it can no longer be applied.
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('navigation', { name: 'Build tools' }).getByRole('button', { name: 'Road $8', exact: true }).click();
  const bounds = (await page.locator('canvas').boundingBox())!;
  const pts = (await page.getByTestId('minimap-camera').getAttribute('points'))!.split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const w = (gx: number, gy: number) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const o = w(pts[0][0], pts[0][1]), r = w(pts[1][0], pts[1][1]), s = bounds.width / (r.x - o.x), t = w(30.5, 33.5);
  await page.mouse.click(bounds.x + (t.x - o.x) * s, bounds.y + (t.y - o.y) * s);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(page.locator('.architect-chip')).toHaveText('Plan is stale');
  await expect(page.getByRole('button', { name: 'Approve & build' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a different service on the planner port is named, with recovery steps (the reported failure)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openCity(page);
  // Exactly what the other local app answered for every TINY CITY route.
  await page.route('http://127.0.0.1:8012/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/openapi.json')) return route.fulfill({ status: 200, json: { openapi: '3.1.0', info: { title: 'F01 API', version: '0.1.0' }, paths: {} } });
    return route.fulfill({ status: 404, json: { detail: 'Not Found' } });
  });
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  const badge = page.getByRole('status', { name: 'Planner connection' });
  await expect(badge).toContainText('Wrong service on the planner port (F01 API)');
  await expect(badge).not.toContainText('readiness unknown');
  await ask(page, 'Xây 2 biệt thự gần công viên');
  const recovery = page.getByRole('region', { name: 'Planner recovery' });
  await expect(recovery).toContainText('Another service is answering on the planner port');
  await expect(page.getByText('The planning service returned an invalid error response.')).toHaveCount(0);
  await expect(page.locator('.architect-state')).toContainText('HTTP 404');
  await expect(page.getByRole('textbox', { name: 'Describe a city change' })).toHaveValue('Xây 2 biệt thự gần công viên');
  expect(errors).toEqual([]);
});

test('AI-built housing keeps a room for a waiting character, who moves in, walks and survives a reload', async ({ page }) => {
  const full: CityState = { size: 64, funds: 5000, roads: Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), buildings: [
    { id: 'villa-a', name: 'Lagoon Villa', kind: 'villa', x: 12, y: 21, createdAt: 0 },
    { id: 'villa-b', name: 'Palm Villa', kind: 'villa', x: 15, y: 21, createdAt: 0 },
    { id: 'office', name: 'Harbor Office', kind: 'office', x: 44, y: 21, createdAt: 0 } ] };
  const errors = await openCity(page, full);
  await useOfflineRulesPlanner(page);
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const residents = new Map((await save(page)).simulation.citizens.map((c) => [c.id, c.homeBuildingId]));
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Mai');
  await page.getByRole('button', { name: /Next: choose a home/ }).click();
  await expect(page.getByRole('region', { name: 'No free home' })).toContainText('4 of 4 rooms taken');
  // Ask the AI Architect for housing instead of building by hand.
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await ask(page, 'Xây 2 biệt thự gần đường');
  await expect(page.getByRole('list', { name: 'Plan impact' })).toContainText('one is kept for Mai', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Approve & build' }).click();
  await expect(notice(page)).toContainText(/AI city plan applied|has a free room for Mai/);
  const afterPlan = (await save(page)).simulation;
  for (const [id, home] of residents) expect(afterPlan.citizens.find((c) => c.id === id)?.homeBuildingId).toBe(home);
  expect(afterPlan.citizens).toHaveLength(7);
  expect(afterPlan.player).toMatchObject({ name: 'Mai', movement: { status: 'unplaced' } });
  // Approving closes the Plan panel and returns to Life mode, where home selection is already open.
  const back = page.getByRole('button', { name: 'Back to home selection' });
  if (await back.isVisible()) await back.click();
  await expect(page.getByRole('heading', { name: 'Choose your home' })).toBeVisible();
  await page.getByRole('list', { name: 'Homes' }).getByRole('button', { name: /New.*Free room/ }).click();
  await page.getByRole('region', { name: 'Confirm home' }).getByRole('button', { name: 'Move in & start' }).click();
  await expect(notice(page)).toContainText('Welcome home, Mai!');
  const placed = (await save(page)).simulation.player!;
  expect(placed.movement.status).toBe('inside');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // Walk out along the street to prove the character is playable.
  const bounds = (await page.locator('canvas').boundingBox())!;
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  // The camera glides; a fixed wait can read it mid-move on a slow runner.
  await cameraSettled(page);
  const pts = (await page.getByTestId('minimap-camera').getAttribute('points'))!.split(' ').map((p) => p.split(',').map((n) => Number(n) * 64 / 100));
  const w = (gx: number, gy: number) => ({ x: (gx - gy) * 28, y: (gx + gy) * 14 });
  const o = w(pts[0][0], pts[0][1]), r = w(pts[1][0], pts[1][1]), sc = bounds.width / (r.x - o.x), t = w(30.5, 20.5);
  await page.mouse.click(bounds.x + (t.x - o.x) * sc, bounds.y + (t.y - o.y) * sc);
  await expect(page.getByRole('status', { name: 'Current activity' })).toContainText('Walking to the street at 30, 20');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await untilText(page, page.getByRole('status', { name: 'Current activity' }), 'Free to explore', { within: 240 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const saved = (await save(page)).simulation;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Life', exact: true })).toHaveAttribute('title', 'Continue life as Mai');
  expect((await save(page)).simulation.player).toEqual(saved.player);
  expect(errors).toEqual([]);
});
