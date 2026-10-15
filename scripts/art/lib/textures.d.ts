import type { Object3D } from 'three';
/** Assigns world-unit UVs (uniform texel density) to every textured mesh under `root`. */
export function applyWorldUVs(root: Object3D): void;
import type { Texture } from 'three';
/** Cached procedural detail map (`plaster`, `leaves`, `grass`, `asphalt`, …). */
export function detailTexture(kind: string): Texture;
export const TEXTURE_SCALE: Readonly<Record<string, number>>;
