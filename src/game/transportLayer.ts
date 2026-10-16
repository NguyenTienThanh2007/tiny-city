import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { decodePath, TRANSPORT } from '@tiny-city/simulation';
import type { BusStop, Position, Vehicle, WorldState } from '@tiny-city/simulation';
import { iso, TILE_H, TILE_W } from './mapGeometry';
import { currentArt, type ArtLibrary } from './art/artLibrary';
import { congestionLevel, networkFor } from '../simulation/transportView';
import type { LocalBounds } from './npcLayer';
import {
  directionFrame, stopSide, vehicleColor, frontOf, LINE_COLORS, lengthOf, nextSample, sampleFront, vehiclePose,
  type VehiclePose, type VehicleSample,
} from './vehicleMotion';

/**
 * Phase 6 renderer for simulated vehicles, bus stops and traffic overlays. Every vehicle drawn is a vehicle in
 * `world.transport.vehicles` (cars of residents, buses of lines, delivery vans); nothing is decorative. It reads the
 * live snapshot once per frame and never writes it.
 *
 * Layers: soft ground shadows in the shadow layer; tinted body + baked detail in the shared depth-sorted container
 * (so vehicles pass behind and in front of buildings and residents); lamps in one additive night layer. Falls back to
 * simple vector bodies when the vehicle atlas is unavailable.
 */
export type TrafficOverlay = 'off' | 'traffic' | 'transit';
interface VehicleSprite {
  root: Container;
  body: Sprite;
  detail: Sprite;
  shadow: Sprite;
  lights: Sprite;
  vector: Graphics | null;
  sample: VehicleSample;
  shown: number;
  frame: number;
  model: string;
  color: number;
  pose: VehiclePose | null;
}
interface StopSprite { root: Container; shadow: Sprite; light: Sprite; key: string }

const SHADOW_ALPHA = 0.3;
const CONGESTION_COLORS: readonly [number, number][] = [[0, 0x62c797], [TRANSPORT.congestion.levels.slow, 0xf2c14e], [TRANSPORT.congestion.levels.heavy, 0xe8873f], [TRANSPORT.congestion.levels.jammed, 0xd2484a]];

export { stopSide };

export class TransportLayer {
  private readonly vehicles = new Map<string, VehicleSprite>();
  private readonly stops = new Map<string, StopSprite>();
  private readonly lightLayer = new Container();
  private readonly shadowLayer = new Container();
  private readonly overlay = new Graphics();
  private readonly selection = new Graphics();
  private lastState: WorldState | null = null;
  private overlayKey = '';
  private overlayMode: TrafficOverlay = 'off';
  private selectedId: string | null = null;
  private tint = 0xffffff;
  private art: ArtLibrary | null = null;
  private stopsKey = '';

  constructor(private readonly scene: Container, groundOverlay: Container, shadows: Container, lightsParent: Container) {
    this.lightLayer.eventMode = 'none';
    this.lightLayer.blendMode = 'add';
    this.lightLayer.visible = false;
    this.shadowLayer.eventMode = 'none';
    this.overlay.eventMode = 'none';
    this.selection.eventMode = 'none';
    shadows.addChild(this.shadowLayer);
    groundOverlay.addChild(this.overlay, this.selection);
    lightsParent.addChild(this.lightLayer);
  }

  get count(): number { let n = 0; for (const v of this.vehicles.values()) if (v.root.visible) n += 1; return n; }
  get total(): number { return this.vehicles.size; }

  setOverlay(mode: TrafficOverlay): void { if (mode !== this.overlayMode) { this.overlayMode = mode; this.overlayKey = ''; } }
  setSelected(id: string | null): void { if (id !== this.selectedId) { this.selectedId = id; this.overlayKey = ''; } }
  private draft: readonly Position[] | null = null;
  /** Stops picked in the bus-line editor (numbered in order, joined by a dashed guide). */
  setDraft(stops: readonly Position[] | null): void { if (stops !== this.draft) { this.draft = stops; this.overlayKey = ''; } }

  /** Night: lamps glow, bodies take the scene tint. */
  setLighting(tint: number, glow: number): void {
    this.lightLayer.visible = glow > 0.02;
    this.lightLayer.alpha = Math.min(1, glow * 1.1);
    if (tint === this.tint) return;
    this.tint = tint;
    for (const v of this.vehicles.values()) this.applyTint(v);
    for (const s of this.stops.values()) s.root.tint = tint;
  }

