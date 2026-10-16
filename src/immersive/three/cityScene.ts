import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingDesign } from '@tiny-city/ai-architect';
import type { Position, WorldState } from '@tiny-city/simulation';
import { selectDecorAsset } from '../../game/art/artManifest';
import { windowsOn } from '../../game/lighting';
import { terrainColor } from '../../game/terrainArt';
import { TALL_DECOR, type Decor } from '../../game/worldDecor';
import { detailTexture, TEXTURE_SCALE } from '../../../scripts/art/lib/textures.js';
import { waterMat } from '../../../scripts/art/lib/kit.js';
import { busStop } from '../../../scripts/art/vehicles/models.js';
import { placementMatrix } from '../coordinates';
import type { Box3 as SolidBox } from '../orbitCamera';
import { CHUNK, chunkKey, diffStatic, staticSceneOf, stopFootprint, STOP_HEIGHT, type BuildingEntity, type StaticDiff, type StaticScene, type StopEntity } from '../world/sceneModel';
import { assetLod, buildAsset, buildingAssetId, lodMaterials, nightMaterials, runtimeArtIndex, type BuiltAsset } from './assetBuilder';
import { createSky, skyState, type SkyState } from './atmosphere';

/**
 * Phase 8B city scene: the whole city as a live, incrementally reconciled Three.js scene. `sync()` diffs the world's
 * static scene model against what is built (by building ID, road chunk, decor chunk and stop ID) and changes only
 * that, so the scene survives view switches (it is kept between visits; the GPU side is released on exit) and
 * follows construction, demolition and road edits. Distance levels keep any city size affordable:
 *
 * - near: the detailed model of each building (the bake's own model), detailed landscaping;
 * - mid: the same model in one vertex-coloured material (one or two draw calls per building);
 * - far: one instanced massing block per building (its real footprint and height) and light instanced trees;
 * - beyond the far distance (and outside the view frustum): nothing is drawn.
 *
 * Simulation entities are never culled: this only decides what is drawn.
 */

export type Quality = 'high' | 'low';
export const DISTANCES = Object.freeze({
  /** near: detailed model; mid: one-material model; far: massing block; decor: detailed landscaping (far trees beyond). */
  high: { near: 12, mid: 40, decor: 16, far: 80, fogNear: 30, fogFar: 84 },
  low: { near: 8, mid: 24, decor: 11, far: 45, fogNear: 15, fogFar: 48 },
});
/** Kept for 8A callers: the fog's far edge. */
export const VIEW_DISTANCE = { high: DISTANCES.high.fogFar, low: DISTANCES.low.fogFar } as const;
const MARGIN = 30;
const HYSTERESIS = 2;
const FLAT = new Set(['flowers', 'grass', 'stones']);
const NO_SHADOW = new Set(['flowers', 'grass', 'stones', 'bin', 'bikes']);
const TREES = new Set(['tree', 'accent', 'streetTree', 'palm']);
/** Massing heights before a model is built (tiles); replaced by the model's real height once built. */
const MASSING_HEIGHT: Record<string, number> = { villa: 0.55, duplex: 0.6, townhouse: 0.8, apartment: 1.6, office: 2.2, mall: 0.9, clubhouse: 0.6, cafe: 0.5, shops: 0.6, market: 0.4,
  cinema: 0.9, nightclub: 0.7, amusement: 0.6, park: 0.05, pool: 0.05, plaza: 0.05, stage: 0.5 };
const MASSING_COLOR: Record<string, number> = { home: 0xefe8dc, workplace: 0xd9dcd8, park: 0x8fb57a };

export interface CitySceneStats {
  buildings: number;
  models: number;
  modelIds: string[];
  fallback: string[];
  roadTiles: number;
  decor: number;
  stops: number;
  /** Buildings currently drawn with their detailed model / their mid-level model / as far massing. */
  nearBuildings: number;
  midBuildings: number;
  farBuildings: number;
  triangles: number;
  buildMs: number;
  /** Incremental reconciliations applied after the first hydration, and what the last one changed. */
  reconciles: number;
  lastSync: { added: number; removed: number; changed: number; roadChunks: number; decorChunks: number; stops: number; ms: number } | null;
}

