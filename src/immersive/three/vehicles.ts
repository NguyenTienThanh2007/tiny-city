import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vehicle, VehicleModel, WorldState } from '@tiny-city/simulation';
import { VEHICLE_MODELS } from '../../../scripts/art/vehicles/models.js';
import { frontOf, lengthOf, nextSample, routeOf, sampleFront, vehicleColor, vehiclePose, type VehicleSample } from '../../game/vehicleMotion';

/**
 * Phase 8A synchronized vehicles: a limited subset of Phase 6 traffic near the player. Exactly the simulated vehicles
 * (residents' cars, delivery vans, buses of real lines; parked or driving) within a radius, each placed with the same
 * pure pose the City View uses (front distance interpolated between ticks, kept to the right lane), built from the
 * same Phase 6 models. Nothing drives that the simulation does not have.
 */

export const VEHICLES = Object.freeze({ radius: 12, max: 24 });

interface Template { readonly parts: readonly { geometry: THREE.BufferGeometry; material: THREE.Material; body: boolean }[] }
const templates = new Map<VehicleModel, Template>();
const paints = new Map<number, THREE.Material>();

function template(model: VehicleModel): Template {
  const hit = templates.get(model);
  if (hit) return hit;
  const root = VEHICLE_MODELS[model]();
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, { body: boolean; geometries: THREE.BufferGeometry[] }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    const entry = groups.get(material) ?? { body: mesh.userData.layer === 'body', geometries: [] };
    entry.geometries.push(g);
    groups.set(material, entry);
  });
  const parts = [...groups].map(([material, { body, geometries }]) => ({ geometry: mergeGeometries(geometries, false)!, material, body }));
  root.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) mesh.geometry.dispose(); });
  const built = { parts };
  templates.set(model, built);
  return built;
}
function paint(base: THREE.Material, color: number) {
  let m = paints.get(color);
  if (!m) { m = base.clone(); (m as THREE.MeshStandardMaterial).color.setHex(color); paints.set(color, m); }
  return m;
}

interface Drawn { readonly root: THREE.Group; sample: VehicleSample; shown: number }

export class VehicleLayer {
  readonly group = new THREE.Group();
  private readonly drawn = new Map<string, Drawn>();
  private lastState: WorldState | null = null;
  constructor(private readonly shadows: boolean) { this.group.name = 'vehicles'; }

  sync(world: WorldState, focus: { x: number; y: number }) {
    const t = world.transport;
    if (!t) { this.clear(); return; }
    const alpha = world.clock.paused ? 1 : Math.max(0, Math.min(1, world.clock.accumulatedMs / world.clock.fixedStepMs));
    const near = (v: Vehicle) => { const p = vehiclePose(routeOf(v), frontOf(v), lengthOf(v)); return Math.hypot(p.x - focus.x, p.y - focus.y) <= VEHICLES.radius; };
    if (this.lastState !== world) {
      const wanted = t.vehicles.filter((v) => v.state !== 'departing' && near(v)).slice(0, VEHICLES.max);
      const keep = new Set(wanted.map((v) => v.id));
      for (const [id, d] of this.drawn) if (!keep.has(id)) { this.group.remove(d.root); this.drawn.delete(id); }
      for (const v of wanted) {
        let d = this.drawn.get(v.id);
        if (!d) {
          const root = new THREE.Group();
          root.name = `vehicle ${v.id}`;
          for (const part of template(v.model).parts) {
            const mesh = new THREE.Mesh(part.geometry, part.body ? paint(part.material, vehicleColor(v)) : part.material);
            mesh.castShadow = this.shadows;
            root.add(mesh);
          }
          d = { root, sample: nextSample(undefined, v, world.clock.tick, null), shown: frontOf(v) };
          this.drawn.set(v.id, d);
          this.group.add(root);
        }
        d.sample = nextSample(d.sample, v, world.clock.tick, d.shown);
      }
      this.lastState = world;
    }
    const byId = new Map(t.vehicles.map((v) => [v.id, v]));
    for (const [id, d] of this.drawn) {
      const vehicle = byId.get(id);
      if (!vehicle) continue;
      d.shown = sampleFront(d.sample, alpha);
      const pose = vehiclePose(d.sample.route, d.shown, lengthOf(vehicle));
      d.root.position.set(pose.x, 0.002, pose.y);
      // Models face +X; the map angle is 0 = east (+x), π/2 = south (+y = +Z).
      d.root.rotation.y = -pose.angle;
    }
  }

  get count() { return this.drawn.size; }
  ids() { return [...this.drawn.keys()].sort(); }
  private clear() { for (const d of this.drawn.values()) this.group.remove(d.root); this.drawn.clear(); }
  dispose() { this.clear(); }
}

/** Frees the shared vehicle models (called when the Character View closes). */
export function disposeVehicleTemplates() {
  for (const t of templates.values()) for (const p of t.parts) p.geometry.dispose();
  templates.clear();
  for (const m of paints.values()) m.dispose();
  paints.clear();
}
