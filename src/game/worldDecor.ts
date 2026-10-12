import type { CityPlan, Position } from '@tiny-city/simulation';

/**
 * Deterministic landscaping derived only from the authoritative plan. Decorations never sit on roads, buildings
 * or water, never affect placement rules, and the viewport hides tall ones under a placement preview, so they
 * cannot look like they block a buildable lot. Streetlights stand on the curb of real road tiles only.
 */

export type DecorKind = 'tree' | 'palm' | 'bush' | 'flowers' | 'stones' | 'lamp';
export interface Decor {
  readonly kind: DecorKind;
  /** Tile that owns the decoration (for hiding under previews and rebuilds). */
  readonly tile: Position;
  /** Exact tile-space anchor (feet / base point). */
  readonly at: Position;
  readonly variant: number;
  readonly size: number;
}
export const TALL_DECOR: ReadonlySet<DecorKind> = new Set(['tree', 'palm', 'bush', 'lamp']);
export const MAX_DECOR = 900;

const key = (x: number, y: number) => `${x},${y}`;

/** Integer hash noise in [0, 1); stable for a tile and salt. */
export function tileNoise(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 0x632be5ab, 0x9e3779b1) ^ Math.imul(y + 0x85157af5, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Coarse value noise so trees form groves instead of salt-and-pepper clutter. */
function grove(x: number, y: number): number {
  const cx = Math.floor(x / 6), cy = Math.floor(y / 6);
  const fx = (x % 6) / 6, fy = (y % 6) / 6;
  const a = tileNoise(cx, cy, 91), b = tileNoise(cx + 1, cy, 91), c = tileNoise(cx, cy + 1, 91), d = tileNoise(cx + 1, cy + 1, 91);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

export function planDecor(plan: CityPlan): Decor[] {
  const size = plan.width;
  const roads = new Set(plan.roads.map((tile) => key(tile.x, tile.y)));
  const blocked = new Set(plan.blockedTiles.map((tile) => key(tile.x, tile.y)));
  const occupied = new Set<string>();
  const nearBuilding = new Set<string>();
  for (const building of plan.buildings) {
    for (let y = building.position.y - 1; y <= building.position.y + building.footprint.height; y += 1) {
      for (let x = building.position.x - 1; x <= building.position.x + building.footprint.width; x += 1) {
        const inside = x >= building.position.x && y >= building.position.y &&
          x < building.position.x + building.footprint.width && y < building.position.y + building.footprint.height;
        (inside ? occupied : nearBuilding).add(key(x, y));
      }
    }
  }
  // Distance (Chebyshev, capped) to the built-up area, so landscaping thins out around streets and lots.
  // Marked by dilation (O(developed tiles)), not by scanning every road per map tile.
  const developedRing = new Set<string>();
  const mark = (px: number, py: number) => { for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) developedRing.add(key(px + dx, py + dy)); };
  for (const road of plan.roads) mark(road.x, road.y);
  for (const building of plan.buildings) {
    for (let y = building.position.y; y < building.position.y + building.footprint.height; y += 1) {
      for (let x = building.position.x; x < building.position.x + building.footprint.width; x += 1) mark(x, y);
    }
  }

  const decor: Decor[] = [];
  for (let y = 0; y < size && decor.length < MAX_DECOR; y += 1) {
    for (let x = 0; x < size && decor.length < MAX_DECOR; x += 1) {
      const k = key(x, y);
      if (roads.has(k) || blocked.has(k) || occupied.has(k)) continue;
      const coast = x + y;
      const n = tileNoise(x, y, 7);
      const jitter = { x: x + 0.3 + tileNoise(x, y, 11) * 0.4, y: y + 0.3 + tileNoise(x, y, 13) * 0.4 };
      const variant = Math.floor(tileNoise(x, y, 17) * 3);
      if (coast >= size * 2 - 13) {
        // Sand band: sparse palms and pebbles.
        if (n < 0.07 && !nearBuilding.has(k)) decor.push({ kind: 'palm', tile: { x, y }, at: jitter, variant, size: 0.8 + tileNoise(x, y, 19) * 0.3 });
        else if (n > 0.93) decor.push({ kind: 'stones', tile: { x, y }, at: jitter, variant, size: 1 });
        continue;
      }
      const near = developedRing.has(k);
      if (!nearBuilding.has(k) && !near && grove(x, y) > 0.62 && n < 0.42) {
        decor.push({ kind: 'tree', tile: { x, y }, at: jitter, variant, size: 0.85 + tileNoise(x, y, 23) * 0.4 });
      } else if (!nearBuilding.has(k) && n > 0.965) {
        decor.push({ kind: 'bush', tile: { x, y }, at: jitter, variant, size: 0.8 + tileNoise(x, y, 29) * 0.4 });
      } else if (n < 0.035 || n > 0.94 && near) {
        decor.push({ kind: 'flowers', tile: { x, y }, at: jitter, variant, size: 1 });
      } else if (n > 0.5 && n < 0.515) {
        decor.push({ kind: 'stones', tile: { x, y }, at: jitter, variant, size: 1 });
      }
    }
  }
  // Streetlights: every few road tiles, on a curb that faces open ground (never in the walking lanes).
  for (const road of plan.roads) {
    if (decor.length >= MAX_DECOR) break;
    if ((road.x * 7 + road.y * 13) % 6 !== 0) continue;
    const sides = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;
    const open = sides.find(([dx, dy]) => !roads.has(key(road.x + dx, road.y + dy)));
    if (!open) continue;
    decor.push({ kind: 'lamp', tile: { x: road.x, y: road.y }, at: { x: road.x + 0.5 + open[0] * 0.42, y: road.y + 0.5 + open[1] * 0.42 }, variant: 0, size: 1 });
  }
  return decor;
}
