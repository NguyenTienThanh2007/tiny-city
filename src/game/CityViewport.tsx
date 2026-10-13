import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import type { CityPlan, Position, WorldState } from '@tiny-city/simulation';
import type { PlanProposal } from '@tiny-city/ai-architect';
import { validateBuildingMove, validateBuildingPlacement, validateRoadPlacement } from '@tiny-city/simulation';
import { getRenderBuildings } from '../simulation/cityAdapter';
import { connectSimulationTicker } from '../simulation/tickerAdapter';
import { BUILDINGS, cellKey, occupiedCells, type Building, type BuildingKind, type CityState, type Cell, type Tool } from '../types';
import { buildingLift, drawBuildingArt, polygon, roofCapHeight, type RoadSides } from './buildingArt';
import { NpcLayer, npcSpriteScale, type LocalBounds } from './npcLayer';
import { PlayerLayer, type HomeHighlight, type LifeFeedback } from './playerLayer';
import { DecorLayer } from './decorLayer';
import { EffectsLayer } from './effectsLayer';
import { DAYLIGHT, windowsOn, worldLighting, type WorldLighting } from './lighting';
import { AmbientLayer } from './ambientLayer';
import { getGameTime } from '@tiny-city/simulation';
import { buildingDepth } from './npcMotion';
import { cityView, footprint, iso, MAX_SCALE, MIN_SCALE, proposalOverlayGeometry, tileStroke, toCell, toGrid, type Point } from './mapGeometry';
import { rejectionFeedback } from '../simulation/feedback';
import { currentArt, loadArt, type ArtLibrary } from './art/artLibrary';
import { selectBuildingAsset, selectRoadAsset } from './art/artManifest';
import { designLabel, predictBuildingId, resolveChoice, type DesignChoices } from './architecture';
import { drawTerrainArt } from './terrainArt';

export { buildingLift } from './buildingArt';

/** `cell` may be fractional (a resident's position). `zoom` multiplies the scale around the visible center. */
export type CameraRequest = { id: number; cell?: Position; zoom?: number; scale?: number };
export type SafeArea = { left: number; right: number; top: number; bottom: number };
export type RendererStats = { fps: number; frameMs: number; residents: number; visibleResidents: number; venueVisitors?: number; art?: string };
/** What a Life Mode click points at, in priority order: the player, a resident, a building, then a tile. */
export type LifeTarget = { type: 'player' } | { type: 'citizen'; id: string } | { type: 'building'; id: string } | { type: 'tile'; cell: Cell };
export type { HomeHighlight, LifeFeedback };

type Props = {
  city: CityState;
  world: WorldState;
  /** Live snapshot reader; residents are drawn from it every frame without React renders. */
  getWorld?: () => WorldState;
  proposal?: PlanProposal | null;
  onSimulationFrame: (elapsedMs: number) => void;
  tool: Tool;
  selectedBuildingId: string | null;
  movingBuildingId: string | null;
  selectedCitizenId?: string | null;
  followCitizenId?: string | null;
  onSelectBuilding: (id: string | null) => void;
  onSelectCitizen?: (id: string | null) => void;
  onFollowEnd?: () => void;
  onPlaceBuilding: (kind: BuildingKind, x: number, y: number) => void;
  onBeginMoveBuilding: (id: string) => void;
  onMoveBuilding: (id: string, x: number, y: number) => void;
  onAddRoad: (cell: Cell) => void;
  onBulldoze: (cell: Cell) => void;
  onCameraFootprintChange: (points: Point[]) => void;
  cameraRequest?: CameraRequest;
  safeArea?: SafeArea;
  onBeginGesture?: () => void;
  onEndGesture?: () => void;
  /** Phase 4: clicks steer the player instead of selecting (only with the select tool). */
  lifeMode?: boolean;
  onLifeTarget?: (target: LifeTarget) => void;
  /** Clicking the player outside Life Mode opens their profile. */
  onSelectPlayer?: () => void;
  followPlayer?: boolean;
  lifeFeedback?: LifeFeedback | null;
  homeHighlights?: readonly HomeHighlight[] | null;
  /** AI Architect: buildings an ambiguous or blocked request refers to (candidate, chosen, to remove, to move). */
  targetHighlights?: readonly TargetHighlight[];
  /** Visual World 3.1: the architectural model chosen per building type (the ghost shows exactly what gets built). */
  designChoices?: DesignChoices;
};
export type TargetHighlight = { id: string; tone: 'candidate' | 'selected' | 'remove' | 'move' };
const TARGET_TONES: Record<TargetHighlight['tone'], [number, number]> = {
  candidate: [0xffd36e, 0xc8902a], selected: [0x62c797, 0x1f6f58], remove: [0xe36f73, 0xa33449], move: [0x64b8d1, 0x287d99],
};

const SEA = 0x8fc3c0;

/**
 * Pixi applications are created strictly one after another. Destroying an Application clears Pixi's global
 * batch pool; if a StrictMode remount initializes a second app before the first one is destroyed, the live app
 * later draws with destroyed batches. A mount disposed before its turn never creates a renderer at all.
 */
let pixiLifecycle: Promise<void> = Promise.resolve();
const NO_SAFE_AREA: SafeArea = { left: 0, right: 0, top: 0, bottom: 0 };

function tileDiamond(x: number, y: number): Point[] {
  return [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)];
}

function drawTerrain(layer: Container, size: number) {
  const terrain = new Graphics();
  drawTerrainArt(terrain, size);
  layer.addChild(terrain);
}

/** Baked road tiles: one sprite per tile, chosen by its connection mask (sharp at every zoom, one batch). */
function drawRoadSprites(layer: Container, city: CityState, art: ArtLibrary): boolean {
  const roadSet = new Set(city.roads.map(({ x, y }) => cellKey(x, y)));
  const has = (x: number, y: number) => roadSet.has(cellKey(x, y));
  const sprites: Sprite[] = [];
  for (const { x, y } of city.roads) {
    const texture = art.frame(selectRoadAsset(art.index, has, x, y)?.color);
    if (!texture) { sprites.forEach((sprite) => sprite.destroy()); return false; }
    const sprite = new Sprite(texture);
    const at = iso(x, y);
    sprite.position.set(at.x, at.y);
    sprite.eventMode = 'none';
    sprites.push(sprite);
  }
  // Back-to-front so each tile's sidewalk lip overlaps the one behind it.
  sprites.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const sprite of sprites) layer.addChild(sprite);
  return true;
}

function drawRoads(layer: Container, city: CityState) {
  const art = currentArt();
  if (art && drawRoadSprites(layer, city, art)) return;
  const roadSet = new Set(city.roads.map(({ x, y }) => cellKey(x, y)));
  const g = new Graphics();
  const has = (x: number, y: number) => roadSet.has(cellKey(x, y));
  const quad = (x0: number, y0: number, x1: number, y1: number) => [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)];
  const ASPHALT = 0x56636a, PAVING = 0xe3dccb, CURB = 0xbfb6a2, MARK = 0xf3e3b0;
  const inset = 0.17;
  for (const { x, y } of city.roads) {
    const n = has(x, y - 1), sDir = has(x, y + 1), w = has(x - 1, y), e = has(x + 1, y);
    // Sidewalk paving first, then asphalt that reaches the tile edge wherever the road continues.
    polygon(g, tileDiamond(x, y), PAVING, 1);
    const x0 = w ? x : x + inset, x1 = e ? x + 1 : x + 1 - inset, y0 = n ? y : y + inset, y1 = sDir ? y + 1 : y + 1 - inset;
    polygon(g, quad(x + inset, y + inset, x + 1 - inset, y + 1 - inset), ASPHALT, 1);
    if (w) polygon(g, quad(x, y + inset, x + inset, y + 1 - inset), ASPHALT, 1);
    if (e) polygon(g, quad(x + 1 - inset, y + inset, x + 1, y + 1 - inset), ASPHALT, 1);
    if (n) polygon(g, quad(x + inset, y, x + 1 - inset, y + inset), ASPHALT, 1);
    if (sDir) polygon(g, quad(x + inset, y + 1 - inset, x + 1 - inset, y + 1), ASPHALT, 1);
    // Curbs only along open sides.
    const curb = (a: Point, b: Point) => g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: CURB, width: 1.6, alpha: 0.95 });
    if (!n) curb(iso(x0, y + inset), iso(x1, y + inset));
    if (!sDir) curb(iso(x0, y + 1 - inset), iso(x1, y + 1 - inset));
    if (!w) curb(iso(x + inset, y0), iso(x + inset, y1));
    if (!e) curb(iso(x + 1 - inset, y0), iso(x + 1 - inset, y1));
    const links = Number(n) + Number(sDir) + Number(w) + Number(e);
    const center = iso(x + 0.5, y + 0.5);
    if (links >= 3) {
      // Crosswalk stripes on every approach of an intersection.
      const zebra = (dx: number, dy: number) => {
        for (let stripe = 0; stripe < 4; stripe += 1) {
          const t = inset + 0.08 + stripe * (1 - 2 * inset - 0.16) / 3;
          const a = dx !== 0 ? iso(dx > 0 ? x + 0.86 : x + 0.04, y + t) : iso(x + t, dy > 0 ? y + 0.86 : y + 0.04);
          const b = dx !== 0 ? iso(dx > 0 ? x + 0.98 : x + 0.16, y + t) : iso(x + t, dy > 0 ? y + 0.98 : y + 0.16);
          g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xf7f2e2, width: 2.2, alpha: 0.9 });
        }
      };
      if (n) zebra(0, -1); if (sDir) zebra(0, 1); if (w) zebra(-1, 0); if (e) zebra(1, 0);
      g.circle(center.x, center.y, 1.6).fill({ color: MARK, alpha: 0.45 });
    } else if ((w || e) && !(n || sDir)) {
      for (const [a, b] of [[0.08, 0.36], [0.6, 0.88]] as const) {
        const p = iso(x + a, y + 0.5), q = iso(x + b, y + 0.5);
        g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: MARK, width: 1.3, alpha: 0.85 });
      }
    } else if ((n || sDir) && !(w || e)) {
      for (const [a, b] of [[0.08, 0.36], [0.6, 0.88]] as const) {
        const p = iso(x + 0.5, y + a), q = iso(x + 0.5, y + b);
        g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: MARK, width: 1.3, alpha: 0.85 });
      }
    } else if (links === 2) {
      g.circle(center.x, center.y, 1.2).fill({ color: MARK, alpha: 0.4 });
    }
  }
  layer.addChild(g);
}

