import { Container, Graphics } from 'pixi.js';
import type { PlayerAppearance, PlayerCharacter, Position, WorldState } from '@tiny-city/simulation';
import { iso } from './mapGeometry';
import { npcSpriteScale } from './npcLayer';
import { figureDepth, lotDepths, screenFacing } from './npcMotion';
import { FIGURE_ORDER, FIGURE_ORDER_AWAY, playerFigure, type PlayerFigure, type Shape } from './playerLook';
import { currentArt } from './art/artLibrary';
import { CharacterRig, hasCharacterArt } from './art/characterRig';
import { lookFromAppearance, selectPose } from './art/characterLook';
import { RIG_LOCAL_SCALE } from './npcLayer';
import { playerVenueSpot } from './venueCrowd';
import type { Building } from '@tiny-city/simulation';

const WALK_CYCLES_PER_TILE = 2.2;
const PLAYER_SCALE = 1.12;
/** Open-air venues show the player standing inside; closed buildings show a location pin instead. */
const OPEN_AIR = new Set(['park', 'pool']);
const MARKER = 0xc8714f;
const RING = 0xffd36e;

function draw(g: Graphics, shapes: readonly Shape[]) {
  for (const s of shapes) {
    const fill = { color: 'fill' in s ? s.fill : 0, alpha: s.alpha ?? 1 };
    switch (s.kind) {
      case 'rect': g.roundRect(s.x, s.y, s.w, s.h, s.r).fill(fill); break;
      case 'circle': g.circle(s.x, s.y, s.r).fill(fill); break;
      case 'ellipse': g.ellipse(s.x, s.y, s.rx, s.ry).fill(fill); break;
      case 'poly': g.poly([...s.points]).fill(fill); break;
      case 'line': {
        g.moveTo(s.points[0]!, s.points[1]!);
        for (let i = 2; i < s.points.length; i += 2) g.lineTo(s.points[i]!, s.points[i + 1]!);
        g.stroke({ color: s.color, width: s.width, alpha: s.alpha ?? 1, cap: 'round', join: 'round' });
      }
    }
  }
}

export type LifeFeedback = { readonly id: number; readonly cell: Position; readonly ok: boolean };
export type HomeHighlight = { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly available: boolean; readonly selected: boolean; readonly fresh?: boolean };

interface Pulse { cell: Position; ok: boolean; age: number }

/** The player character on the map. Reads authoritative snapshots only; positions are blended between fixed ticks. */
export class PlayerLayer {
  private readonly root = new Container();
  private readonly figure = new Container();
  private readonly body = new Container();
  private readonly parts = new Map<string, Graphics>();
  private readonly legLeft = new Graphics();
  private readonly legRight = new Graphics();
  private readonly ring = new Graphics();
  private readonly marker = new Graphics();
  private readonly pin = new Container();
  private readonly overlay = new Graphics();
  private readonly highlights = new Graphics();
  private readonly badges = new Container();
  private badgeList: readonly HomeHighlight[] = [];
  private appearanceKey = '';
  private lots = new Map<string, number>();
  private lotsPlan: WorldState['plan'] | null = null;
  /** 3.0C baked character (null: 2.0 vector figure fallback). */
  private rig: CharacterRig | null = null;
  private from: Position | null = null;
  private to: Position | null = null;
  private tick = -1;
  private revision = -1;
  private walkPhase = 0;
  private facing: 1 | -1 = 1;
  private lastBase: Position | null = null;
  private lastFrame = 0;
  private time = 0;
  /** Pose clock: advances only while simulation time runs (pause freezes the character too). */
  private poseTime = 0;
  private pulses: Pulse[] = [];
  private lastFeedback = 0;
  private rendered: Position | null = null;
  private visibleOnMap = false;
  private tint = 0xffffff;
  private readonly reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** `liftOf` gives a building's roof height in local units, so pins and badges float just above it. */
  constructor(private readonly scene: Container, groundOverlay: Container, top: Container, private readonly liftOf: (buildingId: string) => number,
    private readonly frontOf: (building: Building) => 'S' | 'E' = () => 'S') {
    this.root.label = 'player';
    this.root.eventMode = 'none';
    this.root.visible = false;
    this.figure.addChild(this.ring);
    this.root.addChild(this.figure, this.marker);
    this.scene.addChild(this.root, this.pin);
    this.pin.eventMode = 'none';
    this.pin.visible = false;
    this.overlay.eventMode = 'none';
    this.highlights.eventMode = 'none';
    groundOverlay.addChild(this.highlights, this.overlay);
    this.badges.eventMode = 'none';
    top.addChild(this.badges);
    this.drawMarker();
  }

