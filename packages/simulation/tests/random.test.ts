import { describe, expect, it } from 'vitest';
import { createRandomState, nextRandom, randomInteger } from '../src/index.js';

describe('seeded randomness', () => {
  it('locks the Mulberry32 output for a known seed', () => {
    const first = nextRandom(createRandomState(1));
    expect(first).toEqual({ state: 1831565814, value: 0.6270739405881613 });
    expect(nextRandom(first.state).value).toBe(0.002735721180215478);
  });

  it('repeats string seeds and distinguishes different seeds', () => {
    expect(createRandomState('tiny-city')).toBe(createRandomState('tiny-city'));
    expect(nextRandom(createRandomState('tiny-city'))).not.toEqual(nextRandom(createRandomState('other-city')));
    expect(createRandomState('')).toBe(0x811c9dc5);
  });

  it('resumes from serialized state and supports zero seeds', () => {
    let state = createRandomState(0);
    for (let i = 0; i < 100; i += 1) {
      const draw = nextRandom(state);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(1);
      state = draw.state;
    }
    const restored: number = JSON.parse(JSON.stringify(state));
    expect(nextRandom(restored)).toEqual(nextRandom(state));
  });

  it('returns inclusive bounded integers and advances state for singleton ranges', () => {
    let state = createRandomState('bounds');
    const values = new Set<number>();
    for (let i = 0; i < 100; i += 1) {
      const draw = randomInteger(state, -2, 2);
      expect(Number.isInteger(draw.value)).toBe(true);
      expect(draw.value).toBeGreaterThanOrEqual(-2);
      expect(draw.value).toBeLessThanOrEqual(2);
      state = draw.state;
      values.add(draw.value);
    }
    expect(values).toEqual(new Set([-2, -1, 0, 1, 2]));
    expect(randomInteger(0, 5, 5)).toEqual({ state: nextRandom(0).state, value: 5 });
  });

  it.each([-1, 0.5, 0x1_0000_0000, NaN, Infinity])('rejects invalid numeric seed %s', (seed) => {
    expect(() => createRandomState(seed)).toThrow(RangeError);
    expect(() => nextRandom(seed)).toThrow(RangeError);
  });

  it('rejects reversed, fractional, unsafe, and excessively wide integer bounds', () => {
    for (const [min, max] of [[2, 1], [0.1, 1], [0, Infinity], [0, Number.MAX_SAFE_INTEGER + 1], [-0x1_0000_0000, 1]]) {
      expect(() => randomInteger(0, min!, max!)).toThrow(RangeError);
    }
  });
});