type Level = 'near' | 'mid' | 'far' | 'none';
interface BuildingEntry {
  entity: BuildingEntity;
  group: THREE.Group;
  mid: THREE.Group | null;
  level: Level;
  centre: Position;
  solid: SolidBox | null;
  windows: THREE.MeshStandardMaterial[];
  slot: number;
  height: number;
  assetId: string | null;
}

function radialTexture(inner: string, outer: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function hash(text: string) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

/** Yields to the browser when the current slice has used its budget. */
export function slicer(budgetMs = 10) {
  let start = performance.now();
  return async () => {
    if (performance.now() - start < budgetMs) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    start = performance.now();
  };
}

/** A light, low-poly tree for far landscaping (one merged geometry, vertex-coloured). */
function farTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.03, 0.04, 0.5, 5); trunk.translate(0, 0.25, 0);
  const crown = new THREE.IcosahedronGeometry(0.34, 0); crown.scale(1, 1.1, 1); crown.translate(0, 0.8, 0);
  const paint = (g: THREE.BufferGeometry, color: number) => {
    const out = g.toNonIndexed(); const c = new THREE.Color(color), n = out.attributes.position!.count, data = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) data.set([c.r, c.g, c.b], i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(data, 3));
    for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') out.deleteAttribute(name);
    return out;
  };
  return mergeGeometries([paint(trunk, 0x6f5236), paint(crown, 0x5f8f4e)], false)!;
}
const FAR_TREE = { geometry: null as THREE.BufferGeometry | null, material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }) };