  private drawMarker() {
    this.ring.clear()
      .ellipse(0, 0, 9.5, 4.6).fill({ color: RING, alpha: 0.28 })
      .ellipse(0, 0, 9.5, 4.6).stroke({ color: MARKER, width: 1.6, alpha: 0.95 })
      .ellipse(0, 0, 12, 5.9).stroke({ color: 0xfff1c4, width: 1, alpha: 0.7 });
    // A small terracotta chevron above the head marks "you" without a label.
    this.marker.clear()
      .poly([-3.2, -33, 3.2, -33, 0, -28.6]).fill(MARKER).stroke({ color: 0xffffff, width: 1, alpha: 0.95 });
    const pin = new Graphics()
      .circle(0, -12, 7).fill(MARKER).stroke({ color: 0xffffff, width: 1.6 })
      .poly([-4.2, -7, 4.2, -7, 0, 0]).fill(MARKER)
      .circle(0, -12, 3.2).fill(0xffffff);
    this.pin.addChild(pin);
  }

  private build(appearance: PlayerAppearance) {
    const art = currentArt();
    const rigMode = hasCharacterArt(art);
    const key = `${rigMode ? 'rig' : 'vector'}:${JSON.stringify(appearance)}`;
    if (key === this.appearanceKey) return;
    this.appearanceKey = key;
    for (const g of this.parts.values()) g.destroy();
    this.parts.clear();
    this.figure.removeChildren();
    this.body.removeChildren();
    this.rig?.destroy();
    this.rig = null;
    if (rigMode) {
      // The same baked rig as residents, composed from the saved appearance.
      this.rig = new CharacterRig(art, lookFromAppearance(appearance));
      this.rig.root.scale.set(RIG_LOCAL_SCALE);
      const shadow = new Graphics().ellipse(0.6, 0.2, 6.6, 2.9).fill({ color: 0x14221a, alpha: 0.24 }).ellipse(0.3, 0, 4.6, 2).fill({ color: 0x14221a, alpha: 0.3 });
      this.parts.set('shadow', shadow);
      this.body.addChild(shadow, this.rig.root);
      this.body.tint = this.tint;
      this.figure.addChild(this.ring, this.body);
      return;
    }
    this.legLeft.clear(); this.legRight.clear();
    const figure: PlayerFigure = playerFigure(appearance);
    draw(this.legLeft, figure.legLeft);
    draw(this.legRight, figure.legRight);
    this.legLeft.position.set(...figure.legPivot.left);
    this.legRight.position.set(...figure.legPivot.right);
    for (const part of ['shadow', 'back', 'hairBack', 'body', 'front', 'head', 'face', 'hairFront', 'hairAway'] as const) {
      const g = new Graphics();
      draw(g, figure[part]);
      this.parts.set(part, g);
    }
    this.figure.addChild(this.ring);
    this.figure.addChild(this.body);
    this.arrange(false);
  }

  /** Layer order depends on whether the player faces the camera. */
  private arrange(away: boolean) {
    if (this.rig) return;
    this.body.removeChildren();
    const order = away ? FIGURE_ORDER_AWAY : FIGURE_ORDER;
    for (const part of order) {
      if (part === 'legs') { this.body.addChild(this.legLeft, this.legRight); continue; }
      const g = this.parts.get(part);
      if (g) this.body.addChild(g);
    }
    this.body.tint = this.tint;
  }

  setTint(tint: number) { this.tint = tint; this.body.tint = tint; }

  get position(): Position | null { return this.visibleOnMap ? this.rendered : null; }
  /** Where the camera should look: the figure, or the building the player is inside. */
  get focus(): Position | null { return this.rendered; }

  feedback(feedback: LifeFeedback | null | undefined) {
    if (!feedback || feedback.id === this.lastFeedback) return;
    this.lastFeedback = feedback.id;
    this.pulses.push({ cell: feedback.cell, ok: feedback.ok, age: 0 });
    if (this.pulses.length > 6) this.pulses.shift();
  }

