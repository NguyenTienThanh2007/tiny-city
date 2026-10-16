import type { BuildingDesign } from '@tiny-city/ai-architect';
import type { Building, CitizenActivity, Position, TripPhase, Vehicle, WorldState } from '@tiny-city/simulation';
import { roadMask } from '../../game/art/artManifest';
import { crowdLayout, type CrowdAction } from '../../game/venueCrowd';
import { planDecor, type Decor } from '../../game/worldDecor';
import { stopSide } from '../../game/vehicleMotion';
import { facingFor, roadSides } from '../spawn';
import type { Facing } from '../coordinates';

/**
 * Phase 8B world scene model: the authoritative WorldState translated into stable, renderer-independent scene
 * entities. Pure and deterministic. The Three.js renderer reconciles its objects against this model; it never decides
 * which buildings, residents, vehicles or stops exist, where anyone is, or what they are doing.
 *
 * Static entities (buildings, road tiles, stops, landscaping) change only with the plan or the bus network and are
 * diffed by stable ID or tile key. Actors (residents, vehicles) are listed every frame from the live state.
 */

export const CHUNK = 12;
export const chunkKey = (x: number, y: number) => `${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`;
const tileKey = (x: number, y: number) => `${x},${y}`;

export interface BuildingEntity {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly kind: Building['kind'];
  readonly position: Position;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly facing: Facing;
  readonly design?: BuildingDesign;
  /** Everything that changes how the building is drawn or collides; a different key means rebuild. */
  readonly key: string;
}
export interface RoadEntity { readonly x: number; readonly y: number; readonly mask: number; readonly plaza: boolean; readonly key: string }
export interface StopEntity { readonly id: string; readonly name: string; readonly tile: Position; readonly side: 'N' | 'E' | 'S' | 'W'; readonly key: string }

export interface StaticScene {
  readonly planId: string;
  readonly width: number;
  readonly height: number;
  readonly buildings: ReadonlyMap<string, BuildingEntity>;
  readonly roads: ReadonlyMap<string, RoadEntity>;
  readonly stops: ReadonlyMap<string, StopEntity>;
  /** The deterministic landscaping (the City View's decor plan). */
  readonly decor: readonly Decor[];
  /** Landscaping signature per chunk, to rebuild only the chunks whose decor changed. */
  readonly decorChunks: ReadonlyMap<string, string>;
}

export function staticSceneOf(world: WorldState, designs: ReadonlyMap<string, BuildingDesign>): StaticScene {
  const plan = world.plan;
  const roadSet = new Set(plan.roads.map((r) => tileKey(r.x, r.y)));
  const has = (x: number, y: number) => roadSet.has(tileKey(x, y));
  const buildings = new Map<string, BuildingEntity>();
  for (const b of plan.buildings) {
    const facing = facingFor(roadSides(b, has));
    const design = designs.get(b.id);
    buildings.set(b.id, { id: b.id, name: b.name, type: b.type ?? b.kind, kind: b.kind, position: { ...b.position }, footprint: { ...b.footprint }, facing,
      ...(design ? { design } : {}), key: `${b.type}|${b.position.x},${b.position.y}|${b.footprint.width}x${b.footprint.height}|${facing}|${design?.model ?? '-'}` });
  }
  const roads = new Map<string, RoadEntity>();
  for (const r of plan.roads) {
    const mask = roadMask(has, r.x, r.y);
    const plaza = mask === 15 && has(r.x - 1, r.y - 1) && has(r.x + 1, r.y - 1) && has(r.x - 1, r.y + 1) && has(r.x + 1, r.y + 1);
    roads.set(tileKey(r.x, r.y), { x: r.x, y: r.y, mask, plaza, key: `${mask}${plaza ? 'p' : ''}` });
  }
  const stops = new Map<string, StopEntity>();
  for (const s of world.transport?.stops ?? []) {
    const side = stopSide(s.tile, roadSet);
    stops.set(s.id, { id: s.id, name: s.name, tile: { ...s.tile }, side, key: `${s.tile.x},${s.tile.y}|${side}` });
  }
  const decor = planDecor(plan);
  const chunks = new Map<string, string[]>();
  for (const d of decor) {
    const key = chunkKey(d.at.x, d.at.y);
    const list = chunks.get(key) ?? [];
    list.push(`${d.kind}:${d.variant}:${d.at.x.toFixed(3)},${d.at.y.toFixed(3)}:${d.size.toFixed(3)}`);
    chunks.set(key, list);
  }
  const decorChunks = new Map([...chunks].map(([k, v]) => [k, v.join(';')]));
  return { planId: plan.id, width: plan.width, height: plan.height, buildings, roads, stops, decor, decorChunks };
}

