import type { BuildingKind } from '../../types';
import { hashString } from '../npcMotion';

/**
 * Visual World 3.0 asset manifest (written by scripts/art/bake.mjs). Pure data and selection rules only, so
 * the renderer, tests and tooling agree on which baked sprite stands for which game object. Nothing here can
 * change simulation state: selection depends only on the stable building ID, its kind and which sides touch a road.
 */

export type ArtCategory = 'building' | 'nature' | 'road';
export type ArtFront = 'S' | 'E';
export interface ArtAssetRecord {
  readonly kind: string;
  readonly category: ArtCategory;
  readonly variant: number;
  readonly front: ArtFront;
  readonly footprint: { readonly w: number; readonly d: number };
  /** Road connection mask (N 1, E 2, S 4, W 8). */
  readonly mask?: number;
  /** Frame names inside the atlas pages. */
  readonly color?: string;
  readonly shadow?: string;
  readonly emissive?: string;
}
export interface ArtSheet { readonly file: string; readonly image: string; readonly width: number; readonly height: number; readonly sha256?: string }
export interface ArtManifest {
  readonly version: number;
  readonly resolution: number;
  readonly tile: { readonly w: number; readonly h: number };
  readonly sheets: readonly ArtSheet[];
  readonly assets: Readonly<Record<string, ArtAssetRecord>>;
}

/** The kinds the 3.0A vertical slice ships baked art for; every other kind keeps the vector renderer. */
export const BAKED_BUILDING_KINDS: readonly BuildingKind[] = ['villa', 'townhouse', 'apartment', 'park'];
export const MAX_ATLAS_SIZE = 4096;

/** Structural checks; returns human-readable problems (empty when the manifest is usable). */
export function validateManifest(value: unknown, footprints?: Readonly<Record<string, { width: number; height: number }>>): string[] {
  const errors: string[] = [];
  const manifest = value as Partial<ArtManifest> | null;
  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object'];
  if (manifest.version !== 1) errors.push(`unsupported manifest version ${String(manifest.version)}`);
  if (!(typeof manifest.resolution === 'number' && manifest.resolution > 0)) errors.push('resolution must be a positive number');
  if (!manifest.tile || manifest.tile.w !== 56 || manifest.tile.h !== 28) errors.push('tile size must be 56 × 28 (the game grid)');
  if (!Array.isArray(manifest.sheets) || manifest.sheets.length === 0) errors.push('no atlas sheets');
  for (const sheet of manifest.sheets ?? []) {
    if (!sheet.file?.endsWith('.json') || !sheet.image?.endsWith('.png')) errors.push(`sheet ${sheet.file} needs .json data and a .png image`);
    if (sheet.width > MAX_ATLAS_SIZE || sheet.height > MAX_ATLAS_SIZE) errors.push(`sheet ${sheet.file} exceeds ${MAX_ATLAS_SIZE}px`);
  }
  for (const [id, asset] of Object.entries(manifest.assets ?? {})) {
    if (!asset.color) errors.push(`${id} has no color frame`);
    if (asset.front !== 'S' && asset.front !== 'E') errors.push(`${id} has invalid front ${String(asset.front)}`);
    if (asset.category === 'road' && !(Number.isInteger(asset.mask) && asset.mask! >= 0 && asset.mask! < 16)) errors.push(`${id} needs a road mask 0–15`);
    const expected = asset.category === 'building' ? footprints?.[asset.kind] : undefined;
    if (expected && (expected.width !== asset.footprint.w || expected.height !== asset.footprint.d)) {
      errors.push(`${id} footprint ${asset.footprint.w}×${asset.footprint.d} does not match the catalog ${expected.width}×${expected.height}`);
    }
  }
  return errors;
}

/** Index of assets by role, built once per manifest. */
export interface ArtIndex {
  readonly manifest: ArtManifest;
  readonly buildings: ReadonlyMap<string, readonly ArtAssetRecord[]>;
  readonly roads: ReadonlyMap<number, ArtAssetRecord>;
  readonly nature: ReadonlyMap<string, ArtAssetRecord>;
}
export function indexManifest(manifest: ArtManifest): ArtIndex {
  const buildings = new Map<string, ArtAssetRecord[]>();
  const roads = new Map<number, ArtAssetRecord>();
  const nature = new Map<string, ArtAssetRecord>();
  for (const [id, asset] of Object.entries(manifest.assets)) {
    if (asset.category === 'building') buildings.set(asset.kind, [...(buildings.get(asset.kind) ?? []), asset]);
    else if (asset.category === 'road' && asset.mask !== undefined) roads.set(asset.mask, asset);
    else if (asset.category === 'nature') nature.set(id, asset);
  }
  for (const list of buildings.values()) list.sort((a, b) => a.variant - b.variant || a.front.localeCompare(b.front));
  return { manifest, buildings, roads, nature };
}

export interface RoadSidesLike { readonly north: boolean; readonly south: boolean; readonly east: boolean; readonly west: boolean }

/**
 * Deterministic building look: the variant comes from the stable ID, the facing from the road sides. Only the two
 * camera-facing sides have entrances; a road on the east (and not the south) turns the front east.
 */
export function selectBuildingAsset(index: ArtIndex, kind: string, id: string, sides: RoadSidesLike): ArtAssetRecord | null {
  const list = index.buildings.get(kind);
  if (!list?.length) return null;
  const variants = [...new Set(list.map((asset) => asset.variant))];
  const variant = variants[hashString(`vw3:${kind}:${id}`) % variants.length]!;
  const front: ArtFront = sides.east && !sides.south ? 'E' : 'S';
  return list.find((asset) => asset.variant === variant && asset.front === front)
    ?? list.find((asset) => asset.variant === variant) ?? null;
}

export function roadMask(has: (x: number, y: number) => boolean, x: number, y: number): number {
  return (has(x, y - 1) ? 1 : 0) | (has(x + 1, y) ? 2 : 0) | (has(x, y + 1) ? 4 : 0) | (has(x - 1, y) ? 8 : 0);
}

/** Decor kinds from worldDecor.ts mapped to baked nature assets; the variant picks among species. */
const DECOR_ASSETS: Record<string, readonly string[]> = {
  // Mostly greens; blossom and autumn are rare accents so groves never turn into candy-coloured patches.
  tree: ['tree.broadleaf.0', 'tree.broadleaf.1', 'tree.broadleaf.2', 'tree.broadleaf.0', 'tree.cypress.0', 'tree.broadleaf.1', 'tree.broadleaf.2'],
  accent: ['tree.blossom.0', 'tree.autumn.0', 'tree.blossom.0'],
  streetTree: ['tree.broadleaf.0', 'tree.broadleaf.2', 'tree.palm.1', 'tree.broadleaf.1'],
  palm: ['tree.palm.0', 'tree.palm.1', 'tree.palm.2'],
  bush: ['tree.shrub.0', 'tree.shrub.1', 'tree.shrub.2'],
  flowers: ['prop.flowers.0', 'prop.flowers.1', 'prop.flowers.2'],
  lamp: ['prop.lamp.0'],
};
export function selectDecorAsset(index: ArtIndex, kind: string, variant: number): ArtAssetRecord | null {
  const ids = DECOR_ASSETS[kind];
  if (!ids) return null;
  return index.nature.get(ids[Math.abs(variant) % ids.length]!) ?? null;
}
