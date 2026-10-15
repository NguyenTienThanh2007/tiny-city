import type { CityPlan, Position } from '@tiny-city/simulation';
import { CURB_DECOR, type Decor } from '../game/worldDecor';

/**
 * Phase 8A walkable ground and character collision. Pure and allocation-light; runs at a fixed step.
 *
 * The walkable ground is exactly the simulation's: road tiles (asphalt, the sidewalks drawn along their open edges,
 * and pedestrian squares). Building footprints, open meadow, the beach, the sea and everything outside the map are
 * solid, so the character can never stand where `playerWalkCheck` would refuse it. Street furniture standing on the
 * curb (lamps, street trees, benches, bins, bike racks, planters) adds small solid shapes taken from the same decor
 * plan the City View draws. The character is a circle (the capsule's footprint) of radius `radius`.
 */

export interface CircleObstacle { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number; readonly source: string }
export interface BoxObstacle { readonly kind: 'box'; readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number; readonly source: string }
export type Obstacle = CircleObstacle | BoxObstacle;

export interface WalkGrid {
  readonly width: number;
  readonly height: number;
  /** 1 where the tile is walkable (a road tile). */
  readonly walkable: Uint8Array;
  /** Curb furniture, bucketed by tile index for local queries. */
  readonly obstacles: ReadonlyMap<number, readonly Obstacle[]>;
}

/** Solid sizes of curb furniture (tiles), matching the proportions of the baked props. */
const FURNITURE: Partial<Record<Decor['kind'], (d: Decor) => Obstacle>> = {
  lamp: (d) => ({ kind: 'circle', x: d.at.x, y: d.at.y, r: 0.03, source: 'lamp' }),
  streetTree: (d) => ({ kind: 'circle', x: d.at.x, y: d.at.y, r: 0.045, source: 'tree' }),
  bin: (d) => ({ kind: 'circle', x: d.at.x, y: d.at.y, r: 0.035, source: 'bin' }),
  planter: (d) => ({ kind: 'box', minX: d.at.x - 0.12, minY: d.at.y - 0.06, maxX: d.at.x + 0.12, maxY: d.at.y + 0.06, source: 'planter' }),
  bench: (d) => d.variant === 1
    ? { kind: 'box', minX: d.at.x - 0.04, minY: d.at.y - 0.1, maxX: d.at.x + 0.04, maxY: d.at.y + 0.1, source: 'bench' }
    : { kind: 'box', minX: d.at.x - 0.1, minY: d.at.y - 0.04, maxX: d.at.x + 0.1, maxY: d.at.y + 0.04, source: 'bench' },
  bikes: (d) => ({ kind: 'box', minX: d.at.x - 0.13, minY: d.at.y - 0.05, maxX: d.at.x + 0.08, maxY: d.at.y + 0.05, source: 'bikes' }),
};

export function buildWalkGrid(plan: CityPlan, decor: readonly Decor[] = []): WalkGrid {
  const walkable = new Uint8Array(plan.width * plan.height);
  for (const r of plan.roads) if (r.x >= 0 && r.y >= 0 && r.x < plan.width && r.y < plan.height) walkable[r.y * plan.width + r.x] = 1;
  const obstacles = new Map<number, Obstacle[]>();
  for (const d of decor) {
    if (!CURB_DECOR.has(d.kind)) continue;
    const make = FURNITURE[d.kind];
    if (!make) continue;
    const o = make(d);
    // Register the shape in every tile it overlaps, so queries around the character find it.
    const [minX, minY, maxX, maxY] = o.kind === 'circle' ? [o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r] : [o.minX, o.minY, o.maxX, o.maxY];
    for (let ty = Math.floor(minY); ty <= Math.floor(maxY); ty += 1) for (let tx = Math.floor(minX); tx <= Math.floor(maxX); tx += 1) {
      if (tx < 0 || ty < 0 || tx >= plan.width || ty >= plan.height) continue;
      const k = ty * plan.width + tx;
      obstacles.set(k, [...(obstacles.get(k) ?? []), o]);
    }
  }
  return { width: plan.width, height: plan.height, walkable, obstacles };
}

export function isWalkableTile(grid: WalkGrid, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < grid.width && ty < grid.height && grid.walkable[ty * grid.width + tx] === 1;
}
export const isWalkablePoint = (grid: WalkGrid, p: Position) => isWalkableTile(grid, Math.floor(p.x), Math.floor(p.y));

/** Pushes a circle out of an axis-aligned box; returns the corrected centre or null when not touching. */
function pushOutOfBox(x: number, y: number, r: number, minX: number, minY: number, maxX: number, maxY: number): Position | null {
  const cx = Math.max(minX, Math.min(maxX, x)), cy = Math.max(minY, Math.min(maxY, y));
  const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2), k = (r - d) / d;
    return { x: x + dx * k, y: y + dy * k };
  }
  // Centre inside the box: leave by the nearest face.
  const left = x - minX, right = maxX - x, top = y - minY, bottom = maxY - y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: minX - r, y };
  if (m === right) return { x: maxX + r, y };
  if (m === top) return { x, y: minY - r };
  return { x, y: maxY + r };
}

function resolve(grid: WalkGrid, p: Position, r: number): Position {
  let { x, y } = p;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    let moved = false;
    const tx = Math.floor(x), ty = Math.floor(y);
    for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
      const nx = tx + ox, ny = ty + oy;
      if (!isWalkableTile(grid, nx, ny)) {
        const out = pushOutOfBox(x, y, r, nx, ny, nx + 1, ny + 1);
        if (out) { x = out.x; y = out.y; moved = true; }
      }
      const list = nx >= 0 && ny >= 0 && nx < grid.width && ny < grid.height ? grid.obstacles.get(ny * grid.width + nx) : undefined;
      if (!list) continue;
      for (const o of list) {
        if (o.kind === 'box') {
          const out = pushOutOfBox(x, y, r, o.minX, o.minY, o.maxX, o.maxY);
          if (out) { x = out.x; y = out.y; moved = true; }
        } else {
          const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy), min = r + o.r;
          if (d < min) {
            const ux = d > 1e-9 ? dx / d : 1, uy = d > 1e-9 ? dy / d : 0;
            x = o.x + ux * min; y = o.y + uy * min; moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
  return { x, y };
}

export interface MoveResult { readonly position: Position; readonly blocked: boolean }

/**
 * Moves a circle by `delta`, sliding along walls. Sub-steps keep each move under half the radius, so nothing thin
 * can be tunnelled through at any speed or frame time. A result off walkable ground (only possible when the start
 * itself was invalid) keeps the start position.
 */
export function moveCircle(grid: WalkGrid, from: Position, delta: Position, r: number): MoveResult {
  const length = Math.hypot(delta.x, delta.y);
  const steps = Math.max(1, Math.ceil(length / (r * 0.5)));
  let p = from, blocked = false;
  for (let i = 0; i < steps; i += 1) {
    const wanted = { x: p.x + delta.x / steps, y: p.y + delta.y / steps };
    const next = resolve(grid, wanted, r);
    if (Math.abs(next.x - wanted.x) + Math.abs(next.y - wanted.y) > 1e-9) blocked = true;
    if (!isWalkablePoint(grid, next)) return { position: p, blocked: true };
    p = next;
  }
  return { position: p, blocked };
}

/** True when a circle of radius r at p overlaps nothing solid (used to validate spawn points). */
export function isClear(grid: WalkGrid, p: Position, r: number): boolean {
  const out = resolve(grid, p, r);
  return isWalkablePoint(grid, p) && Math.abs(out.x - p.x) < 1e-9 && Math.abs(out.y - p.y) < 1e-9;
}