export interface StaticDiff {
  readonly buildings: { readonly added: readonly BuildingEntity[]; readonly removed: readonly string[]; readonly changed: readonly BuildingEntity[] };
  /** Chunks whose road tiles (or a tile's connection mask) changed. */
  readonly roadChunks: ReadonlySet<string>;
  readonly decorChunks: ReadonlySet<string>;
  readonly stops: { readonly added: readonly StopEntity[]; readonly removed: readonly string[]; readonly changed: readonly StopEntity[] };
  readonly empty: boolean;
}

/** What changed between two static scenes (null `prev` = initial hydration: everything is added). */
export function diffStatic(prev: StaticScene | null, next: StaticScene): StaticDiff {
  const added: BuildingEntity[] = [], removed: string[] = [], changed: BuildingEntity[] = [];
  const before = prev?.buildings ?? new Map<string, BuildingEntity>();
  for (const [id, b] of next.buildings) { const old = before.get(id); if (!old) added.push(b); else if (old.key !== b.key) changed.push(b); }
  for (const id of before.keys()) if (!next.buildings.has(id)) removed.push(id);
  const roadChunks = new Set<string>();
  const oldRoads = prev?.roads ?? new Map<string, RoadEntity>();
  for (const [k, r] of next.roads) if (oldRoads.get(k)?.key !== r.key) roadChunks.add(chunkKey(r.x, r.y));
  for (const [k, r] of oldRoads) if (!next.roads.has(k)) roadChunks.add(chunkKey(r.x, r.y));
  const decorChunks = new Set<string>();
  const oldDecor = prev?.decorChunks ?? new Map<string, string>();
  for (const [k, sig] of next.decorChunks) if (oldDecor.get(k) !== sig) decorChunks.add(k);
  for (const k of oldDecor.keys()) if (!next.decorChunks.has(k)) decorChunks.add(k);
  const sAdded: StopEntity[] = [], sRemoved: string[] = [], sChanged: StopEntity[] = [];
  const oldStops = prev?.stops ?? new Map<string, StopEntity>();
  for (const [id, s] of next.stops) { const old = oldStops.get(id); if (!old) sAdded.push(s); else if (old.key !== s.key) sChanged.push(s); }
  for (const id of oldStops.keys()) if (!next.stops.has(id)) sRemoved.push(id);
  const empty = !added.length && !removed.length && !changed.length && !roadChunks.size && !decorChunks.size && !sAdded.length && !sRemoved.length && !sChanged.length;
  return { buildings: { added, removed, changed }, roadChunks, decorChunks, stops: { added: sAdded, removed: sRemoved, changed: sChanged }, empty };
}

/** A stop shelter's footprint on its curb (grid coordinates): solid for the character and the camera. */
export function stopFootprint(stop: Pick<StopEntity, 'tile' | 'side'>): { minX: number; minY: number; maxX: number; maxY: number } {
  const { x, y } = stop.tile, half = 0.3, depth = 0.16;
  switch (stop.side) {
    case 'N': return { minX: x + 0.5 - half, maxX: x + 0.5 + half, minY: y, maxY: y + depth };
    case 'S': return { minX: x + 0.5 - half, maxX: x + 0.5 + half, minY: y + 1 - depth, maxY: y + 1 };
    case 'E': return { minX: x + 1 - depth, maxX: x + 1, minY: y + 0.5 - half, maxY: y + 0.5 + half };
    case 'W': return { minX: x, maxX: x + depth, minY: y + 0.5 - half, maxY: y + 0.5 + half };
  }
}
export const STOP_HEIGHT = 0.46;
/** Every bus shelter of the world as a solid box for character collision. */
export function stopObstacles(world: WorldState): { kind: 'box'; minX: number; minY: number; maxX: number; maxY: number; source: string }[] {
  const roads = new Set(world.plan.roads.map((r) => tileKey(r.x, r.y)));
  return (world.transport?.stops ?? []).map((s) => ({ kind: 'box' as const, ...stopFootprint({ tile: s.tile, side: stopSide(s.tile, roads) }), source: 'bus-stop' }));
}

