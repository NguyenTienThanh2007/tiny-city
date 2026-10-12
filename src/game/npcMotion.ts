import type { Citizen, Position, WorldState } from '@tiny-city/simulation';

/**
 * Presentation-only helpers for resident sprites. Nothing here advances simulation state:
 * positions come from authoritative snapshots and are only blended between fixed ticks.
 */

export interface CitizenAppearance {
  readonly skin: number;
  readonly hair: number;
  readonly shirt: number;
  readonly pants: number;
  readonly hairStyle: 'short' | 'long' | 'bun' | 'cap';
  readonly silhouette: 'shirt' | 'dress' | 'jacket';
  readonly accessory: 'none' | 'bag' | 'scarf';
  /** Signed lateral lane offset in tiles; residents keep to their right on shared paths. */
  readonly lane: number;
}

const SKIN = [0xf3d2b3, 0xe8b98f, 0xc98f62, 0xa86b45, 0x7d4c32, 0xf0c7a0] as const;
const HAIR = [0x2d221c, 0x4a3326, 0x7a5132, 0xb07a45, 0xd7b06a, 0x8f8f8a, 0x1f2a33, 0xa4493a] as const;
// Coastal palette: terracotta, sea glass, sage, sand, ink blue, coral, mustard, lavender.
const SHIRT = [0xc8714f, 0x5fa7a8, 0x7f9f6f, 0xe0c27a, 0x3f5d7a, 0xe58f7a, 0xd5a33f, 0x9a88b8, 0xf2ece0, 0x4f7f62] as const;
const PANTS = [0x34495e, 0x5b4636, 0x3c4a3f, 0x6c7a89, 0x2f3437, 0x8a6f52] as const;
const HAIR_STYLES = ['short', 'long', 'bun', 'cap'] as const;
const SILHOUETTES = ['shirt', 'dress', 'jacket'] as const;
const ACCESSORIES = ['none', 'none', 'bag', 'scarf'] as const;

/** FNV-1a: stable across sessions and platforms, so a resident always looks the same. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pick<T>(items: readonly T[], seed: number, salt: number): T {
  const mixed = Math.imul(seed ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return items[((mixed ^ (mixed >>> 13)) >>> 0) % items.length]!;
}

export function citizenAppearance(citizenId: string): CitizenAppearance {
  const seed = hashString(citizenId);
  const laneMagnitude = 0.11 + (seed % 7) * 0.014;
  return {
    skin: pick(SKIN, seed, 1),
    hair: pick(HAIR, seed, 2),
    shirt: pick(SHIRT, seed, 3),
    pants: pick(PANTS, seed, 4),
    hairStyle: pick(HAIR_STYLES, seed, 5),
    silhouette: pick(SILHOUETTES, seed, 6),
    accessory: pick(ACCESSORIES, seed, 7),
    lane: laneMagnitude,
  };
}

export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Residents inside a building (or on its private entrance leg) are not drawn on the street. */
export function isCitizenOutdoors(citizen: Citizen): boolean {
  const movement = citizen.movement;
  if (!movement) return false;
  return movement.status !== 'inside' && movement.currentBuildingId === null;
}

/** Right-hand perpendicular of a tile heading in a y-down grid. */
export function laneOffset(heading: Position, lane: number): Position {
  if (heading.x === 0 && heading.y === 0) return { x: 0, y: 0 };
  return { x: -heading.y * lane, y: heading.x * lane };
}

export interface MotionSample {
  from: Position;
  to: Position;
  /** Simulation tick of `to`. */
  tick: number;
  revision: number;
  outdoors: boolean;
  heading: Position;
  /** Smoothed lane offset that eases around corners instead of jumping. */
  offset: Position;
  walkPhase: number;
  facing: 1 | -1;
  /** True when the resident faces away from the camera (walking up-screen). */
  away: boolean;
  /** Visible alpha, eased towards 1 outdoors and 0 indoors. */
  alpha: number;
  moving: boolean;
}

/** The furthest an ordinary walker can cover in one fixed tick (0.4 tiles/min at 1 min/tick) plus slack. */
const MAX_TILES_PER_TICK = 0.45;

/**
 * Advances a sample to a new authoritative snapshot. Returns true when the change was a discontinuity
 * (editor relocation, structural edit, re-entry from a building) and the sprite should snap.
 */
export function receiveSnapshot(sample: MotionSample | undefined, citizen: Citizen, world: WorldState): { sample: MotionSample; snapped: boolean } {
  const outdoors = isCitizenOutdoors(citizen);
  const heading = citizen.movement?.heading ?? { x: 0, y: 0 };
  if (!sample) {
    return { snapped: true, sample: {
      from: citizen.position, to: citizen.position, tick: world.clock.tick, revision: world.revision, outdoors,
      heading, offset: { x: 0, y: 0 }, walkPhase: hashString(citizen.id) % 628 / 100, facing: 1, away: false,
      alpha: outdoors ? 1 : 0, moving: citizen.movement?.status === 'travelling',
    } };
  }
  if (sample.tick === world.clock.tick && sample.revision === world.revision &&
      sample.to.x === citizen.position.x && sample.to.y === citizen.position.y && sample.outdoors === outdoors) {
    return { sample, snapped: false };
  }
  const elapsedTicks = Math.max(1, world.clock.tick - sample.tick);
  const distance = Math.abs(citizen.position.x - sample.to.x) + Math.abs(citizen.position.y - sample.to.y);
  const discontinuous = sample.revision !== world.revision && distance > 0 ||
    !sample.outdoors && outdoors ||
    distance > Math.max(1.2, elapsedTicks * MAX_TILES_PER_TICK * world.clock.minutesPerTick);
  const from = discontinuous ? citizen.position : sample.to;
  return { snapped: discontinuous, sample: { ...sample, from, to: citizen.position, tick: world.clock.tick,
    revision: world.revision, outdoors, moving: citizen.movement?.status === 'travelling',
    heading: heading.x === 0 && heading.y === 0 ? sample.heading : heading } };
}

/** Linear blend between the two latest fixed-step positions. Orthogonal routes keep corner cuts inside the road tile. */
export function blendPosition(sample: MotionSample, alpha: number): Position {
  const t = Math.max(0, Math.min(1, alpha));
  return { x: sample.from.x + (sample.to.x - sample.from.x) * t, y: sample.from.y + (sample.to.y - sample.from.y) * t };
}

/** Screen-space facing for an isometric heading: +x goes right/down, +y goes left/down. */
export function screenFacing(heading: Position, previous: 1 | -1): { facing: 1 | -1; away: boolean } {
  const dx = heading.x - heading.y;
  const dy = heading.x + heading.y;
  if (dx === 0 && dy === 0) return { facing: previous, away: false };
  return { facing: dx < 0 ? -1 : dx > 0 ? 1 : previous, away: dy < 0 };
}

/** Isometric depth for sorting residents among buildings that share the same container. */
export function citizenDepth(position: Position): number {
  return position.x + position.y;
}

/** A building's sort key sits between the deepest tile behind it and the shallowest tile in front of it. */
export function buildingDepth(x: number, y: number, width: number, height: number): number {
  return x + y + (width + height) / 2;
}
