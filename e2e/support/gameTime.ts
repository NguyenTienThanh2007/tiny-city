import type { Locator, Page } from '@playwright/test';

/**
 * Waits measured in game time, not wall-clock time.
 *
 * Game time is driven by rendered frames, and one frame never replays more than 250 ms
 * (`MAX_FRAME_MS` in useCitySimulation). On a slow software-rendered CI runner frames take longer than that, so
 * the game clock runs slower than real time and a fixed real-time budget ("reach 17:25 within 90 s") fails on
 * slower machines while the game is fine. These helpers instead fail when the event has not happened within a
 * game-time budget, or when the clock stops advancing for `stallMs` (paused or hung). The test timeout still
 * bounds the whole test.
 */
const DAY = 24 * 60;

/** Total game minutes on the HUD clock (`DAY 01 · 07:15`). */
export async function gameMinutes(page: Page): Promise<number> {
  const text = (await page.getByLabel('Simulation clock').textContent()) ?? '';
  const match = /DAY\s+(\d+)\D+(\d\d):(\d\d)/.exec(text);
  if (!match) throw new Error(`Unreadable simulation clock: "${text}"`);
  return Number(match[1]) * DAY + Number(match[2]) * 60 + Number(match[3]);
}

export interface GameTimeWait { /** Game minutes allowed before giving up. */ within: number; /** Real ms without a clock tick that counts as stalled. */ stallMs?: number }

/** Polls `probe` until `accept` holds, failing after `within` game minutes or a stalled clock. Returns the accepted value. */
export async function untilInGameTime<T>(page: Page, what: string, probe: () => Promise<T>, accept: (value: T) => boolean,
  { within, stallMs = 30_000 }: GameTimeWait): Promise<T> {
  const start = await gameMinutes(page);
  let last = start;
  let lastTick = Date.now();
  for (;;) {
    const value = await probe();
    if (accept(value)) return value;
    const now = await gameMinutes(page);
    if (now !== last) { last = now; lastTick = Date.now(); }
    if (now - start > within) {
      const final = await probe();
      if (accept(final)) return final;
      throw new Error(`${what}: did not happen within ${within} game minutes (clock ${start} → ${now}); last value ${JSON.stringify(final)}`);
    }
    if (Date.now() - lastTick > stallMs) throw new Error(`${what}: the game clock stopped advancing at ${now} for ${stallMs} ms`);
    await page.waitForTimeout(200);
  }
}

/** Runs the (already running) clock until today's `minuteOfDay` (returns at once if the clock is already past it). */
export async function untilClock(page: Page, minuteOfDay: number): Promise<void> {
  const start = await gameMinutes(page);
  const ahead = Math.max(0, minuteOfDay - (start % DAY));
  const label = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
  await untilInGameTime(page, `reach ${label}`, () => gameMinutes(page), (now) => now >= start + ahead, { within: ahead + 5 });
}

/** Waits until a locator's text contains `text`, within a game-time budget. */
export async function untilText(page: Page, locator: Locator, text: string, wait: GameTimeWait): Promise<void> {
  await untilInGameTime(page, `"${text}"`, async () => (await locator.textContent({ timeout: 2000 }).catch(() => null)) ?? '', (value) => value.includes(text), wait);
}