export class CityScene {
  readonly scene = new THREE.Scene();
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private readonly moon = new THREE.DirectionalLight(0x9fb4ff, 0);
  private readonly hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6b48, 1);
  private readonly sky = createSky();
  private readonly fog: THREE.Fog;
  private model: StaticScene | null = null;
  private groundSize = '';
  private ground: THREE.Object3D[] = [];
  private readonly buildings = new Map<string, BuildingEntry>();
  private readonly roadChunks = new Map<string, THREE.Group>();
  private readonly decorChunks = new Map<string, { detail: THREE.Group; far: THREE.Group; centre: Position }>();
  private readonly stops = new Map<string, THREE.Object3D>();
  private stopTemplate: THREE.Group | null = null;
  private pools: THREE.InstancedMesh | null = null;
  private poolMaterial: THREE.MeshBasicMaterial | null = null;
  private massing: THREE.InstancedMesh | null = null;
  private readonly freeSlots: number[] = [];
  private nextSlot = 0;
  private solidList: SolidBox[] = [];
  private solidsDirty = true;
  private lastWindowCheck = -Infinity;
  private lastLod = -Infinity;
  private sky0: SkyState | null = null;
  readonly stats: CitySceneStats = { buildings: 0, models: 0, modelIds: [], fallback: [], roadTiles: 0, decor: 0, stops: 0, nearBuildings: 0, midBuildings: 0, farBuildings: 0, triangles: 0, buildMs: 0, reconciles: 0, lastSync: null };

  constructor(readonly quality: Quality) {
    const d = DISTANCES[quality];
    this.fog = new THREE.Fog(0xd6ebf5, d.fogNear, d.fogFar);
    this.scene.fog = this.fog;
    this.scene.add(this.sky, this.hemi, this.sun, this.sun.target, this.moon, this.moon.target);
    if (quality === 'high') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const s = this.sun.shadow.camera;
      s.left = -10; s.right = 10; s.top = 10; s.bottom = -10; s.near = 0.5; s.far = 45;
      s.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.012;
    }
  }

  get current(): StaticScene | null { return this.model; }
  get decor(): readonly Decor[] { return this.model?.decor ?? []; }
  get skyNow(): SkyState | null { return this.sky0; }
  /** Camera obstruction boxes of every building (rebuilt only when buildings change). */
  get solids(): readonly SolidBox[] {
    if (this.solidsDirty) {
      this.solidList = [...this.buildings.values()].flatMap((b) => (b.solid ? [b.solid] : []));
      for (const s of this.model?.stops.values() ?? []) { const f = stopFootprint(s); this.solidList.push({ min: { x: f.minX, y: 0, z: f.minY }, max: { x: f.maxX, y: STOP_HEIGHT, z: f.maxY } }); }
      this.solidsDirty = false;
    }
    return this.solidList;
  }
  /** IDs of what is built, for the debug API and tests. */
  entityIds() { return { buildings: [...this.buildings.keys()].sort(), stops: [...this.stops.keys()].sort(), roads: this.model?.roads.size ?? 0 }; }

  // ------------------------------------------------------------ reconciliation

  /**
   * Brings the scene to the world: the first call hydrates everything (nearest to `focus` first), later calls apply
   * only the difference. Time-sliced through `slice`; `progress` reports hydration steps.
   */
  async sync(world: WorldState, designs: ReadonlyMap<string, BuildingDesign>, focus: Position, slice: () => Promise<void>,
    progress?: (done: number, total: number, label: string) => void, cancelled: () => boolean = () => false): Promise<StaticDiff> {
    const started = performance.now();
    const next = staticSceneOf(world, designs);
    const first = this.model === null;
    const diff = diffStatic(this.model, next);
    if (diff.empty && !first) { this.model = next; return diff; }
    progress?.(0, 4, 'Laying the ground');
    this.ensureGround(world);
    await slice(); if (cancelled()) return diff;
    progress?.(1, 4, 'Paving the streets');
    for (const key of diff.roadChunks) { this.rebuildRoadChunk(key, next); await slice(); if (cancelled()) return diff; }
    progress?.(2, 4, 'Raising the buildings');
    for (const id of diff.buildings.removed) this.removeBuilding(id);
    for (const b of diff.buildings.changed) this.removeBuilding(b.id);
    const add = [...diff.buildings.added, ...diff.buildings.changed]
      .sort((a, b) => Math.hypot(a.position.x - focus.x, a.position.y - focus.y) - Math.hypot(b.position.x - focus.x, b.position.y - focus.y));
    for (const b of add) { this.addBuilding(b); await slice(); if (cancelled()) return diff; }
    for (const id of diff.stops.removed) this.removeStop(id);
    for (const s of [...diff.stops.added, ...diff.stops.changed]) { this.removeStop(s.id); this.addStop(s); }
    progress?.(3, 4, 'Planting the gardens');
    for (const key of diff.decorChunks) { this.rebuildDecorChunk(key, next); await slice(); if (cancelled()) return diff; }
    if (diff.decorChunks.size) this.rebuildPools(next.decor);
    this.model = next;
    this.solidsDirty = true;
    this.stats.buildings = next.buildings.size; this.stats.roadTiles = next.roads.size; this.stats.stops = next.stops.size;
    this.stats.decor = next.decor.length;
    const models = new Set([...this.buildings.values()].flatMap((b) => (b.assetId ? [b.assetId] : [])));
    this.stats.models = models.size; this.stats.modelIds = [...models].sort();
    this.stats.fallback = [...this.buildings.values()].filter((b) => !b.assetId).map((b) => b.entity.id).sort();
    this.lastLod = -Infinity;
    const ms = Math.round(performance.now() - started);
    if (first) this.stats.buildMs = ms; else this.stats.reconciles += 1;
    this.stats.lastSync = { added: diff.buildings.added.length, removed: diff.buildings.removed.length, changed: diff.buildings.changed.length,
      roadChunks: diff.roadChunks.size, decorChunks: diff.decorChunks.size, stops: diff.stops.added.length + diff.stops.removed.length + diff.stops.changed.length, ms };
    progress?.(4, 4, 'Ready');
    return diff;
  }

  private ensureGround(world: WorldState) {
    const plan = world.plan, key = `${plan.width}x${plan.height}`;
    if (key === this.groundSize) return;
    for (const o of this.ground) { this.scene.remove(o); disposeTree(o); }
    this.groundSize = key;
    const size = plan.width;
    const minX = -MARGIN, minY = -MARGIN, maxX = plan.width + MARGIN, maxY = plan.height + MARGIN;
    const nx = maxX - minX, ny = maxY - minY;
    const geometry = new THREE.PlaneGeometry(nx, ny, nx, ny);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(minX + nx / 2, 0, minY + ny / 2);
    const pos = geometry.attributes.position!, colors = new Float32Array(pos.count * 3), uv = new Float32Array(pos.count * 2);
    const color = new THREE.Color(), scale = TEXTURE_SCALE.grass ?? 1;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), y = pos.getZ(i);
      color.setHex(terrainColor(x, y, size), THREE.SRGBColorSpace);
      colors.set([color.r, color.g, color.b], i * 3);
      // The land slopes under the sea along the same coastline the City View paints.
      const coast = x + y - (size * 2 - 8);
      pos.setY(i, -0.016 - Math.max(0, Math.min(1, (coast + 0.6) / 2)) * 0.09);
      uv[i * 2] = x / scale; uv[i * 2 + 1] = y / scale;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: detailTexture('grass') }));
    ground.receiveShadow = this.quality === 'high';
    ground.name = 'ground';
    const seaGeometry = new THREE.PlaneGeometry(nx, ny, 1, 1);
    seaGeometry.rotateX(-Math.PI / 2);
    seaGeometry.translate(minX + nx / 2, -0.05, minY + ny / 2);
    const su = seaGeometry.attributes.uv!;
    for (let i = 0; i < su.count; i += 1) su.setXY(i, su.getX(i) * nx / 2, su.getY(i) * ny / 2);
    const sea = new THREE.Mesh(seaGeometry, waterMat(0x4fb3bf));
    sea.name = 'sea';
    this.ground = [ground, sea];
    this.scene.add(ground, sea);
  }

  private chunkCentre(key: string): Position { const [cx, cy] = key.split(',').map(Number) as [number, number]; return { x: (cx + 0.5) * CHUNK, y: (cy + 0.5) * CHUNK }; }

  private instanced(group: THREE.Group, asset: BuiltAsset, matrices: readonly THREE.Matrix4[], shadows: boolean) {
    for (const part of asset.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = shadows && part.castShadow && this.quality === 'high';
      mesh.receiveShadow = this.quality === 'high';
      group.add(mesh);
    }
  }

  /** Road tiles of a chunk, merged per material into a few static meshes (they only change with road edits). */
  private rebuildRoadChunk(key: string, model: StaticScene) {
    const old = this.roadChunks.get(key);
    if (old) { this.scene.remove(old); disposeTree(old, false); this.roadChunks.delete(key); }
    const { index, ids } = runtimeArtIndex();
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const r of model.roads.values()) {
      if (chunkKey(r.x, r.y) !== key) continue;
      const record = r.plaza ? index.plaza : index.roads.get(r.mask) ?? null;
      const id = record ? ids.get(record) : undefined;
      const asset = id ? buildAsset(id) : null;
      if (!asset) continue;
      for (const part of asset.parts) byMaterial.set(part.material, [...(byMaterial.get(part.material) ?? []), part.geometry.clone().translate(r.x, 0, r.y)]);
    }
    if (!byMaterial.size) return;
    const group = new THREE.Group();
    group.name = `roads ${key}`;
    group.userData.centre = this.chunkCentre(key);
    for (const [material, list] of byMaterial) {
      const geometry = mergeGeometries(list, false)!;
      for (const g of list) g.dispose();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = this.quality === 'high';
      group.add(mesh);
    }
    this.roadChunks.set(key, group);
    this.scene.add(group);
  }

  private rebuildDecorChunk(key: string, model: StaticScene) {
    const old = this.decorChunks.get(key);
    if (old) { this.scene.remove(old.detail, old.far); disposeInstances(old.detail); disposeInstances(old.far); this.decorChunks.delete(key); }
    const items = model.decor.filter((d) => chunkKey(d.at.x, d.at.y) === key);
    if (!items.length) return;
    const { index, ids } = runtimeArtIndex();
    const byAsset = new Map<string, { kind: Decor['kind']; matrices: THREE.Matrix4[] }>();
    const farTrees: THREE.Matrix4[] = [];
    for (const d of items) {
      const turn = d.kind === 'lamp' || d.kind === 'bench' || d.kind === 'bin' || d.kind === 'bikes' || d.kind === 'planter' ? 0 : (hash(`${d.tile.x},${d.tile.y},${d.kind}`) % 628) / 100;
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(d.at.x, 0, d.at.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn), new THREE.Vector3(d.size, d.size, d.size));
      if (TREES.has(d.kind)) farTrees.push(new THREE.Matrix4().compose(new THREE.Vector3(d.at.x, 0, d.at.y), new THREE.Quaternion(), new THREE.Vector3(d.size * 1.1, d.size * 1.25, d.size * 1.1)));
      if (this.quality === 'low' && !TALL_DECOR.has(d.kind)) continue;
      const record = selectDecorAsset(index, d.kind, d.variant);
      const id = record ? ids.get(record) : undefined;
      if (!id) continue;
      const entry = byAsset.get(id) ?? { kind: d.kind, matrices: [] };
      entry.matrices.push(matrix);
      byAsset.set(id, entry);
    }
    const detail = new THREE.Group(), far = new THREE.Group(), centre = this.chunkCentre(key);
    detail.name = `decor ${key}`; far.name = `far trees ${key}`;
    for (const [id, { kind, matrices }] of byAsset) {
      const asset = buildAsset(id);
      if (!asset) continue;
      if (FLAT.has(kind)) { const flat = new THREE.Group(); flat.userData.flat = true; this.instanced(flat, asset, matrices, false); detail.add(flat); }
      else this.instanced(detail, asset, matrices, !NO_SHADOW.has(kind));
    }
    if (farTrees.length) {
      FAR_TREE.geometry ??= farTreeGeometry();
      const mesh = new THREE.InstancedMesh(FAR_TREE.geometry, FAR_TREE.material, farTrees.length);
      farTrees.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      far.add(mesh);
    }
    far.visible = false;
    this.decorChunks.set(key, { detail, far, centre });
    this.scene.add(detail, far);
  }

  private rebuildPools(decor: readonly Decor[]) {
    if (this.pools) { this.scene.remove(this.pools); this.pools.dispose(); this.pools = null; }
    const lamps = decor.filter((d) => d.kind === 'lamp');
    if (!lamps.length) return;
    if (!this.poolMaterial) {
      const texture = radialTexture('rgba(255,214,150,0.55)', 'rgba(255,214,150,0)');
      if (!texture) return;
      this.poolMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    }
    const geometry = new THREE.PlaneGeometry(0.8, 0.8); geometry.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(geometry, this.poolMaterial, lamps.length);
    lamps.forEach((d, i) => {
      const cx = d.tile.x + 0.5, cy = d.tile.y + 0.5;
      pools.setMatrixAt(i, new THREE.Matrix4().makeTranslation(d.at.x + (cx - d.at.x) * 0.45, 0.03, d.at.y + (cy - d.at.y) * 0.45));
    });
    pools.computeBoundingSphere();
    pools.renderOrder = 2;
    pools.name = 'light pools';
    this.pools = pools;
    this.scene.add(pools);
  }

  private ensureMassing(): THREE.InstancedMesh {
    if (this.massing && this.nextSlot < this.massing.count) return this.massing;
    const capacity = Math.max(256, (this.massing?.count ?? 0) * 2);
    const geometry = new THREE.BoxGeometry(1, 1, 1); geometry.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), capacity);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i += 1) mesh.setMatrixAt(i, zero);
    if (this.massing) {
      const m = new THREE.Matrix4(), c = new THREE.Color();
      for (let i = 0; i < this.massing.count; i += 1) { this.massing.getMatrixAt(i, m); mesh.setMatrixAt(i, m); if (this.massing.instanceColor) { this.massing.getColorAt(i, c); mesh.setColorAt(i, c); } }
      this.scene.remove(this.massing); this.massing.geometry.dispose(); (this.massing.material as THREE.Material).dispose(); this.massing.dispose();
    }
    mesh.setColorAt(0, new THREE.Color(0xffffff));
    mesh.frustumCulled = false;
    mesh.castShadow = false; mesh.receiveShadow = this.quality === 'high';
    mesh.name = 'far massing';
    this.massing = mesh;
    this.scene.add(mesh);
    return mesh;
  }

  private setMassing(entry: BuildingEntry, shown: boolean) {
    const mesh = this.ensureMassing();
    const b = entry.entity, inset = b.kind === 'park' ? 0.05 : 0.18;
    const m = shown ? new THREE.Matrix4().compose(new THREE.Vector3(entry.centre.x, 0, entry.centre.y), new THREE.Quaternion(),
      new THREE.Vector3(Math.max(0.2, b.footprint.width - inset * 2), Math.max(0.03, entry.height), Math.max(0.2, b.footprint.height - inset * 2))) : new THREE.Matrix4().makeScale(0, 0, 0);
    mesh.setMatrixAt(entry.slot, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private addBuilding(b: BuildingEntity) {
    // Idempotent: a hydration interrupted part-way (the view closed while loading) may have added it already.
    this.removeBuilding(b.id);
    const assetId = buildingAssetId({ id: b.id, kind: b.type, ...(b.design ? { design: b.design } : {}) }, b.facing);
    const asset = assetId ? buildAsset(assetId) : null;
    const group = new THREE.Group();
    group.name = `building ${b.id}`;
    group.userData = { buildingId: b.id, assetId: asset ? assetId : null, facing: b.facing };
    const matrix = new THREE.Matrix4().fromArray(placementMatrix(b, b.facing));
    const windows: THREE.MeshStandardMaterial[] = [];
    let solid: SolidBox | null = null, height = MASSING_HEIGHT[b.type] ?? 0.6;
    if (asset) {
      const own = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      for (const part of asset.parts) {
        let material = part.material;
        // Each building gets its own window materials, so homes go dark one by one at night like the City View.
        if (part.role === 'window') {
          let mine = own.get(part.material);
          if (!mine) { mine = (part.material as THREE.MeshStandardMaterial).clone(); own.set(part.material, mine); windows.push(mine); }
          material = mine;
        }
        const mesh = new THREE.Mesh(part.geometry, material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(matrix);
        // Near buildings cast their shadow from the simplified geometry (an invisible proxy below), not every detail.
        mesh.castShadow = false;
        mesh.receiveShadow = this.quality === 'high';
        group.add(mesh);
      }
      if (asset.solid) { const box = asset.solid.clone().applyMatrix4(matrix); solid = { min: { ...box.min }, max: { ...box.max } }; height = box.max.y; }
    } else {
      // A building without a model: a clearly marked, style-compatible massing on the exact footprint (never another model).
      const h = b.kind === 'home' ? 0.5 : b.kind === 'park' ? 0.04 : 0.9, inset = 0.18;
      const mass = new THREE.Mesh(new THREE.BoxGeometry(b.footprint.width - inset * 2, h, b.footprint.height - inset * 2), new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.85 }));
      mass.position.set(b.position.x + b.footprint.width / 2, h / 2, b.position.y + b.footprint.height / 2);
      const band = new THREE.Mesh(new THREE.BoxGeometry(b.footprint.width - inset * 2 + 0.02, 0.05, b.footprint.height - inset * 2 + 0.02), new THREE.MeshStandardMaterial({ color: 0xc8714f, roughness: 0.7 }));
      band.position.set(mass.position.x, h - 0.03, mass.position.z);
      mass.castShadow = mass.receiveShadow = this.quality === 'high';
      group.add(mass, band);
      group.userData.fallback = true;
      solid = { min: { x: b.position.x + inset, y: 0, z: b.position.y + inset }, max: { x: b.position.x + b.footprint.width - inset, y: h, z: b.position.y + b.footprint.height - inset } };
      height = h;
    }
    let mid: THREE.Group | null = null;
    if (asset) {
      const lod = assetLod(asset);
      mid = new THREE.Group();
      mid.name = `building-mid ${b.id}`;
      for (const [geometry, material] of [[lod.body, lodMaterials.body], [lod.windows, lodMaterials.windows]] as const) {
        if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix);
        mesh.castShadow = this.quality === 'high'; mesh.receiveShadow = this.quality === 'high';
        mid.add(mesh);
      }
      mid.visible = false;
      this.scene.add(mid);
      if (this.quality === 'high') {
        const proxy = new THREE.Mesh(lod.body, SHADOW_PROXY);
        proxy.matrixAutoUpdate = false; proxy.matrix.copy(matrix);
        proxy.castShadow = true; proxy.receiveShadow = false;
        proxy.name = 'shadow proxy';
        group.add(proxy);
      }
    }
    const slot = this.freeSlots.pop() ?? this.nextSlot++;
    const entry: BuildingEntry = { entity: b, group, mid, level: 'near', centre: { x: b.position.x + b.footprint.width / 2, y: b.position.y + b.footprint.height / 2 }, solid, windows, slot, height, assetId: asset ? assetId : null };
    this.ensureMassing().setColorAt(slot, new THREE.Color(MASSING_COLOR[b.kind] ?? 0xe6e1d8));
    if (this.massing!.instanceColor) this.massing!.instanceColor.needsUpdate = true;
    this.setMassing(entry, false);
    this.buildings.set(b.id, entry);
    this.scene.add(group);
    this.solidsDirty = true;
    if (asset) this.stats.triangles += asset.triangles;
  }

  private removeBuilding(id: string) {
    const entry = this.buildings.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    if (entry.mid) this.scene.remove(entry.mid);
    for (const m of entry.windows) m.dispose();
    if (entry.group.userData.fallback) disposeTree(entry.group);
    this.setMassing(entry, false);
    this.freeSlots.push(entry.slot);
    this.buildings.delete(id);
    this.solidsDirty = true;
  }

  private addStop(s: StopEntity) {
    this.stopTemplate ??= mergedStop();
    const stop = this.stopTemplate.clone();
    stop.name = `stop ${s.id}`;
    stop.userData.stopId = s.id;
    stop.position.set(s.tile.x + 0.5, 0.024, s.tile.y + 0.5);
    // The shelter is modelled on the north curb (−Z); turn it to its curb.
    stop.rotation.y = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 }[s.side];
    stop.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = this.quality === 'high'; mesh.receiveShadow = this.quality === 'high'; } });
    this.stops.set(s.id, stop);
    this.scene.add(stop);
  }
  private removeStop(id: string) { const stop = this.stops.get(id); if (stop) { this.scene.remove(stop); this.stops.delete(id); } }

  // ------------------------------------------------------------ per frame

  /** Sky, sun and night lights from the clock; shadows, levels of detail and culling around the focus point. */
  update(minuteOfDay: number, focus: Position, cameraPosition: THREE.Vector3) {
    const sky = skyState(minuteOfDay);
    this.sky0 = sky;
    const u = this.sky.material.uniforms;
    (u.top!.value as THREE.Color).setHex(sky.skyTop, THREE.SRGBColorSpace);
    (u.horizon!.value as THREE.Color).setHex(sky.skyHorizon, THREE.SRGBColorSpace);
    (u.sunDir!.value as THREE.Vector3).set(sky.sunDirection.x, sky.sunDirection.y, sky.sunDirection.z);
    (u.sunColor!.value as THREE.Color).setHex(sky.sunColor, THREE.SRGBColorSpace);
    u.sunGlow!.value = sky.lighting.sun;
    this.sky.position.copy(cameraPosition);
    this.fog.color.setHex(sky.skyHorizon, THREE.SRGBColorSpace);
    this.hemi.color.setHex(sky.skyTop, THREE.SRGBColorSpace).lerp(WHITE, 0.55);
    this.hemi.groundColor.setHex(sky.groundColor, THREE.SRGBColorSpace);
    this.hemi.intensity = sky.hemisphereIntensity;
    this.scene.environmentIntensity = sky.environmentIntensity;
    // The sun's shadow camera follows the character, snapped to shadow texels so edges never crawl.
    const texel = 20 / 2048;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.y / texel) * texel;
    this.sun.color.setHex(sky.sunColor, THREE.SRGBColorSpace);
    this.sun.intensity = sky.sunIntensity;
    this.sun.position.set(fx + sky.sunDirection.x * 20, sky.sunDirection.y * 20, fz + sky.sunDirection.z * 20);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.visible = sky.sunIntensity > 0.01;
    this.moon.intensity = sky.moonIntensity;
    this.moon.position.set(fx - 8, 14, fz + 6); this.moon.target.position.set(fx, 0, fz);
    nightMaterials.lamp.emissiveIntensity = 2.2 * sky.glow;
    lodMaterials.windows.emissiveIntensity = 1.3 * sky.glow;
    for (const m of nightMaterials.glow.values()) m.emissiveIntensity = 0.2 + 2 * sky.glow;
    if (this.poolMaterial) this.poolMaterial.opacity = sky.glow;
    const now = performance.now();
    if (now - this.lastWindowCheck > 400) {
      this.lastWindowCheck = now;
      for (const entry of this.buildings.values()) {
        const on = sky.glow * windowsOn(entry.entity.type, entry.entity.id, minuteOfDay);
        for (const m of entry.windows) m.emissiveIntensity = 1.6 * on;
      }
    }
    if (now - this.lastLod > 200) { this.lastLod = now; this.applyLevels(focus); }
  }

  /** Near / mid / far / hidden for every building and landscaping chunk, with hysteresis so nothing flickers. */
  private applyLevels(focus: Position) {
    const d = DISTANCES[this.quality];
    let near = 0, mid = 0, far = 0;
    const pad = (level: Level, limit: Level) => (level === limit ? HYSTERESIS : 0);
    for (const entry of this.buildings.values()) {
      const dist = Math.hypot(entry.centre.x - focus.x, entry.centre.y - focus.y);
      const level: Level = dist < d.near + pad(entry.level, 'near') || !entry.mid && dist < d.mid ? 'near'
        : dist < d.mid + pad(entry.level, 'mid') ? 'mid' : dist < d.far ? 'far' : 'none';
      if (level !== entry.level) {
        entry.level = level;
        entry.group.visible = level === 'near';
        if (entry.mid) entry.mid.visible = level === 'mid';
        this.setMassing(entry, level === 'far');
      }
      if (level === 'near') near += 1; else if (level === 'mid') mid += 1; else if (level === 'far') far += 1;
    }
    this.stats.midBuildings = mid;
    this.stats.nearBuildings = near; this.stats.farBuildings = far;
    for (const chunk of this.decorChunks.values()) {
      const dist = Math.hypot(chunk.centre.x - focus.x, chunk.centre.y - focus.y) - CHUNK * 0.7;
      chunk.detail.visible = dist < d.decor;
      for (const child of chunk.detail.children) if (child.userData.flat) child.visible = dist < 10;
      chunk.far.visible = !chunk.detail.visible && dist < d.far;
    }
    for (const group of this.roadChunks.values()) {
      const c = group.userData.centre as Position;
      group.visible = Math.hypot(c.x - focus.x, c.y - focus.y) - CHUNK * 0.7 < d.far;
    }
    for (const stop of this.stops.values()) stop.visible = Math.hypot(stop.position.x - focus.x, stop.position.z - focus.y) < d.near + 4;
  }

  /** Frees every GPU resource (three keeps dispose listeners holding the renderer); objects stay and re-upload. */
  releaseGpu() { releaseGpuResources(this.scene); }

  dispose() {
    releaseGpuResources(this.scene);
    for (const entry of this.buildings.values()) for (const m of entry.windows) m.dispose();
    this.scene.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
    this.scene.clear();
    this.buildings.clear(); this.roadChunks.clear(); this.decorChunks.clear(); this.stops.clear();
    this.model = null;
  }
}