  setHomeHighlights(list: readonly HomeHighlight[] | null) {
    const g = this.highlights;
    g.clear();
    this.badges.removeChildren().forEach((child) => child.destroy());
    this.badgeList = list ?? [];
    if (!list) return;
    // Floating badges above each roof read clearly even where the footprint is hidden by the building.
    for (const home of list) {
      const badge = new Graphics();
      const color = home.selected ? 0xe8b64c : home.available ? 0x2f8a5b : 0x8f9a91;
      const r = home.selected ? 12 : home.available ? 10 : 7;
      badge.poly([-3.4, -r * 0.4, 3.4, -r * 0.4, 0, r + 4]).fill(color);
      // Newly built housing gets a gold halo so it is easy to find after building it.
      if (home.fresh && home.available) badge.circle(0, -r * 0.6, r + 5).fill({ color: 0xffd36e, alpha: 0.45 }).stroke({ color: 0xe8b64c, width: 1.6 });
      badge.circle(0, -r * 0.6, r).fill(color).stroke({ color: 0xffffff, width: 1.6 });
      if (home.available || home.selected) {
        badge.poly([-r * 0.5, -r * 0.5, 0, -r * 1.05, r * 0.5, -r * 0.5]).fill(0xffffff);
        badge.rect(-r * 0.36, -r * 0.5, r * 0.72, r * 0.5).fill(0xffffff);
      } else badge.rect(-r * 0.45, -r * 0.7, r * 0.9, r * 0.22).fill(0xffffff);
      const center = iso(home.x + home.width / 2, home.y + home.height / 2);
      badge.position.set(center.x, center.y - this.liftOf(home.id) - 14);
      badge.label = home.id;
      this.badges.addChild(badge);
    }
    for (const home of list) {
      const pts = [iso(home.x, home.y), iso(home.x + home.width, home.y), iso(home.x + home.width, home.y + home.height), iso(home.x, home.y + home.height)]
        .flatMap((p) => [p.x, p.y]);
      if (home.selected) g.poly(pts).fill({ color: RING, alpha: 0.4 }).poly(pts).stroke({ color: 0xffc94d, width: 3.2, alpha: 1 });
      else if (home.available) g.poly(pts).fill({ color: 0x62c797, alpha: 0.28 }).poly(pts).stroke({ color: 0x2f8a5b, width: 2.2, alpha: 0.95 });
      else g.poly(pts).fill({ color: 0x8f9a91, alpha: 0.18 }).poly(pts).stroke({ color: 0x6d7b71, width: 1.4, alpha: 0.7 });
    }
  }

