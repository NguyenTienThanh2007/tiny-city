import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { Building, CityPlan } from '@tiny-city/simulation';
import { iso } from './mapGeometry';
import { hashString } from './npcMotion';

/**
 * Visual World 3.0C atmosphere: soft night light pools spilled from lit buildings onto the ground, water shimmer on
 * pools by day, and a few fireflies over parks at night. Purely decorative and bounded: built once per plan change,
 * animated with a handful of alpha/position updates per frame, frozen under reduced motion. No full-screen overlays.
 *
 * Effects are described per venue type in `VENUE_FX`, the hook future venues (café, shopping street, concert stage,
 * night market, cinema, amusement park, music club, performance plaza) extend with their own pools, accents or
 * stage lights. Only buildings that exist in the authoritative plan get effects.
 */

export interface VenueFx {
  /** Ground light pool radius (tiles) and colour spilled in front of the building at night. */
  readonly pool: number;
  readonly color: number;
  /** Relative strength of the night spill. */
  readonly strength: number;
  readonly sparkles?: 'pool';
  readonly fireflies?: number;
  /** Reserved for performance venues (concert stage, music club): coloured beams that sweep over the crowd area. */
  readonly stageLights?: readonly number[];
}

export const VENUE_FX: Readonly<Record<string, VenueFx>> = {
  villa: { pool: 0.75, color: 0xffc977, strength: 0.55 },
  duplex: { pool: 0.8, color: 0xffc977, strength: 0.6 },
  townhouse: { pool: 0.9, color: 0xffc070, strength: 0.75 },
  apartment: { pool: 1.3, color: 0xffc977, strength: 0.75 },
  clubhouse: { pool: 1.4, color: 0xffb764, strength: 1 },
  mall: { pool: 2.2, color: 0xffcf86, strength: 1 },
  office: { pool: 1.5, color: 0xd8e6ff, strength: 0.7 },
  pool: { pool: 1.1, color: 0x9fe6ff, strength: 0.55, sparkles: 'pool' },
  park: { pool: 0, color: 0, strength: 0, fireflies: 7 },
};

const POOL_RINGS = 7;

/** Pure: where a building spills light at night (front edges facing the camera), in tile coordinates. */
export function lightPoolsFor(building: Building): { x: number; y: number; radius: number; color: number; strength: number }[] {
  const fx = building.type ? VENUE_FX[building.type] : undefined;
  if (!fx || fx.pool <= 0) return [];
  const { x, y } = building.position, { width: w, height: h } = building.footprint;
  // South edge (screen lower-left) and east edge (screen lower-right) are the lit, visible facades.
  return [
    { x: x + w * 0.5, y: y + h + 0.15, radius: fx.pool * Math.min(1.4, w / 2.5 + 0.4), color: fx.color, strength: fx.strength },
    { x: x + w + 0.15, y: y + h * 0.5, radius: fx.pool * Math.min(1.4, h / 2.5 + 0.4), color: fx.color, strength: fx.strength * 0.8 },
  ];
}

export class AmbientLayer {
  private readonly pools = new Graphics();
  private readonly sparkles = new Container();
  private readonly fireflies = new Container();
  private readonly sparkleContext = new GraphicsContext()
    .poly([0, -2.4, 0.55, -0.55, 2.4, 0, 0.55, 0.55, 0, 2.4, -0.55, 0.55, -2.4, 0, -0.55, -0.55]).fill({ color: 0xffffff, alpha: 0.95 });
  private readonly fireflyContext = new GraphicsContext()
    .circle(0, 0, 3.2).fill({ color: 0xfff3a6, alpha: 0.18 }).circle(0, 0, 1.3).fill({ color: 0xfffbe0, alpha: 0.95 });
  private particles: { g: Graphics; x: number; y: number; phase: number; speed: number; kind: 'spark' | 'fly' }[] = [];
  private glow = 0;
  private sun = 1;

  /** `scene` is the depth-sorted building container (sparkles sit on the water, behind anything in front of the pool). */
  constructor(groundLayer: Container, airLayer: Container, private readonly reducedMotion = false, private readonly scene: Container | null = null) {
    this.pools.eventMode = 'none';
    this.pools.blendMode = 'add';
    this.pools.visible = false;
    groundLayer.addChild(this.pools);
    this.sparkles.eventMode = 'none';
    this.fireflies.eventMode = 'none';
    this.fireflies.blendMode = 'add';
    airLayer.addChild(this.sparkles);
    airLayer.addChild(this.fireflies);
  }

