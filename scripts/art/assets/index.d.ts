// Types for the procedural art registry, so the Phase 8A Character View (TypeScript) can build the same models in
// real time that the bake renders into sprites.
import type { Group } from 'three';

export interface ArtAssetSource {
  readonly id: string;
  readonly kind: string;
  readonly category: 'building' | 'nature' | 'road';
  readonly variant?: number;
  readonly front?: 'S' | 'E';
  readonly footprint?: { readonly w: number; readonly d: number };
  readonly model?: string;
  readonly mask?: number;
  readonly plaza?: boolean;
  readonly tile?: boolean;
  readonly origin?: 'base';
  readonly shadow?: boolean;
  build(group: Group): unknown;
}
export function allAssets(): ArtAssetSource[];