  /** Called every Pixi frame after the simulation advance. */
  sync(world: WorldState, nowMs: number, viewScale: number) {
    const dt = this.lastFrame === 0 ? 16 : Math.min(100, Math.max(0, nowMs - this.lastFrame));
    this.lastFrame = nowMs;
    this.time += dt;
    if (!world.clock.paused) this.poseTime += dt;
    const badgeScale = Math.max(1, 0.8 / Math.max(viewScale, 0.05));
    this.badges.children.forEach((badge, index) => {
      badge.scale.set(badgeScale);
      if (this.badgeList[index]?.selected && !this.reducedMotion) badge.pivot.y = Math.sin(this.time / 260) * 2;
    });
    const player = world.player;
    // A character waiting for a home is not in the world yet.
    if (!player || player.movement.status === 'unplaced') {
      this.root.visible = false; this.pin.visible = false; this.overlay.clear(); this.rendered = null; this.visibleOnMap = false;
      this.drawPulses(viewScale, dt);
      return;
    }
    this.build(player.appearance);
    const inside = player.movement.status === 'inside' ? world.plan.buildings.find((b) => b.id === player.movement.currentBuildingId) : undefined;
    // Snapshots: blend between the last two fixed-tick positions; snap across discontinuities.
    if (world.clock.tick !== this.tick || world.revision !== this.revision || !this.to || this.to.x !== player.position.x || this.to.y !== player.position.y) {
      const jump = !this.to || Math.abs(player.position.x - this.to.x) + Math.abs(player.position.y - this.to.y) > Math.max(1.2, 0.6 * world.clock.minutesPerTick * Math.max(1, world.clock.tick - this.tick));
      this.from = jump ? player.position : this.to;
      this.to = player.position;
      this.tick = world.clock.tick;
      this.revision = world.revision;
    }
    const alpha = world.clock.paused ? 1 : Math.max(0, Math.min(1, world.clock.accumulatedMs / world.clock.fixedStepMs));
    const from = this.from ?? player.position, to = this.to ?? player.position;
    // Visiting a park, pool or terrace: stand on the lawn or deck, not on the venue's centrepiece.
    const spot = inside ? playerVenueSpot(inside, this.frontOf) : null;
    const base = spot ? spot.position : { x: from.x + (to.x - from.x) * alpha, y: from.y + (to.y - from.y) * alpha };
    this.rendered = base;
    const showFigure = !inside || OPEN_AIR.has(inside.type ?? '');
    this.visibleOnMap = showFigure;
    this.root.visible = showFigure;
    // Slightly larger than residents so "you" stands out in a crowd.
    const scale = npcSpriteScale(viewScale) * PLAYER_SCALE;
    if (showFigure) {
      const travelled = this.lastBase ? Math.abs(base.x - this.lastBase.x) + Math.abs(base.y - this.lastBase.y) : 0;
      this.lastBase = base;
      const moving = player.movement.status === 'travelling' && travelled > 0;
      if (moving && travelled < 1) this.walkPhase = (this.walkPhase + travelled * WALK_CYCLES_PER_TILE * Math.PI * 2) % (Math.PI * 2);
      const orientation = screenFacing(player.movement.heading, this.facing);
      const away = orientation.away && player.movement.status === 'travelling';
      this.facing = orientation.facing;
      this.arrangeIfNeeded(away);
      const screen = iso(base.x, base.y);
      this.root.position.set(screen.x, screen.y);
      if (world.plan !== this.lotsPlan) { this.lots = lotDepths(world.plan); this.lotsPlan = world.plan; }
      this.root.zIndex = spot ? Math.max(figureDepth(base, this.lots), spot.depth) : figureDepth(base, this.lots) + 0.0002;
      this.root.scale.set(scale * this.facing, scale);
      if (this.rig) {
        const a = player.activity;
        const performing = a.phase === 'performing';
        const action = performing && a.kind === 'greet' ? 'wave' : performing && a.kind === 'socialize' ? 'talk'
          : performing && a.kind === 'visit' && inside ? 'sit' : 'none';
        if (action === 'wave' || action === 'talk') {
          // Face the resident being greeted.
          const other = world.citizens.find((c) => c.id === a.citizenId)?.position;
          if (other) {
            const o = screenFacing({ x: Math.sign(Math.round((other.x - base.x) * 4)), y: Math.sign(Math.round((other.y - base.y) * 4)) }, this.facing);
            this.facing = o.facing;
            this.root.scale.set(scale * this.facing, scale);
          }
        }
        const pose = selectPose({ moving, walkPhase: this.walkPhase, action, seed: 7, timeMs: this.poseTime, reducedMotion: this.reducedMotion });
        this.rig.show(away ? 'back' : 'front', pose.pose, pose.frame);
        this.body.y = 0;
      } else {
        const swing = moving ? Math.sin(this.walkPhase) * 0.5 : 0;
        this.legLeft.rotation = swing;
        this.legRight.rotation = -swing;
        const idle = this.reducedMotion ? 0 : Math.sin(this.time / 420) * 0.3;
        this.body.y = moving ? -Math.abs(Math.sin(this.walkPhase)) * 0.7 : idle;
      }
      this.marker.y = this.reducedMotion ? 0 : Math.sin(this.time / 320) * 1.2;
      this.marker.scale.x = this.facing;
      this.ring.scale.set(this.reducedMotion ? 1 : 1 + Math.sin(this.time / 300) * 0.06);
    }
    this.pin.visible = !!inside && !showFigure;
    if (inside && !showFigure) {
      const top = iso(inside.position.x + inside.footprint.width / 2, inside.position.y + inside.footprint.height / 2);
      this.pin.position.set(top.x, top.y - this.liftOf(inside.id) - 12 - (this.reducedMotion ? 0 : Math.sin(this.time / 320) * 2));
      this.pin.scale.set(Math.max(1, 0.8 / Math.max(viewScale, 0.05)));
      this.pin.zIndex = 1e6;
      this.pin.tint = 0xffffff;
    }
    this.drawRoute(player, world, viewScale);
    this.drawPulses(viewScale, dt);
  }

  private awayLayout = false;
  private arrangeIfNeeded(away: boolean) {
    if (away === this.awayLayout) return;
    this.awayLayout = away;
    this.arrange(away);
  }

