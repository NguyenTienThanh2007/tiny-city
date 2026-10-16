import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vehicle, VehicleModel, WorldState } from '@tiny-city/simulation';
import { VEHICLE_MODELS } from '../../../scripts/art/vehicles/models.js';
import { citizenLook } from '../../game/art/characterLook';
import { frontOf, lengthOf, LINE_COLORS, nextSample, routeOf, sampleFront, vehicleColor, vehiclePose, type VehicleSample } from '../../game/vehicleMotion';
import { angleDelta } from '../coordinates';
import type { ResidentEntity } from '../world/sceneModel';
import { buildCharacter, type CharacterModel } from './characterModel';

/**
 * Phase 8B actors: the real residents and vehicles near the player, reconciled every frame against the scene model.
 * Identity is the simulation's: a drawn resident is keyed by its citizen ID and built from `citizenLook(id)` (the
 * City View's own look), a drawn vehicle by its vehicle ID with the City View's pose and colour rules. Rendering only
 * interpolates between ticks; it never moves anyone in the simulation. Models are pooled (an LRU keeps recently seen
 * residents), and at most a few new characters are built per frame so walking into a crowd never stutters.
 */

export const ACTOR_LIMITS = Object.freeze({
  high: { residentRadius: 26, residents: 60, vehicleRadius: 34, vehicles: 90, builds: 3 },
  low: { residentRadius: 18, residents: 30, vehicleRadius: 24, vehicles: 40, builds: 2 },
});

/**
 * Walkers keep to the sidewalk on their right. Phase 3 routes run along road tile centres (as the City View draws
 * them); the 3D view offsets the drawn figure toward the curb, perpendicular to the heading, exactly as vehicles keep
 * to their lane. Presentation only: the simulated position is unchanged.
 */
export const SIDEWALK_OFFSET = 0.36;
export function walkerOffset(heading: { x: number; y: number }): { x: number; y: number } {
  const n = Math.hypot(heading.x, heading.y);
  return n < 1e-6 ? { x: 0, y: 0 } : { x: (-heading.y / n) * SIDEWALK_OFFSET, y: (heading.x / n) * SIDEWALK_OFFSET };
}

interface DrawnResident {
  readonly model: CharacterModel;
  x: number; y: number; yaw: number; stride: number; speed: number;
  offset: { x: number; y: number };
  readonly seed: number;
  entity: ResidentEntity;
}

export class ResidentActors {
  readonly group = new THREE.Group();
  private readonly drawn = new Map<string, DrawnResident>();
  /** Recently seen residents' models, kept for reuse (bounded). */
  private readonly pool = new Map<string, CharacterModel>();
  constructor(private readonly limits: (typeof ACTOR_LIMITS)['high']) { this.group.name = 'residents'; }

