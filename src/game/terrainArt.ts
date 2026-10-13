import { Graphics } from 'pixi.js';
import { iso, type Point } from './mapGeometry';

/**
 * Visual World 3.0 terrain: a soft, painterly island ground. Colour comes from smooth multi-octave value noise so
 * neighbouring tiles blend into meadows, mown patches and dry spots instead of a checkerboard; no grid lines are
 * drawn. Coast bands (sand, wet sand, shallows, sea) follow the existing land rule (x + y < 2·size − 8).
 * Deterministic and presentation-only; baked once into a cached texture by the viewport.
 */

/** Integer hash in [0, 1). */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 0x27d4eb2d, 0x9e3779b1) ^ Math.imul(y + 0x165667b1, 0x85ebca6b) ^ Math.imul(salt + 7, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Bilinear value noise with smoothstep, period `cell` tiles. */
export function valueNoise(x: number, y: number, cell: number, salt: number): number {
  const gx = x / cell, gy = y / cell;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = smooth(gx - x0), fy = smooth(gy - y0);
  const a = hash(x0, y0, salt), b = hash(x0 + 1, y0, salt), c = hash(x0, y0 + 1, salt), d = hash(x0 + 1, y0 + 1, salt);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const channel = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - k) + ((b >> shift) & 0xff) * k);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

const MEADOW = 0x96c47b, LUSH = 0x76ab65, DRY = 0xbccc8c, MOSS = 0x7fa972;
const SAND = 0xead9a8, WET_SAND = 0xd6c896, SHALLOW = 0x86cbc6, SEA = 0x69b3b9;

/** Ground colour at a (fractional) tile position. */
export function terrainColor(x: number, y: number, size: number): number {
  const coast = x + y - (size * 2 - 8);
  const shore = (valueNoise(x, y, 5, 41) - 0.5) * 1.6;
  const c = coast + shore;
  if (c >= 3) return mix(SHALLOW, SEA, (c - 3) / 4);
  if (c >= 0) return mix(WET_SAND, SHALLOW, c / 3);
  if (c >= -2.5) return mix(SAND, WET_SAND, (c + 2.5) / 2.5);
  const broad = valueNoise(x, y, 11, 3);
  const mid = valueNoise(x, y, 4.5, 9);
  const fine = valueNoise(x, y, 1.7, 17);
  let color = mix(MEADOW, LUSH, smooth(Math.max(0, broad - 0.3) / 0.7) * 1.1);
  color = mix(color, DRY, Math.max(0, mid - 0.58) * 1.9);
  color = mix(color, MOSS, Math.max(0, 0.32 - mid) * 1.4);
  color = mix(color, fine > 0.5 ? 0xffffff : 0x000000, Math.abs(fine - 0.5) * 0.06);
  // Grass gives way to dune grass near the beach.
  if (c > -6) color = mix(color, mix(DRY, SAND, 0.4), (c + 6) / 3.5 * 0.8);
  return color;
}

/**
 * Draws the island: every tile is split into four sub-diamonds coloured at their own centres, which smooths the
 * gradients at normal zoom while staying cheap (cached to one texture). Adds a cliff skirt, foam and grass tufts.
 */
export function drawTerrainArt(terrain: Graphics, size: number): void {
  const depth = 30;
  const sw = [iso(0, size), iso(size, size)], se = [iso(size, size), iso(size, 0)];
  const quad = (points: Point[], color: number, alpha = 1) => terrain.poly(points.flatMap((p) => [p.x, p.y])).fill({ color, alpha });
  // Island skirt: layered soil and rock under the front edges.
  quad([sw[0]!, sw[1]!, { x: sw[1]!.x, y: sw[1]!.y + depth }, { x: sw[0]!.x, y: sw[0]!.y + depth }], 0x5e8d8c);
  quad([se[0]!, se[1]!, { x: se[1]!.x, y: se[1]!.y + depth }, { x: se[0]!.x, y: se[0]!.y + depth }], 0x4f7c7d);
  quad([sw[0]!, sw[1]!, { x: sw[1]!.x, y: sw[1]!.y + 6 }, { x: sw[0]!.x, y: sw[0]!.y + 6 }], 0x7ab1ad);
  quad([se[0]!, se[1]!, { x: se[1]!.x, y: se[1]!.y + 6 }, { x: se[0]!.x, y: se[0]!.y + 6 }], 0x6aa19f);
  const step = 0.5;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      quad([iso(x, y), iso(x + step + 0.02, y), iso(x + step + 0.02, y + step + 0.02), iso(x, y + step + 0.02)], terrainColor(x + step / 2, y + step / 2, size));
    }
  }
  // Foam along the waterline and gentle wave crests offshore.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coast = x + y - (size * 2 - 8) + (valueNoise(x + 0.5, y + 0.5, 5, 41) - 0.5) * 1.6;
      const center = iso(x + 0.5, y + 0.5);
      const n = hash(x, y, 71);
      if (coast >= -0.4 && coast < 0.6) terrain.moveTo(center.x - 14, center.y + 1).quadraticCurveTo(center.x, center.y - 4, center.x + 14, center.y + 1)
        .stroke({ color: 0xf6fbf6, width: 1.6, alpha: 0.75 });
      else if (coast > 2.5 && n > 0.78) terrain.moveTo(center.x - 9, center.y).quadraticCurveTo(center.x, center.y - 3, center.x + 9, center.y)
        .stroke({ color: 0xe8f6f2, width: 1.2, alpha: 0.5 });
      else if (coast < -3) {
        // Grass tufts and tiny wildflowers: short strokes, never a regular pattern.
        if (n < 0.22) {
          const ox = (hash(x, y, 73) - 0.5) * 26, oy = (hash(x, y, 79) - 0.5) * 10;
          const p = { x: center.x + ox, y: center.y + oy };
          const tuft = mix(terrainColor(x, y, size), 0x3f6e3c, 0.35);
          terrain.moveTo(p.x - 2, p.y).lineTo(p.x - 3, p.y - 3).moveTo(p.x, p.y).lineTo(p.x, p.y - 4).moveTo(p.x + 2, p.y).lineTo(p.x + 3.2, p.y - 3)
            .stroke({ color: tuft, width: 0.9, alpha: 0.7 });
        } else if (n > 0.97) {
          const p = { x: center.x + (hash(x, y, 83) - 0.5) * 20, y: center.y };
          terrain.circle(p.x, p.y, 1.1).fill(0xf6efe0).circle(p.x + 2.6, p.y + 1, 1).fill(0xf2c66b);
        }
      }
    }
  }
}
