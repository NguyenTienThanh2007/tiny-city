import type { Building, Position } from '@tiny-city/simulation';
import { iso, type Point } from '../game/mapGeometry';

/**
 * Phase 8A coordinate convention, shared by the City View (PixiJS), the Character View (Three.js) and the simulation.
 *
 * - Simulation grid: continuous `Position {x, y}`; tile (i, j) covers [i, i + 1) × [j, j + 1). Authoritative.
 * - Three.js world: X = grid x, Z = grid y, Y = height. One unit is one tile (about 6.5 m), the same unit the baked
 *   art pipeline models in (`scripts/art/lib/kit.js`), so its procedural buildings drop into the 3D world unchanged.
 * - City View: `iso(x, y)` (2:1 dimetric, 56 × 28 px tiles); one unit of height lifts a point by HEIGHT_PX_PER_UNIT.
 *
 * Seen from the City View camera (+X, +Y, +Z looking at the origin), screen-right is +X − Z and screen-down is +X + Z,
 * which is exactly iso()'s (x − y, x + y): the 3D world is neither mirrored nor rotated relative to the map.
 * Positions are never derived from rendered sprite pixels.
 */

/** Real-world size of one tile, used only for documentation and HUD wording. */
export const METERS_PER_TILE = 6.5;
/** City View screen px per unit of height (matches scripts/art/lib/projection.js). */
export const HEIGHT_PX_PER_UNIT = 28 * Math.SQRT2 * Math.cos(Math.asin(28 / 56));

export interface WorldPoint { readonly x: number; readonly y: number; readonly z: number }
export type Facing = 'S' | 'E' | 'N' | 'W';

export const gridToWorld = (p: Position, elevation = 0): WorldPoint => ({ x: p.x, y: elevation, z: p.y });
export const worldToGrid = (w: { readonly x: number; readonly z: number }): Position => ({ x: w.x, y: w.z });
export const tileOf = (p: Position): Position => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
export const tileCenter = (tile: Position): Position => ({ x: tile.x + 0.5, y: tile.y + 0.5 });

/** Where a 3D point appears in the City View's world px (for framing the same place in both views). */
export function worldToIso(w: WorldPoint): Point {
  const ground = iso(w.x, w.z);
  return { x: ground.x, y: ground.y - w.y * HEIGHT_PX_PER_UNIT };
}

/** Ground-plane footprint of a building in 3D world units (min corner inclusive, max exclusive, like the grid). */
export function footprintBox(b: Pick<Building, 'position' | 'footprint'>) {
  return { minX: b.position.x, minZ: b.position.y, maxX: b.position.x + b.footprint.width, maxZ: b.position.y + b.footprint.height };
}

/**
 * Yaw (Three.js rotation.y) of something facing grid direction (dx, dy). Yaw 0 faces +Z (grid +y, the art's
 * "south"/street side); yaw π/2 faces +X.
 */
export const yawFromGridDirection = (dx: number, dy: number): number => Math.atan2(dx, dy);
export const gridDirectionFromYaw = (yaw: number): Position => ({ x: Math.sin(yaw), y: Math.cos(yaw) });
/** Facing → the grid direction a front door looks along. */
export const FACING_DIRECTION: Readonly<Record<Facing, Position>> = { S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, N: { x: 0, y: -1 }, W: { x: -1, y: 0 } };

/** Smallest signed difference between two angles, in (−π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Local-to-world transform for a south-facing art model (built in [0, w] × [0, d], street on +Z) placed on a footprint
 * so its front faces `facing`. S and E reproduce the City View exactly (identity, and the bake's x↔z mirror); N and W
 * add a half turn so entrances always face the road (the City View only ever shows S and E fronts).
 * Returns a column-major 4×4 matrix (Three.js `Matrix4.fromArray` order).
 */
export function placementMatrix(b: Pick<Building, 'position' | 'footprint'>, facing: Facing): number[] {
  const { x, y } = b.position, W = b.footprint.width, H = b.footprint.height;
  // Rows of the affine map (worldX, worldZ) = M · (localX, localZ, 1).
  let r: [number, number, number, number, number, number];
  switch (facing) {
    case 'S': r = [1, 0, x, 0, 1, y]; break;
    case 'E': r = [0, 1, x, 1, 0, y]; break;                 // x ↔ z mirror (the bake's SWAP)
    case 'N': r = [-1, 0, x + W, 0, -1, y + H]; break;       // half turn of S
    case 'W': r = [0, -1, x + W, -1, 0, y + H]; break;       // half turn of E
  }
  const [a, b2, tx, c, d, tz] = r;
  return [a, 0, c, 0, 0, 1, 0, 0, b2, 0, d, 0, tx, 0, tz, 1];
}