  isVisible(id: string): boolean { return this.vehicles.get(id)?.root.visible ?? false; }
  /** Rendered pose of a vehicle (for picking, camera follow and the inspector), in map coordinates. */
  poseOf(id: string): VehiclePose | null { return this.vehicles.get(id)?.pose ?? null; }

  /** The vehicle under a world-space point, if any (closest wins). */
  pick(point: { x: number; y: number }, zoom: number): string | null {
    let best: { id: string; d: number } | null = null;
    const radius = Math.max(12, 9 / Math.max(zoom, 0.2));
    for (const [id, v] of this.vehicles) {
      if (!v.root.visible || !v.pose) continue;
      const at = iso(v.pose.x, v.pose.y);
      const d = Math.hypot(point.x - at.x, point.y - (at.y - 6));
      if (d < radius && (!best || d < best.d)) best = { id, d };
    }
    return best?.id ?? null;
  }

  private applyTint(v: VehicleSprite): void {
    v.body.tint = multiply(v.color, this.tint);
    v.detail.tint = this.tint;
    if (v.vector) v.vector.tint = this.tint;
  }

  private create(vehicle: Vehicle, tick: number): VehicleSprite {
    const root = new Container();
    root.eventMode = 'none';
    root.label = 'vehicle';
    const body = new Sprite(Texture.EMPTY), detail = new Sprite(Texture.EMPTY);
    const shadow = new Sprite(Texture.EMPTY), lights = new Sprite(Texture.EMPTY);
    shadow.alpha = SHADOW_ALPHA;
    root.addChild(body, detail);
    this.scene.addChild(root);
    this.shadowLayer.addChild(shadow);
    this.lightLayer.addChild(lights);
    const sprite: VehicleSprite = { root, body, detail, shadow, lights, vector: null, sample: nextSample(undefined, vehicle, tick, null), shown: frontOf(vehicle),
      frame: -1, model: vehicle.model, color: vehicleColor(vehicle), pose: null };
    return sprite;
  }

  private remove(id: string, v: VehicleSprite): void {
    v.root.destroy({ children: true });
    v.shadow.destroy();
    v.lights.destroy();
    this.vehicles.delete(id);
  }

  /**
   * Called once per Pixi frame after the simulation advance. `alpha` is the fraction of the next fixed step; fronts
   * are blended between the two latest ticks.
   */
  sync(world: WorldState, bounds: LocalBounds | null): void {
    const t = world.transport;
    const art = currentArt();
    if (art !== this.art) {
      this.art = art;
      for (const [id, v] of this.vehicles) this.remove(id, v);
      for (const s of this.stops.values()) s.root.destroy({ children: true });
      this.stops.clear();
      this.stopsKey = '';
      this.lastState = null;
    }
    if (!t) { for (const [id, v] of this.vehicles) this.remove(id, v); this.syncStops(world); this.drawOverlay(world); return; }
    const alpha = world.clock.paused ? 1 : Math.max(0, Math.min(1, world.clock.accumulatedMs / world.clock.fixedStepMs));
    if (this.lastState !== world) {
      const live = new Set<string>();
      for (const vehicle of t.vehicles) {
        if (vehicle.state === 'departing') continue;
        live.add(vehicle.id);
        let v = this.vehicles.get(vehicle.id);
        if (!v) { v = this.create(vehicle, world.clock.tick); this.vehicles.set(vehicle.id, v); }
        v.sample = nextSample(v.sample, vehicle, world.clock.tick, v.shown);
        if (v.model !== vehicle.model) v.model = vehicle.model;
        const color = vehicleColor(vehicle);
        if (v.color !== color) { v.color = color; v.frame = -1; this.applyTint(v); }
      }
      for (const [id, v] of this.vehicles) if (!live.has(id)) this.remove(id, v);
      this.lastState = world;
      this.syncStops(world);
    }
    const vehiclesById = new Map(t.vehicles.map((v) => [v.id, v]));
    for (const [id, v] of this.vehicles) {
      const vehicle = vehiclesById.get(id)!;
      v.shown = sampleFront(v.sample, alpha);
      const pose = vehiclePose(v.sample.route, v.shown, lengthOf(vehicle));
      v.pose = pose;
      const visible = !bounds || pose.x >= bounds.left && pose.x <= bounds.right && pose.y >= bounds.top && pose.y <= bounds.bottom;
      v.root.visible = visible; v.shadow.visible = visible; v.lights.visible = visible;
      if (!visible) continue;
      const at = iso(pose.x, pose.y);
      v.root.position.set(at.x, at.y);
      v.shadow.position.set(at.x, at.y);
      v.lights.position.set(at.x, at.y);
      v.root.zIndex = pose.x + pose.y + 0.02;
      const frame = directionFrame(pose.angle);
      if (frame !== v.frame) { v.frame = frame; this.setFrame(v, vehicle); }
      const tinted = multiply(v.color, this.tint);
      if (v.body.tint !== tinted) v.body.tint = tinted;
      if (v.detail.tint !== this.tint) v.detail.tint = this.tint;
    }
    this.drawSelection();
    this.drawOverlay(world);
  }