  sync(residents: readonly ResidentEntity[], focus: { x: number; y: number }, dt: number, time: number) {
    const wanted = residents
      .map((r) => ({ r, d: Math.hypot(r.x - focus.x, r.y - focus.y) }))
      .filter((e) => e.d <= this.limits.residentRadius)
      .sort((a, b) => a.d - b.d || (a.r.id < b.r.id ? -1 : 1))
      .slice(0, this.limits.residents);
    const keep = new Set(wanted.map((e) => e.r.id));
    for (const [id, d] of this.drawn) if (!keep.has(id)) { this.group.remove(d.model.root); this.park(id, d.model); this.drawn.delete(id); }
    let builds = 0;
    const k = 1 - Math.exp(-Math.max(0, dt) / 0.09);
    for (const { r } of wanted) {
      let d = this.drawn.get(r.id);
      if (!d) {
        let model = this.pool.get(r.id);
        if (model) this.pool.delete(r.id);
        else { if (builds >= this.limits.builds) continue; model = buildCharacter(citizenLook(r.id), { contact: false }); builds += 1; }
        let seed = 0; for (let i = 0; i < r.id.length; i += 1) seed = (seed * 31 + r.id.charCodeAt(i)) >>> 0;
        const offset = r.mode === 'walking' || r.mode === 'waiting' ? walkerOffset(r.heading) : { x: 0, y: 0 };
        d = { model, x: r.x + offset.x, y: r.y + offset.y, yaw: Math.atan2(r.heading.x, r.heading.y || 1), stride: 0, speed: 0, seed, entity: r, offset };
        model.root.name = `resident ${r.id}`;
        this.drawn.set(r.id, d);
        this.group.add(model.root);
      }
      d.entity = r;
      // Sidewalk side from the heading (kept while standing), none at stops and venues.
      if (r.mode === 'walking' || r.mode === 'waiting') { if (r.heading.x !== 0 || r.heading.y !== 0) d.offset = walkerOffset(r.heading); }
      else d.offset = { x: 0, y: 0 };
      const tx = r.x + d.offset.x, ty = r.y + d.offset.y;
      // Interpolate toward the authoritative position; a jump (a new spot, a stop, a venue) is taken at once.
      const jump = Math.hypot(tx - d.x, ty - d.y) > 1.5;
      const nx = jump ? tx : d.x + (tx - d.x) * k, ny = jump ? ty : d.y + (ty - d.y) * k;
      const moved = jump ? 0 : Math.hypot(nx - d.x, ny - d.y);
      d.speed = dt > 0 ? moved / dt : 0;
      const walking = r.mode === 'walking' && d.speed > 0.03;
      const facing = walking ? Math.atan2(nx - d.x, ny - d.y) : (r.heading.x !== 0 || r.heading.y !== 0) ? Math.atan2(r.heading.x, r.heading.y) : d.yaw;
      d.yaw += angleDelta(d.yaw, facing) * Math.min(1, k * 1.5);
      d.x = nx; d.y = ny; d.stride = (d.stride + moved / 0.2 * Math.PI * 2) % (Math.PI * 2);
      d.model.root.position.set(d.x, 0, d.y);
      d.model.root.rotation.y = d.yaw;
      // Pose from the authoritative activity: walking by displacement; waiting idles; venue visitors talk, sit or cheer.
      const action = r.mode === 'at-venue' ? (r.action === 'none' ? 'idle' : r.action) : 'idle';
      d.model.pose({ moving: walking, stride: d.stride, runBlend: 0, time: time + (d.seed % 1000) / 97, action });
    }
  }

  private park(id: string, model: CharacterModel) {
    this.pool.set(id, model);
    while (this.pool.size > this.limits.residents) {
      const [oldest, old] = this.pool.entries().next().value as [string, CharacterModel];
      old.dispose(); this.pool.delete(oldest);
    }
  }

  /** Drawn residents as the debug API reports them (ID, mode, drawn position). */
  list() { return [...this.drawn.values()].map((d) => ({ id: d.entity.id, name: d.entity.name, mode: d.entity.mode, action: d.entity.action, x: +d.x.toFixed(3), y: +d.y.toFixed(3) })).sort((a, b) => (a.id < b.id ? -1 : 1)); }
  positions() { return [...this.drawn.values()].map((d) => ({ id: d.entity.id, name: d.entity.name, x: d.x, y: d.y })); }
  get count() { return this.drawn.size; }
  dispose() { for (const d of this.drawn.values()) d.model.dispose(); for (const m of this.pool.values()) m.dispose(); this.drawn.clear(); this.pool.clear(); this.group.clear(); }
}

// ---------------------------------------------------------------- vehicles

/**
 * A vehicle model in a body colour, merged for instancing: every opaque part in one vertex-coloured geometry (paint in
 * the vehicle's colour) and the lamp lenses in another. All vehicles of one model and colour are one instanced draw.
 */
interface Template { readonly body: THREE.BufferGeometry; readonly lamps: THREE.BufferGeometry | null }
const templates = new Map<string, Template>();
const VEHICLE_BODY = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.12 });
/** Lamp lenses are unlit (they are lights); their brightness rises after dark. */
const VEHICLE_LAMPS = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });

function template(model: VehicleModel, color: number): Template {
  const key = `${model}|${color}`;
  const hit = templates.get(key);
  if (hit) return hit;
  const root = VEHICLE_MODELS[model]();
  root.updateMatrixWorld(true);
  const body: THREE.BufferGeometry[] = [], lamps: THREE.BufferGeometry[] = [];
  const paintColor = new THREE.Color(color);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const c = mesh.userData.layer === 'body' ? paintColor : material.color, n = g.attributes.position!.count, data = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) data.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(data, 3));
    (mesh.userData.layer === 'light' ? lamps : body).push(g);
  });
  root.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) mesh.geometry.dispose(); });
  const merge = (list: THREE.BufferGeometry[]) => { if (!list.length) return null; const m = mergeGeometries(list, false)!; for (const g of list) g.dispose(); return m; };
  const built = { body: merge(body)!, lamps: merge(lamps) };
  templates.set(key, built);
  return built;
}