// ---------------------------------------------------------------- actors

/**
 * How a resident appears in 3D, from their authoritative state:
 * - `walking`: on a road tile, walking a route (Phase 3), or walking to a bus stop (Phase 6 `to-stop`).
 * - `waiting`: standing on a road tile waiting for a route (Phase 3 `waiting`).
 * - `at-stop`: waiting at a bus stop (Phase 6 trip phase `waiting`), drawn beside the shelter.
 * - `at-venue`: a visitor of an open-air venue (park, pool, plaza, stage, market…) at the City View's own crowd spot.
 * Everyone else is hidden and only counted: inside a building, on a building's own lot (the entrance leg between the
 * door and the street: residents appear at the lot edge, never inside walls), riding a bus, or driving a car.
 */
export type ResidentMode = 'walking' | 'waiting' | 'at-stop' | 'at-venue';
export interface ResidentEntity {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly heading: Position;
  readonly mode: ResidentMode;
  readonly action: 'none' | CrowdAction;
  readonly activity: CitizenActivity;
  readonly venueId: string | null;
  readonly stopId: string | null;
}
export interface HiddenResidents { inside: number; onLot: number; riding: number; driving: number }
export interface ActorScene { readonly residents: readonly ResidentEntity[]; readonly hidden: HiddenResidents }

/** Slot `index` beside a stop shelter: on the shelter's curb half of the tile, spread along the curb. */
export function stopSlot(stop: Pick<StopEntity, 'tile' | 'side'>, index: number): Position {
  const out = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } }[stop.side];
  const along = { x: Math.abs(out.y), y: Math.abs(out.x) };
  const row = Math.floor(index / 5), col = index % 5;
  const offset = (col - 2) * 0.14 + (row % 2) * 0.07;
  const depth = 0.27 - row * 0.12;
  return { x: stop.tile.x + 0.5 + out.x * depth + along.x * offset, y: stop.tile.y + 0.5 + out.y * depth + along.y * offset };
}

export function actorScene(world: WorldState, isRoad: (x: number, y: number) => boolean, stops: ReadonlyMap<string, StopEntity>,
  frontOf: (b: Building) => 'S' | 'E' = () => 'S'): ActorScene {
  const hidden: HiddenResidents = { inside: 0, onLot: 0, riding: 0, driving: 0 };
  const residents: ResidentEntity[] = [];
  const trips = new Map((world.transport?.trips ?? []).map((t) => [t.citizenId, t]));
  const crowd = crowdLayout(world, frontOf);
  const waitingAt = new Map<string, string[]>();
  for (const c of world.citizens) {
    const m = c.movement;
    const onRoad = isRoad(Math.floor(c.position.x), Math.floor(c.position.y));
    const base = { id: c.id, name: c.name, activity: c.activity, venueId: null, stopId: null, action: 'none' as const };
    if (!m) {
      if (onRoad) residents.push({ ...base, x: c.position.x, y: c.position.y, heading: { x: 0, y: 1 }, mode: 'walking' });
      else hidden.inside += 1;
      continue;
    }
    if (m.status === 'travelling' || m.status === 'waiting') {
      if (onRoad) residents.push({ ...base, x: c.position.x, y: c.position.y, heading: m.heading, mode: m.status === 'travelling' ? 'walking' : 'waiting' });
      else if (m.currentBuildingId) hidden.onLot += 1; else hidden.inside += 1;
      continue;
    }
    if (m.status === 'vehicle') {
      const phase: TripPhase | undefined = trips.get(c.id)?.phase;
      const stopId = trips.get(c.id)?.boardStopId ?? null;
      if (phase === 'waiting' && stopId && stops.has(stopId)) waitingAt.set(stopId, [...(waitingAt.get(stopId) ?? []), c.id]);
      else if (phase === 'riding') hidden.riding += 1;
      else hidden.driving += 1;
      continue;
    }
    const spot = crowd.get(c.id);
    if (spot) residents.push({ ...base, x: spot.position.x, y: spot.position.y, heading: spot.heading, mode: 'at-venue', action: spot.action, venueId: spot.venueId });
    else hidden.inside += 1;
  }
  const byId = new Map(world.citizens.map((c) => [c.id, c]));
  for (const [stopId, ids] of waitingAt) {
    const stop = stops.get(stopId)!;
    const out = { N: { x: 0, y: 1 }, S: { x: 0, y: -1 }, E: { x: -1, y: 0 }, W: { x: 1, y: 0 } }[stop.side];
    [...ids].sort().forEach((id, index) => {
      const c = byId.get(id)!;
      const at = stopSlot(stop, index);
      residents.push({ id, name: c.name, activity: c.activity, x: at.x, y: at.y, heading: out, mode: 'at-stop', action: 'idle', venueId: null, stopId });
    });
  }
  residents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { residents, hidden };
}

