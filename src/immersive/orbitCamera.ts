import type { Position } from '@tiny-city/simulation';
import { angleDelta } from './coordinates';

/**
 * Phase 8A third-person orbit camera. Pure state + math (no Three.js), so limits, damping and collision are tested
 * directly. The camera looks at a point above the character's shoulders and sits behind it at `distance`, raised by
 * `pitch`. Orbiting changes only the camera, never the character or the simulation.
 */

export const ORBIT = Object.freeze({
  /** Look-at height above the feet (tiles): a little under the 0.27-tile character's eye line. */
  targetHeight: 0.21,
  distance: Object.freeze({ min: 0.32, max: 2.1, initial: 0.92 }),
  /** Radians. Positive looks down on the character. */
  pitch: Object.freeze({ min: -0.12, max: 1.15, initial: 0.3 }),
  /** Default mouse sensitivity (radians per pixel) and the allowed settings range. */
  sensitivity: Object.freeze({ min: 0.001, max: 0.008, initial: 0.0034 }),
  /** Time constants (s): target follow, orbit smoothing, zoom easing, and easing back out after an obstruction. */
  follow: 0.06,
  orbit: 0.04,
  zoom: 0.12,
  recover: 0.35,
  /** Keep the camera this far in front of whatever blocks the view (tiles), and never closer than `nearest`. */
  margin: 0.06,
  nearest: 0.16,
  /** The camera never dips below this height (tiles). */
  floor: 0.05,
});

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }
export interface Box3 { readonly min: Vec3; readonly max: Vec3 }

export interface OrbitState {
  /** Where the camera looks along the ground (Three.js yaw convention: 0 looks toward +Z). */
  readonly yaw: number;
  readonly pitch: number;
  /** Wanted yaw/pitch (input) and the smoothed values above. */
  readonly yawTarget: number;
  readonly pitchTarget: number;
  /** Wanted distance (zoom) and the eased distance before collision. */
  readonly distanceTarget: number;
  readonly distance: number;
  /** Distance after obstruction handling (what is rendered). */
  readonly actual: number;
  /** Smoothed look-at point. */
  readonly target: Vec3;
  /** Seconds since the last orbit input. */
  readonly idle: number;
}

export const clampPitch = (pitch: number) => Math.max(ORBIT.pitch.min, Math.min(ORBIT.pitch.max, pitch));
export const clampDistance = (distance: number) => Math.max(ORBIT.distance.min, Math.min(ORBIT.distance.max, distance));
export const clampSensitivity = (value: number) => Math.max(ORBIT.sensitivity.min, Math.min(ORBIT.sensitivity.max, value));

export function createOrbit(feet: Position, yaw: number, options: { distance?: number; pitch?: number } = {}): OrbitState {
  const distance = clampDistance(options.distance ?? ORBIT.distance.initial), pitch = clampPitch(options.pitch ?? ORBIT.pitch.initial);
  return { yaw, pitch, yawTarget: yaw, pitchTarget: pitch, distanceTarget: distance, distance, actual: distance,
    target: { x: feet.x, y: ORBIT.targetHeight, z: feet.y }, idle: 0 };
}

/** Mouse / trackpad drag (pixels). Dragging right turns the view right; `invertY` flips the vertical axis. */
export function orbitBy(state: OrbitState, dx: number, dy: number, sensitivity: number = ORBIT.sensitivity.initial, invertY = false): OrbitState {
  const s = clampSensitivity(sensitivity);
  return { ...state, yawTarget: state.yawTarget - dx * s, pitchTarget: clampPitch(state.pitchTarget + (invertY ? -dy : dy) * s), idle: 0 };
}

/** Wheel / pinch zoom: proportional to the wheel delta, exact inverses, clamped. */
export function zoomBy(state: OrbitState, deltaY: number): OrbitState {
  if (!Number.isFinite(deltaY) || deltaY === 0) return state;
  return { ...state, distanceTarget: clampDistance(state.distanceTarget * Math.exp(Math.max(-0.5, Math.min(0.5, deltaY * 0.0015)))) };
}

