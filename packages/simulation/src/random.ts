const UINT32_RANGE = 0x1_0000_0000;

export function validateRandomState(state: number): void {
  if (!Number.isInteger(state) || state < 0 || state >= UINT32_RANGE) {
    throw new RangeError('random state must be an unsigned 32-bit integer');
  }
}

/** Numeric seeds use uint32 values; strings use FNV-1a over UTF-16 code units. */
export function createRandomState(seed: number | string): number {
  if (typeof seed === 'number') {
    validateRandomState(seed);
    return seed;
  }
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  }
  return state;
}

/** Mulberry32: explicit state in, next state and a value in [0, 1) out. */
export function nextRandom(state: number): { readonly state: number; readonly value: number } {
  validateRandomState(state);
  const next = (state + 0x6d2b79f5) >>> 0;
  let value = Math.imul(next ^ (next >>> 15), next | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return { state: next, value: ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE };
}

/** Inclusive integer bounds; suitable for simulation choices, not cryptography. */
export function randomInteger(state: number, min: number, max: number): {
  readonly state: number;
  readonly value: number;
} {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max ||
      max - min + 1 > UINT32_RANGE) {
    throw new RangeError('integer bounds must be ordered safe integers with a span <= 2^32');
  }
  const draw = nextRandom(state);
  return { state: draw.state, value: min + Math.floor(draw.value * (max - min + 1)) };
}
