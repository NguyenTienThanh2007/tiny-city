import { describe, expect, it } from 'vitest';
import { advanceClock, createClock, getGameTime, stepClock } from '../src/index.js';

describe('fixed-timestep clock', () => {
  it('has predictable defaults and derives game time from tick count', () => {
    const clock = createClock();
    expect(clock).toEqual({ tick: 0, fixedStepMs: 100, minutesPerTick: 1, accumulatedMs: 0, paused: false });
    expect(getGameTime(stepClock(clock, 1441))).toEqual({ day: 1, minuteOfDay: 1 });
    expect(clock.tick).toBe(0);
  });

  it('carries fractional steps and executes only whole ticks', () => {
    const first = advanceClock(createClock(), 250);
    expect(first.steps).toBe(2);
    expect(first.alpha).toBe(0.5);
    expect(first.clock.accumulatedMs).toBe(50);
    const second = advanceClock(first.clock, 50);
    expect(second.steps).toBe(1);
    expect(second.clock.tick).toBe(3);
    expect(second.alpha).toBe(0);
  });

  it('accepts fractional frame deltas without advancing early', () => {
    const first = advanceClock(createClock(), 49.5);
    expect(first.steps).toBe(0);
    expect(advanceClock(first.clock, 50.5).clock.tick).toBe(1);
  });

  it('matches one batch with differently sized integer frame deltas', () => {
    let clock = createClock({ fixedStepMs: 50, minutesPerTick: 5 });
    for (const elapsed of [17, 80, 3, 151, 249]) clock = advanceClock(clock, elapsed).clock;
    expect(clock).toEqual(advanceClock(createClock({ fixedStepMs: 50, minutesPerTick: 5 }), 500).clock);
  });

  it('discards time spent paused, preserves the remainder, and permits manual stepping', () => {
    const partial = advanceClock(createClock(), 40).clock;
    const paused = { ...partial, paused: true };
    expect(advanceClock(paused, 9000).clock).toEqual(paused);
    expect(stepClock(paused, 2)).toEqual({ ...paused, tick: 2 });
    expect(advanceClock({ ...paused, paused: false }, 60).clock.tick).toBe(1);
  });

  it.each([-1, NaN, Infinity])('rejects invalid elapsed time %s', (elapsed) => {
    expect(() => advanceClock(createClock(), elapsed)).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, Infinity])('rejects invalid fixed step %s', (fixedStepMs) => {
    expect(() => createClock({ fixedStepMs })).toThrow(RangeError);
  });

  it('rejects invalid game-minute increments, step counts, and tick overflow', () => {
    expect(() => createClock({ minutesPerTick: 0 })).toThrow(RangeError);
    expect(() => stepClock(createClock(), -1)).toThrow(RangeError);
    expect(() => stepClock(createClock(), 0.5)).toThrow(RangeError);
    expect(() => stepClock({ ...createClock(), tick: Number.MAX_SAFE_INTEGER })).toThrow(RangeError);
    expect(() => advanceClock(createClock(), Number.MAX_VALUE)).toThrow(RangeError);
    expect(() => advanceClock({ ...createClock(), accumulatedMs: 100 }, 0)).toThrow(RangeError);
  });
});