/** Vehicles the renderer may draw: every simulated vehicle that is on the road (not still pulling out of a lot). */
export const drawableVehicles = (world: WorldState): readonly Vehicle[] => (world.transport?.vehicles ?? []).filter((v) => v.state !== 'departing');

// ---------------------------------------------------------------- interaction

export type InteractionKind = 'resident' | 'building' | 'stop';
export interface InteractionTarget { readonly kind: InteractionKind; readonly id: string; readonly label: string; readonly distance: number }
export const INTERACTION = Object.freeze({ resident: 1.4, stop: 1.1, building: 0.75, fov: (80 * Math.PI) / 180 });

/**
 * What E would act on: the nearest real resident, stop or building the character faces and is close to. Residents
 * win ties (they are the smaller target). Pure; IDs come straight from the scene model, so a target always resolves
 * to an authoritative record.
 */
export function interactionTarget(player: Position, yaw: number, residents: readonly Pick<ResidentEntity, 'id' | 'name' | 'x' | 'y'>[],
  buildings: Iterable<BuildingEntity>, stops: Iterable<StopEntity>): InteractionTarget | null {
  const fx = Math.sin(yaw), fy = Math.cos(yaw);
  const facing = (dx: number, dy: number) => { const d = Math.hypot(dx, dy); return d < 1e-6 || (dx * fx + dy * fy) / d >= Math.cos(INTERACTION.fov); };
  let best: (InteractionTarget & { score: number }) | null = null;
  const offer = (t: InteractionTarget, score: number) => { if (!best || score < best.score) best = { ...t, score }; };
  for (const r of residents) {
    const dx = r.x - player.x, dy = r.y - player.y, d = Math.hypot(dx, dy);
    if (d <= INTERACTION.resident && facing(dx, dy)) offer({ kind: 'resident', id: r.id, label: r.name, distance: d }, d - 0.3);
  }
  for (const s of stops) {
    const dx = s.tile.x + 0.5 - player.x, dy = s.tile.y + 0.5 - player.y, d = Math.hypot(dx, dy);
    if (d <= INTERACTION.stop && facing(dx, dy)) offer({ kind: 'stop', id: s.id, label: s.name, distance: d }, d - 0.1);
  }
  for (const b of buildings) {
    const cx = Math.max(b.position.x, Math.min(b.position.x + b.footprint.width, player.x));
    const cy = Math.max(b.position.y, Math.min(b.position.y + b.footprint.height, player.y));
    const dx = cx - player.x, dy = cy - player.y, d = Math.hypot(dx, dy);
    if (d <= INTERACTION.building && facing(dx, dy)) offer({ kind: 'building', id: b.id, label: b.name, distance: d }, d);
  }
  if (!best) return null;
  const { score: _score, ...target } = best as InteractionTarget & { score: number };
  void _score;
  return target;
}