  private setFrame(v: VehicleSprite, vehicle: Vehicle): void {
    const art = this.art;
    const name = (layer: string) => `veh:${vehicle.model}:${layer}:${v.frame}`;
    const tex = (layer: string) => art?.frame(name(layer)) ?? null;
    const body = tex('body'), detail = tex('detail');
    if (body && detail) {
      for (const [sprite, texture] of [[v.body, body], [v.detail, detail], [v.shadow, tex('shadow')], [v.lights, tex('lights')]] as const) {
        sprite.texture = texture ?? Texture.EMPTY;
        const anchor = texture?.defaultAnchor ?? { x: 0, y: 0 };
        sprite.anchor.set(anchor.x, anchor.y);
      }
      if (v.vector) { v.vector.destroy(); v.vector = null; }
      return;
    }
    // Vector fallback: a rounded body footprint with a darker cabin, turned to the heading.
    v.body.texture = Texture.EMPTY; v.detail.texture = Texture.EMPTY;
    if (!v.vector) { v.vector = new Graphics(); v.root.addChild(v.vector); }
    const g = v.vector.clear();
    const angle = v.frame * Math.PI * 2 / 16, len = lengthOf(vehicle) / 100, wid = vehicle.kind === 'bus' ? 0.3 : 0.25;
    const corner = (fx: number, fy: number) => {
      const gx = Math.cos(angle) * fx - Math.sin(angle) * fy, gy = Math.sin(angle) * fx + Math.cos(angle) * fy;
      return { x: (gx - gy) * TILE_W / 2, y: (gx + gy) * TILE_H / 2 };
    };
    const quad = (l: number, w: number, lift: number) => [corner(l, w), corner(l, -w), corner(-l, -w), corner(-l, w)].flatMap((p) => [p.x, p.y - lift]);
    g.poly(quad(len / 2, wid / 2, 0)).fill(0x2a2f33).poly(quad(len / 2, wid / 2, 5)).fill(v.color)
      .poly(quad(len / 3.2, wid / 2.6, 9)).fill(0x34444f);
  }

  private drawSelection(): void {
    const g = this.selection.clear();
    const v = this.selectedId ? this.vehicles.get(this.selectedId) : undefined;
    if (!v?.pose || !v.root.visible) return;
    const at = iso(v.pose.x, v.pose.y);
    g.ellipse(at.x, at.y, 17, 8.5).stroke({ color: 0xffffff, width: 2.4, alpha: 0.95 }).ellipse(at.x, at.y, 17, 8.5).fill({ color: 0xffd36e, alpha: 0.22 });
  }

  /** Bus-stop shelters on their curb (always visible, like any street furniture). */
  private syncStops(world: WorldState): void {
    const stops = world.transport?.stops ?? [];
    const key = `${stops.map((s) => `${s.id}@${s.tile.x},${s.tile.y}`).join(';')}|${world.plan.roads.length}`;
    if (key === this.stopsKey) return;
    this.stopsKey = key;
    const roads = new Set(world.plan.roads.map((t) => `${t.x},${t.y}`));
    const live = new Set<string>();
    for (const stop of stops) {
      const side = stopSide(stop.tile, roads);
      const spriteKey = `${side}`;
      live.add(stop.id);
      let s = this.stops.get(stop.id);
      if (s && s.key !== spriteKey) { s.root.destroy({ children: true }); s.shadow.destroy(); s.light.destroy(); s = undefined; }
      if (!s) s = this.createStop(stop, side);
      this.stops.set(stop.id, s);
    }
    for (const [id, s] of this.stops) if (!live.has(id)) { s.root.destroy({ children: true }); s.shadow.destroy(); s.light.destroy(); this.stops.delete(id); }
  }

