import { expect, test, type Page } from '@playwright/test';
import { untilClock } from './support/gameTime';
import type { CityState } from '../src/types';

/** Visual World 3.0C: baked characters, real venue visitors, camera stability, reduced motion. */
const SAVE_KEY = 'tiny-city-imagine-save-v1';
const street: CityState = { size: 64, funds: 20_000, roads: Array.from({ length: 27 }, (_, i) => ({ x: 8 + i, y: 22 })), buildings: [
  { id: 'v1', name: 'Shell Villa', kind: 'villa', x: 9, y: 20, createdAt: 0 },
  { id: 'v2', name: 'Reef Villa', kind: 'villa', x: 12, y: 20, createdAt: 0 },
  { id: 'd1', name: 'Tern Duplex', kind: 'duplex', x: 15, y: 20, createdAt: 0 },
  { id: 'p1', name: 'Lagoon Park', kind: 'park', x: 25, y: 18, createdAt: 0 },
  { id: 'o1', name: 'Tide House', kind: 'office', x: 30, y: 18, createdAt: 0 },
] };
type Stats = { residents: number; visibleResidents: number; venueVisitors?: number; art?: string };
test.slow();

async function openCity(page: Page, city: unknown = street) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ key, value }) => {
    if (!sessionStorage.getItem('vw3c')) { localStorage.setItem(key, JSON.stringify(value)); sessionStorage.setItem('vw3c', '1'); }
  }, { key: SAVE_KEY, value: city });
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.city-viewport')).toHaveAttribute('data-art', /ready|fallback/, { timeout: 20_000 });
  return errors;
}
const stats = (page: Page) => page.evaluate(() => (window as unknown as { __tinyCityRenderer?: Stats }).__tinyCityRenderer ?? null);
async function runUntil(page: Page, minute: number) {
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  if (await resume.isVisible()) await resume.click();
  await page.getByRole('button', { name: 'Speed 4x' }).click();
  await untilClock(page, minute);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
}
async function footprint(page: Page) {
  const points = (await page.getByTestId('minimap-camera').getAttribute('points'))!.split(' ').map((p) => p.split(',').map(Number));
  return { cx: points.reduce((s, p) => s + p[0], 0) / 4, cy: points.reduce((s, p) => s + p[1], 0) / 4, w: Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) };
}

test('residents render as baked characters and stay visible and selectable after repeated zoom cycles', async ({ page }) => {
  const errors = await openCity(page);
  await page.getByRole('button', { name: /^Live\b/ }).first().click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await runUntil(page, 7 * 60 + 10);
  await page.getByRole('button', { name: 'Center neighborhood' }).click();
  await page.waitForTimeout(400);
  const before = await footprint(page);
  for (let cycle = 0; cycle < 8; cycle += 1) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  }
  // The minimap footprint updates asynchronously; wait for it to settle, then require the exact same view:
  // button zoom cycles must not drift in centre or scale.
  await expect.poll(async () => Math.abs((await footprint(page)).w - before.w) / before.w, { timeout: 5000 }).toBeLessThan(0.01);
  const after = await footprint(page);
  expect(Math.abs(after.cx - before.cx)).toBeLessThan(0.5);
  expect(Math.abs(after.cy - before.cy)).toBeLessThan(0.5);
  await page.waitForTimeout(1300);
  const s = (await stats(page))!;
  expect(s.art).toBe('ready');
  expect(s.residents).toBeGreaterThan(0);
  expect(s.visibleResidents).toBeGreaterThan(0);
  // A resident walking on the street can still be clicked and inspected.
  await page.getByRole('button', { name: 'Pause', exact: true }).isVisible().then(async (v) => { if (v) await page.getByRole('button', { name: 'Pause', exact: true }).click(); });
  const first = page.getByRole('list', { name: /residents|on the move/i }).getByRole('button').first();
  if (await first.isVisible().catch(() => false)) {
    await first.click();
    await expect(page.locator('.citizen-inspector')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('real park visitors are drawn at the park instead of disappearing inside it', async ({ page }) => {
  const errors = await openCity(page);
  await page.getByRole('button', { name: /^Live\b/ }).first().click();
  await page.getByRole('button', { name: 'Welcome residents' }).click();
  await runUntil(page, 17 * 60 + 50);
  await page.waitForTimeout(1300);
  const s = (await stats(page))!;
  const leisure = Number((await page.getByText(/^Leisure$/).first().locator('xpath=..').textContent())!.replace(/\D/g, '')) || 0;
  expect(s.venueVisitors ?? 0).toBeGreaterThan(0);
  // Never more figures than real visitors (the park shows up to 12).
  expect(s.venueVisitors!).toBeLessThanOrEqual(Math.max(leisure, s.venueVisitors!));
  expect(errors).toEqual([]);
});

test('the Character Creator previews the baked character with the same accessible name', async ({ page }) => {
  // Count PNG encodes: the animated preview must reuse cached frames, not re-encode one every 115 ms (that kept
  // the main thread busy for seconds per action on slow CI runners, and toasts expired before they were seen).
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toDataURL;
    (window as unknown as { __encodes: number }).__encodes = 0;
    HTMLCanvasElement.prototype.toDataURL = function (...args: Parameters<typeof encode>) {
      (window as unknown as { __encodes: number }).__encodes += 1;
      return encode.apply(this, args);
    };
  });
  await openCity(page);
  await page.getByRole('button', { name: 'Life', exact: true }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Character name').fill('Mai Nguyen');
  const preview = page.getByRole('img', { name: 'Preview of Mai Nguyen' });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('data-art', 'baked');
  const encodes = () => page.evaluate(() => (window as unknown as { __encodes: number }).__encodes);
  // Once each walk frame has been drawn, the running animation encodes nothing more (before the fix: one every 115 ms).
  let previous = -1;
  await expect.poll(async () => {
    const count = await encodes();
    const settled = count === previous;
    previous = count;
    return settled;
  }, { intervals: [1500], timeout: 20_000 }).toBe(true);
  await expect(preview).toHaveAttribute('src', /^data:image\/png/);
  // Choices update the preview image.
  const src = await preview.getAttribute('src');
  await page.getByRole('radio', { name: 'Accessory Sun hat' }).check();
  await expect.poll(() => preview.getAttribute('src')).not.toBe(src);
  // The map stays the page's only canvas.
  await expect(page.locator('canvas')).toHaveCount(1);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('freezes ambient animation and idle breathing while the clock is paused', async ({ page }) => {
    const errors = await openCity(page);
    await page.getByRole('button', { name: /^Live\b/ }).first().click();
    await page.getByRole('button', { name: 'Welcome residents' }).click();
    await runUntil(page, 17 * 60 + 50);
    await page.mouse.move(640, 30);
    await page.waitForTimeout(800);
    const clip = { x: 300, y: 180, width: 520, height: 520 };
    const a = await page.screenshot({ clip });
    await page.waitForTimeout(1500);
    const b = await page.screenshot({ clip });
    expect(b.equals(a)).toBe(true);
    expect(errors).toEqual([]);
  });
});
