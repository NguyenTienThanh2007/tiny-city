import * as THREE from 'three';
import type { BuildingDesign } from '@tiny-city/ai-architect';
import type { Building, Position, WorldState } from '@tiny-city/simulation';
import { selectDecorAsset, selectRoadAsset } from '../../game/art/artManifest';
import { windowsOn } from '../../game/lighting';
import { terrainColor } from '../../game/terrainArt';
import { planDecor, TALL_DECOR, type Decor } from '../../game/worldDecor';
import { detailTexture, TEXTURE_SCALE } from '../../../scripts/art/lib/textures.js';
import { waterMat } from '../../../scripts/art/lib/kit.js';
import { placementMatrix, type Facing } from '../coordinates';
import type { Box3 as SolidBox } from '../orbitCamera';
import { facingFor, roadSides } from '../spawn';
import { buildAsset, buildingAssetId, nightMaterials, runtimeArtIndex, type BuiltAsset } from './assetBuilder';
import { createSky, skyState, type SkyState } from './atmosphere';

/**
 * Phase 8A neighbourhood: the authoritative plan turned into a real-time 3D scene. Every building, road tile and
 * piece of landscaping comes from the same plan, catalog footprints, saved designs and deterministic decor the City
 * View draws; nothing is invented. Roads and decor are instanced per spatial chunk (so the camera frustum and the
 * distance limit cull them), buildings share merged models, and the scene is built in short time slices so the page
 * stays responsive while it loads.
 */

export type Quality = 'high' | 'low';
export const VIEW_DISTANCE = { high: 30, low: 20 } as const;
const CHUNK = 8;
const MARGIN = 26;

export interface NeighbourhoodStats {
  buildings: number;
  /** Distinct architecture models built (shared between buildings that use the same one). */
  models: number;
  modelIds: string[];
  /** Buildings drawn as labelled stand-ins because no model exists for them. */
  fallback: string[];
  roadTiles: number;
  decor: number;
  /** Triangles in the scene (instanced copies counted). */
  triangles: number;
  buildMs: number;
}

interface BuildingEntry { readonly building: Building; readonly group: THREE.Group; readonly centre: Position; readonly windows: THREE.MeshStandardMaterial[]; readonly assetId: string | null; readonly facing: Facing }