/** Display objects per building, so lighting and hover feedback can update without redrawing art. */
export interface BuildingVisual { readonly item: Container; readonly lights: Container | null }
type BuildingRegistry = Map<string, BuildingVisual>;

/**
 * Finished buildings are pre-rendered once into textures and shown as sprites (one quad each). Keyed by
 * everything that changes their look, so a selection change re-renders one building, not the city.
 * Sprites avoid per-building cacheAsTexture render groups, whose destruction corrupts Pixi's batch pool.
 */
/** Off-stage sources and retired textures are destroyed on the next frame, never in the frame that rendered them. */
class DeferredDestroy {
  private queue: Array<() => void> = [];
  add(task: () => void): void { this.queue.push(task); }
  flush(): void { const tasks = this.queue; this.queue = []; for (const task of tasks) task(); }
}

class BuildingTextures {
  private readonly entries = new Map<string, { texture: Texture; x: number; y: number }>();
  private used = new Set<string>();
  constructor(private readonly renderer: Renderer | null, private readonly graveyard = new DeferredDestroy()) {}
  begin(): void { this.used = new Set(); }
  get(key: string, render: () => Container): { texture: Texture; x: number; y: number } | null {
    if (!this.renderer) return null;
    this.used.add(key);
    let entry = this.entries.get(key);
    if (!entry) {
      const source = render();
      const bounds = source.getLocalBounds();
      entry = { texture: this.renderer.generateTexture({ target: source, resolution: 1.5, antialias: true }), x: bounds.minX, y: bounds.minY };
      this.graveyard.add(() => source.destroy({ children: true, context: true }));
      this.entries.set(key, entry);
    }
    return entry;
  }
  end(): void {
    for (const [key, entry] of this.entries) if (!this.used.has(key)) { this.graveyard.add(() => entry.texture.destroy(true)); this.entries.delete(key); }
  }
  get size(): number { return this.entries.size; }
  destroy(): void { for (const entry of this.entries.values()) entry.texture.destroy(true); this.entries.clear(); }
}

function roadSidesFor(building: Building, roadSet: ReadonlySet<string>): RoadSides {
  const spec = BUILDINGS[building.kind];
  const along = (from: number, to: number, fixed: number, horizontal: boolean) => {
    for (let i = from; i < to; i += 1) if (roadSet.has(horizontal ? cellKey(i, fixed) : cellKey(fixed, i))) return true;
    return false;
  };
  return {
    north: along(building.x, building.x + spec.width, building.y - 1, true),
    south: along(building.x, building.x + spec.width, building.y + spec.height, true),
    west: along(building.y, building.y + spec.height, building.x - 1, false),
    east: along(building.y, building.y + spec.height, building.x + spec.width, false),
  };
}

/** Baked sprite path: color sprite (revealed bottom-up while under construction), ground shadow and night glow. */
function drawBakedBuilding(layer: Container, shadows: Container | null, building: Building, selected: boolean, progress: number,
  sides: RoadSides, registry: BuildingRegistry, art: ArtLibrary): boolean {
  const spec = BUILDINGS[building.kind];
  const asset = selectBuildingAsset(art.index, building, sides);
  const texture = art.frame(asset?.color);
  if (!asset || !texture) return false;
  const origin = iso(building.x, building.y);
  const depth = buildingDepth(building.x, building.y, spec.width, spec.height);
  const item = new Container();
  item.label = 'building';
  const sprite = new Sprite(texture);
  sprite.position.set(origin.x, origin.y);
  item.addChild(sprite);
  if (progress < 1) {
    // Construction: the finished model rises out of the lot behind a reveal mask, with scaffolding on top.
    const top = origin.y - texture.height * sprite.anchor.y, height = texture.height;
    const reveal = 0.18 + progress * 0.82;
    const mask = new Graphics().rect(origin.x - texture.width, top + height * (1 - reveal), texture.width * 2, height * reveal + 4).fill(0xffffff);
    item.addChild(mask);
    sprite.mask = mask;
    const center = iso(building.x + spec.width / 2, building.y + spec.height / 2);
    const lift = buildingLift(building, 1) * reveal;
    const scaffold = new Graphics();
    scaffold.moveTo(center.x + 14, center.y - lift + 4).lineTo(center.x + 14, center.y - lift - 30)
      .lineTo(center.x + 43, center.y - lift - 30).stroke({ color: 0xd69f51, width: 2.5, alpha: 0.9 });
    scaffold.moveTo(center.x + 40, center.y - lift - 30).lineTo(center.x + 40, center.y - lift - 18).stroke({ color: 0x4a4a4a, width: 0.8 });
    item.addChild(scaffold);
  }
  if (selected) {
    const outline = new Graphics();
    const ground = footprint(building.x, building.y, spec.width, spec.height);
    outline.poly(ground.flatMap((point) => [point.x, point.y])).fill({ color: 0xffd36e, alpha: 0.16 }).stroke({ color: 0xffd36e, width: 2.5, alpha: 0.95 });
    item.addChild(outline);
  }
  item.eventMode = 'none';
  item.zIndex = depth;
  layer.addChild(item);
  const shadowTexture = progress >= 1 ? art.frame(asset.shadow) : null;
  if (shadows && shadowTexture) {
    const shadow = new Sprite(shadowTexture);
    shadow.label = 'building-shadow';
    shadow.position.set(origin.x, origin.y);
    shadow.eventMode = 'none';
    shadows.addChild(shadow);
  }
  let lights: Container | null = null;
  const glowTexture = progress >= 1 ? art.frame(asset.emissive) : null;
  if (glowTexture) {
    const glow = new Sprite(glowTexture);
    glow.label = 'building-lights';
    glow.position.set(origin.x, origin.y);
    // Straight alpha with a warm colour: reads as lamplight behind glass instead of blown-out white.
    glow.visible = false;
    glow.eventMode = 'none';
    glow.zIndex = depth + 0.0005;
    layer.addChild(glow);
    lights = glow;
  }
  registry.set(building.id, { item, lights });
  return true;
}

