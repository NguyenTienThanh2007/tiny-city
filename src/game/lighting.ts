/**
 * Time-of-day lighting from the authoritative minute of day. Applied as cheap per-container tints in Pixi
 * (no full-screen overlay or filter), with an unlit layer for windows and streetlights.
 */

export interface WorldLighting {
  /** Multiply tint for terrain, buildings, residents and props. */
  readonly tint: number;
  /** 0 (day) … 1 (night): opacity of lit windows and streetlight pools. */
  readonly glow: number;
  /** 0 (no sun) … 1 (full sun): opacity of the baked ground shadows. */
  readonly sun: number;
  readonly phase: 'day' | 'golden' | 'dusk' | 'night' | 'dawn';
}

type Key = { readonly hour: number; readonly tint: number; readonly glow: number; readonly sun: number };
// Warm sunrise, neutral midday, golden hour, violet dusk and a moonlit night that keeps the map readable.
const KEYS: readonly Key[] = [
  { hour: 0, tint: 0x8189bb, glow: 1, sun: 0 },
  { hour: 4.75, tint: 0x8189bb, glow: 1, sun: 0 },
  { hour: 5.75, tint: 0xc9a9bd, glow: 0.6, sun: 0.2 },
  { hour: 6.5, tint: 0xffdcc0, glow: 0.12, sun: 0.65 },
  { hour: 7, tint: 0xffffff, glow: 0, sun: 1 },
  { hour: 16.5, tint: 0xffffff, glow: 0, sun: 1 },
  { hour: 17.6, tint: 0xffe2b8, glow: 0.04, sun: 0.95 },
  { hour: 18.6, tint: 0xf7cba8, glow: 0.3, sun: 0.65 },
  { hour: 19.5, tint: 0xbaa6c8, glow: 0.72, sun: 0.2 },
  { hour: 20.5, tint: 0x8a92c0, glow: 0.95, sun: 0 },
  { hour: 21.5, tint: 0x8189bb, glow: 1, sun: 0 },
  { hour: 24, tint: 0x8189bb, glow: 1, sun: 0 },
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
  const sun = from.sun + (to.sun - from.sun) * t;
  const phase = hour >= 7 && hour < 16.5 ? 'day' : hour >= 16.5 && hour < 19.25 ? 'golden'
    : hour >= 19.25 && hour < 21 ? 'dusk' : hour >= 4.75 && hour < 7 ? 'dawn' : 'night';
  return { tint: mixColor(from.tint, to.tint, t), glow: Math.round(glow * 100) / 100, sun: Math.round(sun * 100) / 100, phase };
}

/** Neutral daylight, used before residents live in the city (the clock still starts at midnight). */
export const DAYLIGHT: WorldLighting = { tint: 0xffffff, glow: 0, sun: 1, phase: 'day' };
