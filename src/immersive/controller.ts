import type { Position } from '@tiny-city/simulation';
import { moveCircle, type WalkGrid } from './collision';
import { angleDelta } from './coordinates';

/**
 * Phase 8A third-person character controller. Pure: input + camera yaw + elapsed real time → next pose.
 *
 * Movement is integrated at a fixed 120 Hz step, so the same input over the same time gives the same path at any
 * frame rate (frame time is only ever split into whole steps; the remainder carries over). Speeds are in tiles per
 * real second: direct control is a real-time input, independent of the 1/2/4× game speed. Positions are proposals:
 * the bridge commits them to the simulation, which validates every step (`player.walk`).
 */

export const MOVEMENT = Object.freeze({
  /** ≈ 2.1 m/s at 6.5 m per tile: a brisk stroll at miniature scale. */
  walkSpeed: 0.32,
  /** ≈ 5.1 m/s. */
  runSpeed: 0.78,
  /** An exhausted character (energy below the critical threshold) moves slower, as in routed walking. */
  exhaustedFactor: 0.6,
  /** Time constants (s) of the exponential approach to the wanted velocity. */
  accelerate: 0.12,
  decelerate: 0.08,
  /** Facing turns toward the travel direction with this time constant (s). */
  turn: 0.07,
  /** Collision radius (tiles): the capsule's footprint, ≈ 0.45 m wide. */
  radius: 0.07,
  /**
   * Fixed integration step (s) and the most real time one frame may replay: the simulation clock's own 250 ms cap, so
   * a slow (software-rendered) frame keeps real-time speed while a stalled tab never jumps more than a fifth of a tile.
   */
  step: 1 / 120,
  maxFrame: 0.25,
  /** Below this speed (tiles/s) the character counts as standing. */
  still: 0.02,
  /** Distance covered by one full walk cycle (two steps), tiles. Running strides are longer. */
  walkStride: 0.2,
  runStride: 0.34,
});

export interface MoveInput {
  /** −1 (back) … 1 (forward). */
  readonly forward: number;
  /** −1 (left) … 1 (right). */
  readonly right: number;
  readonly run: boolean;
}
export const NO_INPUT: MoveInput = Object.freeze({ forward: 0, right: 0, run: false });

export interface ControllerState {
  readonly position: Position;
  readonly velocity: Position;
  /** Facing (Three.js yaw; 0 = grid +y). */
  readonly yaw: number;
  /** Walk cycle phase in radians, advanced by distance actually covered. */
  readonly stride: number;
  /** 0 … 1: how much of the run pose to blend in. */
  readonly runBlend: number;
  /** Real seconds not yet integrated (less than one step). */
  readonly carry: number;
  readonly blocked: boolean;
}

export type MotionState = 'standing' | 'walking' | 'running';

export function createController(position: Position, yaw: number): ControllerState {
  return { position, velocity: { x: 0, y: 0 }, yaw, stride: 0, runBlend: 0, carry: 0, blocked: false };
}

/**
 * Direction of travel in the grid plane for an input, relative to the camera yaw (the direction the camera looks).
 * Forward is away from the camera; right is screen-right (a camera looking along +Z sees +X on its left).
 */
export function inputDirection(input: MoveInput, cameraYaw: number): Position {
  const fx = Math.sin(cameraYaw), fy = Math.cos(cameraYaw);
  const rx = -Math.cos(cameraYaw), ry = Math.sin(cameraYaw);
  const x = fx * input.forward + rx * input.right, y = fy * input.forward + ry * input.right;
  const length = Math.hypot(x, y);
  return length > 1e-9 ? { x: x / Math.max(1, length), y: y / Math.max(1, length) } : { x: 0, y: 0 };
}

export const speedOf = (s: ControllerState) => Math.hypot(s.velocity.x, s.velocity.y);
export function motionState(s: ControllerState): MotionState {
  const v = speedOf(s);
  return v < MOVEMENT.still ? 'standing' : v > (MOVEMENT.walkSpeed + MOVEMENT.runSpeed) / 2 ? 'running' : 'walking';
}

/** One fixed step. */
export function stepController(state: ControllerState, input: MoveInput, cameraYaw: number, grid: WalkGrid, exhausted = false): ControllerState {
  const dt = MOVEMENT.step;
  const dir = inputDirection(input, cameraYaw);
  const top = (input.run ? MOVEMENT.runSpeed : MOVEMENT.walkSpeed) * (exhausted ? MOVEMENT.exhaustedFactor : 1);
  const want = { x: dir.x * top, y: dir.y * top };
  const pushing = dir.x !== 0 || dir.y !== 0;
  const k = 1 - Math.exp(-dt / (pushing ? MOVEMENT.accelerate : MOVEMENT.decelerate));
  let vx = state.velocity.x + (want.x - state.velocity.x) * k, vy = state.velocity.y + (want.y - state.velocity.y) * k;
  if (!pushing && Math.hypot(vx, vy) < MOVEMENT.still * 0.5) { vx = 0; vy = 0; }
  const moved = moveCircle(grid, state.position, { x: vx * dt, y: vy * dt }, MOVEMENT.radius);
  const dx = moved.position.x - state.position.x, dy = moved.position.y - state.position.y;
  const travelled = Math.hypot(dx, dy);
  // Velocity follows what really happened (sliding along a wall keeps only the free component; no sliding when stopped).
  if (moved.blocked) { vx = dx / dt; vy = dy / dt; }
  let yaw = state.yaw;
  // Turning toward the wanted direction also happens against a wall, so pushing into it still faces it.
  if (pushing) yaw += angleDelta(yaw, Math.atan2(dir.x, dir.y)) * (1 - Math.exp(-dt / MOVEMENT.turn));
  const speed = Math.hypot(vx, vy);
  const runTarget = speed > (MOVEMENT.walkSpeed + MOVEMENT.runSpeed) / 2 ? 1 : 0;
  const runBlend = state.runBlend + (runTarget - state.runBlend) * (1 - Math.exp(-dt / 0.15));
  const strideLength = MOVEMENT.walkStride + (MOVEMENT.runStride - MOVEMENT.walkStride) * runBlend;
  const stride = (state.stride + travelled / strideLength * Math.PI * 2) % (Math.PI * 2);
  return { position: moved.position, velocity: { x: vx, y: vy }, yaw: angleDelta(0, yaw), stride, runBlend, carry: state.carry, blocked: moved.blocked };
}

/** Advances by a frame's real elapsed time in whole fixed steps (carrying the remainder). Frozen while paused. */
export function advanceController(state: ControllerState, input: MoveInput, cameraYaw: number, frameSeconds: number, grid: WalkGrid,
  options: { paused?: boolean; exhausted?: boolean } = {}): ControllerState {
  if (options.paused) return { ...state, velocity: { x: 0, y: 0 }, carry: 0 };
  let time = state.carry + Math.max(0, Math.min(MOVEMENT.maxFrame, frameSeconds));
  let next = state;
  while (time >= MOVEMENT.step - 1e-12) {
    next = stepController(next, input, cameraYaw, grid, options.exhausted);
    time -= MOVEMENT.step;
  }
  return { ...next, carry: Math.max(0, time) };
}
