/**
 * Time-of-day lighting from the authoritative minute of day. Applied as cheap per-container tints in Pixi
 * (no full-screen overlay or filter), with an unlit layer for windows and streetlights.
 */

export interface WorldLighting {
  /** Multiply tint for terrain, buildings, residents and props. */
  readonly tint: number;
  /** 0 (day) … 1 (night): opacity of lit windows and streetlight pools. */
  readonly glow: number;
  readonly phase: 'day' | 'golden' | 'dusk' | 'night' | 'dawn';
}

type Key = { readonly hour: number; readonly tint: number; readonly glow: number };
const KEYS: readonly Key[] = [
  { hour: 0, tint: 0x7c86b3, glow: 1 },
  { hour: 4.75, tint: 0x7c86b3, glow: 1 },
  { hour: 6, tint: 0xd9b9b3, glow: 0.45 },
  { hour: 7, tint: 0xffffff, glow: 0 },
  { hour: 16.5, tint: 0xffffff, glow: 0 },
  { hour: 18, tint: 0xffe3c2, glow: 0.12 },
  { hour: 19.25, tint: 0xe6b9a6, glow: 0.55 },
  { hour: 20.5, tint: 0x8f94bd, glow: 0.95 },
  { hour: 21.5, tint: 0x7c86b3, glow: 1 },
  { hour: 24, tint: 0x7c86b3, glow: 1 },
];

function mixColor(a: number, b: number, t: number): number {
  const channel = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function worldLighting(minuteOfDay: number): WorldLighting {
  const hour = ((((minuteOfDay % 1440) + 1440) % 1440)) / 60;
  let index = 0;
  while (index < KEYS.length - 2 && KEYS[index + 1]!.hour <= hour) index += 1;
  const from = KEYS[index]!, to = KEYS[index + 1]!;
  const t = to.hour === from.hour ? 0 : (hour - from.hour) / (to.hour - from.hour);
  const glow = from.glow + (to.glow - from.glow) * t;
  const phase = hour >= 7 && hour < 16.5 ? 'day' : hour >= 16.5 && hour < 19.25 ? 'golden'
    : hour >= 19.25 && hour < 21 ? 'dusk' : hour >= 4.75 && hour < 7 ? 'dawn' : 'night';
  return { tint: mixColor(from.tint, to.tint, t), glow: Math.round(glow * 100) / 100, phase };
}

/** Neutral daylight, used before residents live in the city (the clock still starts at midnight). */
export const DAYLIGHT: WorldLighting = { tint: 0xffffff, glow: 0, phase: 'day' };