  /** Rebuilds pools and particle anchors from the plan (call when buildings change). */
  rebuild(plan: CityPlan, frontOf: (building: Building) => 'S' | 'E' = () => 'S'): void {
    const g = this.pools;
    g.clear();
    for (const p of this.particles) p.g.destroy();
    this.particles = [];
    for (const building of plan.buildings) {
      for (const pool of lightPoolsFor(building)) {
        const c = iso(pool.x, pool.y);
        const rx = pool.radius * 28 * 1.2, ry = pool.radius * 14 * 1.2;
        // Concentric low-alpha ellipses approximate a soft radial falloff without textures or filters.
        for (let ring = POOL_RINGS; ring >= 1; ring -= 1) {
          const t = ring / POOL_RINGS;
          g.ellipse(c.x, c.y, rx * t, ry * t).fill({ color: pool.color, alpha: 0.068 * pool.strength });
        }
      }
      const fx = building.type ? VENUE_FX[building.type] : undefined;
      if (fx?.sparkles === 'pool') {
        // Main lane pool water rectangle of the 3.0B lido art (built facing south; east-facing art swaps axes).
        const east = frontOf(building) === 'E';
        const W = east ? 4 : 3, D = east ? 3 : 4;
        const water = { x0: 0.35, z0: 0.5, x1: 0.35 + (W - 0.95), z1: 0.5 + D * 0.48 };
        const seed = hashString(building.id);
        for (let i = 0; i < 9; i += 1) {
          const u = ((seed >> (i * 3)) % 97) / 97, v = ((seed >> (i * 2 + 5)) % 89) / 89;
          const lx = water.x0 + (water.x1 - water.x0) * (0.1 + 0.8 * ((u + i * 0.37) % 1));
          const lz = water.z0 + (water.z1 - water.z0) * (0.1 + 0.8 * ((v + i * 0.61) % 1));
          const local = east ? { x: lz, y: lx } : { x: lx, y: lz };
          const p = iso(building.position.x + local.x, building.position.y + local.y);
          const spark = new Graphics(this.sparkleContext);
          spark.position.set(p.x, p.y - 2);
          spark.eventMode = 'none';
          // Just above the pool's own sprite in the shared depth order.
          spark.zIndex = building.position.x + building.position.y + (building.footprint.width + building.footprint.height) / 2 + 0.003;
          (this.scene ?? this.sparkles).addChild(spark);
          this.particles.push({ g: spark, x: p.x, y: p.y - 2, phase: i * 1.7 + (seed % 10), speed: 0.9 + (i % 4) * 0.25, kind: 'spark' });
        }
      }
      if (fx?.fireflies) {
        const seed = hashString(`ff:${building.id}`);
        for (let i = 0; i < fx.fireflies; i += 1) {
          const lx = 0.6 + ((seed >> i) % 29) / 29 * (building.footprint.width - 1.2);
          const lz = 0.6 + ((seed >> (i + 7)) % 31) / 31 * (building.footprint.height - 1.2);
          const p = iso(building.position.x + lx, building.position.y + lz);
          const fly = new Graphics(this.fireflyContext);
          fly.position.set(p.x, p.y - 14);
          this.fireflies.addChild(fly);
          this.particles.push({ g: fly, x: p.x, y: p.y - 14, phase: i * 2.3 + (seed % 7), speed: 0.35 + (i % 3) * 0.12, kind: 'fly' });
        }
      }
    }
    this.apply();
  }

  setLighting(glow: number, sun: number): void {
    if (glow === this.glow && sun === this.sun) return;
    this.glow = glow; this.sun = sun;
    this.apply();
  }

  private apply(): void {
    this.pools.visible = this.glow > 0.02;
    this.pools.alpha = this.glow;
    for (const p of this.particles) if (p.kind === 'spark') p.g.visible = this.sun > 0.3;
    this.fireflies.visible = this.glow > 0.4;
    this.fireflies.alpha = this.glow;
  }

  /** Per-frame animation; cheap (tens of particles). Frozen under reduced motion. */
  update(timeMs: number, detailed: boolean): void {
    this.fireflies.renderable = detailed;
    for (const p of this.particles) if (p.kind === 'spark') p.g.renderable = detailed;
    if (this.reducedMotion || !detailed) return;
    const t = timeMs / 1000;
    for (const p of this.particles) {
      if (p.kind === 'spark') {
        if (!p.g.visible) continue;
        const a = Math.max(0, Math.sin(t * p.speed * 2.2 + p.phase));
        p.g.alpha = a * a * 0.85;
        p.g.scale.set(0.6 + a * 0.6);
      } else if (this.fireflies.visible) {
        p.g.position.set(p.x + Math.sin(t * p.speed + p.phase) * 10, p.y + Math.sin(t * p.speed * 1.7 + p.phase * 2) * 5);
        p.g.alpha = 0.55 + 0.45 * Math.sin(t * 2.4 + p.phase);
      }
    }
  }

  get particleCount(): number { return this.particles.length; }

  destroy(): void {
    this.pools.destroy();
    for (const p of this.particles) p.g.destroy();
    this.particles = [];
    this.sparkles.destroy({ children: true });
    this.fireflies.destroy({ children: true });
    this.sparkleContext.destroy();
    this.fireflyContext.destroy();
  }
}