function drawBuilding(layer: Container, building: Building, selected: boolean, progress: number, roadSet: ReadonlySet<string>, registry: BuildingRegistry, textures: BuildingTextures, shadows: Container | null = null) {
  const spec = BUILDINGS[building.kind];
  const sides = roadSidesFor(building, roadSet);
  const art = currentArt();
  if (art && drawBakedBuilding(layer, shadows, building, selected, progress, sides, registry, art)) return;
  const item = new Container();
  item.label = 'building';
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const windows: Point[][] = [];
  const vector = () => {
    const group = new Container();
    const base = new Graphics();
    polygon(base, ground, selected ? 0xffd36e : 0x3c5242, selected ? 0.5 : 0.12, selected ? 0xfff1c4 : undefined, selected ? 0.95 : 0.28);
    if (selected) base.poly(ground.flatMap((point) => [point.x, point.y])).stroke({ color: 0xffd36e, width: 2.5, alpha: 0.9 });
    const art = new Graphics();
    windows.length = 0;
    drawBuildingArt(art, building, progress, { roadSides: sides, lights: progress >= 1 ? windows : undefined });
    group.addChild(base, art);
    return group;
  };
  if (progress >= 1) {
    const key = [building.id, building.kind, building.design?.model ?? '', building.x, building.y, selected ? 1 : 0, Number(sides.north), Number(sides.south), Number(sides.east), Number(sides.west)].join(':');
    const cached = textures.get(key, vector);
    if (cached) {
      const sprite = new Sprite(cached.texture);
      sprite.position.set(cached.x, cached.y);
      item.addChild(sprite);
      // Window quads are cheap to recompute and keep night lighting independent of the texture.
      if (!windows.length) drawBuildingArt(new Graphics(), building, progress, { roadSides: sides, lights: windows });
    } else item.addChild(vector());
  } else item.addChild(vector());
  let lights: Graphics | null = null;
  if (windows.length) {
    // Night windows live beside the cached art (same depth), so lighting never forces a re-cache.
    lights = new Graphics();
    lights.label = 'building-lights';
    for (const quad of windows) lights.poly(quad.flatMap((point) => [point.x, point.y])).fill({ color: 0xffd98a, alpha: 0.95 });
    lights.visible = false;
    lights.eventMode = 'none';
    lights.zIndex = buildingDepth(building.x, building.y, spec.width, spec.height) + 0.0005;
    layer.addChild(lights);
  }

  if (progress < 1) {
    const center = iso(building.x + spec.width / 2, building.y + spec.height / 2);
    const scaffold = new Graphics();
    const height = buildingLift(building, progress);
    scaffold.moveTo(center.x + 14, center.y - height + 4).lineTo(center.x + 14, center.y - height - 30)
      .lineTo(center.x + 43, center.y - height - 30).stroke({ color: 0xd69f51, width: 2.5, alpha: 0.9 });
    scaffold.moveTo(center.x + 14, center.y - height - 26).lineTo(center.x + 35, center.y - height - 26)
      .stroke({ color: 0xffd27f, width: 2, alpha: 0.85 });
    scaffold.moveTo(center.x + 40, center.y - height - 30).lineTo(center.x + 40, center.y - height - 18)
      .stroke({ color: 0x4a4a4a, width: 0.8 });
    item.addChild(scaffold);
    item.alpha = 0.74 + Math.min(0.26, progress * 0.26);
  }
  item.eventMode = 'none';
  item.zIndex = buildingDepth(building.x, building.y, spec.width, spec.height);
  layer.addChild(item);
  registry.set(building.id, { item, lights });
}

function clearBuildings(buildings: Container, registry: BuildingRegistry, shadows: Container | null = null) {
  if (shadows) for (const child of shadows.removeChildren()) child.destroy();
  for (const child of [...buildings.children]) {
    if (child.label !== 'building' && child.label !== 'building-lights') continue;
    buildings.removeChild(child);
    // Sprite textures belong to BuildingTextures; destroy only the display objects.
    child.destroy({ children: true });
  }
  registry.clear();
}

function redrawBuildings(buildings: Container, city: CityState, plan: CityPlan, selectedId: string | null, registry: BuildingRegistry, textures: BuildingTextures, shadows: Container | null = null) {
  clearBuildings(buildings, registry, shadows);
  const roadSet = new Set(plan.roads.map(({ x, y }) => cellKey(x, y)));
  textures.begin();
  for (const building of getRenderBuildings(city, plan)) {
    const age = Date.now() - building.createdAt;
    drawBuilding(buildings, building, building.id === selectedId, Math.max(0, Math.min(1, age / 5200)), roadSet, registry, textures, shadows);
  }
  textures.end();
}

function redrawCity(terrain: Container, roads: Container, buildings: Container, city: CityState, plan: CityPlan, selectedId: string | null, includeTerrain: boolean, registry: BuildingRegistry, textures: BuildingTextures, includeRoads = true, shadows: Container | null = null) {
  if (includeTerrain) {
    terrain.cacheAsTexture(false);
    terrain.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    drawTerrain(terrain, plan.width);
    // ~8k static triangles become one textured quad; redrawn only when the map itself changes.
    terrain.cacheAsTexture({ resolution: 1, antialias: true });
  }
  if (includeRoads) {
    roads.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    drawRoads(roads, city);
  }
  redrawBuildings(buildings, city, plan, selectedId, registry, textures, shadows);
}

function redrawProposalOverlay(layer: Container, proposal: PlanProposal | null | undefined, sourcePlan: CityPlan, targets: readonly TargetHighlight[] = []) {
  layer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
  layer.eventMode = 'none';
  if (targets.length) {
    const marks = new Graphics();
    for (const target of targets) {
      const building = sourcePlan.buildings.find((entry) => entry.id === target.id);
      if (!building) continue;
      const [fill, line] = TARGET_TONES[target.tone];
      const points = footprint(building.position.x, building.position.y, building.footprint.width, building.footprint.height);
      polygon(marks, points, fill, target.tone === 'candidate' ? 0.35 : 0.55, line, 1);
      marks.poly(points.flatMap((point) => [point.x, point.y])).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
    }
    layer.addChild(marks);
  }
  if (!proposal || proposal.status === 'REJECTED') return;

  const geometry = proposalOverlayGeometry(proposal, sourcePlan);
  const roads = new Graphics();
  for (const points of geometry.roadAdds) polygon(roads, points, 0x50c8a3, 0.62, 0x16785f);
  for (const points of geometry.roadRemovals) {
    polygon(roads, points, 0xe36f73, 0.58, 0xa33449);
    const center = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
    roads.moveTo(center.x - 7, center.y - 4).lineTo(center.x + 7, center.y + 4)
      .moveTo(center.x + 7, center.y - 4).lineTo(center.x - 7, center.y + 4)
      .stroke({ color: 0x8f263c, width: 2.4, alpha: 0.95 });
  }
  layer.addChild(roads);

  const buildings = new Graphics();
  for (const demolition of geometry.demolitions) polygon(buildings, demolition.points, 0xe36f73, 0.5, 0xa33449);
  for (const placement of geometry.placements) {
    if (placement.from) polygon(buildings, placement.from, 0xe7a66f, 0.4, 0xb2633f);
    polygon(buildings, placement.points, placement.operation === 'move' ? 0x64b8d1 : 0x62c797,
      0.56, placement.operation === 'move' ? 0x287d99 : 0x287a50);
    // Dashed blueprint outline keeps AI previews visibly distinct from built geometry.
    const pts = placement.points;
    for (let index = 0; index < pts.length; index += 1) {
      const a = pts[index]!, b = pts[(index + 1) % pts.length]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const dashes = Math.max(2, Math.floor(length / 7));
      for (let dash = 0; dash < dashes; dash += 2) {
        const t1 = dash / dashes, t2 = Math.min(1, (dash + 1) / dashes);
        buildings.moveTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1).lineTo(a.x + (b.x - a.x) * t2, a.y + (b.y - a.y) * t2);
      }
    }
    buildings.stroke({ color: 0xffffff, width: 1.6, alpha: 0.9 });
  }
  layer.addChild(buildings);
}

function buildingAt(city: CityState, x: number, y: number): Building | undefined {
  return [...city.buildings].reverse().find((building) =>
    occupiedCells(building).some((cell) => cell.x === x && cell.y === y));
}