const designOf = (designs: ReadonlyMap<string, BuildingDesign>, id: string) => designs.get(id);
const chunkKey = (x: number, y: number) => `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
function hash(text: string) { let h = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

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

/** Yields to the browser when the current slice has used its budget. */
function slicer(budgetMs = 10) {
  let start = performance.now();
  return async () => {
    if (performance.now() - start < budgetMs) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    start = performance.now();
  };
}

export class Neighbourhood {
  readonly scene = new THREE.Scene();
  readonly solids: SolidBox[] = [];
  readonly stats: NeighbourhoodStats = { buildings: 0, models: 0, modelIds: [], fallback: [], roadTiles: 0, decor: 0, triangles: 0, buildMs: 0 };
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private readonly moon = new THREE.DirectionalLight(0x9fb4ff, 0);
  private readonly hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6b48, 1);
  private readonly sky = createSky();
  private readonly fog = new THREE.Fog(0xd6ebf5, 14, 30);
  private readonly buildings: BuildingEntry[] = [];
  private readonly chunks = new Map<string, { group: THREE.Group; centre: Position }>();
  private readonly owned: { dispose(): void }[] = [];
  private poolMaterial: THREE.MeshBasicMaterial | null = null;
  private lastWindowCheck = -Infinity;
  private sky0: SkyState | null = null;
  readonly decor: readonly Decor[];

  constructor(private readonly world: WorldState, private readonly designs: ReadonlyMap<string, BuildingDesign>, readonly quality: Quality) {
    this.decor = planDecor(world.plan);
    this.scene.fog = this.fog;
    this.scene.add(this.sky, this.hemi, this.sun, this.sun.target, this.moon, this.moon.target);
    this.fog.far = VIEW_DISTANCE[quality];
    this.fog.near = VIEW_DISTANCE[quality] * 0.45;
    if (quality === 'high') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const s = this.sun.shadow.camera;
      s.left = -9; s.right = 9; s.top = 9; s.bottom = -9; s.near = 0.5; s.far = 40;
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.012;
      this.sun.shadow.radius = 3;
    }
  }

  private chunk(x: number, y: number): THREE.Group {
    const key = chunkKey(x, y);
    let entry = this.chunks.get(key);
    if (!entry) {
      const group = new THREE.Group();
      group.name = `chunk ${key}`;
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      entry = { group, centre: { x: (cx + 0.5) * CHUNK, y: (cy + 0.5) * CHUNK } };
      this.chunks.set(key, entry);
      this.scene.add(group);
    }
    return entry.group;
  }

  /** Places instanced copies of a model's parts, one InstancedMesh per part per chunk. */
  private instance(asset: BuiltAsset, placements: readonly { x: number; y: number; matrix: THREE.Matrix4 }[], shadows: boolean) {
    const byChunk = new Map<string, THREE.Matrix4[]>();
    for (const p of placements) { const key = chunkKey(p.x, p.y); byChunk.set(key, [...(byChunk.get(key) ?? []), p.matrix]); }
    for (const [key, matrices] of byChunk) {
      const [cx, cy] = key.split(',').map(Number) as [number, number];
      const group = this.chunk(cx * CHUNK, cy * CHUNK);
      for (const part of asset.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = shadows && part.castShadow && this.quality === 'high';
        mesh.receiveShadow = this.quality === 'high';
        group.add(mesh);
        this.owned.push({ dispose: () => mesh.dispose() });
        this.stats.triangles += (part.geometry.attributes.position!.count / 3) * matrices.length;
      }
    }
  }

  private ground() {
    const plan = this.world.plan, size = plan.width;
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
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: detailTexture('grass') });
    const ground = new THREE.Mesh(geometry, material);
    ground.receiveShadow = this.quality === 'high';
    ground.name = 'ground';
    this.scene.add(ground);
    this.owned.push(geometry, material);
    // The sea: a glossy water sheet where the land has dipped below it.
    const seaGeometry = new THREE.PlaneGeometry(nx, ny, 1, 1);
    seaGeometry.rotateX(-Math.PI / 2);
    seaGeometry.translate(minX + nx / 2, -0.05, minY + ny / 2);
    const water = waterMat(0x4fb3bf);
    const sea = new THREE.Mesh(seaGeometry, water);
    const su = seaGeometry.attributes.uv!;
    for (let i = 0; i < su.count; i += 1) su.setXY(i, su.getX(i) * nx / 2, su.getY(i) * ny / 2);
    sea.name = 'sea';
    this.scene.add(sea);
    this.owned.push(seaGeometry);
  }

  private async roads(slice: () => Promise<void>) {
    const plan = this.world.plan;
    const { index, ids } = runtimeArtIndex();
    const roads = new Set(plan.roads.map((r) => `${r.x},${r.y}`));
    const has = (x: number, y: number) => roads.has(`${x},${y}`);
    const byAsset = new Map<string, { x: number; y: number; matrix: THREE.Matrix4 }[]>();
    for (const r of plan.roads) {
      const record = selectRoadAsset(index, has, r.x, r.y);
      const id = record ? ids.get(record) : undefined;
      if (!id) continue;
      byAsset.set(id, [...(byAsset.get(id) ?? []), { x: r.x, y: r.y, matrix: new THREE.Matrix4().makeTranslation(r.x, 0, r.y) }]);
    }
    for (const [id, placements] of byAsset) {
      const asset = buildAsset(id);
      if (asset) this.instance(asset, placements, false);
      await slice();
    }
    this.stats.roadTiles = plan.roads.length;
  }

  private async buildingModels(slice: () => Promise<void>) {
    const plan = this.world.plan;
    const roads = new Set(plan.roads.map((r) => `${r.x},${r.y}`));
    const isRoad = (x: number, y: number) => roads.has(`${x},${y}`);
    const models = new Set<string>();
    for (const building of plan.buildings) {
      const facing = facingFor(roadSides(building, isRoad));
      const design = designOf(this.designs, building.id);
      const assetId = building.type ? buildingAssetId({ id: building.id, kind: building.type, ...(design ? { design } : {}) }, facing) : null;
      const asset = assetId ? buildAsset(assetId) : null;
      const group = new THREE.Group();
      group.name = `building ${building.id}`;
      group.userData = { buildingId: building.id, assetId, facing };
      const matrix = new THREE.Matrix4().fromArray(placementMatrix(building, facing));
      const windows: THREE.MeshStandardMaterial[] = [];
      if (asset) {
        models.add(asset.id);
        const own = new Map<THREE.Material, THREE.MeshStandardMaterial>();
        for (const part of asset.parts) {
          let material = part.material;
          // Each building gets its own window materials, so homes go dark one by one at night like the City View.
          if (part.role === 'window') {
            let mine = own.get(part.material);
            if (!mine) { mine = (part.material as THREE.MeshStandardMaterial).clone(); own.set(part.material, mine); windows.push(mine); this.owned.push(mine); }
            material = mine;
          }
          const mesh = new THREE.Mesh(part.geometry, material);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(matrix);
          mesh.castShadow = this.quality === 'high' && part.castShadow;
          mesh.receiveShadow = this.quality === 'high';
          group.add(mesh);
        }
        this.stats.triangles += asset.triangles;
        if (asset.solid) this.solids.push(transformBox(asset.solid, matrix));
      } else {
        this.stats.fallback.push(building.id);
        this.fallbackMassing(group, building);
      }
      this.scene.add(group);
      this.buildings.push({ building, group, windows, assetId, facing,
        centre: { x: building.position.x + building.footprint.width / 2, y: building.position.y + building.footprint.height / 2 } });
      await slice();
    }
    this.stats.buildings = plan.buildings.length;
    this.stats.models = models.size;
    this.stats.modelIds = [...models].sort();
  }

  /** A building without a model: a clearly marked, style-compatible massing on the exact footprint (never another model). */
  private fallbackMassing(group: THREE.Group, b: Building) {
    const h = b.kind === 'home' ? 0.5 : b.kind === 'park' ? 0.04 : 0.9;
    const inset = 0.18;
    const geometry = new THREE.BoxGeometry(b.footprint.width - inset * 2, h, b.footprint.height - inset * 2);
    const material = new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.85 });
    const mass = new THREE.Mesh(geometry, material);
    mass.position.set(b.position.x + b.footprint.width / 2, h / 2, b.position.y + b.footprint.height / 2);
    mass.castShadow = mass.receiveShadow = this.quality === 'high';
    const band = new THREE.Mesh(new THREE.BoxGeometry(b.footprint.width - inset * 2 + 0.02, 0.05, b.footprint.height - inset * 2 + 0.02), new THREE.MeshStandardMaterial({ color: 0xc8714f, roughness: 0.7 }));
    band.position.set(mass.position.x, h - 0.03, mass.position.z);
    group.add(mass, band);
    group.userData.fallback = true;
    this.owned.push(geometry, material, band.geometry, band.material as THREE.Material);
    this.solids.push({ min: { x: b.position.x + inset, y: 0, z: b.position.y + inset }, max: { x: b.position.x + b.footprint.width - inset, y: h, z: b.position.y + b.footprint.height - inset } });
  }

  private async landscaping(slice: () => Promise<void>) {
    const { index, ids } = runtimeArtIndex();
    const byAsset = new Map<string, { x: number; y: number; matrix: THREE.Matrix4 }[]>();
    let count = 0;
    for (const d of this.decor) {
      if (this.quality === 'low' && !TALL_DECOR.has(d.kind)) continue;
      const record = selectDecorAsset(index, d.kind, d.variant);
      const id = record ? ids.get(record) : undefined;
      if (!id) continue;
      const curb = d.kind === 'lamp' || d.kind === 'bench' || d.kind === 'bin' || d.kind === 'bikes' || d.kind === 'planter';
      const turn = curb ? 0 : (hash(`${d.tile.x},${d.tile.y},${d.kind}`) % 628) / 100;
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(d.at.x, 0, d.at.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn),
        new THREE.Vector3(d.size, d.size, d.size));
      byAsset.set(id, [...(byAsset.get(id) ?? []), { x: d.at.x, y: d.at.y, matrix }]);
      count += 1;
    }
    for (const [id, placements] of byAsset) {
      const asset = buildAsset(id);
      if (asset) this.instance(asset, placements, true);
      await slice();
    }
    this.stats.decor = count;
    // Street-light pools on the pavement (additive; their strength follows the night glow).
    const lamps = this.decor.filter((d) => d.kind === 'lamp');
    const texture = radialTexture('rgba(255,214,150,0.55)', 'rgba(255,214,150,0)');
    if (lamps.length && texture) {
      this.poolMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
      const geometry = new THREE.PlaneGeometry(0.8, 0.8); geometry.rotateX(-Math.PI / 2);
      const pools = new THREE.InstancedMesh(geometry, this.poolMaterial, lamps.length);
      lamps.forEach((d, i) => {
        // Pools spill toward the street from the curb.
        const cx = d.tile.x + 0.5, cy = d.tile.y + 0.5;
        pools.setMatrixAt(i, new THREE.Matrix4().makeTranslation(d.at.x + (cx - d.at.x) * 0.45, 0.03, d.at.y + (cy - d.at.y) * 0.45));
      });
      pools.computeBoundingSphere();
      pools.renderOrder = 2;
      pools.name = 'light pools';
      this.scene.add(pools);
      this.owned.push(geometry, this.poolMaterial, texture, { dispose: () => pools.dispose() });
    }
  }

  /** Builds everything in time slices. `cancelled()` aborts between slices (the view closed while loading). */
  async build(progress: (done: number, total: number, label: string) => void, cancelled: () => boolean): Promise<void> {
    const started = performance.now();
    const slice = slicer();
    progress(0, 4, 'Laying the ground');
    this.ground();
    await slice(); if (cancelled()) return;
    progress(1, 4, 'Paving the streets');
    await this.roads(slice); if (cancelled()) return;
    progress(2, 4, 'Raising the homes');
    await this.buildingModels(slice); if (cancelled()) return;
    progress(3, 4, 'Planting the gardens');
    await this.landscaping(slice); if (cancelled()) return;
    progress(4, 4, 'Ready');
    this.stats.buildMs = Math.round(performance.now() - started);
  }

  /** Per frame: sky, sun and night lights from the clock; shadows and culling around the focus point. */
  update(minuteOfDay: number, focus: Position, cameraPosition: THREE.Vector3) {
    const sky = skyState(minuteOfDay);
    this.sky0 = sky;
    const top = this.sky.material.uniforms.top!.value as THREE.Color, horizon = this.sky.material.uniforms.horizon!.value as THREE.Color;
    top.setHex(sky.skyTop, THREE.SRGBColorSpace); horizon.setHex(sky.skyHorizon, THREE.SRGBColorSpace);
    (this.sky.material.uniforms.sunDir!.value as THREE.Vector3).set(sky.sunDirection.x, sky.sunDirection.y, sky.sunDirection.z);
    (this.sky.material.uniforms.sunColor!.value as THREE.Color).setHex(sky.sunColor, THREE.SRGBColorSpace);
    this.sky.material.uniforms.sunGlow!.value = sky.lighting.sun;
    this.sky.position.copy(cameraPosition);
    this.fog.color.setHex(sky.skyHorizon, THREE.SRGBColorSpace);
    this.hemi.color.setHex(sky.skyTop, THREE.SRGBColorSpace).lerp(new THREE.Color(0xffffff), 0.55);
    this.hemi.groundColor.setHex(sky.groundColor, THREE.SRGBColorSpace);
    this.hemi.intensity = sky.hemisphereIntensity;
    this.scene.environmentIntensity = sky.environmentIntensity;
    // The sun's shadow camera follows the character, snapped to shadow texels so edges never crawl.
    const texel = 18 / 2048;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.y / texel) * texel;
    this.sun.color.setHex(sky.sunColor, THREE.SRGBColorSpace);
    this.sun.intensity = sky.sunIntensity;
    this.sun.position.set(fx + sky.sunDirection.x * 20, sky.sunDirection.y * 20, fz + sky.sunDirection.z * 20);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.visible = sky.sunIntensity > 0.01;
    this.moon.intensity = sky.moonIntensity;
    this.moon.position.set(fx - 8, 14, fz + 6); this.moon.target.position.set(fx, 0, fz);
    // Night lights.
    nightMaterials.lamp.emissiveIntensity = 2.2 * sky.glow;
    for (const m of nightMaterials.glow.values()) m.emissiveIntensity = 0.2 + 2 * sky.glow;
    if (this.poolMaterial) this.poolMaterial.opacity = sky.glow;
    const now = performance.now();
    if (now - this.lastWindowCheck > 400) {
      this.lastWindowCheck = now;
      for (const entry of this.buildings) {
        const on = sky.glow * windowsOn(entry.building.type, entry.building.id, minuteOfDay);
        for (const m of entry.windows) m.emissiveIntensity = 1.6 * on;
      }
    }
    // Distance culling (fog hides the edge); the frustum culls the rest.
    const far = VIEW_DISTANCE[this.quality] + 4;
    for (const { group, centre } of this.chunks.values()) group.visible = Math.hypot(centre.x - focus.x, centre.y - focus.y) < far + CHUNK * 0.75;
    for (const entry of this.buildings) entry.group.visible = Math.hypot(entry.centre.x - focus.x, entry.centre.y - focus.y) < far + 3;
  }

  get skyNow(): SkyState | null { return this.sky0; }
  get buildingEntries(): readonly BuildingEntry[] { return this.buildings; }

  dispose() {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.clear();
  }
}

/** Transforms a design-space box by a placement matrix (handles the mirrored facings) into a world-space solid. */
function transformBox(box: THREE.Box3, matrix: THREE.Matrix4): SolidBox {
  const out = box.clone().applyMatrix4(matrix);
  return { min: { x: out.min.x, y: out.min.y, z: out.min.z }, max: { x: out.max.x, y: out.max.y, z: out.max.z } };
}
