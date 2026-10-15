import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { Building, Citizen, CitizenActivity, Position, WorldState } from '@tiny-city/simulation';
import { iso } from './mapGeometry';
import { currentArt } from './art/artLibrary';
import { CharacterRig, hasCharacterArt } from './art/characterRig';
import { citizenLook, selectPose } from './art/characterLook';
import { crowdLayout, type CrowdPlacement } from './venueCrowd';
import { figureDepth, hashString, lotDepths, waitingAtStops, type StopPlace } from './npcMotion';
import {
  blendPosition, citizenAppearance, laneOffset, receiveSnapshot, screenFacing,
  type CitizenAppearance, type MotionSample,
} from './npcMotion';

/** Local sprite units: feet at (0,0), roughly 17 units tall next to a 30-unit villa. */
const FEET_TO_CENTER = 8;
const FADE_PER_MS = 1 / 180;
const LANE_EASE_PER_MS = 1 / 140;
const WALK_CYCLES_PER_TILE = 2.6;
/** Residents read clearly at normal zoom and keep a minimum on-screen size when zoomed out. */
const BASE_SCALE = 1.15;
export function npcSpriteScale(viewScale: number): number {
  return Math.max(BASE_SCALE, Math.min(2.4, 0.7 / Math.max(viewScale, 0.05)));
}
const ACTIVITY_COLORS: Record<CitizenActivity, number> = {
  travel: 0xd9962f, work: 0x4f84a8, leisure: 0x6c9d5a, home: 0xc8714f, sleep: 0x6a6ca6, idle: 0x8f9a91,
};

/** Baked figures are about 26 px tall; at this local scale a resident stands ~22 units (about 1.4 storeys of a villa). */
export const RIG_LOCAL_SCALE = 0.86;
/** Venue visitors walk from the entrance to their spot at this speed (tiles per second, presentation only). */
const VENUE_WALK_TILES_PER_MS = 1.6 / 1000;

interface NpcSprite {
  root: Container;
  figure: Container;
  bodyGroup: Container;
  rig: CharacterRig | null;
  seed: number;
  /** Venue presentation: where the visitor is drawn, and the walk-in from where they were last seen. */
  venue: { placement: CrowdPlacement; from: Position; progress: number } | null;
  hoverRing: Graphics;
  badge: Graphics;
  activity: CitizenActivity;
  legLeft: Graphics | null;
  legRight: Graphics | null;
  face: Graphics | null;
  hairFront: Graphics | null;
  hairBack: Graphics | null;
  ring: Graphics;
  appearance: CitizenAppearance;
  sample: MotionSample;
  rendered: Position;
  lastBase: Position;
}

export interface LocalBounds { left: number; top: number; right: number; bottom: number }

/** Shared geometry: hundreds of residents reuse a few dozen GPU contexts instead of rebuilding paths. */
class ContextCache {
  private readonly contexts = new Map<string, GraphicsContext>();
  get(key: string, build: (context: GraphicsContext) => void): GraphicsContext {
    let context = this.contexts.get(key);
    if (!context) { context = new GraphicsContext(); build(context); this.contexts.set(key, context); }
    return context;
  }
  destroy(): void {
    for (const context of this.contexts.values()) context.destroy();
    this.contexts.clear();
  }
}

