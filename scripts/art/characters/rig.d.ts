import type { Group, Mesh } from 'three';
export interface Limb { readonly upper: Group; readonly lower: Group; readonly end: Group }
export interface Skeleton {
  readonly root: Group; readonly hips: Group; readonly torso: Group; readonly neck: Group; readonly head: Group;
  readonly armR: Limb; readonly armL: Limb; readonly legR: Limb; readonly legL: Limb;
}
export const POSES: Readonly<Record<'walk' | 'idle' | 'wave' | 'talk' | 'sit', number>>;
export function createSkeleton(): Skeleton;
export function applyPose(skeleton: Skeleton, name: 'walk' | 'idle' | 'wave' | 'talk' | 'sit', frame: number): void;
export const LAYERS: Readonly<Record<string, { readonly tint: string | null; readonly front?: boolean;
  readonly variants: Readonly<Record<string, (skeleton: Skeleton, side: 'armR' | 'armL' | 'legR' | 'legL') => Mesh[]>> }>>;
export const CHARACTER_HEIGHT: number;
/** Tessellation scale for real-time builds (1 = exactly as baked). */
export function setRigDetail(detail: number): void;