  private createStop(stop: BusStop, side: 'N' | 'E' | 'S' | 'W'): StopSprite {
    const root = new Container();
    root.eventMode = 'none';
    root.label = 'bus-stop';
    const at = iso(stop.tile.x + 0.5, stop.tile.y + 0.5);
    root.position.set(at.x, at.y);
    const depth = { N: -0.4, W: -0.4, S: 0.4, E: 0.4 }[side];
    root.zIndex = stop.tile.x + stop.tile.y + 1 + depth;
    const art = this.art;
    const texture = art?.frame(`stop:${side}:color`) ?? null;
    const shadow = new Sprite(art?.frame(`stop:${side}:shadow`) ?? Texture.EMPTY);
    const light = new Sprite(art?.frame(`stop:${side}:lights`) ?? Texture.EMPTY);
    for (const sprite of [shadow, light]) { const a = sprite.texture.defaultAnchor ?? { x: 0, y: 0 }; sprite.anchor.set(a.x, a.y); sprite.position.set(at.x, at.y); }
    shadow.alpha = SHADOW_ALPHA;
    if (texture) {
      const sprite = new Sprite(texture);
      const a = texture.defaultAnchor ?? { x: 0, y: 0 };
      sprite.anchor.set(a.x, a.y);
      root.addChild(sprite);
    } else {
      // Vector fallback: a sign post with a teal disc.
      const g = new Graphics();
      const off = { N: { x: 0, y: -0.35 }, S: { x: 0, y: 0.35 }, W: { x: -0.35, y: 0 }, E: { x: 0.35, y: 0 } }[side];
      const p = { x: (off.x - off.y) * TILE_W / 2, y: (off.x + off.y) * TILE_H / 2 };
      g.rect(p.x - 1, p.y - 20, 2, 20).fill(0x40494e).circle(p.x, p.y - 22, 5).fill(0x2f8f83).circle(p.x, p.y - 22, 2.2).fill(0xffffff);
      root.addChild(g);
    }
    root.tint = this.tint;
    this.scene.addChild(root);
    this.shadowLayer.addChild(shadow);
    this.lightLayer.addChild(light);
    return { root, shadow, light, key: side };
  }

