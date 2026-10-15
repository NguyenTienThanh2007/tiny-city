import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { allAssets, type ArtAssetSource } from '../../../scripts/art/assets/index.js';
import { applyWorldUVs, detailTexture } from '../../../scripts/art/lib/textures.js';
import { indexManifest, selectBuildingAsset, type ArtAssetRecord, type ArtIndex, type ArtManifest, type BuildingArtKey, type RoadSidesLike } from '../../game/art/artManifest';

/**
 * Phase 8A real-time art. The Character View builds the very same procedural models the bake renders into the City
 * View's sprites (`scripts/art/assets/*`, modelled in Three.js at one unit per tile), so a villa shows the same
 * architecture model in both views. Each model is built once, its meshes merged per material (a few dozen draw
 * calls per building instead of hundreds) and shared by every building that uses it.
 *
 * Night lighting follows the bake's tags: `userData.window` panes (lit ones glow warm), `userData.lamp` heads and
 * `userData.glow` coloured lights become emissive materials whose intensity the scene drives from the game clock.
 */

export type PartRole = 'solid' | 'foliage' | 'window' | 'lamp' | 'glow';
export interface AssetPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly role: PartRole;
  readonly castShadow: boolean;
}
export interface BuiltAsset {
  readonly id: string;
  readonly parts: readonly AssetPart[];
  /** Bounds of everything, in the model's own (south-facing design) space. */
  readonly bounds: THREE.Box3;
  /** Solid mass that should stop the camera (walls, roofs; not lawns, low walls or foliage), design space. */
  readonly solid: THREE.Box3 | null;
  readonly triangles: number;
  readonly buildMs: number;
}

let registry: Map<string, ArtAssetSource> | null = null;
let artIndex: { index: ArtIndex; ids: Map<ArtAssetRecord, string> } | null = null;

function sources(): Map<string, ArtAssetSource> {
  registry ??= new Map(allAssets().map((asset) => [asset.id, asset]));
  return registry;
}

/** The art index built from the asset registry itself (the bake writes the manifest from this same list). */
export function runtimeArtIndex(): { index: ArtIndex; ids: Map<ArtAssetRecord, string> } {
  if (artIndex) return artIndex;
  const assets: Record<string, ArtAssetRecord> = {};
  for (const [id, a] of sources()) {
    assets[id] = { kind: a.kind, category: a.category, variant: a.variant ?? 0, front: a.front ?? 'S', footprint: a.footprint ?? { w: 1, d: 1 },
      ...(a.model ? { model: a.model } : {}), ...(a.mask !== undefined ? { mask: a.mask } : {}), ...(a.plaza ? { plaza: true } : {}) };
  }
  const manifest: ArtManifest = { version: 1, resolution: 1, tile: { w: 56, h: 28 }, sheets: [], assets };
  const index = indexManifest(manifest);
  const ids = new Map<ArtAssetRecord, string>();
  for (const [id, record] of Object.entries(index.manifest.assets)) ids.set(record, id);
  artIndex = { index, ids };
  return artIndex;
}

/** The asset ID the City View would draw for a building facing S/E; N/W fronts reuse the S/E model, turned. */
export function buildingAssetId(building: BuildingArtKey, facing: 'S' | 'E' | 'N' | 'W'): string | null {
  const { index, ids } = runtimeArtIndex();
  const sides: RoadSidesLike = facing === 'E' || facing === 'W' ? { north: false, south: false, east: true, west: false } : { north: false, south: true, east: false, west: false };
  const record = selectBuildingAsset(index, building, sides);
  return record ? ids.get(record) ?? null : null;
}
export const assetSource = (id: string) => sources().get(id);
export const natureAssetIds = () => [...sources().values()].filter((a) => a.category === 'nature').map((a) => a.id);

const WARM = [0xffd27a, 0xffc366, 0xffdf9a, 0xfff0c4];
const LIT_SHARE = 0.62;
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (text: string) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

/** Shared night materials (intensity driven by the scene each frame). */
export const nightMaterials = {
  windows: WARM.map((color) => new THREE.MeshStandardMaterial({ color: 0x6f7f86, roughness: 0.2, metalness: 0.1, emissive: new THREE.Color(color), emissiveIntensity: 0 })),
  lamp: new THREE.MeshStandardMaterial({ color: 0xf6efe0, roughness: 0.4, emissive: new THREE.Color(0xfff2c8), emissiveIntensity: 0 }),
  glow: new Map<number, THREE.MeshStandardMaterial>(),
};
function glowMaterial(color: number) {
  let m = nightMaterials.glow.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: new THREE.Color(color), emissiveIntensity: 0.2 }); nightMaterials.glow.set(color, m); }
  return m;
}

/**
 * Painted surfaces that differ only in colour share one material: the colour moves into a vertex attribute (it
 * multiplies the detail map exactly as `material.color` did), so a model's dozens of tints merge into a handful of
 * draw calls. Glossy physical materials (glass, water) keep their own material.
 */