const WHITE = new THREE.Color(0xffffff);
/** Writes nothing in the main pass; in the shadow pass three substitutes its depth material, so the proxy casts. */
const SHADOW_PROXY = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

function disposeInstances(group: THREE.Object3D) { group.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); }); }
function disposeTree(o: THREE.Object3D, materials = true) {
  o.traverse((x) => { const mesh = x as THREE.Mesh; if (!mesh.isMesh) return; mesh.geometry.dispose(); if (materials) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose(); });
}

/** The bus shelter merged into one vertex-coloured mesh (plus its glowing sign), so a stop is one or two draw calls. */
function mergedStop(): THREE.Group {
  const source = busStop();
  source.updateMatrixWorld(true);
  const solid: THREE.BufferGeometry[] = [], light: THREE.BufferGeometry[] = [];
  source.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const c = ((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial).color, n = g.attributes.position!.count, data = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) data.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(data, 3));
    (mesh.userData.layer === 'light' ? light : solid).push(g);
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeometries(solid, false)!, lodMaterials.body));
  if (light.length) group.add(new THREE.Mesh(mergeGeometries(light, false)!, nightMaterials.lamp));
  return group;
}

/** Releases the GPU side of every material, geometry and texture under `root` (the objects stay usable). */
export function releaseGpuResources(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>();
  const instanced: THREE.InstancedMesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) instanced.push(mesh as THREE.InstancedMesh);
    geometries.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(m);
      for (const value of Object.values(m)) if ((value as THREE.Texture)?.isTexture) textures.add(value as THREE.Texture);
    }
  });
  if ((root as THREE.Scene).environment) textures.add((root as THREE.Scene).environment!);
  for (const m of materials) m.dispose();
  for (const g of geometries) g.dispose();
  for (const t of textures) t.dispose();
  // Instanced meshes carry their own renderer dispose listener (instance buffers); they re-upload on next use.
  for (const m of instanced) m.dispose();
}
