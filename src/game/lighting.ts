import { VENUES } from '@tiny-city/simulation';
import type { BuildingType } from '@tiny-city/simulation';
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
// 3.0C: fresh golden sunrise, clear warm-neutral midday, amber golden hour that keeps facades readable, a violet
// dusk and a cool moonlit night lifted enough that roads, residents and buildings stay visible. Interpolated with
// smoothstep, so no keyframe produces a visible kink.
const KEYS: readonly Key[] = [
  { hour: 0, tint: 0x8590c2, glow: 1, sun: 0 },
  { hour: 4.6, tint: 0x8590c2, glow: 1, sun: 0 },
  { hour: 5.6, tint: 0xb8a9c9, glow: 0.7, sun: 0.15 },
  { hour: 6.4, tint: 0xffdcbc, glow: 0.18, sun: 0.6 },
  { hour: 7.3, tint: 0xfff2e2, glow: 0, sun: 0.95 },
  { hour: 9, tint: 0xffffff, glow: 0, sun: 1 },
  { hour: 15.8, tint: 0xffffff, glow: 0, sun: 1 },
  { hour: 17.2, tint: 0xffe7c4, glow: 0.03, sun: 0.97 },
  { hour: 18.4, tint: 0xffcf9f, glow: 0.25, sun: 0.75 },
  { hour: 19.3, tint: 0xe2ad9e, glow: 0.62, sun: 0.35 },
  { hour: 20.2, tint: 0xa79bc6, glow: 0.9, sun: 0.08 },
  { hour: 21.2, tint: 0x8590c2, glow: 1, sun: 0 },
  { hour: 24, tint: 0x8590c2, glow: 1, sun: 0 },
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
  const linear = to.hour === from.hour ? 0 : (hour - from.hour) / (to.hour - from.hour);
  const t = linear * linear * (3 - 2 * linear);
  const glow = from.glow + (to.glow - from.glow) * t;
  const sun = from.sun + (to.sun - from.sun) * t;
  const phase = hour >= 7 && hour < 16.5 ? 'day' : hour >= 16.5 && hour < 19.25 ? 'golden'
    : hour >= 19.25 && hour < 21 ? 'dusk' : hour >= 4.75 && hour < 7 ? 'dawn' : 'night';
  return { tint: mixColor(from.tint, to.tint, t), glow: Math.round(glow * 100) / 100, sun: Math.round(sun * 100) / 100, phase };
}

/** Neutral daylight, used before residents live in the city (the clock still starts at midnight). */
export const DAYLIGHT: WorldLighting = { tint: 0xffffff, glow: 0, sun: 1, phase: 'day' };

/**
 * Fraction of a building's lit windows still on at a minute of the day (deterministic per building). Homes go dark
 * one by one after 23:00 and wake around 05:30; shops and offices close at 22:00 except a security light; the
 * clubhouse stays lively until midnight. Multiplied with the global glow, so daylight is unaffected.
 */
export function windowsOn(type: string | undefined, id: string, minuteOfDay: number): number {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const r = ((h >>> 0) % 1000) / 1000;
  const ramp = (from: number, to: number) => Math.max(0, Math.min(1, (m - from) / (to - from)));
  // Closing fades over 20 minutes so storefronts never snap off.
  if (type === 'mall' || type === 'office') return m >= 12 * 60 ? 1 - 0.82 * ramp(21 * 60 + 40, 22 * 60) : m < 6 * 60 ? 0.18 : 1;
  if (type === 'clubhouse') return m >= 12 * 60 ? 1 - 0.75 * ramp(23 * 60 + 35, 23 * 60 + 55) : m < 6 * 60 ? 0.25 : 1;
  // Phase 7 venues light up for their opening hours (the night market and the music club after dark, the cinema
  // until the last screening ends); the concert stage's towers are lit in the evening.
  const venue = type === 'stage' ? { open: 18 * 60, close: 23 * 60 + 30 } : type ? VENUES[type as BuildingType] : undefined;
  if (venue && type !== 'park' && type !== 'pool') {
    const t = venue.close > 1440 && m < 12 * 60 ? m + 1440 : m;
    const fade = (from: number, to: number) => Math.max(0, Math.min(1, (t - from) / (to - from)));
    if (t >= venue.open - 20 && t <= venue.close) return Math.max(0.12, Math.min(fade(venue.open - 20, venue.open), 1 - fade(venue.close - 20, venue.close)));
    return 0.12;
  }
  // Each home picks its own bedtime between 23:00 and 01:30 and wakes between 05:30 and 06:30.
  const bed = 23 * 60 + r * 150, wake = 5.5 * 60 + r * 60;
  const dim = (at: number) => 1 - ramp(at - 20, at) * 0.85;
  if (m >= 12 * 60) return bed < 1440 ? dim(bed) : 1;
  if (bed >= 1440 && m < bed - 1440) return dim(bed - 1440);
  return m < wake ? (bed >= 1440 ? dim(bed - 1440) : 0.15) : 1;
}
