import type { BuildingKind } from '../types';
import { hashString } from './npcMotion';

/**
 * Deterministic, presentation-only building variants. Derived from the stable building ID (and kind), so a
 * building looks identical across sessions, undo/redo and save/load without persisting any extra data.
 * Variants never change footprint, height used for hit testing, cost, capacity or any simulation data.
 */

export type RoofStyle = 'hip' | 'gable';
export type GardenStyle = 'palm' | 'tree' | 'hedge' | 'flowers';
export type RoofAccent = 'none' | 'chimney' | 'solar';
export type ParkLayout = 'cross' | 'curve' | 'ring';
export type ParkFeature = 'pond' | 'fountain' | 'gazebo' | 'playground';

export interface BuildingVariant {
  readonly index: number;
  readonly wall: number;
  readonly roof: number;
  readonly trim: number;
  readonly glass: number;
  readonly awning: number;
  readonly roofStyle: RoofStyle;
  readonly garden: GardenStyle;
  readonly accent: RoofAccent;
  readonly balconies: boolean;
  readonly parkLayout: ParkLayout;
  readonly parkFeature: ParkFeature;
  /** Seed for per-window decisions such as which windows glow at night. */
  readonly seed: number;
}

const HOUSE_WALLS = [0xf1e3c6, 0xf6efe2, 0xe9d3b0, 0xf0d9cf, 0xe6e1cf] as const;
const HOUSE_ROOFS = [0xc8714f, 0xb45f45, 0x9c5a46, 0x5f7f86, 0xd98a5f] as const;
const TOWER_WALLS = [0xdfe3d6, 0xe8e2d4, 0xd4dcd6, 0xe9dccb] as const;
const GLASS = [0x8fbcc0, 0x6fa6b8, 0x7fb3a6, 0x5d93a6] as const;
const AWNINGS = [0xc8714f, 0x5fa7a8, 0xe0c27a, 0x7f9f6f] as const;
const TRIMS = [0xf7f2e2, 0xffffff, 0xe8dcc4] as const;

function pick<T>(items: readonly T[], seed: number, salt: number): T {
  const mixed = Math.imul(seed ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return items[((mixed ^ (mixed >>> 15)) >>> 0) % items.length]!;
}

export function buildingVariant(id: string, kind: BuildingKind): BuildingVariant {
  const seed = hashString(`${kind}:${id}`);
  const house = kind === 'villa' || kind === 'duplex' || kind === 'townhouse';
  return {
    index: seed % 4,
    wall: house ? pick(HOUSE_WALLS, seed, 1) : pick(TOWER_WALLS, seed, 1),
    roof: pick(HOUSE_ROOFS, seed, 2),
    trim: pick(TRIMS, seed, 3),
    glass: pick(GLASS, seed, 4),
    awning: pick(AWNINGS, seed, 5),
    roofStyle: pick(['hip', 'gable'] as const, seed, 6),
    garden: pick(['palm', 'tree', 'hedge', 'flowers'] as const, seed, 7),
    accent: pick(['none', 'chimney', 'solar', 'chimney'] as const, seed, 8),
    balconies: pick([true, false, true] as const, seed, 9),
    parkLayout: pick(['cross', 'curve', 'ring'] as const, seed, 10),
    parkFeature: pick(['pond', 'fountain', 'gazebo', 'playground'] as const, seed, 11),
    seed,
  };
}

/** Stable on/off decision for one window at night (~70% lit, varying per building). */
export function windowLit(variant: BuildingVariant, windowIndex: number): boolean {
  const mixed = Math.imul(variant.seed ^ Math.imul(windowIndex + 7, 0x27d4eb2d), 0x165667b1) >>> 0;
  return ((mixed ^ (mixed >>> 13)) >>> 0) % 10 < 7;
}

export function shade(color: number, amount: number): number {
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 0xff) * amount)));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
