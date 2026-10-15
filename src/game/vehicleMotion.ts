import { decodePath, TRANSPORT } from '@tiny-city/simulation';
import type { Position, Vehicle } from '@tiny-city/simulation';

/**
 * Phase 6 presentation of vehicles. Pure functions only: the renderer turns the authoritative integer lane position
 * (route + front distance) into a smooth on-screen pose, and never feeds anything back into the simulation.
 *
 * - The centre line runs through tile centres; corners are rounded by averaging the line a little ahead of and
 *   behind the point, so turns read as arcs instead of sharp pivots.
 * - Vehicles keep to the right: the pose is offset to the right of the heading by `LANE_OFFSET` tiles.
 * - Between fixed ticks the front distance is interpolated (never the screen position), so a vehicle always stays on
 *   its road, even through a corner.
 */
const U = TRANSPORT.unitsPerTile;
export const LANE_OFFSET = 0.21;
/** Half-width of the corner rounding window (tiles). */
const ROUND = 0.32;
export const VEHICLE_DIRECTIONS = 16;

export interface VehiclePose { readonly x: number; readonly y: number; readonly angle: number }

/** Point on the centre line at distance `d` (tiles) from the first tile centre, extended straight past either end. */
function along(route: readonly Position[], d: number): Position {
  const last = route.length - 1;
  if (last < 1) return { x: route[0]!.x + 0.5, y: route[0]!.y + 0.5 };
  const i = Math.max(0, Math.min(last - 1, Math.floor(d)));
  const t = d - i;
  const a = route[i]!, b = route[i + 1]!;
  return { x: a.x + 0.5 + (b.x - a.x) * t, y: a.y + 0.5 + (b.y - a.y) * t };
}

/** Pose of a vehicle's centre whose front is `s` route units along `route`. Angle in radians on the map (0 = east, π/2 = south). */
export function vehiclePose(route: readonly Position[], s: number, length: number): VehiclePose {
  const d = (s - length / 2) / U;
  const back = along(route, d - ROUND), ahead = along(route, d + ROUND);
  const centre = { x: (back.x + ahead.x) / 2, y: (back.y + ahead.y) / 2 };
  const dx = ahead.x - back.x, dy = ahead.y - back.y;
  const norm = Math.hypot(dx, dy);
  // A U-turn at a dead end folds the window onto itself: keep the heading of the lane being entered.
  const heading = norm > 1e-6 ? { x: dx / norm, y: dy / norm } : (() => { const p = along(route, d + 0.6), q = along(route, d); const n = Math.hypot(p.x - q.x, p.y - q.y) || 1; return { x: (p.x - q.x) / n, y: (p.y - q.y) / n }; })();
  // Keep right: perpendicular to the right of the heading in a y-down grid.
  return { x: centre.x - heading.y * LANE_OFFSET, y: centre.y + heading.x * LANE_OFFSET, angle: Math.atan2(heading.y, heading.x) };
}

/** Nearest of the baked headings (0 = east, counting towards south). */
export function directionFrame(angle: number): number {
  const step = (Math.PI * 2) / VEHICLE_DIRECTIONS;
  return ((Math.round(angle / step) % VEHICLE_DIRECTIONS) + VEHICLE_DIRECTIONS) % VEHICLE_DIRECTIONS;
}

export const frontOf = (v: Vehicle) => v.edge * U + v.offset;
export const routeOf = (v: Vehicle) => decodePath(v.origin, v.path);
export const lengthOf = (v: Vehicle) => TRANSPORT.vehicles[v.kind].length;

/**
 * Where an old front distance lies on a new route: routes are only trimmed behind the vehicle or re-planned ahead
 * of its current lane, so the old route's tile at the new origin gives the shift. Null when unrelated (snap).
 */
export function remapFront(oldRoute: readonly Position[], oldS: number, newRoute: readonly Position[]): number | null {
  const origin = newRoute[0]!;
  for (let i = 0; i < oldRoute.length; i += 1) {
    const tile = oldRoute[i]!;
    if (tile.x !== origin.x || tile.y !== origin.y) continue;
    // The tile the old front was on must also be on the new route at the same place.
    const at = Math.min(oldRoute.length - 1, Math.floor(oldS / U));
    const newIndex = at - i;
    const check = newRoute[newIndex];
    if (newIndex >= 0 && check && check.x === oldRoute[at]!.x && check.y === oldRoute[at]!.y) return oldS - i * U;
  }
  return null;
}

/** Interpolation state per vehicle between the two latest fixed ticks. */
export interface VehicleSample {
  route: readonly Position[];
  from: number;
  to: number;
  tick: number;
}

/**
 * Advances a sample to a new snapshot of the vehicle. `shown` is the front distance currently drawn (the
 * interpolation starts there, so motion never jumps backwards when frames and ticks interleave).
 */
export function nextSample(sample: VehicleSample | undefined, vehicle: Vehicle, tick: number, shown: number | null): VehicleSample {
  const route = routeOf(vehicle), s = frontOf(vehicle);
  if (!sample) return { route, from: s, to: s, tick };
  if (sample.tick === tick && sample.route === route && sample.to === s) return sample;
  const start = shown ?? sample.to;
  const from = sample.route === route ? start : remapFront(sample.route, start, route);
  // Never interpolate across a discontinuity (a stall, a new trip on the same ID) or backwards.
  const continuous = from !== null && from <= s && s - from <= (Math.max(1, tick - sample.tick) + 1) * TRANSPORT.vehicles[vehicle.kind].maxSpeed;
  return { route, from: continuous ? from! : s, to: s, tick };
}

export function sampleFront(sample: VehicleSample, alpha: number): number {
  const t = Math.max(0, Math.min(1, alpha));
  return sample.from + (sample.to - sample.from) * t;
}

/** Body colours of residents' cars (palette index from the simulation) and of bus lines and vans. */
export const CAR_COLORS = [0xe88b74, 0x5fb0aa, 0xf3efe6, 0x3d464b, 0x8ec5d6, 0xc96f4f, 0xa3bb8c, 0xf1c45f] as const;
export const LINE_COLORS = [0x2f8f83, 0xd9603f, 0x4a73b8, 0xc4952a, 0x8a5bb0, 0x3f9d4f, 0xc9506e, 0x5a6b78] as const;
export const lineColorCss = (index: number) => `#${LINE_COLORS[index % LINE_COLORS.length]!.toString(16).padStart(6, '0')}`;
