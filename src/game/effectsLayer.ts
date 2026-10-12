import { Container, Graphics } from 'pixi.js';
import type { Position } from '@tiny-city/simulation';
import { iso } from './mapGeometry';

/** Short, pooled feedback bursts for completed actions. Bounded: never more than POOL_SIZE live effects. */
export type EffectKind = 'build' | 'demolish' | 'road' | 'plan';
const POOL_SIZE = 48;
const DURATION: Record<EffectKind, number> = { build: 650, demolish: 600, road: 380, plan: 900 };
const COLORS: Record<EffectKind, number> = { build: 0xfff1c4, demolish: 0xc9b9a3, road: 0xf3e3b0, plan: 0x7fe0b8 };

interface Effect { g: Graphics; kind: EffectKind; age: number; size: number }

export class EffectsLayer {
  private readonly pool: Graphics[] = [];
  private readonly live: Effect[] = [];
  readonly enabled: boolean;

  constructor(private readonly layer: Container) {
    layer.eventMode = 'none';
    this.enabled = typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  get activeCount(): number { return this.live.length; }

  /** `at` is a tile-space center; `size` scales with the footprint (tiles). */
  spawn(kind: EffectKind, at: Position, size = 1): void {
    if (!this.enabled) return;
    if (this.live.length >= POOL_SIZE) this.recycle(this.live.shift()!);
    const g = this.pool.pop() ?? new Graphics();
    const point = iso(at.x, at.y);
    g.position.set(point.x, point.y);
    g.visible = true;
    this.layer.addChild(g);
    this.live.push({ g, kind, age: 0, size });
  }

  private recycle(effect: Effect): void {
    effect.g.clear();
    effect.g.visible = false;
    this.layer.removeChild(effect.g);
    this.pool.push(effect.g);
  }

  update(dt: number): void {
    for (let index = this.live.length - 1; index >= 0; index -= 1) {
      const effect = this.live[index]!;
      effect.age += dt;
      const t = effect.age / DURATION[effect.kind];
      if (t >= 1) { this.recycle(effect); this.live.splice(index, 1); continue; }
      const g = effect.g;
      const ease = 1 - (1 - t) * (1 - t);
      const radius = (10 + effect.size * 14) * ease;
      const alpha = (1 - t) * 0.85;
      g.clear();
      if (effect.kind === 'road') {
        g.ellipse(0, 0, radius * 0.9, radius * 0.45).stroke({ color: COLORS.road, width: 2, alpha });
        continue;
      }
      g.ellipse(0, 0, radius * 1.3, radius * 0.62).stroke({ color: COLORS[effect.kind], width: 2.4, alpha });
      for (let puff = 0; puff < 6; puff += 1) {
        const angle = puff / 6 * Math.PI * 2 + effect.size;
        const distance = radius * (0.9 + (puff % 2) * 0.25);
        const rise = effect.kind === 'demolish' ? -18 * ease : -6 * ease;
        g.circle(Math.cos(angle) * distance * 1.2, Math.sin(angle) * distance * 0.55 + rise, 3.5 * (1 - t * 0.6))
          .fill({ color: COLORS[effect.kind], alpha: alpha * 0.8 });
      }
    }
  }

  destroy(): void {
    for (const effect of this.live) effect.g.destroy();
    for (const g of this.pool) g.destroy();
    this.live.length = 0;
    this.pool.length = 0;
  }
}