/** Growable instanced pools, one per model and colour. */
class VehiclePool {
  body: THREE.InstancedMesh;
  lamps: THREE.InstancedMesh | null;
  used = 0;
  constructor(private readonly group: THREE.Group, private readonly t: Template, private readonly shadows: boolean, capacity = 8) {
    this.body = this.make(t.body, VEHICLE_BODY, capacity, shadows);
    this.lamps = t.lamps ? this.make(t.lamps, VEHICLE_LAMPS, capacity, false) : null;
  }
  private make(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadows: boolean) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0; mesh.castShadow = shadows; mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }
  add(matrix: THREE.Matrix4) {
    if (this.used >= this.body.instanceMatrix.count) {
      const capacity = this.body.instanceMatrix.count * 2;
      const grow = (old: THREE.InstancedMesh, geometry: THREE.BufferGeometry, material: THREE.Material, shadows: boolean) => {
        const next = this.make(geometry, material, capacity, shadows);
        this.group.remove(old); old.dispose();
        return next;
      };
      this.body = grow(this.body, this.t.body, VEHICLE_BODY, this.shadows);
      if (this.lamps) this.lamps = grow(this.lamps, this.t.lamps!, VEHICLE_LAMPS, false);
    }
    this.body.setMatrixAt(this.used, matrix);
    this.lamps?.setMatrixAt(this.used, matrix);
    this.used += 1;
  }
  flush() {
    this.body.count = this.used; this.body.instanceMatrix.needsUpdate = true;
    if (this.lamps) { this.lamps.count = this.used; this.lamps.instanceMatrix.needsUpdate = true; }
    this.used = 0;
  }
  dispose() { this.group.remove(this.body); this.body.dispose(); if (this.lamps) { this.group.remove(this.lamps); this.lamps.dispose(); } }
}

