import * as THREE from 'three';
import type { Citizen, WorldState } from '@tiny-city/simulation';
import { citizenLook } from '../../game/art/characterLook';
import { buildCharacter, type CharacterModel } from './characterModel';
import { angleDelta } from '../coordinates';

/**
 * Phase 8A synchronized residents: a limited, honest subset of the living world. Only residents the simulation has
 * walking outdoors near the player are drawn, each at its authoritative position (smoothed between ticks) with the
 * look derived from its ID, exactly as in the City View. Residents indoors or in vehicles are not drawn; nobody is
 * invented. Interactions in 3D are left to Phase 8C.
 */

export const RESIDENTS = Object.freeze({ radius: 9, max: 14 });

interface Drawn { readonly model: CharacterModel; x: number; y: number; yaw: number; stride: number; speed: number; seen: number; readonly seed: number }

export class ResidentLayer {
  readonly group = new THREE.Group();
  private readonly drawn = new Map<string, Drawn>();
  constructor() { this.group.name = 'residents'; }

  /** Residents eligible to be drawn: outdoors (walking or waiting) and within the radius, nearest first. */
  static visible(world: WorldState, focus: { x: number; y: number }): Citizen[] {
    return world.citizens
      .filter((c) => (c.movement?.status === 'travelling' || c.movement?.status === 'waiting') && Math.hypot(c.position.x - focus.x, c.position.y - focus.y) <= RESIDENTS.radius)
      .sort((a, b) => Math.hypot(a.position.x - focus.x, a.position.y - focus.y) - Math.hypot(b.position.x - focus.x, b.position.y - focus.y) || (a.id < b.id ? -1 : 1))
      .slice(0, RESIDENTS.max);
  }

  sync(world: WorldState, focus: { x: number; y: number }, dt: number, time: number) {
    const wanted = ResidentLayer.visible(world, focus);
    const keep = new Set(wanted.map((c) => c.id));
    for (const [id, d] of this.drawn) if (!keep.has(id)) { this.group.remove(d.model.root); d.model.dispose(); this.drawn.delete(id); }
    const k = 1 - Math.exp(-Math.max(0, dt) / 0.09);
    for (const c of wanted) {
      let d = this.drawn.get(c.id);
      if (!d) {
        const model = buildCharacter(citizenLook(c.id));
        let seed = 0; for (let i = 0; i < c.id.length; i += 1) seed = (seed * 31 + c.id.charCodeAt(i)) >>> 0;
        d = { model, x: c.position.x, y: c.position.y, yaw: Math.atan2(c.movement?.heading.x ?? 0, c.movement?.heading.y ?? 1), stride: 0, speed: 0, seen: time, seed };
        this.drawn.set(c.id, d);
        this.group.add(model.root);
      }
      const nx = d.x + (c.position.x - d.x) * k, ny = d.y + (c.position.y - d.y) * k;
      const moved = Math.hypot(nx - d.x, ny - d.y);
      d.speed = dt > 0 ? moved / dt : 0;
      if (moved > 1e-5) d.yaw += angleDelta(d.yaw, Math.atan2(nx - d.x, ny - d.y)) * Math.min(1, k * 1.5);
      d.x = nx; d.y = ny; d.stride = (d.stride + moved / 0.2 * Math.PI * 2) % (Math.PI * 2);
      d.model.root.position.set(d.x, 0, d.y);
      d.model.root.rotation.y = d.yaw;
      d.model.pose({ moving: d.speed > 0.03, stride: d.stride, runBlend: 0, time: time + (d.seed % 1000) / 97 });
    }
  }

  get count() { return this.drawn.size; }
  ids() { return [...this.drawn.keys()].sort(); }
  dispose() { for (const d of this.drawn.values()) d.model.dispose(); this.drawn.clear(); this.group.clear(); }
}