/** Camera position for a look-at point, yaw, pitch and distance: behind (−forward) and above. */
export function cameraPosition(target: Vec3, yaw: number, pitch: number, distance: number): Vec3 {
  const horizontal = Math.cos(pitch) * distance;
  return { x: target.x - Math.sin(yaw) * horizontal, y: target.y + Math.sin(pitch) * distance, z: target.z - Math.cos(yaw) * horizontal };
}

/** Ray/box intersection (slab method). Returns the entry distance along the unit direction, or null. */
export function rayBox(origin: Vec3, dir: Vec3, box: Box3, maxT: number): number | null {
  let t0 = 0, t1 = maxT;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis], d = dir[axis], lo = box.min[axis], hi = box.max[axis];
    if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return null; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/**
 * How far the camera may sit from the look-at point along its direction before solid geometry gets in the way.
 * Obstacles are the buildings' solid boxes; the ground is handled by the height floor.
 */
export function unobstructedDistance(target: Vec3, yaw: number, pitch: number, wanted: number, solids: readonly Box3[]): number {
  const p = cameraPosition(target, yaw, pitch, 1);
  const dir = { x: p.x - target.x, y: p.y - target.y, z: p.z - target.z };
  let limit = wanted;
  for (const box of solids) {
    const t = rayBox(target, dir, box, wanted + ORBIT.margin);
    if (t !== null && t - ORBIT.margin < limit) limit = t - ORBIT.margin;
  }
  // Ground: keep the eye above the floor height.
  if (dir.y < 0) limit = Math.min(limit, (target.y - ORBIT.floor) / -dir.y);
  return Math.max(ORBIT.nearest, Math.min(wanted, limit));
}

export interface OrbitFrame {
  readonly state: OrbitState;
  readonly position: Vec3;
  readonly lookAt: Vec3;
}

/**
 * One frame: smooth the look-at point toward the character, ease yaw/pitch/zoom, and pull in at once in front of
 * obstructions (easing back out when the view clears). Frame-rate independent (1 − exp(−dt/τ)); reduced motion snaps.
 */
export function updateOrbit(state: OrbitState, feet: Position, dt: number, solids: readonly Box3[],
  options: { reducedMotion?: boolean } = {}): OrbitFrame {
  const a = (tau: number) => options.reducedMotion ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau);
  const goal = { x: feet.x, y: ORBIT.targetHeight, z: feet.y };
  const f = a(ORBIT.follow);
  const target = { x: state.target.x + (goal.x - state.target.x) * f, y: goal.y, z: state.target.z + (goal.z - state.target.z) * f };
  const idle = state.idle + Math.max(0, dt);
  // Controls are camera-relative (W walks away from the camera), so the camera never swings by itself: an
  // auto-follow would turn a held strafe into a circle. The player orbits with the mouse or trackpad.
  const yawTarget = state.yawTarget;
  const o = a(ORBIT.orbit);
  const yaw = state.yaw + angleDelta(state.yaw, yawTarget) * o;
  const pitch = state.pitch + (state.pitchTarget - state.pitch) * o;
  const distance = state.distance + (state.distanceTarget - state.distance) * a(ORBIT.zoom);
  const free = unobstructedDistance(target, yaw, pitch, distance, solids);
  // Obstruction: pull in immediately (never render through a wall); clear view: ease back out.
  const actual = free < state.actual ? free : state.actual + (free - state.actual) * a(ORBIT.recover);
  const next: OrbitState = { yaw, pitch, yawTarget, pitchTarget: state.pitchTarget, distanceTarget: state.distanceTarget, distance, actual: Math.min(actual, free), target, idle };
  return { state: next, position: cameraPosition(target, yaw, pitch, next.actual), lookAt: target };
}
