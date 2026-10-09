import type { ClockState } from './types.js';

export const MINUTES_PER_DAY = 1440;

export interface ClockOptions {
  readonly fixedStepMs?: number;
  readonly minutesPerTick?: number;
  readonly paused?: boolean;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

export function validateClock(clock: ClockState): void {
  positiveInteger(clock.fixedStepMs, 'fixedStepMs');
  positiveInteger(clock.minutesPerTick, 'minutesPerTick');
  if (!Number.isSafeInteger(clock.tick) || clock.tick < 0 ||
      !Number.isSafeInteger(clock.tick * clock.minutesPerTick)) {
    throw new RangeError('tick and total game minutes must be nonnegative safe integers');
  }
  if (!Number.isFinite(clock.accumulatedMs) || clock.accumulatedMs < 0 ||
      clock.accumulatedMs >= clock.fixedStepMs) {
    throw new RangeError('accumulatedMs must be in [0, fixedStepMs)');
  }
  if (typeof clock.paused !== 'boolean') throw new TypeError('paused must be boolean');
}

export function createClock(options: ClockOptions = {}): ClockState {
  const clock: ClockState = {
    tick: 0,
    fixedStepMs: options.fixedStepMs ?? 100,
    minutesPerTick: options.minutesPerTick ?? 1,
    accumulatedMs: 0,
    paused: options.paused ?? false,
  };
  validateClock(clock);
  return clock;
}

/** Advances exact ticks without reading a wall clock. Works while paused. */
export function stepClock(clock: ClockState, steps = 1): ClockState {
  validateClock(clock);
  if (!Number.isSafeInteger(steps) || steps < 0) {
    throw new RangeError('steps must be a nonnegative safe integer');
  }
  const next = { ...clock, tick: clock.tick + steps };
  validateClock(next);
  return next;
}

export function advanceClock(clock: ClockState, elapsedMs: number): {
  readonly clock: ClockState;
  readonly steps: number;
  readonly alpha: number;
} {
  validateClock(clock);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError('elapsedMs must be finite and nonnegative');
  }
  const total = clock.accumulatedMs + (clock.paused ? 0 : elapsedMs);
  const steps = Math.floor(total / clock.fixedStepMs);
  const next = { ...stepClock(clock, steps), accumulatedMs: total % clock.fixedStepMs };
  validateClock(next);
  return { clock: next, steps, alpha: next.accumulatedMs / next.fixedStepMs };
}

export function getGameTime(clock: ClockState): { readonly day: number; readonly minuteOfDay: number } {
  validateClock(clock);
  const totalMinutes = clock.tick * clock.minutesPerTick;
  return { day: Math.floor(totalMinutes / MINUTES_PER_DAY), minuteOfDay: totalMinutes % MINUTES_PER_DAY };
}