function containsPoint(point: Point, polygonPoints: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i, i += 1) {
    const current = polygonPoints[i]!;
    const previous = polygonPoints[j]!;
    const crosses = (current.y > point.y) !== (previous.y > point.y) &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Height of a building's drawn art above its footprint centre (world px): baked height or the vector lift + cap. */
export function buildingTop(building: Building, roads: CityState['roads'] = []): number {
  const legacy = buildingLift(building, 1) + roofCapHeight(building.kind);
  const art = currentArt();
  if (!art) return legacy;
  const roadSet = new Set(roads.map(({ x, y }) => cellKey(x, y)));
  const height = selectBuildingAsset(art.index, building, roadSidesFor(building, roadSet))?.heightPx;
  return height ? Math.max(legacy, height) : legacy;
}

/** Pixel test against the building's baked sprite (null when no art or no mask is available). */
function bakedArtHit(building: Building, point: Point, roadSet: ReadonlySet<string>, art: ArtLibrary): boolean | null {
  const asset = selectBuildingAsset(art.index, building, roadSidesFor(building, roadSet));
  const texture = art.frame(asset?.color);
  if (!asset || !texture) return null;
  const origin = iso(building.x, building.y);
  const anchor = texture.defaultAnchor ?? { x: 0, y: 0 };
  return art.hit(asset.color, point.x - (origin.x - anchor.x * texture.width), point.y - (origin.y - anchor.y * texture.height));
}

export function buildingAtPoint(city: CityState, point: Point): Building | undefined {
  const art = currentArt();
  const roadSet = art ? new Set(city.roads.map(({ x, y }) => cellKey(x, y))) : null;
  const byDrawOrder = [...city.buildings].sort((a, b) => {
    const sa = BUILDINGS[a.kind], sb = BUILDINGS[b.kind];
    return buildingDepth(a.x, a.y, sa.width, sa.height) - buildingDepth(b.x, b.y, sb.width, sb.height);
  }).reverse();
  for (const building of byDrawOrder) {
    const spec = BUILDINGS[building.kind];
    const ground = footprint(building.x, building.y, spec.width, spec.height);
    const progress = Math.max(0, Math.min(1, (Date.now() - building.createdAt) / 5200));
    const lift = buildingLift(building, progress);
    const top = ground.map((vertex) => ({ x: vertex.x, y: vertex.y - lift }));
    const cap = top.map((vertex) => ({ x: vertex.x, y: vertex.y - roofCapHeight(building.kind) }));
    const visibleFaces = [
      top, cap,
      [ground[3]!, ground[2]!, top[2]!, top[3]!],
      [ground[1]!, ground[2]!, top[2]!, top[1]!],
      [ground[0]!, ground[1]!, top[1]!, top[0]!],
      ground,
    ];
    // Baked art can rise above the legacy box (towers, roofs, trees); its opaque pixels are clickable too.
    if (art && roadSet && bakedArtHit(building, point, roadSet, art)) return building;
    if (visibleFaces.some((face) => containsPoint(point, face))) return building;
  }
  const cell = toCell(point);
  return buildingAt(city, cell.x, cell.y);
}

export default function CityViewport(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const terrainRef = useRef<Container | null>(null);
  const roadsRef = useRef<Container | null>(null);
  const buildingsRef = useRef<Container | null>(null);
  const shadowsRef = useRef<Container | null>(null);
  const proposalOverlayRef = useRef<Container | null>(null);
  const propsRef = useRef(props);
  const refreshRef = useRef<(() => void) | null>(null);
  const cameraRef = useRef<((request: CameraRequest) => void) | null>(null);
  const safeAreaRef = useRef<(() => void) | null>(null);
  const nameplateRef = useRef<(() => void) | null>(null);
  const registryRef = useRef<BuildingRegistry>(new Map());
  const texturesRef = useRef<BuildingTextures>(new BuildingTextures(null));
  const afterRedrawRef = useRef<((plan: CityPlan) => void) | null>(null);
  const refreshGroundRef = useRef<(() => void) | null>(null);
  const lastRoadsRef = useRef<CityState['roads'] | null>(null);
  const [preview, setPreview] = useState('');
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    const previous = propsRef.current;
    propsRef.current = props;
    if (previous.tool !== props.tool || previous.movingBuildingId !== props.movingBuildingId) {
      props.onEndGesture?.();
    }
    refreshRef.current?.();
  }, [props]);

  useEffect(() => {
    if (props.cameraRequest) cameraRef.current?.(props.cameraRequest);
  }, [props.cameraRequest]);

  const safe = props.safeArea ?? NO_SAFE_AREA;
  useEffect(() => { safeAreaRef.current?.(); }, [safe.left, safe.right, safe.top, safe.bottom]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const app = new Application();
    let cleanup = () => {};

    const run = pixiLifecycle.then(async () => {
      if (disposed) return;
      await app.init({
        backgroundColor: SEA,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        resizeTo: host,
      });
      if (disposed) { app.destroy(true); return; }
      appRef.current = app;
      app.canvas.className = 'city-canvas';
      host.appendChild(app.canvas);

      const world = new Container();
      const terrain = new Container();
      // Roads and flat landscaping are composed off-stage and shown as one texture, re-rendered only when the
      // plan changes. (A sprite, not cacheAsTexture: destroying children of a cached group corrupts Pixi's batch pool.)
      const ground = new Container();
      // Roads are live sprites (baked tiles) or vector art; the cached ground texture holds flat landscaping only.
      const roads = new Container();
      roads.eventMode = 'none';
      const groundDecor = new Container();
      ground.addChild(groundDecor);
      // Baked ground shadows (buildings, trees) sit on the ground under every walker; faded by sun strength.
      const shadowLayer = new Container();
      shadowLayer.eventMode = 'none';
      const buildingShadows = new Container();
      const decorShadows = new Container();
      shadowLayer.addChild(decorShadows, buildingShadows);
      // Night light pools spilled from buildings sit on the ground, under walkers and buildings.
      const lightPoolLayer = new Container();
      lightPoolLayer.eventMode = 'none';
      const groundSprite = new Sprite(Texture.EMPTY);
      groundSprite.eventMode = 'none';
      const groundOverlay = new Container();
      // Buildings and residents share one depth-sorted container so walkers pass behind and in front correctly.
      const buildings = new Container();
      buildings.sortableChildren = true;
      const proposalOverlay = new Container();
      const effectsContainer = new Container();
      const ghost = new Container();
      const ghostShape = new Graphics();
      const ghostArt = new Graphics();
      ghostArt.alpha = 0.62;
      const ghostSprite = new Sprite(Texture.EMPTY);
      ghostSprite.alpha = 0.7;
      ghostSprite.visible = false;
      ghost.addChild(ghostShape, ghostArt, ghostSprite);
      const labels = new Container();
      const nameplateBg = new Graphics();
      const nameplate = new Text({ text: '', style: { fontFamily: 'Manrope, Inter, sans-serif', fontSize: 11, fontWeight: '700', fill: '#24382c' } });
      nameplate.anchor.set(0.5, 1);
      labels.addChild(nameplateBg, nameplate);
      labels.visible = false;
      world.addChild(terrain, groundSprite, roads, shadowLayer, lightPoolLayer, groundOverlay, buildings, proposalOverlay, effectsContainer, ghost, labels);
      app.stage.addChild(world);
      // Pixi v8 skips listeners on passive containers, including the default stage.
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;
      world.eventMode = 'none';
      terrainRef.current = terrain;
      roadsRef.current = roads;
      buildingsRef.current = buildings;
      shadowsRef.current = buildingShadows;
      proposalOverlayRef.current = proposalOverlay;
      const registry = registryRef.current;
      const graveyard = new DeferredDestroy();
      const textures = new BuildingTextures(app.renderer as Renderer, graveyard);
      texturesRef.current = textures;
      redrawCity(terrain, roads, buildings, propsRef.current.city, propsRef.current.world.plan, propsRef.current.selectedBuildingId, true, registry, textures, true, buildingShadows);
      redrawProposalOverlay(proposalOverlay, propsRef.current.proposal, propsRef.current.world.plan, propsRef.current.targetHighlights);
      // Venue visitors stand where the baked venue art has its lawn, deck or terrace, which depends on its facing.
      const frontOf = (b: CityPlan['buildings'][number]): 'S' | 'E' => {
        const art = currentArt();
        if (!art || !b.type) return 'S';
        const roadSet = new Set(propsRef.current.world.plan.roads.map((tile) => cellKey(tile.x, tile.y)));
        const design = propsRef.current.city.buildings.find((entry) => entry.id === b.id)?.design;
        const editor: Building = { id: b.id, kind: b.type as BuildingKind, x: b.position.x, y: b.position.y, name: b.name, createdAt: 0, ...(design ? { design } : {}) };
        return selectBuildingAsset(art.index, editor, roadSidesFor(editor, roadSet))?.front ?? 'S';
      };
      const npcs = new NpcLayer(buildings, groundOverlay, { frontOf });
      const lifeMarkers = new Container();
      world.addChildAt(lifeMarkers, world.getChildIndex(labels));
      const player = new PlayerLayer(buildings, groundOverlay, lifeMarkers, (id) => {
        const building = propsRef.current.city.buildings.find((entry) => entry.id === id);
        return building ? buildingTop(building, propsRef.current.city.roads) : 30;
      }, (b) => frontOf(b));
      let lastHighlights: readonly HomeHighlight[] | null | undefined;
      const decor = new DecorLayer(buildings, groundDecor, app.renderer, decorShadows);
      const effects = new EffectsLayer(effectsContainer);
      const reducedMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const ambient = new AmbientLayer(lightPoolLayer, effectsContainer, reducedMotion, buildings);
      let windowCheck = 0;
      // World animation clock: advances only while simulation time runs, so pausing freezes the whole scene.
      let ambientTime = 0;

      // Lighting is applied as cheap tints when it changes, never as a full-screen overlay or filter.
      let lighting: WorldLighting = DAYLIGHT;
      let demolishHoverId: string | null = null;
      const seaTint = (tint: number) => {
        const channel = (shift: number) => Math.round(((SEA >> shift) & 0xff) * (((tint >> shift) & 0xff) / 255));
        return (channel(16) << 16) | (channel(8) << 8) | channel(0);
      };
      const applyLighting = (next: WorldLighting, force = false) => {
        if (!force && next.tint === lighting.tint && next.glow === lighting.glow && next.sun === lighting.sun) return;
        lighting = next;
        terrain.tint = next.tint;
        groundSprite.tint = next.tint;
        roads.tint = next.tint;
        shadowLayer.alpha = 0.2 + 0.8 * next.sun;
        ambient.setLighting(next.glow, next.sun);
        windowCheck = 0;
        decor.applyLighting(next.tint, next.glow, force);
        npcs.setTint(next.tint);
        player.setTint(next.tint);
        for (const [id, visual] of registry) {
          visual.item.tint = id === demolishHoverId ? 0xff9c8a : next.tint;
          if (visual.lights) { visual.lights.visible = next.glow > 0.01; visual.lights.alpha = next.glow; }
        }
        app.renderer.background.color = seaTint(next.tint);
      };
      const setDemolishHover = (id: string | null) => {
        if (id === demolishHoverId) return;
        const previous = demolishHoverId ? registry.get(demolishHoverId) : undefined;
        if (previous) previous.item.tint = lighting.tint;
        demolishHoverId = id;
        const next = id ? registry.get(id) : undefined;
        if (next) next.item.tint = 0xff9c8a;
      };

      // Plan diffs drive decor rebuilds and completion feedback (build, move, demolish, roads, AI batches).
      let lastPlan: CityPlan = propsRef.current.world.plan;
      decor.rebuild(lastPlan);
      ambient.rebuild(lastPlan, frontOf);
      const rebuildGround = () => {
        const bounds = ground.getLocalBounds();
        const previous = groundSprite.texture;
        groundSprite.texture = bounds.width > 0 ? app.renderer.generateTexture({ target: ground, resolution: 1, antialias: true }) : Texture.EMPTY;
        groundSprite.position.set(bounds.minX, bounds.minY);
        if (previous !== Texture.EMPTY) graveyard.add(() => previous.destroy(true));
      };
      rebuildGround();
      let groundDirty = false;
      refreshGroundRef.current = () => { groundDirty = true; };
      afterRedrawRef.current = (plan) => {
        if (plan !== lastPlan) {
          const before = new Map(lastPlan.buildings.map((b) => [b.id, b]));
          const after = new Map(plan.buildings.map((b) => [b.id, b]));
          const center = (b: CityPlan['buildings'][number]) => ({ x: b.position.x + b.footprint.width / 2, y: b.position.y + b.footprint.height / 2 });
          const built = plan.buildings.filter((b) => !before.has(b.id));
          const batch = built.length > 1 ? 'plan' : 'build';
          for (const b of built) effects.spawn(batch, center(b), Math.max(b.footprint.width, b.footprint.height) / 2);
          for (const b of plan.buildings) {
            const old = before.get(b.id);
            if (old && (old.position.x !== b.position.x || old.position.y !== b.position.y)) effects.spawn('build', center(b), Math.max(b.footprint.width, b.footprint.height) / 2);
          }
          for (const b of lastPlan.buildings) if (!after.has(b.id)) effects.spawn('demolish', center(b), Math.max(b.footprint.width, b.footprint.height) / 2);
          const oldRoads = new Set(lastPlan.roads.map((tile) => cellKey(tile.x, tile.y)));
          plan.roads.filter((tile) => !oldRoads.has(cellKey(tile.x, tile.y))).slice(0, 12)
            .forEach((tile) => effects.spawn('road', { x: tile.x + 0.5, y: tile.y + 0.5 }));
          if (plan.roads !== lastPlan.roads || plan.buildings !== lastPlan.buildings || plan.blockedTiles !== lastPlan.blockedTiles) {
            decor.rebuild(plan);
            ambient.rebuild(plan, frontOf);
            groundDirty = true;
          }
          lastPlan = plan;
        }
        if (groundDirty) { rebuildGround(); groundDirty = false; }
        applyLighting(lighting, true);
      };
      applyLighting(DAYLIGHT, true);
      // Baked atlases load asynchronously; until then (or if they fail) the vector renderer stays in place.
      void loadArt().then((art) => {
        if (disposed || appRef.current !== app) return;
        // Tells tests and tooling the world is drawn with its final art ('fallback' = vector art only).
        host.dataset.art = art ? 'ready' : 'fallback';
        if (!art) return;
        const current = propsRef.current;
        redrawCity(terrain, roads, buildings, current.city, current.world.plan, current.selectedBuildingId, false, registry, textures, true, buildingShadows);
        decor.rebuild(current.world.plan);
        ambient.rebuild(current.world.plan, frontOf);
        rebuildGround();
        applyLighting(lighting, true);
        refreshRef.current?.();
      });

      const safeBox = () => {
        const area = propsRef.current.safeArea ?? NO_SAFE_AREA;
        const width = Math.max(120, app.screen.width - area.left - area.right);
        const height = Math.max(120, app.screen.height - area.top - area.bottom);
        return { width, height, cx: area.left + width / 2, cy: area.top + height / 2 };
      };
      const home = (() => { const box = safeBox(); return cityView(propsRef.current.city, box.width, box.height); })();
      const view = { x: 0, y: -25, scale: home.scale };
      let center = home.center;
      let lastFootprint = 0;
      let following = false;
      const updateCamera = (throttle = false) => {
        const box = safeBox();
        world.scale.set(view.scale);
        decor.setDetail(view.scale);
        world.position.set(box.cx - center.x * view.scale + view.x, box.cy - center.y * view.scale + view.y);
        const now = performance.now();
        if (throttle && now - lastFootprint < 120) return;
        lastFootprint = now;
        const screenCorners = [
          { x: 0, y: 0 },
          { x: app.screen.width, y: 0 },
          { x: app.screen.width, y: app.screen.height },
          { x: 0, y: app.screen.height },
        ];
        const footprintPoints = screenCorners.map((corner) => {
          const localX = (corner.x - world.position.x) / view.scale;
          const localY = (corner.y - world.position.y) / view.scale;
          return toGrid({ x: localX, y: localY });
        });
        propsRef.current.onCameraFootprintChange(footprintPoints);
      };
      const zoomAround = (screenPoint: Point, nextScale: number) => {
        const box = safeBox();
        const oldScale = view.scale;
        const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
        const worldX = (screenPoint.x - world.x) / oldScale;
        const worldY = (screenPoint.y - world.y) / oldScale;
        view.scale = clamped;
        view.x = screenPoint.x - worldX * clamped - (box.cx - center.x * clamped);
        view.y = screenPoint.y - worldY * clamped - (box.cy - center.y * clamped);
      };
      cameraRef.current = (request) => {
        if (request.zoom !== undefined && !request.cell) {
          const box = safeBox();
          zoomAround({ x: box.cx, y: box.cy }, view.scale * request.zoom);
        } else if (request.cell) {
          center = iso(request.cell.x, request.cell.y);
          if (request.scale !== undefined) view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, request.scale));
          view.x = 0; view.y = request.scale !== undefined ? 0 : -25;
        } else {
          const box = safeBox();
          const next = cityView(propsRef.current.city, box.width, box.height);
          center = next.center; view.scale = next.scale;
          view.x = 0; view.y = -25;
        }
        updateCamera();
        refreshRef.current?.();
      };
      safeAreaRef.current = () => updateCamera();
      if (propsRef.current.cameraRequest) cameraRef.current(propsRef.current.cameraRequest);
      else updateCamera();

      let pointerAction: 'paint' | 'bulldoze' | 'pan' | null = null;
      let lastPointer = { x: 0, y: 0 };
      let lastCell: Cell | null = null;
      let hoverPoint: Point | null = null;
      let hoverBuildingId: string | null = null;
      let hoverCitizenId: string | null = null;
      let hoverPlayer = false;
      let gestureTool = propsRef.current.tool;
      const endGesture = () => {
        pointerAction = null; lastCell = null;
        propsRef.current.onEndGesture?.();
      };
      const leave = () => {
        endGesture(); hoverPoint = null; hoverBuildingId = null; hoverCitizenId = null; hoverPlayer = false;
        ghostShape.clear(); ghostArt.clear(); ghostSprite.visible = false; setPreview('');
        host.style.cursor = '';
        nameplateRef.current?.();
      };
      const getLocalPoint = (event: { global: Point }) => world.toLocal(event.global);
      const handleCell = (cell: Cell, localPoint?: Point) => {
        const current = propsRef.current;
        if (pointerAction === 'bulldoze') {
          const building = localPoint ? buildingAtPoint(current.city, localPoint) : buildingAt(current.city, cell.x, cell.y);
          if (building) {
            current.onBulldoze({ x: building.x, y: building.y });
            return;
          }
        }
        if (pointerAction === 'paint') {
          current.onAddRoad(cell);
        } else if (pointerAction === 'bulldoze') {
          current.onBulldoze(cell);
        }
      };

      const drawNameplate = () => {
        const current = propsRef.current;
        const live = current.getWorld?.() ?? current.world;
        nameplateBg.clear();
        let text = '';
        let anchor: Point | null = null;
        const citizenId = hoverPlayer ? null : hoverCitizenId ?? current.selectedCitizenId ?? null;
        if (hoverPlayer && live.player && player.position) {
          text = `${live.player.name} · you`;
          const point = iso(player.position.x, player.position.y);
          anchor = { x: point.x, y: point.y - 38 * npcSpriteScale(view.scale) };
        }
        if (citizenId) {
          const citizen = live.citizens.find((entry) => entry.id === citizenId);
          const position = npcs.getRenderedPosition(citizenId);
          if (citizen && position) {
            text = citizen.name;
            const point = iso(position.x, position.y);
            // Clear the figure (and the selected resident's activity badge), which scale with zoom.
            anchor = { x: point.x, y: point.y - (citizenId === current.selectedCitizenId ? 36 : 25) * npcSpriteScale(view.scale) };
          }
        }
        const buildingId = !text ? hoverBuildingId ?? (current.lifeMode ? null : current.selectedBuildingId) : null;
        if (buildingId) {
          const building = current.city.buildings.find((entry) => entry.id === buildingId);
          if (building) {
            const spec = BUILDINGS[building.kind];
            const point = iso(building.x + spec.width / 2, building.y + spec.height / 2);
            text = building.name;
            anchor = { x: point.x, y: point.y - buildingTop(building, current.city.roads) - 10 };
          }
        }
        if (!text || !anchor) { labels.visible = false; return; }
        nameplate.text = text;
        const inverse = 1 / Math.max(0.35, Math.min(1.4, view.scale));
        labels.scale.set(1);
        nameplate.scale.set(inverse);
        nameplate.position.set(anchor.x, anchor.y);
        const width = nameplate.width + 14 * inverse, height = nameplate.height + 7 * inverse;
        nameplateBg.roundRect(anchor.x - width / 2, anchor.y - height + 1 * inverse, width, height, 7 * inverse)
          .fill({ color: 0xfbf7ee, alpha: 0.95 }).stroke({ color: 0x24382c, width: 1 * inverse, alpha: 0.12 });
        nameplateBg.poly([anchor.x - 4 * inverse, anchor.y + 1 * inverse, anchor.x + 4 * inverse, anchor.y + 1 * inverse, anchor.x, anchor.y + 5 * inverse])
          .fill({ color: 0xfbf7ee, alpha: 0.95 });
        labels.visible = true;
      };
      nameplateRef.current = drawNameplate;

      app.stage.on('pointerdown', (event) => {
        const localPoint = getLocalPoint(event);
        const cell = toCell(localPoint);
        lastPointer = { x: event.global.x, y: event.global.y };
        const current = propsRef.current;
        gestureTool = current.tool;
        lastCell = cell;
        hoverPoint = { x: event.global.x, y: event.global.y };
        if (event.button === 1 || event.button === 2 || event.shiftKey) {
          pointerAction = 'pan';
          return;
        }
        if (current.tool === 'road') {
          current.onBeginGesture?.();
          pointerAction = 'paint';
          handleCell(cell, localPoint);
        } else if (current.tool === 'bulldoze') {
          current.onBeginGesture?.();
          pointerAction = 'bulldoze';
          handleCell(cell, localPoint);
        } else if (current.tool === 'move') {
          if (current.movingBuildingId) current.onMoveBuilding(current.movingBuildingId, cell.x, cell.y);
          else {
            const building = buildingAtPoint(current.city, localPoint);
            if (building) current.onBeginMoveBuilding(building.id);
            else current.onSelectBuilding(null);
          }
        } else if (current.tool === 'select' && current.lifeMode && current.onLifeTarget) {
          const citizenId = player.pick(localPoint, view.scale) ? null : npcs.pick(localPoint, view.scale);
          if (player.pick(localPoint, view.scale)) current.onLifeTarget({ type: 'player' });
          else if (citizenId) current.onLifeTarget({ type: 'citizen', id: citizenId });
          else {
            const building = buildingAtPoint(current.city, localPoint);
            current.onLifeTarget(building ? { type: 'building', id: building.id } : { type: 'tile', cell });
          }
        } else if (current.tool === 'select') {
          if (current.onSelectPlayer && player.pick(localPoint, view.scale)) { current.onSelectPlayer(); return; }
          const citizenId = current.onSelectCitizen ? npcs.pick(localPoint, view.scale) : null;
          if (citizenId) current.onSelectCitizen?.(citizenId);
          else current.onSelectBuilding(buildingAtPoint(current.city, localPoint)?.id ?? null);
        } else {
          const kind = current.tool as BuildingKind;
          current.onPlaceBuilding(kind, cell.x, cell.y);
        }
      });
      const footprintTiles = (x: number, y: number, width: number, height: number) => {
        const tiles = new Set<string>();
        for (let ty = y; ty < y + height; ty += 1) for (let tx = x; tx < x + width; tx += 1) tiles.add(cellKey(tx, ty));
        return tiles;
      };
      /** Marks road tiles touching a footprint (green) or outlines a missing connection (red, dashed). */
      const roadAccessHint = (x: number, y: number, width: number, height: number, ok: boolean) => {
        const roadSet = new Set(propsRef.current.world.plan.roads.map((tile) => cellKey(tile.x, tile.y)));
        let touching = 0;
        for (let tx = x - 1; tx <= x + width; tx += 1) {
          for (let ty = y - 1; ty <= y + height; ty += 1) {
            const edge = (tx === x - 1 || tx === x + width) !== (ty === y - 1 || ty === y + height);
            if (!edge || !roadSet.has(cellKey(tx, ty))) continue;
            touching += 1;
            polygon(ghostShape, tileDiamond(tx, ty), 0x62c797, 0.45, 0xe8fff3, 0.9);
          }
        }
        if (!ok && touching === 0) {
          const pts = footprint(x, y, width, height);
          for (let index = 0; index < 4; index += 1) {
            const a = pts[index]!, b = pts[(index + 1) % 4]!;
            for (let dash = 0; dash < 8; dash += 2) {
              ghostShape.moveTo(a.x + (b.x - a.x) * dash / 8, a.y + (b.y - a.y) * dash / 8)
                .lineTo(a.x + (b.x - a.x) * (dash + 1) / 8, a.y + (b.y - a.y) * (dash + 1) / 8);
            }
          }
          ghostShape.stroke({ color: 0xb84c43, width: 2.4, alpha: 0.95 });
        }
      };
      /** Ghost of the real baked model when available; vector art otherwise. */
      const ghostBuilding = (building: Building) => {
        const art = currentArt();
        const roadSet = new Set(propsRef.current.world.plan.roads.map((tile) => cellKey(tile.x, tile.y)));
        const asset = art ? selectBuildingAsset(art.index, building, roadSidesFor(building, roadSet)) : null;
        const texture = art?.frame(asset?.color) ?? null;
        if (!texture) { drawBuildingArt(ghostArt, building, 1); return; }
        const at = iso(building.x, building.y);
        ghostSprite.texture = texture;
        ghostSprite.anchor.copyFrom(texture.defaultAnchor ?? { x: 0, y: 0 });
        ghostSprite.position.set(at.x, at.y);
        ghostSprite.visible = true;
      };
      const refreshPreview = () => {
        ghostShape.clear();
        ghostArt.clear();
        ghostSprite.visible = false;
        decor.hideUnder(null);
        setDemolishHover(null);
        npcs.setHovered(null);
        if (!hoverPoint) { nameplateRef.current?.(); return; }
        const localPoint = world.toLocal(hoverPoint);
        const cell = toCell(localPoint);
        const current = propsRef.current;
        if (gestureTool !== current.tool) endGesture();
        let label = '';
        hoverBuildingId = null;
        hoverCitizenId = null;
        if (current.tool === 'road') {
          const validation = validateRoadPlacement(current.world, cell);
          label = validation.valid ? 'Road · Ready to build · $8' : rejectionFeedback[validation.reason];
          polygon(ghostShape, tileDiamond(cell.x, cell.y), validation.valid ? 0x6d7b80 : 0xd97962,
            0.72, validation.valid ? 0xf3e3b0 : 0xb84c43, 0.95);
          if (validation.valid) decor.hideUnder(new Set([cellKey(cell.x, cell.y)]));
        } else if (Object.hasOwn(BUILDINGS, current.tool)) {
          const kind = current.tool as BuildingKind;
          const spec = BUILDINGS[kind];
          const validation = validateBuildingPlacement(current.world, kind, cell);
          // The ghost carries the ID and design the build will get, so preview and result are the same model.
          const ghostId = predictBuildingId(current.world);
          const ghostDesign = resolveChoice(kind, current.designChoices?.[kind], ghostId);
          label = `${spec.label} · ${designLabel(ghostDesign)} · ${spec.width} × ${spec.height} · ${validation.valid ? `Ready to build · $${spec.cost}` : rejectionFeedback[validation.reason]}`;
          polygon(ghostShape, footprint(cell.x, cell.y, spec.width, spec.height), validation.valid ? 0xbfe8c9 : 0xd97962,
            validation.valid ? 0.42 : 0.58, validation.valid ? 0x2f8a5b : 0xb84c43, 0.95);
          if (validation.valid || validation.reason === 'road-required') roadAccessHint(cell.x, cell.y, spec.width, spec.height, validation.valid);
          decor.hideUnder(footprintTiles(cell.x, cell.y, spec.width, spec.height));
          if (validation.valid) ghostBuilding({ id: ghostId, kind, x: cell.x, y: cell.y, name: '', createdAt: 0, design: ghostDesign });
        } else if (current.tool === 'move' && current.movingBuildingId) {
          const building = current.city.buildings.find((entry) => entry.id === current.movingBuildingId);
          if (building) {
            const spec = BUILDINGS[building.kind];
            const validation = validateBuildingMove(current.world, building.id, cell);
            label = validation.valid ? 'Ready to move · No cost' : rejectionFeedback[validation.reason];
            polygon(ghostShape, footprint(cell.x, cell.y, spec.width, spec.height), validation.valid ? 0xb9e8c2 : 0xd97962,
              0.62, validation.valid ? 0x4d9662 : 0xb84c43, 0.9);
            // Dashed travel line from the current lot to the destination.
            const from = iso(building.x + spec.width / 2, building.y + spec.height / 2), to = iso(cell.x + spec.width / 2, cell.y + spec.height / 2);
            const steps = Math.max(2, Math.floor(Math.hypot(to.x - from.x, to.y - from.y) / 9));
            for (let step = 0; step < steps; step += 2) {
              ghostShape.moveTo(from.x + (to.x - from.x) * step / steps, from.y + (to.y - from.y) * step / steps)
                .lineTo(from.x + (to.x - from.x) * (step + 1) / steps, from.y + (to.y - from.y) * (step + 1) / steps);
            }
            ghostShape.stroke({ color: 0x2f8a5b, width: 2, alpha: 0.85 });
            decor.hideUnder(footprintTiles(cell.x, cell.y, spec.width, spec.height));
            if (validation.valid) {
              roadAccessHint(cell.x, cell.y, spec.width, spec.height, true);
              ghostBuilding({ ...building, x: cell.x, y: cell.y, createdAt: 0 });
            }
          }
        } else if (current.tool === 'move' || current.tool === 'bulldoze') {
          const building = buildingAtPoint(current.city, localPoint);
          if (building) {
            const spec = BUILDINGS[building.kind];
            label = `${current.tool === 'move' ? 'Move' : 'Demolish'} ${building.name}`;
            hoverBuildingId = building.id;
            polygon(ghostShape, footprint(building.x, building.y, spec.width, spec.height),
              current.tool === 'move' ? 0xb9e8c2 : 0xd97962, 0.5, current.tool === 'move' ? 0x2f8a5b : 0xb84c43, 0.95);
            if (current.tool === 'bulldoze') setDemolishHover(building.id);
          } else {
            label = current.tool === 'move' ? 'Choose a building to move.' : 'Choose a building or road to demolish.';
            polygon(ghostShape, tileDiamond(cell.x, cell.y), 0xffe8a2, 0.18, 0xfff4d5);
          }
        } else if (current.tool === 'select' && current.lifeMode) {
          const live = current.getWorld?.() ?? current.world;
          hoverPlayer = player.pick(localPoint, view.scale);
          hoverCitizenId = hoverPlayer ? null : npcs.pick(localPoint, view.scale);
          npcs.setHovered(hoverCitizenId);
          const building = hoverPlayer || hoverCitizenId ? undefined : buildingAtPoint(current.city, localPoint);
          hoverBuildingId = building?.id ?? null;
          if (current.homeHighlights) {
            const home = building && current.homeHighlights.find((entry) => entry.id === building.id);
            label = home ? `${building!.name} · ${home.available ? 'Choose this home' : 'No free room'}` : 'Choose a highlighted home';
          } else if (hoverPlayer) label = 'You · open your profile';
          else if (hoverCitizenId) label = `Meet ${live.citizens.find((entry) => entry.id === hoverCitizenId)?.name ?? 'resident'}`;
          else if (building) {
            label = `${building.name} · ${building.kind === 'park' || building.kind === 'pool' || building.kind === 'clubhouse' ? 'Visit or walk here' : 'Walk here'}`;
            const spec = BUILDINGS[building.kind];
            ghostShape.poly(footprint(building.x, building.y, spec.width, spec.height).flatMap((point) => [point.x, point.y]))
              .fill({ color: 0xffffff, alpha: 0.12 }).stroke({ color: 0xffffff, width: 2, alpha: 0.85 });
          } else if (live.player) {
            const road = live.plan.roads.some((tile) => tile.x === cell.x && tile.y === cell.y);
            label = road ? 'Walk here' : 'Can’t walk here · only roads and paths';
            polygon(ghostShape, tileDiamond(cell.x, cell.y), road ? 0xbfe8c9 : 0xd97962, road ? 0.45 : 0.4, road ? 0x2f8a5b : 0xb84c43, 0.9);
          }
        } else if (current.tool === 'select') {
          hoverPlayer = !!current.onSelectPlayer && player.pick(localPoint, view.scale);
          hoverCitizenId = !hoverPlayer && current.onSelectCitizen ? npcs.pick(localPoint, view.scale) : null;
          npcs.setHovered(hoverCitizenId);
          if (!hoverCitizenId) hoverBuildingId = buildingAtPoint(current.city, localPoint)?.id ?? null;
          const hovered = hoverBuildingId && hoverBuildingId !== current.selectedBuildingId ? current.city.buildings.find((entry) => entry.id === hoverBuildingId) : undefined;
          if (hovered) {
            const spec = BUILDINGS[hovered.kind];
            ghostShape.poly(footprint(hovered.x, hovered.y, spec.width, spec.height).flatMap((point) => [point.x, point.y]))
              .fill({ color: 0xffffff, alpha: 0.12 }).stroke({ color: 0xffffff, width: 2, alpha: 0.85 });
          }
        }
        host.style.cursor = current.tool === 'select' && (hoverCitizenId || hoverBuildingId || hoverPlayer) ? 'pointer' : '';
        setPreview(label);
        drawNameplate();
      };
      refreshRef.current = refreshPreview;
      app.stage.on('globalpointermove', (event) => {
        if (event.nativeEvent.target !== app.canvas || event.global.x < 0 || event.global.y < 0 ||
            event.global.x >= app.screen.width || event.global.y >= app.screen.height) {
          leave();
          return;
        }
        hoverPoint = { x: event.global.x, y: event.global.y };
        const localPoint = getLocalPoint(event);
        const cell = toCell(localPoint);
        const current = propsRef.current;
        if (gestureTool !== current.tool) endGesture();
        if (pointerAction === 'pan') {
          view.x += event.global.x - lastPointer.x;
          view.y += event.global.y - lastPointer.y;
          lastPointer = { x: event.global.x, y: event.global.y };
          if (following) { following = false; current.onFollowEnd?.(); }
          updateCamera();
        } else if (pointerAction === 'paint' || pointerAction === 'bulldoze') {
          const cells = lastCell ? tileStroke(lastCell, cell, current.city.size) : [cell];
          for (const tile of cells) handleCell(tile, tile.x === cell.x && tile.y === cell.y ? localPoint : undefined);
          lastCell = cell;
        }
        refreshPreview();
      });
      app.stage.on('pointerup', endGesture);
      app.stage.on('pointerupoutside', endGesture);
      app.canvas.addEventListener('pointerleave', leave);
      window.addEventListener('pointerup', endGesture);
      window.addEventListener('blur', leave);
      const preventContextMenu = (event: Event) => event.preventDefault();
      app.canvas.addEventListener('contextmenu', preventContextMenu);

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const bounds = app.canvas.getBoundingClientRect();
        const mouse = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        zoomAround(mouse, view.scale * (event.deltaY < 0 ? 1.1 : 0.91));
        updateCamera();
        refreshPreview();
      };
      app.canvas.addEventListener('wheel', onWheel, { passive: false });
      const resizeObserver = new ResizeObserver(() => {
        // Pixi queues window resize on RAF; update it before deriving pointer/minimap transforms.
        app.resize();
        app.stage.hitArea = app.screen;
        updateCamera();
        refreshPreview();
      });
      resizeObserver.observe(host);
      const disconnectSimulation = connectSimulationTicker(app.ticker, (elapsedMs) => propsRef.current.onSimulationFrame(elapsedMs));
      // Geometry, labels, and scaffolding must finish even while simulation time is paused.
      let wasConstructing = false;
      let lastConstructionDraw = 0;
      let frames = 0, frameWindowStart = performance.now(), frameCost = 0;
      app.ticker.add(() => {
        graveyard.flush();
        const frameStart = performance.now();
        const now = Date.now();
        const current = propsRef.current;
        const constructing = current.city.buildings.some((building) => now - building.createdAt < 5200);
        if ((constructing && now - lastConstructionDraw >= 100) || (wasConstructing && !constructing)) {
          redrawBuildings(buildings, current.city, current.world.plan, current.selectedBuildingId, registry, textures, buildingShadows);
          applyLighting(lighting, true);
          lastConstructionDraw = now;
        }
        wasConstructing = constructing;

        // Residents: read the authoritative snapshot after this frame's simulation advance.
        const live = current.getWorld?.() ?? current.world;
        const inverse = 1 / view.scale;
        const margin = 60 * inverse;
        const bounds: LocalBounds | null = live.citizens.length > 60 ? (() => {
          const corners = [world.toLocal({ x: 0, y: 0 }), world.toLocal({ x: app.screen.width, y: app.screen.height })];
          const a = toGrid({ x: corners[0]!.x - margin, y: corners[0]!.y - margin });
          const b = toGrid({ x: corners[1]!.x + margin, y: corners[1]!.y + margin });
          const c = toGrid({ x: corners[0]!.x - margin, y: corners[1]!.y + margin });
          const d = toGrid({ x: corners[1]!.x + margin, y: corners[0]!.y - margin });
          return { left: Math.min(a.x, b.x, c.x, d.x), right: Math.max(a.x, b.x, c.x, d.x),
            top: Math.min(a.y, b.y, c.y, d.y), bottom: Math.max(a.y, b.y, c.y, d.y) };
        })() : null;
        npcs.setSelected(current.selectedCitizenId ?? null);
        const minuteOfDay = getGameTime(live.clock).minuteOfDay;
        const target = live.population ? worldLighting(minuteOfDay) : DAYLIGHT;
        applyLighting(target);
        // Late at night homes go dark one by one and shops close (checked a few times per second, never per frame).
        if (lighting.glow > 0.01 && live.population && frameStart - windowCheck > 400) {
          windowCheck = frameStart;
          const types = new Map(live.plan.buildings.map((b) => [b.id, b.type]));
          for (const [id, visual] of registry) if (visual.lights) visual.lights.alpha = lighting.glow * windowsOn(types.get(id), id, minuteOfDay);
        }
        if (!live.clock.paused) ambientTime += Math.min(100, app.ticker.deltaMS);
        const detailed = view.scale >= 0.32;
        ambient.update(ambientTime, detailed);
        const tl = world.toLocal({ x: 0, y: 0 }), br = world.toLocal({ x: app.screen.width, y: app.screen.height });
        decor.sway(ambientTime, { left: tl.x - 60, top: tl.y - 60, right: br.x + 60, bottom: br.y + 120 }, reducedMotion);
        npcs.sync(live, frameStart, view.scale, bounds);
        player.feedback(current.lifeFeedback);
        if (current.homeHighlights !== lastHighlights) { lastHighlights = current.homeHighlights; player.setHomeHighlights(current.homeHighlights ?? null); }
        player.sync(live, frameStart, view.scale);
        effects.update(Math.min(100, app.ticker.deltaMS));

        const followId = current.followCitizenId ?? null;
        const playerFocus = current.followPlayer ? player.focus : null;
        if (playerFocus) {
          const goal = iso(playerFocus.x, playerFocus.y);
          if (!following) { following = true; view.x = 0; view.y = 0; }
          center = { x: center.x + (goal.x - center.x) * 0.18, y: center.y + (goal.y - center.y) * 0.18 };
          updateCamera(true);
        } else if (followId) {
          const citizen = live.citizens.find((entry) => entry.id === followId);
          const rendered = npcs.getRenderedPosition(followId);
          const target = citizen ? (citizen.movement?.status === 'inside' || !rendered ? citizen.position : rendered) : null;
          if (target) {
            const goal = iso(target.x, target.y);
            if (!following) { following = true; view.x = 0; view.y = 0; }
            center = { x: center.x + (goal.x - center.x) * 0.18, y: center.y + (goal.y - center.y) * 0.18 };
            updateCamera(true);
          }
        } else following = false;
        if (hoverCitizenId || current.selectedCitizenId || hoverPlayer) drawNameplate();

        frames += 1;
        frameCost += performance.now() - frameStart;
        if (frameStart - frameWindowStart >= 1000) {
          const stats: RendererStats = { fps: Math.round(frames * 1000 / (frameStart - frameWindowStart)),
            frameMs: Math.round(frameCost / frames * 100) / 100, residents: npcs.count,
            visibleResidents: buildings.children.filter((child) => child.label === 'npc' && child.visible).length,
            venueVisitors: npcs.venueVisitors, art: host.dataset.art ?? 'loading' };
          (window as unknown as { __tinyCityRenderer?: RendererStats }).__tinyCityRenderer = stats;
          frames = 0; frameCost = 0; frameWindowStart = frameStart;
        }
      });

      cleanup = () => {
        disconnectSimulation();
        npcs.destroy();
        player.destroy();
        decor.destroy();
        ambient.destroy();
        effects.destroy();
        graveyard.flush();
        textures.destroy();
        if (groundSprite.texture !== Texture.EMPTY) groundSprite.texture.destroy(true);
        ground.destroy({ children: true });
        texturesRef.current = new BuildingTextures(null);
        afterRedrawRef.current = null;
        refreshGroundRef.current = null;
        app.canvas.removeEventListener('wheel', onWheel);
        app.canvas.removeEventListener('pointerleave', leave);
        app.canvas.removeEventListener('contextmenu', preventContextMenu);
        window.removeEventListener('pointerup', endGesture);
        window.removeEventListener('blur', leave);
        resizeObserver.disconnect();
      };
    }).catch(() => {
      if (!disposed) setRenderError(true);
    });
    pixiLifecycle = run;

    return () => {
      disposed = true;
      cleanup();
      if (appRef.current === app) {
        app.destroy(true, { children: true });
        appRef.current = null;
      }
      refreshRef.current = null;
      cameraRef.current = null;
      safeAreaRef.current = null;
      nameplateRef.current = null;
      host.replaceChildren();
      terrainRef.current = null;
      roadsRef.current = null;
      buildingsRef.current = null;
      shadowsRef.current = null;
      proposalOverlayRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terrain = terrainRef.current;
    const roads = roadsRef.current;
    const buildings = buildingsRef.current;
    const proposalOverlay = proposalOverlayRef.current;
    if (!terrain || !roads || !buildings) return;
    const roadsChanged = lastRoadsRef.current !== props.city.roads;
    lastRoadsRef.current = props.city.roads;
    redrawCity(terrain, roads, buildings, props.city, props.world.plan, props.selectedBuildingId, false, registryRef.current, texturesRef.current, roadsChanged, shadowsRef.current);
    if (roadsChanged) refreshGroundRef.current?.();
    afterRedrawRef.current?.(props.world.plan);
    if (proposalOverlay) redrawProposalOverlay(proposalOverlay, props.proposal, props.world.plan, props.targetHighlights);
    nameplateRef.current?.();
  }, [props.city, props.world.plan, props.selectedBuildingId, props.proposal, props.targetHighlights]);

  return <><div ref={hostRef} className={`city-viewport ${props.tool === 'move' ? 'is-moving' : ''} ${props.tool === 'bulldoze' ? 'is-demolishing' : ''} ${props.lifeMode ? 'is-life' : ''}`}
    aria-label="Isometric 64 by 64 city map" />
    {preview && <output className="placement-feedback" aria-label="Placement preview">{preview}</output>}
    {renderError && <div className="render-error" role="alert">The city renderer could not start. Reload to retry; your saved city is still on this device.</div>}
  </>;
}