const signatureMaterials = new Map<string, THREE.MeshStandardMaterial>();
function signature(m: THREE.Material): string | null {
  if (m.type !== 'MeshStandardMaterial') return null;
  const s = m as THREE.MeshStandardMaterial;
  // Roughness and metalness are bucketed (steps of 0.2 / 0.4): at eye level the difference between 0.82 and 0.9
  // matte paint is invisible, and the buckets halve the draw calls again.
  const rough = Math.round(s.roughness * 5) / 5, metal = Math.round(s.metalness * 2.5) / 2.5;
  return [s.map?.uuid ?? '-', rough, metal, s.emissive.getHexString(), s.emissiveIntensity, s.transparent, s.opacity, s.side, s.flatShading, s.envMapIntensity, s.userData.texScale ?? 1].join('|');
}
function signatureMaterial(key: string, original: THREE.MeshStandardMaterial) {
  let m = signatureMaterials.get(key);
  if (!m) {
    m = original.clone(); m.color.set(0xffffff); m.vertexColors = true; m.name = `shared ${key}`;
    const [, rough, metal] = key.split('|');
    m.roughness = Number(rough); m.metalness = Number(metal);
    signatureMaterials.set(key, m);
  }
  return m;
}
function withColor(g: THREE.BufferGeometry, color: THREE.Color) {
  const n = g.attributes.position!.count, data = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) { data[i * 3] = color.r; data[i * 3 + 1] = color.g; data[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(data, 3));
}

const isFoliage = (m: THREE.Material) => { const map = (m as THREE.MeshStandardMaterial).map; return !!map && map === detailTexture('leaves'); };

/** Positions, normals and UVs only, non-indexed, transformed into the model root's space. */
function normalized(mesh: THREE.Mesh): THREE.BufferGeometry {
  let g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  if (g.index) g = g.toNonIndexed();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

const cache = new Map<string, BuiltAsset>();

/**
 * Builds (once) and returns a merged model. `origin: 'base'` nature assets are centred on their base point; building
 * and road assets span [0, w] × [0, d] with the street on +Z, exactly as modelled for the bake.
 */
export function buildAsset(id: string): BuiltAsset | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const source = sources().get(id);
  if (!source) return null;
  const started = performance.now();
  const root = new THREE.Group();
  source.build(root);
  applyWorldUVs(root);
  root.updateMatrixWorld(true);
  const random = seeded(hash(id) * 7919 + 13);
  const groups = new Map<string, { material: THREE.Material; role: PartRole; geometries: THREE.BufferGeometry[]; cast: boolean }>();
  const bounds = new THREE.Box3(), solid = new THREE.Box3();
  let triangles = 0;
  const meshBox = new THREE.Box3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const original = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    let role: PartRole = 'solid', material: THREE.Material = original;
    if (mesh.userData.lamp) { role = 'lamp'; material = nightMaterials.lamp; }
    else if (mesh.userData.glow !== undefined) { role = 'glow'; material = glowMaterial(mesh.userData.glow as number); }
    else if (mesh.userData.window && (mesh.userData.lit ?? random() < LIT_SHARE)) { role = 'window'; material = nightMaterials.windows[Math.floor(random() * WARM.length)]!; }
    else if (isFoliage(original)) role = 'foliage';
    const geometry = normalized(mesh);
    if (role === 'solid' || role === 'foliage') {
      const sig = signature(original);
      if (sig) { material = signatureMaterial(sig, original as THREE.MeshStandardMaterial); withColor(geometry, (original as THREE.MeshStandardMaterial).color); }
    }
    geometry.computeBoundingBox();
    meshBox.copy(geometry.boundingBox!);
    bounds.union(meshBox);
    // The camera stops at real mass: anything taller than a garden wall that is not foliage.
    if (role !== 'foliage' && meshBox.max.y > 0.16 && meshBox.max.y - meshBox.min.y > 0.08) solid.union(meshBox);
    triangles += geometry.attributes.position!.count / 3;
    const key = `${role}:${material.uuid}`;
    const group = groups.get(key) ?? { material, role, geometries: [], cast: false };
    group.geometries.push(geometry);
    group.cast ||= mesh.castShadow && meshBox.max.y > 0.03;
    groups.set(key, group);
  });
  const parts: AssetPart[] = [];
  for (const group of groups.values()) {
    const merged = group.geometries.length === 1 ? group.geometries[0]! : mergeGeometries(group.geometries, false);
    for (const g of group.geometries) if (g !== merged) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    parts.push({ geometry: merged, material: group.material, role: group.role, castShadow: group.cast });
  }
  // Only the merged copies are kept; the build's own geometries are released now.
  root.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.isMesh) mesh.geometry.dispose(); });
  const built: BuiltAsset = { id, parts, bounds, solid: solid.isEmpty() ? null : solid, triangles, buildMs: performance.now() - started };
  cache.set(id, built);
  return built;
}

/** Releases every cached model (GPU buffers are freed by the renderer's dispose on geometry). */
export function disposeAssetCache(): void {
  for (const built of cache.values()) for (const part of built.parts) part.geometry.dispose();
  cache.clear();
}
export const cachedAssetCount = () => cache.size;