/** A small sign above a bus with its line and the real number of passengers on board. */
function occupancyLabel(): { sprite: THREE.Sprite; set(text: string, color: number): void } {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true, fog: true }));
  sprite.scale.set(0.56, 0.14, 1);
  sprite.position.set(0, 0.62, 0);
  sprite.renderOrder = 3;
  let last = '';
  return {
    sprite,
    set(text, color) {
      const key = `${text}|${color}`;
      if (key === last) return;
      last = key;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, 256, 64);
      ctx.fillStyle = 'rgba(255,253,248,0.94)'; ctx.beginPath(); ctx.roundRect(4, 6, 248, 52, 26); ctx.fill();
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`; ctx.beginPath(); ctx.arc(34, 32, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#223d33'; ctx.font = '600 26px Manrope, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText(text, 60, 33);
      texture.needsUpdate = true;
    },
  };
}

interface DrawnVehicle { readonly key: string; sample: VehicleSample; shown: number; label: ReturnType<typeof occupancyLabel> | null; x: number; y: number }

/**
 * Exactly the simulated vehicles near the player (residents' cars, delivery vans, buses of real lines; parked or
 * driving), posed with the City View's pure `vehiclePose` (front distance interpolated between ticks, kept to the
 * right lane, rounded through corners) and built from the Phase 6 models. Buses show their line and the number of
 * passengers actually on board; riders are never drawn walking at the same time (the scene model hides them).
 */
export class VehicleActors {
  readonly group = new THREE.Group();
  private readonly drawn = new Map<string, DrawnVehicle>();
  private readonly pools = new Map<string, VehiclePool>();
  private lastState: WorldState | null = null;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  constructor(private readonly limits: (typeof ACTOR_LIMITS)['high'], private readonly shadows: boolean) { this.group.name = 'vehicles'; }

  sync(world: WorldState, vehicles: readonly Vehicle[], focus: { x: number; y: number }, glow: number) {
    const alpha = world.clock.paused ? 1 : Math.max(0, Math.min(1, world.clock.accumulatedMs / world.clock.fixedStepMs));
    if (this.lastState !== world) {
      const wanted = vehicles
        .map((v) => { const p = vehiclePose(routeOf(v), frontOf(v), lengthOf(v)); return { v, d: Math.hypot(p.x - focus.x, p.y - focus.y) }; })
        .filter((e) => e.d <= this.limits.vehicleRadius)
        .sort((a, b) => a.d - b.d || (a.v.id < b.v.id ? -1 : 1))
        .slice(0, this.limits.vehicles).map((e) => e.v);
      const keep = new Set(wanted.map((v) => v.id));
      for (const [id, d] of this.drawn) if (!keep.has(id)) this.remove(id, d);
      for (const v of wanted) {
        let d = this.drawn.get(v.id);
        const key = `${v.model}|${vehicleColor(v)}`;
        if (!d) {
          const label = v.kind === 'bus' ? occupancyLabel() : null;
          if (label) { label.sprite.name = `bus-label ${v.id}`; this.group.add(label.sprite); }
          d = { key, sample: nextSample(undefined, v, world.clock.tick, null), shown: frontOf(v), label, x: 0, y: 0 };
          this.drawn.set(v.id, d);
        }
        d.sample = nextSample(d.sample, v, world.clock.tick, d.shown);
        if (d.label) {
          const line = world.transport?.lines.find((l) => l.id === v.lineId);
          d.label.set(`${line?.name ?? 'Bus'} · ${v.passengers.length} on board`, LINE_COLORS[(line?.color ?? v.color) % LINE_COLORS.length]!);
        }
      }
      this.lastState = world;
    }
    const byId = new Map(vehicles.map((v) => [v.id, v]));
    for (const [id, d] of this.drawn) {
      const v = byId.get(id);
      if (!v) continue;
      d.shown = sampleFront(d.sample, alpha);
      const pose = vehiclePose(d.sample.route, d.shown, lengthOf(v));
      d.x = pose.x; d.y = pose.y;
      // Models face +X; the map angle is 0 = east (+x), π/2 = south (+y = +Z).
      this.matrix.compose(this.position.set(pose.x, 0.002, pose.y), this.rotation.setFromAxisAngle(this.up, -pose.angle), this.one);
      let pool = this.pools.get(d.key);
      if (!pool) { const [model, color] = d.key.split('|'); pool = new VehiclePool(this.group, template(model as VehicleModel, Number(color)), this.shadows); this.pools.set(d.key, pool); }
      pool.add(this.matrix);
      if (d.label) { d.label.sprite.position.set(pose.x, 0.62, pose.y); d.label.sprite.visible = Math.hypot(pose.x - focus.x, pose.y - focus.y) < 14; }
    }
    for (const pool of this.pools.values()) pool.flush();
    // Head- and tail-lamps: plain by day, glowing after dark.
    VEHICLE_LAMPS.color.setScalar(0.8 + 1.4 * glow);
  }

  private remove(id: string, d: DrawnVehicle) {
    if (d.label) { this.group.remove(d.label.sprite); (d.label.sprite.material as THREE.SpriteMaterial).map?.dispose(); d.label.sprite.material.dispose(); }
    this.drawn.delete(id);
  }

  list() { return [...this.drawn.entries()].map(([id, d]) => ({ id, x: +d.x.toFixed(3), y: +d.y.toFixed(3) })).sort((a, b) => (a.id < b.id ? -1 : 1)); }
  get count() { return this.drawn.size; }
  dispose() { for (const [id, d] of [...this.drawn]) this.remove(id, d); for (const pool of this.pools.values()) pool.dispose(); this.pools.clear(); }
}

/** One mesh of every vehicle model, for compiling their shaders while the view loads. */
export function vehicleWarmup(): THREE.Group {
  const group = new THREE.Group();
  for (const model of Object.keys(VEHICLE_MODELS) as VehicleModel[]) {
    const t = template(model, 0xffffff);
    group.add(new THREE.Mesh(t.body, VEHICLE_BODY));
    if (t.lamps) group.add(new THREE.Mesh(t.lamps, VEHICLE_LAMPS));
  }
  return group;
}

/** Releases the shared vehicle models from the GPU; they stay cached for the next visit. */
export function releaseVehicleResources() {
  for (const t of templates.values()) { t.body.dispose(); t.lamps?.dispose(); }
  VEHICLE_BODY.dispose(); VEHICLE_LAMPS.dispose();
}