  private drawRoute(player: PlayerCharacter, world: WorldState, viewScale: number) {
    const g = this.overlay;
    g.clear();
    const width = Math.max(2, 2.8 / Math.max(viewScale, 0.2));
    const m = player.movement, a = player.activity;
    const pulse = this.reducedMotion ? 0.8 : 0.6 + Math.sin(this.time / 300) * 0.25;
    const outline = (id: string | null, color: number) => {
      const b = id ? world.plan.buildings.find((entry) => entry.id === id) : undefined;
      if (!b) return;
      const pts = [iso(b.position.x, b.position.y), iso(b.position.x + b.footprint.width, b.position.y),
        iso(b.position.x + b.footprint.width, b.position.y + b.footprint.height), iso(b.position.x, b.position.y + b.footprint.height)].flatMap((p) => [p.x, p.y]);
      g.poly(pts).fill({ color, alpha: 0.16 }).poly(pts).stroke({ color, width, alpha: pulse });
    };
    if (m.status === 'travelling' && m.route.length > m.nextWaypoint && this.rendered) {
      const start = iso(this.rendered.x, this.rendered.y);
      const points = [start, ...m.route.slice(m.nextWaypoint).map((p) => iso(p.x, p.y))];
      // Dashed path in the player's terracotta, distinct from the gold resident route.
      const dash = 7 / Math.max(viewScale, 0.3), gap = 5 / Math.max(viewScale, 0.3);
      for (let i = 0; i < points.length - 1; i += 1) {
        const p = points[i]!, q = points[i + 1]!;
        const length = Math.hypot(q.x - p.x, q.y - p.y);
        for (let d = 0; d < length; d += dash + gap) {
          const t1 = d / length, t2 = Math.min(1, (d + dash) / length);
          g.moveTo(p.x + (q.x - p.x) * t1, p.y + (q.y - p.y) * t1).lineTo(p.x + (q.x - p.x) * t2, p.y + (q.y - p.y) * t2);
        }
      }
      g.stroke({ color: MARKER, width, alpha: 0.9, cap: 'round' });
      const end = points.at(-1)!;
      g.ellipse(end.x, end.y, 9, 4.5).fill({ color: RING, alpha: 0.35 }).ellipse(end.x, end.y, 9 * (0.8 + pulse * 0.3), 4.5 * (0.8 + pulse * 0.3)).stroke({ color: MARKER, width, alpha: pulse });
    }
    if (a.kind !== 'idle' && a.buildingId && (a.kind !== 'move' || m.status !== 'travelling')) outline(a.buildingId, a.phase === 'performing' ? 0x8fd3c1 : MARKER);
    else if (a.kind === 'move' && a.buildingId) outline(a.buildingId, MARKER);
  }

  private drawPulses(viewScale: number, dt: number) {
    if (!this.pulses.length) return;
    const g = this.overlay;
    const width = Math.max(2, 2.6 / Math.max(viewScale, 0.2));
    this.pulses = this.pulses.filter((p) => (p.age += dt) < 900);
    for (const p of this.pulses) {
      const t = p.age / 900, c = iso(p.cell.x + 0.5, p.cell.y + 0.5);
      const fade = 1 - t;
      if (p.ok) {
        const r = 6 + t * 10;
        g.ellipse(c.x, c.y, r * 2, r).stroke({ color: 0x2f8a5b, width, alpha: fade });
      } else {
        const s = 6;
        g.ellipse(c.x, c.y, 14, 7).fill({ color: 0xd97962, alpha: 0.35 * fade }).stroke({ color: 0xb84c43, width, alpha: fade });
        g.moveTo(c.x - s, c.y - s / 2).lineTo(c.x + s, c.y + s / 2).moveTo(c.x + s, c.y - s / 2).lineTo(c.x - s, c.y + s / 2)
          .stroke({ color: 0xb84c43, width: width * 1.2, alpha: fade });
      }
    }
  }

  /** True when a world-local point is on the player figure. */
  pick(point: Position, viewScale: number): boolean {
    if (!this.root.visible) return false;
    const scale = npcSpriteScale(viewScale) * PLAYER_SCALE;
    const dx = point.x - this.root.position.x;
    const dy = point.y - (this.root.position.y - 11 * scale);
    return Math.hypot(dx, dy * 0.8) <= 10 * scale + 5 / Math.max(viewScale, 0.05);
  }

  destroy() {
    this.rig?.destroy();
    for (const g of this.parts.values()) g.destroy();
    this.parts.clear();
    this.root.destroy({ children: true });
    this.pin.destroy({ children: true });
    this.badges.destroy({ children: true });
    this.overlay.destroy();
    this.highlights.destroy();
  }
}