  /**
   * Traffic overlay (congestion per road tile from the smoothed lane delays) or transit overlay (bus lines along
   * their real loops, and stops); always the selected vehicle's remaining route. Redrawn only when inputs change.
   */
  private drawOverlay(world: WorldState): void {
    const t = world.transport;
    const selected = this.selectedId ? t?.vehicles.find((v) => v.id === this.selectedId) : undefined;
    const key = `${this.overlayMode}|${this.overlayMode === 'traffic' ? world.clock.tick - (world.clock.tick % 10) : ''}|${t?.lines.map((l) => `${l.id}${l.status}${l.stopIds.join()}`).join(';') ?? ''}|${world.plan.roads.length}|${world.revision}|${selected ? `${selected.id}:${selected.path}:${selected.edge}` : ''}|${this.draft?.map((t) => `${t.x},${t.y}`).join(';') ?? ''}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const g = this.overlay.clear();
    if (!t) return;
    if (this.overlayMode === 'traffic') {
      const worst = new Map<string, number>();
      for (const [lane, value] of Object.entries(t.congestion)) {
        const tile = lane.slice(0, -1);
        worst.set(tile, Math.max(worst.get(tile) ?? 0, value));
      }
      for (const road of world.plan.roads) {
        const value = worst.get(`${road.x},${road.y}`) ?? 0;
        const level = congestionLevel(value);
        const color = CONGESTION_COLORS[level]![1];
        diamond(g, road.x, road.y, 0.86);
        g.fill({ color, alpha: level === 0 ? 0.5 : 0.7 + level * 0.08 });
      }
      // Roads cut off from the main network (vehicles cannot reach them): dashed red outlines.
      const components = networkFor(world).navigator.graph.getComponents();
      if (components.length > 1) {
        const main = components.reduce((a, b) => b.length > a.length ? b : a);
        for (const component of components) {
          if (component === main) continue;
          for (const road of component) { diamond(g, road.x, road.y, 0.92); g.stroke({ color: 0xd2484a, width: 2, alpha: 0.95 }); }
        }
      }
    }
    if (this.overlayMode === 'transit' || this.overlayMode === 'traffic') {
      const network = networkFor(world);
      const stops = new Map(t.stops.map((s) => [s.id, s]));
      t.lines.forEach((line, i) => {
        const plan = network.linePlan(line, stops).plan;
        if (!plan || line.status !== 'active') return;
        const offset = (i % 3 - 1) * 0.12;
        const color = LINE_COLORS[line.color % LINE_COLORS.length]!;
        // A white casing under the line colour, so the route reads as a line on top of the streets.
        const transit = this.overlayMode === 'transit';
        for (const leg of plan.legs) polyline(g, leg, offset);
        g.stroke({ color: 0xffffff, width: transit ? 10 : 6, alpha: transit ? 0.95 : 0.6, cap: 'round', join: 'round' });
        for (const leg of plan.legs) polyline(g, leg, offset);
        g.stroke({ color, width: transit ? 5.5 : 3, alpha: transit ? 1 : 0.7, cap: 'round', join: 'round' });
      });
      for (const stop of t.stops) {
        const at = iso(stop.tile.x + 0.5, stop.tile.y + 0.5);
        g.circle(at.x, at.y, 9).fill({ color: 0xffffff, alpha: 0.95 }).circle(at.x, at.y, 9).stroke({ color: 0x2f8f83, width: 3.5 });
      }
    }
    if (this.draft?.length) {
      this.draft.forEach((tile, i) => {
        const at = iso(tile.x + 0.5, tile.y + 0.5);
        if (i > 0) { const prev = iso(this.draft![i - 1]!.x + 0.5, this.draft![i - 1]!.y + 0.5); g.moveTo(prev.x, prev.y).lineTo(at.x, at.y).stroke({ color: 0x2f8f83, width: 2, alpha: 0.6 }); }
      });
      this.draft.forEach((tile, i) => {
        const at = iso(tile.x + 0.5, tile.y + 0.5);
        g.circle(at.x, at.y, 9).fill({ color: 0x2f8f83 }).circle(at.x, at.y, 9).stroke({ color: 0xffffff, width: 2.5 });
        // Order pips: one small dot per position (1–12), so the sequence reads without text.
        for (let k = 0; k <= i && k < 12; k += 1) g.circle(at.x - 6 + (k % 4) * 4, at.y - 2 + Math.floor(k / 4) * 4, 1.2).fill({ color: 0xffffff });
      });
    }
    if (selected) {
      const route = decodePath(selected.origin, selected.path).slice(selected.edge);
      polyline(g, route, 0);
      g.stroke({ color: 0xffd36e, width: 3, alpha: 0.9, cap: 'round', join: 'round' });
      const end = route.at(-1)!;
      const at = iso(end.x + 0.5, end.y + 0.5);
      g.circle(at.x, at.y, 5).fill({ color: 0xffd36e }).circle(at.x, at.y, 5).stroke({ color: 0x8a5a12, width: 1.5 });
    }
  }

  destroy(): void {
    for (const [id, v] of this.vehicles) this.remove(id, v);
    for (const s of this.stops.values()) { s.root.destroy({ children: true }); s.shadow.destroy(); s.light.destroy(); }
    this.stops.clear();
    this.overlay.destroy();
    this.selection.destroy();
    this.lightLayer.destroy({ children: true });
    this.shadowLayer.destroy({ children: true });
  }
}

export { vehicleColor };
function multiply(a: number, b: number): number {
  const c = (shift: number) => Math.round(((a >> shift) & 0xff) * ((b >> shift) & 0xff) / 255);
  return (c(16) << 16) | (c(8) << 8) | c(0);
}
function diamond(g: Graphics, x: number, y: number, scale: number): void {
  const c = iso(x + 0.5, y + 0.5), hw = TILE_W / 2 * scale, hh = TILE_H / 2 * scale;
  g.poly([c.x, c.y - hh, c.x + hw, c.y, c.x, c.y + hh, c.x - hw, c.y]);
}
function polyline(g: Graphics, tiles: readonly Position[], offset: number): void {
  if (tiles.length < 2) return;
  tiles.forEach((tile, i) => {
    const next = tiles[Math.min(tiles.length - 1, i + 1)]!, prev = tiles[Math.max(0, i - 1)]!;
    const dx = next.x - prev.x, dy = next.y - prev.y, n = Math.hypot(dx, dy) || 1;
    const p = iso(tile.x + 0.5 - dy / n * offset, tile.y + 0.5 + dx / n * offset);
    if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
  });
}