function shade(color: number, amount: number): number {
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 0xff) * amount)));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export class NpcLayer {
  private readonly sprites = new Map<string, NpcSprite>();
  private readonly cache = new ContextCache();
  private readonly routeGraphics = new Graphics();
  private lastState: WorldState | null = null;
  private lastFrame = 0;
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private pulse = 0;
  private tint = 0xffffff;
  private time = 0;
  private crowd = new Map<string, CrowdPlacement>();
  private waiting: ReadonlyMap<string, StopPlace> = new Map();
  private interactions = new Map<string, { action: 'wave' | 'talk'; toward: Position }>();
  private artRigs = false;
  private lots = new Map<string, number>();
  private lotsPlan: WorldState['plan'] | null = null;
  private readonly reducedMotion: boolean;

  constructor(private readonly scene: Container, groundOverlay: Container,
    private readonly options: { frontOf?: (building: Building) => 'S' | 'E'; reducedMotion?: boolean } = {}) {
    this.reducedMotion = options.reducedMotion ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.routeGraphics.eventMode = 'none';
    groundOverlay.addChild(this.routeGraphics);
  }

  get count(): number { return this.sprites.size; }

  setHovered(id: string | null): void { this.hoveredId = id; }

  /**
   * Night/dusk multiply tint for figures only; selection and hover rings stay bright. Residents are lifted halfway
   * towards white so they stay readable in the dark (as if lit by the street), without glowing.
   */
  setTint(tint: number): void {
    if (tint === this.tint) return;
    this.tint = tint;
    const lifted = liftTint(tint);
    for (const sprite of this.sprites.values()) sprite.figure.tint = lifted;
  }

  private badgeContext(activity: CitizenActivity): GraphicsContext {
    return this.cache.get(`badge:${activity}`, (g) => {
      g.roundRect(-5.5, -30, 11, 9, 4.5).fill(ACTIVITY_COLORS[activity]).stroke({ color: 0xffffff, width: 1, alpha: 0.95 });
      g.poly([-1.6, -21, 1.6, -21, 0, -19]).fill(ACTIVITY_COLORS[activity]);
      const white = 0xffffff;
      switch (activity) {
        case 'work': g.roundRect(-2.8, -27.4, 5.6, 4, 0.8).fill(white).rect(-1.2, -28.4, 2.4, 1.1).fill(white); break;
        case 'home': g.poly([-3, -25, 0, -28, 3, -25]).fill(white).rect(-2, -25, 4, 2.6).fill(white); break;
        case 'leisure': g.ellipse(0, -25.5, 2.2, 3).fill(white); break;
        case 'sleep': g.moveTo(-2, -27.6).lineTo(2, -27.6).lineTo(-2, -23.4).lineTo(2, -23.4).stroke({ color: white, width: 1.1 }); break;
        case 'travel': g.moveTo(-3, -25.5).lineTo(2.6, -25.5).stroke({ color: white, width: 1.2 }).poly([1, -27.4, 3.4, -25.5, 1, -23.6]).fill(white); break;
        default: g.circle(-2.2, -25.5, 0.8).fill(white).circle(0, -25.5, 0.8).fill(white).circle(2.2, -25.5, 0.8).fill(white);
      }
    });
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    const previous = this.selectedId ? this.sprites.get(this.selectedId) : undefined;
    if (previous) previous.ring.visible = false;
    this.selectedId = id;
  }

  /** Last drawn world-tile position, including interpolation and lane offset. */
  getRenderedPosition(id: string): Position | null {
    return this.sprites.get(id)?.rendered ?? null;
  }

  private createSprite(citizen: Citizen, world: WorldState): NpcSprite {
    const art = currentArt();
    if (hasCharacterArt(art)) return this.createRigSprite(citizen, world, new CharacterRig(art, citizenLook(citizen.id)));
    const look = citizenAppearance(citizen.id);
    const root = new Container();
    root.label = 'npc';
    root.eventMode = 'none';
    const ring = new Graphics(this.cache.get('ring', (g) => {
      g.ellipse(0, 0, 9, 4.5).fill({ color: 0xffd36e, alpha: 0.32 }).ellipse(0, 0, 9, 4.5).stroke({ color: 0xffc94d, width: 2, alpha: 1 })
        .ellipse(0, 0, 11.5, 5.8).stroke({ color: 0xfff1c4, width: 1, alpha: 0.7 });
    }));
    ring.visible = false;
    const hoverRing = new Graphics(this.cache.get('hover-ring', (g) => {
      g.ellipse(0, 0, 8.5, 4.2).fill({ color: 0xffffff, alpha: 0.18 }).ellipse(0, 0, 8.5, 4.2).stroke({ color: 0xffffff, width: 1.4, alpha: 0.9 });
    }));
    hoverRing.visible = false;
    const badge = new Graphics(this.badgeContext(citizen.activity));
    badge.visible = false;
    const shadow = new Graphics(this.cache.get('shadow', (g) => { g.ellipse(0, 0, 5, 2.3).fill({ color: 0x14221a, alpha: 0.38 }); }));
    // Dark silhouette behind the figure keeps residents legible on asphalt and grass alike.
    const outline = new Graphics(this.cache.get('outline', (g) => {
      g.roundRect(-4.9, -12.7, 9.8, 8.6, 2.6).fill({ color: 0x14221a, alpha: 0.5 });
      g.circle(0, -14.8, 3.75).fill({ color: 0x14221a, alpha: 0.5 });
      g.roundRect(-2.6, -5.8, 5.2, 6.2, 1.4).fill({ color: 0x14221a, alpha: 0.42 });
    }));
    const leg = (key: string) => new Graphics(this.cache.get(`leg:${key}`, (g) => {
      g.roundRect(-0.85, 0, 1.7, 5.4, 0.8).fill(look.pants).roundRect(-0.95, 4.6, 1.9, 1.1, 0.5).fill(0x2a2622);
    }));
    const legLeft = leg(`${look.pants}`);
    const legRight = leg(`${look.pants}`);
    legLeft.position.set(-1.3, -5.6);
    legRight.position.set(1.3, -5.6);
    const bodyGroup = new Container();
    const body = new Graphics(this.cache.get(`body:${look.silhouette}:${look.shirt}`, (g) => {
      const dark = shade(look.shirt, 0.78);
      if (look.silhouette === 'dress') {
        g.poly([-2.6, -11.6, 2.6, -11.6, 3.8, -4.2, -3.8, -4.2]).fill(look.shirt);
        g.poly([0.6, -11.6, 2.6, -11.6, 3.8, -4.2, 1.2, -4.2]).fill({ color: dark, alpha: 0.55 });
      } else {
        g.roundRect(-3.1, -11.8, 6.2, 7, 2).fill(look.shirt);
        g.roundRect(0.7, -11.8, 2.4, 7, 1.4).fill({ color: dark, alpha: 0.5 });
        if (look.silhouette === 'jacket') g.rect(-0.35, -11.4, 0.7, 6.4).fill({ color: 0xf6f0e2, alpha: 0.85 });
      }
      // Arms
      g.roundRect(-4.1, -11.1, 1.3, 5.2, 0.65).fill(dark).roundRect(2.8, -11.1, 1.3, 5.2, 0.65).fill(dark);
    }));
    const head = new Graphics(this.cache.get(`head:${look.skin}`, (g) => {
      g.rect(-0.8, -13, 1.6, 1.6).fill(shade(look.skin, 0.88));
      g.circle(0, -14.6, 2.85).fill(look.skin);
    }));
    const face = new Graphics(this.cache.get('face', (g) => {
      g.circle(-1, -14.4, 0.42).fill(0x2a2420).circle(1.15, -14.4, 0.42).fill(0x2a2420);
      g.ellipse(-1.9, -13.5, 0.6, 0.35).fill({ color: 0xe58f7a, alpha: 0.45 });
    }));
    const hairFront = new Graphics(this.cache.get(`hair:${look.hairStyle}:${look.hair}:front`, (g) => {
      const hair = look.hairStyle === 'cap' ? 0xc8714f : look.hair;
      if (look.hairStyle === 'cap') {
        g.arc(0, -15, 3.05, Math.PI, 0).fill(hair).roundRect(-0.4, -15.6, 4.6, 1.1, 0.5).fill(shade(hair, 0.8));
      } else {
        g.arc(0, -14.9, 3.05, Math.PI * 1.02, Math.PI * 1.98).fill(look.hair);
        g.poly([-3, -15.2, -1.2, -16.9, 1.6, -16.7, 3, -15.2, 0.6, -15.9]).fill(look.hair);
        if (look.hairStyle === 'long') g.roundRect(-3.2, -15.4, 1.6, 5, 0.8).fill(look.hair).roundRect(1.6, -15.4, 1.6, 5, 0.8).fill(look.hair);
        if (look.hairStyle === 'bun') g.circle(0, -18.2, 1.5).fill(look.hair);
      }
    }));
    const hairBack = new Graphics(this.cache.get(`hair:${look.hairStyle}:${look.hair}:back`, (g) => {
      const hair = look.hairStyle === 'cap' ? 0xc8714f : look.hair;
      g.circle(0, -14.7, 3.0).fill(hair);
      if (look.hairStyle === 'long') g.roundRect(-2.6, -15, 5.2, 5.4, 1.6).fill(look.hair);
      if (look.hairStyle === 'bun') g.circle(0, -18.2, 1.5).fill(look.hair);
    }));
    hairBack.visible = false;
    bodyGroup.addChild(body);
    if (look.accessory === 'bag') {
      bodyGroup.addChild(new Graphics(this.cache.get(`bag:${look.pants}`, (g) => {
        g.moveTo(-2.4, -11.4).lineTo(2.6, -6.4).stroke({ color: 0x5b4636, width: 0.7 });
        g.roundRect(1.6, -7.6, 2.8, 2.6, 0.6).fill(0x8a6f52);
      })));
    } else if (look.accessory === 'scarf') {
      bodyGroup.addChild(new Graphics(this.cache.get(`scarf:${look.shirt}`, (g) => {
        g.roundRect(-2.6, -12.4, 5.2, 1.5, 0.7).fill(look.shirt === 0xe0c27a ? 0x5fa7a8 : 0xe0c27a);
      })));
    }
    bodyGroup.addChild(head, face, hairFront, hairBack);
    const figure = new Container();
    figure.addChild(shadow, outline, legLeft, legRight, bodyGroup);
    figure.tint = this.tint;
    root.addChild(ring, hoverRing, figure, badge);
    this.scene.addChild(root);
    const { sample } = receiveSnapshot(undefined, citizen, world);
    root.alpha = sample.alpha;
    root.visible = sample.alpha > 0.01;
    return { root, figure, bodyGroup, hoverRing, badge, activity: citizen.activity, legLeft, legRight, face, hairFront, hairBack, ring, appearance: look, sample,
      rendered: citizen.position, lastBase: citizen.position, rig: null, seed: hashString(citizen.id), venue: null };
  }

  /** 3.0C: a baked, animated character for the resident (same rings, badge and picking as before). */
  private createRigSprite(citizen: Citizen, world: WorldState, rig: CharacterRig): NpcSprite {
    const root = new Container();
    root.label = 'npc';
    root.eventMode = 'none';
    const ring = new Graphics(this.cache.get('ring', (g) => {
      g.ellipse(0, 0, 9, 4.5).fill({ color: 0xffd36e, alpha: 0.32 }).ellipse(0, 0, 9, 4.5).stroke({ color: 0xffc94d, width: 2, alpha: 1 })
        .ellipse(0, 0, 11.5, 5.8).stroke({ color: 0xfff1c4, width: 1, alpha: 0.7 });
    }));
    ring.visible = false;
    const hoverRing = new Graphics(this.cache.get('hover-ring', (g) => {
      g.ellipse(0, 0, 8.5, 4.2).fill({ color: 0xffffff, alpha: 0.18 }).ellipse(0, 0, 8.5, 4.2).stroke({ color: 0xffffff, width: 1.4, alpha: 0.9 });
    }));
    hoverRing.visible = false;
    const badge = new Graphics(this.badgeContext(citizen.activity));
    badge.visible = false;
    // Soft contact shadow grounds the figure on roads, lawns and decks.
    const shadow = new Graphics(this.cache.get('rig-shadow', (g) => {
      g.ellipse(0.6, 0.2, 6.2, 2.7).fill({ color: 0x14221a, alpha: 0.22 }).ellipse(0.3, 0, 4.4, 1.9).fill({ color: 0x14221a, alpha: 0.28 });
    }));
    rig.root.scale.set(RIG_LOCAL_SCALE);
    const bodyGroup = new Container();
    bodyGroup.addChild(rig.root);
    const figure = new Container();
    figure.addChild(shadow, bodyGroup);
    figure.tint = liftTint(this.tint);
    root.addChild(ring, hoverRing, figure, badge);
    this.scene.addChild(root);
    const { sample } = receiveSnapshot(undefined, citizen, world);
    root.alpha = sample.alpha;
    root.visible = sample.alpha > 0.01;
    return { root, figure, bodyGroup, hoverRing, badge, activity: citizen.activity, legLeft: null, legRight: null, face: null, hairFront: null, hairBack: null,
      ring, appearance: citizenAppearance(citizen.id), sample, rendered: citizen.position, lastBase: citizen.position, rig, seed: hashString(citizen.id), venue: null };
  }

  /**
   * Called once per Pixi frame after the simulation advance. Reads the authoritative snapshot, never writes it.
   * `alpha` is the fraction of the next fixed step; positions are blended between the two latest ticks.
   */
  sync(world: WorldState, nowMs: number, viewScale: number, bounds: LocalBounds | null): void {
    const dt = this.lastFrame === 0 ? 16 : Math.min(100, Math.max(0, nowMs - this.lastFrame));
    this.lastFrame = nowMs;
    const alpha = world.clock.accumulatedMs / world.clock.fixedStepMs;
    const spriteScale = npcSpriteScale(viewScale);
    // Endless loops (idle breathing, chat gestures) follow world time and freeze while the clock is paused; fades
    // and walk-ins finish on their own and use real time.
    const animDt = world.clock.paused ? 0 : dt;
    this.time += animDt;
    // Baked characters load asynchronously: rebuild every resident once when they arrive.
    const rigs = hasCharacterArt(currentArt());
    if (rigs !== this.artRigs) {
      this.artRigs = rigs;
      for (const sprite of this.sprites.values()) sprite.root.destroy({ children: true });
      this.sprites.clear();
      this.lastState = null;
    }
    const stateChanged = this.lastState !== world;
    if (stateChanged) {
      this.waiting = waitingAtStops(world);
      this.crowd = crowdLayout(world, this.options.frontOf);
      if (world.plan !== this.lotsPlan) { this.lots = lotDepths(world.plan); this.lotsPlan = world.plan; }
      this.interactions = interactionsOf(world);
      const live = new Set<string>();
      for (const citizen of world.citizens) {
        live.add(citizen.id);
        let sprite = this.sprites.get(citizen.id);
        if (!sprite) { sprite = this.createSprite(citizen, world); this.sprites.set(citizen.id, sprite); continue; }
        if (sprite.activity !== citizen.activity) { sprite.activity = citizen.activity; sprite.badge.context = this.badgeContext(citizen.activity); }
        const placement = this.crowd.get(citizen.id);
        if (placement && sprite.venue?.placement.venueId !== placement.venueId) {
          // Entering a park, pool or terrace: walk in from where they were last drawn (or appear at the spot).
          const from = sprite.sample.alpha > 0.5 ? sprite.rendered : placement.position;
          sprite.venue = { placement, from, progress: 0 };
        } else if (placement && sprite.venue) sprite.venue.placement = placement;
        else if (!placement) sprite.venue = null;
        const update = receiveSnapshot(sprite.sample, citizen, world);
        sprite.sample = update.sample;
        if (update.snapped && update.sample.outdoors) {
          // Discontinuities (editor relocation, re-entry, structural edits) appear in place rather than gliding.
          sprite.sample.offset = laneOffset(update.sample.heading, sprite.appearance.lane);
          if (sprite.sample.alpha >= 0.99) sprite.sample.alpha = 0.35;
        }
      }
      for (const [id, sprite] of this.sprites) {
        if (live.has(id)) continue;
        sprite.root.destroy({ children: true });
        this.sprites.delete(id);
        if (this.selectedId === id) this.selectedId = null;
      }
      this.lastState = world;
    }
    this.pulse = (this.pulse + dt / 900) % 1;
    for (const [id, sprite] of this.sprites) {
      const sample = sprite.sample;
      if (sprite.venue) { this.syncVenueVisitor(id, sprite, dt, spriteScale, bounds); continue; }
      const target = sample.outdoors ? 1 : 0;
      sample.alpha += Math.sign(target - sample.alpha) * Math.min(Math.abs(target - sample.alpha), dt * FADE_PER_MS);
      if (world.clock.paused && (sample.from.x !== sample.to.x || sample.from.y !== sample.to.y)) {
        // Settle onto the authoritative position while paused, so resuming continues from exactly there.
        const settle = Math.min(1, dt / 120);
        const close = Math.abs(sample.to.x - sample.from.x) + Math.abs(sample.to.y - sample.from.y) < 0.002;
        sample.from = close ? sample.to : { x: sample.from.x + (sample.to.x - sample.from.x) * settle, y: sample.from.y + (sample.to.y - sample.from.y) * settle };
      }
      const base = blendPosition(sample, alpha);
      const travelled = Math.abs(base.x - sprite.lastBase.x) + Math.abs(base.y - sprite.lastBase.y);
      sprite.lastBase = base;
      // Waiting at a bus stop: stand on the shelter's curb instead of the walking lane.
      const waitingPlace = this.waiting.get(id);
      const laneTarget = waitingPlace ? waitingPlace.offset : laneOffset(sample.heading, sprite.appearance.lane);
      const ease = Math.min(1, dt * LANE_EASE_PER_MS);
      sample.offset = { x: sample.offset.x + (laneTarget.x - sample.offset.x) * ease, y: sample.offset.y + (laneTarget.y - sample.offset.y) * ease };
      const position = { x: base.x + sample.offset.x, y: base.y + sample.offset.y };
      sprite.rendered = position;
      const visible = sample.alpha > 0.01 && (!bounds || position.x >= bounds.left && position.x <= bounds.right &&
        position.y >= bounds.top && position.y <= bounds.bottom);
      sprite.root.visible = visible;
      if (!visible) continue;
      // Walking poses follow real displacement, so pause freezes mid-stride and faster speeds stride faster.
      const moving = sample.outdoors && sample.moving;
      if (moving && travelled < 1) sample.walkPhase = (sample.walkPhase + travelled * WALK_CYCLES_PER_TILE * Math.PI * 2) % (Math.PI * 2);
      const orientation = screenFacing(sample.heading, sample.facing);
      sample.facing = orientation.facing;
      sample.away = orientation.away && moving;
      const screen = iso(position.x, position.y);
      sprite.root.position.set(screen.x, screen.y);
      sprite.root.zIndex = figureDepth(position, this.lots) + 0.0001;
      sprite.root.alpha = sample.alpha;
      sprite.root.scale.set(spriteScale * sample.facing, spriteScale);
      if (sprite.rig) {
        const interaction = this.interactions.get(id);
        if (interaction && !moving) {
          // Greeting or chatting with the player: turn to face them.
          const toward = { x: interaction.toward.x - position.x, y: interaction.toward.y - position.y };
          const o = screenFacing({ x: Math.sign(Math.round(toward.x * 4)), y: Math.sign(Math.round(toward.y * 4)) }, sample.facing);
          sample.facing = o.facing;
          sprite.root.scale.x = spriteScale * sample.facing;
        }
        const pose = selectPose({ moving, walkPhase: sample.walkPhase, action: interaction && !moving ? interaction.action : 'none', seed: sprite.seed, timeMs: this.time, reducedMotion: this.reducedMotion });
        sprite.rig.show(sample.away && moving ? 'back' : 'front', pose.pose, pose.frame);
        sprite.bodyGroup.y = 0;
      } else {
        const swing = moving ? Math.sin(sample.walkPhase) * 0.55 : 0;
        sprite.legLeft!.rotation = swing;
        sprite.legRight!.rotation = -swing;
        // Walkers bob with their stride; waiting residents breathe gently so idle reads differently from walking.
        sprite.bodyGroup.y = moving ? -Math.abs(Math.sin(sample.walkPhase)) * 0.55 : Math.sin(this.pulse * Math.PI * 4 + sample.walkPhase) * 0.25;
        sprite.face!.visible = !sample.away;
        sprite.hairFront!.visible = !sample.away;
        sprite.hairBack!.visible = sample.away;
      }
      this.decorate(id, sprite, sample.facing);
    }
    this.drawSelection(world, viewScale);
  }

  /** Selection ring, badge and hover ring (shared by street walkers and venue visitors). */
  private decorate(id: string, sprite: NpcSprite, facing: 1 | -1): void {
    {
      const selected = id === this.selectedId;
      sprite.ring.visible = selected;
      sprite.badge.visible = selected;
      sprite.hoverRing.visible = !selected && id === this.hoveredId;
      if (selected) {
        sprite.ring.scale.set(1 + Math.sin(this.pulse * Math.PI * 2) * 0.08);
        sprite.badge.scale.x = facing;
        sprite.badge.y = Math.sin(this.pulse * Math.PI * 2) * 0.8;
      }
    }
  }

  /** A real visitor of a park, pool or terrace, drawn at their spot (walking in first) with a fitting pose. */
  private syncVenueVisitor(id: string, sprite: NpcSprite, dt: number, spriteScale: number, bounds: LocalBounds | null): void {
    const venue = sprite.venue!;
    const sample = sprite.sample;
    const to = venue.placement.position;
    const distance = Math.hypot(to.x - venue.from.x, to.y - venue.from.y);
    venue.progress = distance < 0.01 || this.reducedMotion ? 1 : Math.min(1, venue.progress + dt * VENUE_WALK_TILES_PER_MS / distance);
    const walking = venue.progress < 1;
    const position = walking ? { x: venue.from.x + (to.x - venue.from.x) * venue.progress, y: venue.from.y + (to.y - venue.from.y) * venue.progress } : to;
    sample.alpha = Math.min(1, sample.alpha + dt * FADE_PER_MS);
    sprite.rendered = position;
    const visible = !bounds || position.x >= bounds.left && position.x <= bounds.right && position.y >= bounds.top && position.y <= bounds.bottom;
    sprite.root.visible = visible;
    if (!visible) return;
    const heading = walking ? { x: Math.sign(Math.round((to.x - venue.from.x) * 4)), y: Math.sign(Math.round((to.y - venue.from.y) * 4)) } : venue.placement.heading;
    const orientation = screenFacing(heading, sample.facing);
    sample.facing = orientation.facing;
    if (walking) sample.walkPhase = (sample.walkPhase + dt * VENUE_WALK_TILES_PER_MS * WALK_CYCLES_PER_TILE * Math.PI * 2) % (Math.PI * 2);
    const screen = iso(position.x, position.y);
    sprite.root.position.set(screen.x, screen.y);
    sprite.root.zIndex = walking ? figureDepth(position, this.lots) + 0.0001 : Math.max(figureDepth(position, this.lots), venue.placement.depth);
    sprite.root.alpha = sample.alpha;
    sprite.root.scale.set(spriteScale * sample.facing, spriteScale);
    if (sprite.rig) {
      const action = venue.placement.action === 'idle' ? 'none' : venue.placement.action;
      const pose = selectPose({ moving: walking, walkPhase: sample.walkPhase, action, seed: sprite.seed, timeMs: this.time, reducedMotion: this.reducedMotion });
      sprite.rig.show(walking && orientation.away ? 'back' : 'front', pose.pose, pose.frame);
    } else {
      const swing = walking ? Math.sin(sample.walkPhase) * 0.55 : 0;
      sprite.legLeft!.rotation = swing; sprite.legRight!.rotation = -swing;
      sprite.face!.visible = true; sprite.hairFront!.visible = true; sprite.hairBack!.visible = false;
    }
    this.decorate(id, sprite, sample.facing);
  }

  private drawSelection(world: WorldState, viewScale: number): void {
    const g = this.routeGraphics;
    g.clear();
    if (!this.selectedId) return;
    const citizen = world.citizens.find((entry) => entry.id === this.selectedId);
    const sprite = this.sprites.get(this.selectedId);
    if (!citizen || !sprite) return;
    const movement = citizen.movement;
    const width = Math.max(2, 2.6 / Math.max(viewScale, 0.2));
    const destinationId = movement?.destinationBuildingId ?? citizen.targetBuildingId;
    const destination = world.plan.buildings.find((building) => building.id === destinationId);
    const glow = 0.55 + Math.sin(this.pulse * Math.PI * 2) * 0.2;
    if (destination && movement?.status !== 'inside') {
      const { x, y } = destination.position;
      const { width: w, height: h } = destination.footprint;
      const points = [iso(x, y), iso(x + w, y), iso(x + w, y + h), iso(x, y + h)].flatMap((point) => [point.x, point.y]);
      g.poly(points).fill({ color: 0xffd36e, alpha: 0.14 }).poly(points).stroke({ color: 0xffd36e, width, alpha: glow });
    }
    if (movement?.status === 'inside' && movement.currentBuildingId) {
      const inside = world.plan.buildings.find((building) => building.id === movement.currentBuildingId);
      if (inside) {
        const { x, y } = inside.position;
        const { width: w, height: h } = inside.footprint;
        const points = [iso(x, y), iso(x + w, y), iso(x + w, y + h), iso(x, y + h)].flatMap((point) => [point.x, point.y]);
        g.poly(points).fill({ color: 0x8fd3c1, alpha: 0.18 }).poly(points).stroke({ color: 0x8fd3c1, width, alpha: glow });
      }
    }
    if (movement?.status === 'travelling' && movement.route.length > movement.nextWaypoint) {
      const start = iso(sprite.rendered.x, sprite.rendered.y);
      g.moveTo(start.x, start.y);
      for (let index = movement.nextWaypoint; index < movement.route.length; index += 1) {
        const point = iso(movement.route[index]!.x, movement.route[index]!.y);
        g.lineTo(point.x, point.y);
      }
      g.stroke({ color: 0xfff1c4, width: width * 1.9, alpha: 0.35, cap: 'round', join: 'round' });
      g.moveTo(start.x, start.y);
      for (let index = movement.nextWaypoint; index < movement.route.length; index += 1) {
        const point = iso(movement.route[index]!.x, movement.route[index]!.y);
        g.lineTo(point.x, point.y);
      }
      g.stroke({ color: 0xffc94d, width, alpha: 0.95, cap: 'round', join: 'round' });
    }
  }

  /** Nearest visible resident under a world-local point, preferring the one drawn in front. */
  pick(point: Position, viewScale: number): string | null {
    const spriteScale = npcSpriteScale(viewScale);
    const radius = 7.5 * spriteScale + 5 / Math.max(viewScale, 0.05);
    let best: { id: string; distance: number; depth: number } | null = null;
    for (const [id, sprite] of this.sprites) {
      if (!sprite.root.visible || sprite.sample.alpha < 0.5) continue;
      const dx = point.x - sprite.root.position.x;
      const dy = point.y - (sprite.root.position.y - FEET_TO_CENTER * spriteScale);
      const distance = Math.hypot(dx, dy * 0.8);
      if (distance > radius) continue;
      const depth = sprite.root.zIndex;
      if (!best || distance < best.distance - 2 || Math.abs(distance - best.distance) <= 2 && depth > best.depth) best = { id, distance, depth };
    }
    return best?.id ?? null;
  }

  /** Number of residents currently drawn at a venue spot (parks, pools, terraces). */
  get venueVisitors(): number { let n = 0; for (const sprite of this.sprites.values()) if (sprite.venue && sprite.root.visible) n += 1; return n; }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.root.destroy({ children: true });
    this.sprites.clear();
    this.routeGraphics.destroy();
    this.cache.destroy();
  }
}

/** Halfway between the world tint and white: figures stay legible at night without glowing. */
export function liftTint(tint: number): number {
  const channel = (shift: number) => Math.round(((tint >> shift) & 0xff) * 0.55 + 255 * 0.45);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Residents the player is greeting or chatting with right now (real Life Mode state), and where the player stands. */
export function interactionsOf(world: WorldState): Map<string, { action: 'wave' | 'talk'; toward: Position }> {
  const out = new Map<string, { action: 'wave' | 'talk'; toward: Position }>();
  const player = world.player;
  const activity = player?.activity;
  if (player && activity && (activity.kind === 'greet' || activity.kind === 'socialize') && activity.phase === 'performing' && activity.citizenId) {
    out.set(activity.citizenId, { action: activity.kind === 'greet' ? 'wave' : 'talk', toward: player.position });
  }
  return out;
}
