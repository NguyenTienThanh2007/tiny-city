import { expect, type Page } from '@playwright/test';

/**
 * Waits until the camera has stopped (Phase 4.6 cameras glide). A footprint that reads the same twice is not enough
 * on its own: on a slow software-rendered runner one frame can outlast the poll interval, so the renderer's own
 * `moving` flag must also be clear, twice in a row.
 */
export async function cameraSettled(page: Page) {
  // A camera command applies on the next React commit; let it start.
  await page.waitForTimeout(150);
  let previous = '';
  let still = 0;
  await expect.poll(async () => {
    const moving = await page.evaluate(() => (window as unknown as { __tinyCityCamera?: { moving: boolean } }).__tinyCityCamera?.moving ?? false);
    const current = (await page.getByTestId('minimap-camera').getAttribute('points')) ?? '';
    still = !moving && current === previous ? still + 1 : 0;
    previous = current;
    return still >= 2;
  }, { intervals: [250], timeout: 15_000 }).toBe(true);
}
