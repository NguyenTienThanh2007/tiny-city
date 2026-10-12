import { buildingCenter, containsPosition, NPC_LIMITS, RoadNavigator } from './navigation.js';
import { providesLeisure } from './population.js';
import type {
  Building, Citizen, LifeCommand, LifeRejectionReason, PlayerActionKind, PlayerActivity, PlayerActivityKind, PlayerAppearance,
  PlayerCharacter, PlayerFailureReason, PlayerMovement, PlayerNeed, PlayerNeedLevel, PlayerNeeds, PlayerOutcome, PlayerSocialTopic,
  Position, SimulationEvent, WorldState,
} from './types.js';

/** Phase 4 Life Mode: one player character living in the authoritative world. No timers, no RNG, no LLM calls. */
export const PLAYER_ID = 'player-1';

export const PLAYER_APPEARANCE_OPTIONS = Object.freeze({
  skinTones: 6,
  hairStyles: Object.freeze(['short', 'long', 'bun', 'curly', 'cap', 'buzz'] as const),
  hairColors: 8,
  outfits: Object.freeze(['tee', 'dress', 'jacket', 'overalls', 'hoodie'] as const),
  outfitColors: 10,
  accessories: Object.freeze(['none', 'glasses', 'backpack', 'scarf', 'sunhat'] as const),
});

export const PLAYER_LIMITS = Object.freeze({
  nameLength: 24,
  acquaintances: 64,
  /** Square radius searched for a curb when a city edit removes the ground under the player. */
  relocationRadius: 8,
  /** Euclidean tiles within which the player can start talking to an outdoor resident. */
  interactionRange: 2.5,
  /** A conversation ends when the resident walks further than this. */
  interactionBreakRange: 3.5,
  /** Re-route toward a moving resident when their position drifts this far from the route goal. */
  retargetDistance: 3,
});

/**
 * Balance values, per game minute unless stated. Documented in docs/life/phase-4a-contracts.md.
 * A full day (1440 min) of idling drains roughly 100 energy, 100+ hunger and 85 social.
 */
export const PLAYER_BALANCE = Object.freeze({
  walkingSpeed: 0.45,
  exhaustedSpeedFactor: 0.6,
  decay: Object.freeze({ energy: 0.07, hunger: 0.12, social: 0.06 }),
  walkingEnergy: 0.03,
  starvingEnergyFactor: 1.5,
  thresholds: Object.freeze({ critical: 15, low: 30, fair: 60 }),
  initialNeeds: Object.freeze({ energy: 80, hunger: 70, social: 55, mood: 70 }),
  mood: Object.freeze({ rate: 0.25, criticalPenalty: 10 }),
  activities: Object.freeze({
    rest: Object.freeze({ minutes: 120, energy: 0.7, hungerDecayFactor: 0.5, mood: 5 }),
    eat: Object.freeze({ minutes: 30, hunger: 2.5, mood: 5 }),
    visit: Object.freeze({ minutes: 60, social: 0.15, socialPerVisitor: 0.05, maxVisitorBonus: 0.3, mood: 20 }),
    greet: Object.freeze({ minutes: 5, social: 1.2, mood: 10 }),
    socialize: Object.freeze({ minutes: 30, social: 1.8, mood: 15 }),
  }),
});

const NEEDS: readonly PlayerNeed[] = ['energy', 'hunger', 'social', 'mood'];
const NAME = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '.-]*$/u;
const IDLE: PlayerActivity = { kind: 'idle', phase: 'idle', buildingId: null, citizenId: null, tile: null, durationMinutes: 0, elapsedMinutes: 0 };
const STILL = { x: 0, y: 0 };

export function normalizePlayerName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const value = name.normalize('NFC').trim();
  return value.length > 0 && [...value].length <= PLAYER_LIMITS.nameLength && NAME.test(value) && !/ {2}/.test(value) ? value : null;
}

export function isPlayerAppearance(value: unknown): value is PlayerAppearance {
  if (value === null || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  const index = (v: unknown, size: number) => Number.isInteger(v) && Number(v) >= 0 && Number(v) < size;
  return Object.keys(a).length === 6 && index(a.skinTone, PLAYER_APPEARANCE_OPTIONS.skinTones) &&
    index(a.hairColor, PLAYER_APPEARANCE_OPTIONS.hairColors) && index(a.outfitColor, PLAYER_APPEARANCE_OPTIONS.outfitColors) &&
    (PLAYER_APPEARANCE_OPTIONS.hairStyles as readonly unknown[]).includes(a.hairStyle) &&
    (PLAYER_APPEARANCE_OPTIONS.outfits as readonly unknown[]).includes(a.outfit) &&
    (PLAYER_APPEARANCE_OPTIONS.accessories as readonly unknown[]).includes(a.accessory);
}

export function needLevel(value: number): PlayerNeedLevel {
  const t = PLAYER_BALANCE.thresholds;
  return value < t.critical ? 'critical' : value < t.low ? 'low' : value < t.fair ? 'fair' : 'good';
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;
const clamp = (value: number) => round(Math.max(0, Math.min(100, value)));
const distance = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
const tileOf = (p: Position): Position => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

/** Homes the player can live in. The player occupies one housing slot; residents are never evicted for them. */
export interface HomeOption {
  readonly buildingId: string;
  readonly name: string;
  readonly capacity: number;
  readonly residents: number;
  readonly available: boolean;
  readonly roadConnected: boolean;
  readonly current: boolean;
}

export function playerHomeOptions(world: WorldState, navigator?: RoadNavigator): readonly HomeOption[] {
  const nav = navigator ?? new RoadNavigator(world.plan);
  const counts = new Map<string, number>();
  for (const c of world.citizens) counts.set(c.homeBuildingId, (counts.get(c.homeBuildingId) ?? 0) + 1);
  const current = world.player?.homeBuildingId ?? null;
  return world.plan.buildings.filter((b) => b.kind === 'home').map((b) => {
    const residents = counts.get(b.id) ?? 0;
    return { buildingId: b.id, name: b.name, capacity: b.capacity, residents, current: b.id === current,
      available: b.id !== current && residents < b.capacity, roadConnected: nav.getAccessPoints(b.id).length > 0 };
  });
}

/** Residents visiting a leisure venue right now (the same rule the occupancy index uses). */
function visitorCount(world: WorldState, buildingId: string): number {
  let count = 0;
  for (const c of world.citizens) if (c.activity === 'leisure' && c.movement?.status === 'inside' && c.movement.currentBuildingId === buildingId) count += 1;
  return count;
}

/** Where a resident can be met: inside a public venue, or near their current street tile. */
type Meeting = { readonly type: 'venue'; readonly building: Building } | { readonly type: 'street'; readonly goals: readonly Position[]; readonly at: Position } |
  { readonly type: 'unavailable'; readonly building: Building | null };

function meetingPoint(citizen: Citizen, nav: RoadNavigator): Meeting {
  const m = citizen.movement;
  const inside = m?.status === 'inside' && m.currentBuildingId ? nav.getBuilding(m.currentBuildingId) : undefined;
  if (inside) return providesLeisure(inside) ? { type: 'venue', building: inside } : { type: 'unavailable', building: inside };
  if (!m) {
    // Legacy authored residents only move between schedule targets; meet them where they are.
    const cell = nav.grid.get(tileOf(citizen.position));
    if (cell?.type === 'building') {
      const b = nav.getBuilding(cell.buildingId)!;
      return providesLeisure(b) ? { type: 'venue', building: b } : { type: 'unavailable', building: b };
    }
  }
  const tile = tileOf(citizen.position);
  if (nav.graph.getComponentId(tile) !== null) return { type: 'street', goals: [tile], at: citizen.position };
  const leg = m?.currentBuildingId ? nav.getBuilding(m.currentBuildingId) : undefined;
  if (leg) {
    const access = nav.getAccessPoints(leg.id);
    if (access.length) return { type: 'street', goals: access, at: citizen.position };
  }
  const near = nav.nearestRoad(citizen.position, 2);
  return near ? { type: 'street', goals: [near], at: citizen.position } : { type: 'unavailable', building: null };
}

function inConversationRange(player: PlayerCharacter, citizen: Citizen, nav: RoadNavigator, limit: number): boolean {
  const meeting = meetingPoint(citizen, nav);
  if (meeting.type === 'venue') return player.movement.status === 'inside' && player.movement.currentBuildingId === meeting.building.id;
  if (meeting.type === 'unavailable') return false;
  return player.movement.status !== 'inside' && distance(player.position, citizen.position) <= limit;
}

/** Deterministic conversation topic from the resident's real state; no RNG state is consumed. */
function socialTopic(citizen: Citizen, firstMeeting: boolean): PlayerSocialTopic {
  if (firstMeeting) return 'introduction';
  if (citizen.activity === 'travel') return 'commute';
  if (citizen.activity === 'leisure') return 'leisure';
  if (citizen.activity === 'sleep' || citizen.activity === 'home') return 'rest';
  return 'neighbourhood';
}

const standing = (currentBuildingId: string | null, revision: number): PlayerMovement => ({
  status: 'standing', heading: STILL, currentBuildingId, destinationBuildingId: null, route: [], nextWaypoint: 0, plannedRevision: revision,
});
const insideMovement = (buildingId: string, revision: number): PlayerMovement => ({
  status: 'inside', heading: STILL, currentBuildingId: buildingId, destinationBuildingId: null, route: [], nextWaypoint: 0, plannedRevision: revision,
});

function outcome(world: WorldState, activity: PlayerActivity, result: PlayerOutcome['result'], reason: PlayerFailureReason | null): PlayerOutcome {
  return { kind: activity.kind, result, reason, tick: world.clock.tick, buildingId: activity.buildingId, citizenId: activity.citizenId, elapsedMinutes: activity.elapsedMinutes };
}

/** Stops where the player is: the building cell they stand in (if any) remains their current building. */
function stopMovement(player: PlayerCharacter, nav: RoadNavigator, revision: number): PlayerMovement {
  if (player.movement.status === 'inside') return player.movement;
  const cell = nav.grid.get(tileOf(player.position));
  return standing(cell?.type === 'building' ? cell.buildingId : null, revision);
}

function canEnter(player: PlayerCharacter, building: Building, purpose: PlayerActivityKind): boolean {
  return building.id === player.homeBuildingId || purpose === 'visit' && providesLeisure(building) ||
    (purpose === 'greet' || purpose === 'socialize') && providesLeisure(building);
}

type Plan = { readonly route: readonly Position[]; readonly enter: string | null } | { readonly route: null; readonly reason: 'unreachable' | 'search-limit' | 'stranded' };

/** Routes to a destination: entering homes/venues through their door, otherwise stopping on the curb. */
function planRoute(player: PlayerCharacter, nav: RoadNavigator, target: { building?: Building; enter?: boolean; goals?: readonly Position[] }): Plan {
  const from = player.position, current = player.movement.currentBuildingId;
  const source = nav.getBuilding(current);
  const onRoad = nav.graph.getComponentId(tileOf(from)) !== null;
  if (!onRoad && !(source && containsPosition(source, from))) return { route: null, reason: 'stranded' };
  if (target.building && target.enter) {
    if (player.movement.status === 'inside' && current === target.building.id) return { route: [from], enter: target.building.id };
    const result = nav.routeFrom(from, current, target.building.id);
    return result.route ? { route: result.route, enter: target.building.id } : { route: null, reason: result.reason };
  }
  const goals = target.goals ?? (target.building ? nav.getAccessPoints(target.building.id) : []);
  if (!goals.length) return { route: null, reason: 'unreachable' };
  const result = nav.routeToRoad(from, current, goals);
  return result.route ? { route: result.route, enter: null } : { route: null, reason: result.reason };
}

function movementFor(plan: { route: readonly Position[]; enter: string | null }, player: PlayerCharacter, revision: number): PlayerMovement {
  if (plan.route.length <= 1) return plan.enter ? insideMovement(plan.enter, revision) : standing(player.movement.status === 'inside' ? null : player.movement.currentBuildingId, revision);
  return { status: 'travelling', heading: player.movement.heading, currentBuildingId: player.movement.currentBuildingId,
    destinationBuildingId: plan.enter, route: plan.route, nextWaypoint: 1, plannedRevision: revision };
}

type Change = { state: WorldState; events: SimulationEvent[] };
type Applied = { readonly state: WorldState; readonly events: readonly SimulationEvent[]; readonly reason: LifeRejectionReason | null };

function withPlayer(world: WorldState, player: PlayerCharacter): WorldState { return { ...world, player }; }

/** Resolves an action into a travel target and the activity it will perform there. */
function resolveAction(world: WorldState, player: PlayerCharacter, nav: RoadNavigator, activity: PlayerActionKind, buildingId?: string, citizenId?: string):
  { target: { building?: Building; enter?: boolean; goals?: readonly Position[] }; activity: PlayerActivity } | LifeRejectionReason {
  const spec = PLAYER_BALANCE.activities[activity];
  const base = { kind: activity, phase: 'travelling' as const, tile: null, durationMinutes: spec.minutes, elapsedMinutes: 0 };
  const tired = player.needs.energy < PLAYER_BALANCE.thresholds.critical;
  switch (activity) {
    case 'rest':
    case 'eat': {
      const home = nav.getBuilding(player.homeBuildingId);
      if (!home) return 'no-home';
      return { target: { building: home, enter: true }, activity: { ...base, buildingId: home.id, citizenId: null } };
    }
    case 'visit': {
      if (tired) return 'too-tired';
      const candidates = buildingId !== undefined ? [nav.getBuilding(buildingId)] : nav.leisureBuildings;
      if (buildingId !== undefined && !candidates[0]) return 'building-not-found';
      if (buildingId !== undefined && !providesLeisure(candidates[0]!)) return 'not-leisure';
      let best: { building: Building; length: number } | null = null, full = false;
      for (const venue of candidates) {
        if (!venue) continue;
        if (visitorCount(world, venue.id) >= venue.capacity) { full = true; continue; }
        const plan = planRoute(player, nav, { building: venue, enter: true });
        if (!plan.route) continue;
        if (!best || plan.route.length < best.length) best = { building: venue, length: plan.route.length };
      }
      if (!best) return candidates.length === 0 ? 'no-venue' : full ? 'venue-full' : 'unreachable';
      return { target: { building: best.building, enter: true }, activity: { ...base, buildingId: best.building.id, citizenId: null } };
    }
    case 'greet':
    case 'socialize': {
      if (tired) return 'too-tired';
      const citizen = world.citizens.find((c) => c.id === citizenId);
      if (!citizen) return 'citizen-not-found';
      const meeting = meetingPoint(citizen, nav);
      if (meeting.type === 'unavailable') return 'citizen-unavailable';
      const act = { ...base, buildingId: meeting.type === 'venue' ? meeting.building.id : null, citizenId: citizen.id };
      return meeting.type === 'venue' ? { target: { building: meeting.building, enter: true }, activity: act } : { target: { goals: meeting.goals }, activity: act };
    }
  }
}

function startPerforming(world: WorldState, player: PlayerCharacter, events: SimulationEvent[]): PlayerCharacter {
  const activity = { ...player.activity, phase: 'performing' as const };
  events.push({ type: 'player.activity-started', tick: world.clock.tick, activity: activity.kind, phase: 'performing', buildingId: activity.buildingId, citizenId: activity.citizenId });
  if ((activity.kind === 'greet' || activity.kind === 'socialize') && activity.citizenId) {
    const citizen = world.citizens.find((c) => c.id === activity.citizenId)!;
    const firstMeeting = !player.acquaintances.includes(citizen.id);
    events.push({ type: 'player.interaction', tick: world.clock.tick, citizenId: citizen.id, kind: activity.kind, topic: socialTopic(citizen, firstMeeting), firstMeeting });
    const acquaintances = firstMeeting ? [...player.acquaintances, citizen.id].slice(-PLAYER_LIMITS.acquaintances) : player.acquaintances;
    return { ...player, activity, acquaintances };
  }
  return { ...player, activity };
}

function finish(world: WorldState, player: PlayerCharacter, result: PlayerOutcome['result'], reason: PlayerFailureReason | null, events: SimulationEvent[]): PlayerCharacter {
  if (player.activity.kind === 'idle') return player;
  const done = outcome(world, player.activity, result, reason);
  events.push({ type: 'player.activity-ended', tick: world.clock.tick, outcome: done });
  return { ...player, activity: IDLE, lastOutcome: done };
}

/** Pure command reducer. Simulation.executeLife is the commit boundary; rejected commands change nothing. */
export function applyLifeCommand(world: WorldState, command: LifeCommand, nav: RoadNavigator): Applied {
  const tick = world.clock.tick, revision = world.revision;
  const reject = (reason: LifeRejectionReason): Applied => ({ state: world, reason,
    events: [{ type: 'player.command-rejected', tick, commandType: command.type, reason }] });
  const events: SimulationEvent[] = [];
  const player = world.player;
  switch (command.type) {
    case 'player.create': {
      if (player) return reject('player-exists');
      const name = normalizePlayerName(command.name);
      if (!name) return reject('invalid-name');
      if (!isPlayerAppearance(command.appearance)) return reject('invalid-appearance');
      const home = nav.getBuilding(command.homeBuildingId);
      if (!home) return reject('home-not-found');
      if (home.kind !== 'home') return reject('not-a-home');
      if (!playerHomeOptions(world, nav).find((o) => o.buildingId === home.id)?.available) return reject('home-full');
      const created: PlayerCharacter = { version: 1, id: PLAYER_ID, name, appearance: { ...command.appearance }, homeBuildingId: home.id,
        position: buildingCenter(home), movement: insideMovement(home.id, revision), activity: IDLE, needs: { ...PLAYER_BALANCE.initialNeeds },
        acquaintances: [], createdTick: tick, lastOutcome: null };
      events.push({ type: 'player.created', tick, player: created });
      return { state: withPlayer(world, created), events, reason: null };
    }
    case 'player.customize': {
      if (!player) return reject('player-not-found');
      const name = normalizePlayerName(command.name);
      if (!name) return reject('invalid-name');
      if (!isPlayerAppearance(command.appearance)) return reject('invalid-appearance');
      events.push({ type: 'player.customized', tick, name });
      return { state: withPlayer(world, { ...player, name, appearance: { ...command.appearance } }), events, reason: null };
    }
    case 'player.move-in': {
      if (!player) return reject('player-not-found');
      const home = nav.getBuilding(command.homeBuildingId);
      if (!home) return reject('home-not-found');
      if (home.kind !== 'home') return reject('not-a-home');
      if (home.id === player.homeBuildingId) return reject('already-home');
      if (!playerHomeOptions(world, nav).find((o) => o.buildingId === home.id)?.available) return reject('home-full');
      // Moving day is an explicit relocation (like the editor moving a resident), not ordinary travel.
      let next = finish(world, player, 'cancelled', null, events);
      next = { ...next, homeBuildingId: home.id, position: buildingCenter(home), movement: insideMovement(home.id, revision) };
      events.push({ type: 'player.moved-in', tick, homeBuildingId: home.id, previousHomeBuildingId: player.homeBuildingId });
      return { state: withPlayer(world, next), events, reason: null };
    }
    case 'player.cancel': {
      if (!player) return reject('player-not-found');
      if (player.activity.kind === 'idle' && player.movement.status !== 'travelling') return reject('nothing-to-cancel');
      let next = finish(world, player, 'cancelled', null, events);
      next = { ...next, movement: stopMovement(player, nav, revision) };
      return { state: withPlayer(world, next), events, reason: null };
    }
    case 'player.move-to': {
      if (!player) return reject('player-not-found');
      const destination = command.destination;
      let target: { building?: Building; enter?: boolean; goals?: readonly Position[] };
      let activity: PlayerActivity;
      if (destination?.type === 'tile') {
        const p = destination.position;
        if (!p || !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y)) return reject('invalid-destination');
        const cell = nav.grid.get(p);
        if (cell?.type === 'building') return applyLifeCommand(world, { type: 'player.move-to', destination: { type: 'building', buildingId: cell.buildingId } }, nav);
        if (cell?.type !== 'road') return reject('invalid-destination');
        target = { goals: [p] };
        activity = { kind: 'move', phase: 'travelling', buildingId: null, citizenId: null, tile: { x: p.x, y: p.y }, durationMinutes: 0, elapsedMinutes: 0 };
      } else if (destination?.type === 'building') {
        const building = nav.getBuilding(destination.buildingId);
        if (!building) return reject('building-not-found');
        target = { building, enter: canEnter(player, building, 'move') };
        activity = { kind: 'move', phase: 'travelling', buildingId: building.id, citizenId: null, tile: null, durationMinutes: 0, elapsedMinutes: 0 };
      } else return reject('invalid-command');
      const plan = planRoute(player, nav, target);
      if (!plan.route) return reject(plan.reason === 'stranded' ? 'stranded' : 'unreachable');
      let next = finish(world, player, 'cancelled', null, events);
      next = { ...next, activity, movement: movementFor(plan, next, revision) };
      events.push({ type: 'player.activity-started', tick, activity: 'move', phase: 'travelling', buildingId: activity.buildingId, citizenId: null });
      if (next.movement.status !== 'travelling') {
        next = { ...next, position: plan.enter ? buildingCenter(target.building!) : next.position };
        next = finish(world, next, 'completed', null, events);
      }
      return { state: withPlayer(world, next), events, reason: null };
    }
    case 'player.start-activity': {
      if (!player) return reject('player-not-found');
      if (!['rest', 'eat', 'visit', 'greet', 'socialize'].includes(command.activity)) return reject('invalid-command');
      const resolved = resolveAction(world, player, nav, command.activity, command.buildingId, command.citizenId);
      if (typeof resolved === 'string') return reject(resolved);
      let next: PlayerCharacter = player;
      const sameSocial = (resolved.activity.kind === 'greet' || resolved.activity.kind === 'socialize') && resolved.activity.citizenId &&
        inConversationRange(player, world.citizens.find((c) => c.id === resolved.activity.citizenId)!, nav, PLAYER_LIMITS.interactionRange);
      const alreadyThere = sameSocial || resolved.target.building && resolved.target.enter && player.movement.status === 'inside' &&
        player.movement.currentBuildingId === resolved.target.building.id;
      let plan: Plan = { route: [player.position], enter: null };
      if (!alreadyThere) {
        plan = planRoute(player, nav, resolved.target);
        if (!plan.route) return reject(plan.reason === 'stranded' ? 'stranded' : 'unreachable');
      }
      next = finish(world, next, 'cancelled', null, events);
      if (alreadyThere) {
        next = { ...next, movement: stopMovement(next, nav, revision), activity: resolved.activity };
        next = startPerforming(world, next, events);
      } else {
        next = { ...next, activity: resolved.activity, movement: movementFor(plan as { route: readonly Position[]; enter: string | null }, next, revision) };
        events.push({ type: 'player.activity-started', tick, activity: resolved.activity.kind, phase: 'travelling', buildingId: resolved.activity.buildingId, citizenId: resolved.activity.citizenId });
      }
      return { state: withPlayer(world, next), events, reason: null };
    }
    default:
      return reject('invalid-command');
  }
}

function updateNeeds(player: PlayerCharacter, world: WorldState, minutes: number, walking: boolean, events: SimulationEvent[]): PlayerNeeds {
  const b = PLAYER_BALANCE, a = player.activity, n = player.needs;
  const performing = a.phase === 'performing' ? a.kind : null;
  const starving = n.hunger < b.thresholds.critical;
  let energy = -b.decay.energy * (starving ? b.starvingEnergyFactor : 1) - (walking ? b.walkingEnergy : 0);
  let hunger = -b.decay.hunger, social = -b.decay.social, moodBonus = 0;
  switch (performing) {
    case 'rest': energy = b.activities.rest.energy; hunger *= b.activities.rest.hungerDecayFactor; moodBonus = b.activities.rest.mood; break;
    case 'eat': hunger = b.activities.eat.hunger; moodBonus = b.activities.eat.mood; break;
    case 'visit': {
      const others = a.buildingId ? visitorCount(world, a.buildingId) : 0;
      social = b.activities.visit.social + Math.min(b.activities.visit.maxVisitorBonus, others * b.activities.visit.socialPerVisitor);
      moodBonus = b.activities.visit.mood; break;
    }
    case 'greet': social = b.activities.greet.social; moodBonus = b.activities.greet.mood; break;
    case 'socialize': social = b.activities.socialize.social * (n.mood < b.thresholds.critical ? 0.75 : 1); moodBonus = b.activities.socialize.mood; break;
    default: break;
  }
  const next = { energy: clamp(n.energy + energy * minutes), hunger: clamp(n.hunger + hunger * minutes), social: clamp(n.social + social * minutes), mood: n.mood };
  const critical = (['energy', 'hunger', 'social'] as const).filter((k) => next[k] < b.thresholds.critical).length;
  const target = Math.max(0, Math.min(100, (next.energy + next.hunger + next.social) / 3 + moodBonus - critical * b.mood.criticalPenalty));
  const step = b.mood.rate * minutes;
  next.mood = clamp(Math.abs(target - n.mood) <= step ? target : n.mood + Math.sign(target - n.mood) * step);
  for (const need of NEEDS) {
    const before = needLevel(n[need]), after = needLevel(next[need]);
    if (before !== after) events.push({ type: 'player.need-changed', tick: world.clock.tick, need, level: after, previous: before, value: next[need] });
  }
  return next;
}

/** One fixed tick for the player: re-route, walk, perform, and update needs. Bounded to one route search. */
export function advancePlayer(world: WorldState, nav: RoadNavigator): Change {
  let player = world.player;
  if (!player) return { state: world, events: [] };
  const events: SimulationEvent[] = [], tick = world.clock.tick, revision = world.revision, minutes = world.clock.minutesPerTick;
  const citizen = player.activity.citizenId ? world.citizens.find((c) => c.id === player!.activity.citizenId) : undefined;
  if (player.activity.citizenId && !citizen) player = { ...finish(world, player, 'failed', 'citizen-left', events), movement: stopMovement(player, nav, revision) };
  const walkStart = player.position;

  if (player.activity.phase === 'travelling') {
    const social = player.activity.kind === 'greet' || player.activity.kind === 'socialize';
    if (social && citizen && inConversationRange(player, citizen, nav, PLAYER_LIMITS.interactionRange)) {
      player = startPerforming(world, { ...player, movement: stopMovement(player, nav, revision) }, events);
    } else {
      let replan = player.movement.status !== 'travelling' || player.movement.plannedRevision !== revision;
      let target: { building?: Building; enter?: boolean; goals?: readonly Position[] } | null = null;
      if (social && citizen) {
        const meeting = meetingPoint(citizen, nav);
        if (meeting.type === 'unavailable') {
          player = { ...finish(world, player, 'failed', 'citizen-unavailable', events), movement: stopMovement(player, nav, revision) };
        } else {
          target = meeting.type === 'venue' ? { building: meeting.building, enter: true } : { goals: meeting.goals };
          const goal = player.movement.route.at(-1);
          if (meeting.type === 'street' && goal && distance(goal, meeting.at) > PLAYER_LIMITS.retargetDistance) replan = true;
        }
      } else if (player.activity.tile) target = { goals: [player.activity.tile] };
      else {
        const building = nav.getBuilding(player.activity.buildingId);
        if (!building) player = { ...finish(world, player, 'failed', player.activity.kind === 'rest' || player.activity.kind === 'eat' ? 'home-lost' : 'venue-removed', events), movement: stopMovement(player, nav, revision) };
        else target = { building, enter: canEnter(player, building, player.activity.kind) };
      }
      if (target && replan && player.activity.phase === 'travelling') {
        const plan = planRoute(player, nav, target);
        if (!plan.route) {
          events.push({ type: 'player.route-blocked', tick, reason: plan.reason === 'search-limit' ? 'search-limit' : 'unreachable' });
          player = { ...finish(world, player, 'failed', plan.reason === 'stranded' ? 'route-lost' : 'unreachable', events), movement: stopMovement(player, nav, revision) };
        } else player = { ...player, movement: movementFor(plan, player, revision) };
      }
      if (player.activity.phase === 'travelling' && player.movement.status === 'travelling') {
        const m = player.movement;
        let budget = PLAYER_BALANCE.walkingSpeed * minutes * (player.needs.energy < PLAYER_BALANCE.thresholds.critical ? PLAYER_BALANCE.exhaustedSpeedFactor : 1);
        let index = m.nextWaypoint, position = player.position, heading = m.heading;
        while (index < m.route.length && budget > 0) {
          const next = m.route[index]!, dx = next.x - position.x, dy = next.y - position.y;
          const length = Math.abs(dx) + Math.abs(dy); heading = { x: Math.sign(dx), y: Math.sign(dy) };
          if (length <= budget + 1e-12) { position = next; budget = Math.max(0, budget - length); index += 1; }
          else { position = { x: position.x + heading.x * budget, y: position.y + heading.y * budget }; budget = 0; }
        }
        const cell = nav.grid.get(tileOf(position));
        const currentBuildingId = cell?.type === 'building' && (cell.buildingId === m.destinationBuildingId || cell.buildingId === m.currentBuildingId) ? cell.buildingId : null;
        player = { ...player, position, movement: { ...m, nextWaypoint: index, heading, currentBuildingId } };
        if (index >= m.route.length) player = arrive(world, player, nav, events);
      } else if (player.activity.phase === 'travelling' && target !== null && player.movement.plannedRevision === revision) {
        // A fresh plan with nothing left to walk (already at the door or inside).
        player = arrive(world, player, nav, events);
      }
    }
  } else if (player.activity.phase === 'performing') {
    player = perform(world, player, citizen, nav, minutes, events);
  }

  const walking = player.position.x !== walkStart.x || player.position.y !== walkStart.y;
  player = { ...player, needs: updateNeeds(player, world, minutes, walking, events) };
  return { state: withPlayer(world, player), events };
}

function arrive(world: WorldState, player: PlayerCharacter, nav: RoadNavigator, events: SimulationEvent[]): PlayerCharacter {
  const revision = world.revision, m = player.movement;
  const entered = m.destinationBuildingId ? nav.getBuilding(m.destinationBuildingId) : undefined;
  let next: PlayerCharacter;
  if (entered) next = { ...player, position: buildingCenter(entered), movement: insideMovement(entered.id, revision) };
  else if (m.status === 'inside') next = player;
  else {
    const cell = nav.grid.get(tileOf(player.position));
    next = { ...player, movement: standing(cell?.type === 'building' ? cell.buildingId : null, revision) };
  }
  events.push({ type: 'player.arrived', tick: world.clock.tick, buildingId: entered?.id ?? null, position: next.position });
  const kind = next.activity.kind;
  if (kind === 'move') return finish(world, next, 'completed', null, events);
  if (kind === 'visit' && entered && visitorCount(world, entered.id) >= entered.capacity) return finish(world, next, 'failed', 'venue-full', events);
  if (kind === 'greet' || kind === 'socialize') {
    const citizen = world.citizens.find((c) => c.id === next.activity.citizenId);
    if (!citizen) return finish(world, next, 'failed', 'citizen-left', events);
    // Still walking towards a moving resident: route again next tick.
    if (!inConversationRange(next, citizen, nav, PLAYER_LIMITS.interactionRange)) return { ...next, movement: { ...next.movement, plannedRevision: -1 } };
  }
  return startPerforming(world, next, events);
}

function perform(world: WorldState, player: PlayerCharacter, citizen: Citizen | undefined, nav: RoadNavigator, minutes: number, events: SimulationEvent[]): PlayerCharacter {
  const a = player.activity;
  if (a.kind === 'greet' || a.kind === 'socialize') {
    if (!citizen || !inConversationRange(player, citizen, nav, PLAYER_LIMITS.interactionBreakRange)) {
      // Residents keep their own schedule; leaving ends the conversation with whatever was gained so far.
      return finish(world, player, 'failed', 'citizen-left', events);
    }
  } else if (a.buildingId) {
    const venue = nav.getBuilding(a.buildingId);
    const inside = player.movement.status === 'inside' && player.movement.currentBuildingId === a.buildingId;
    if (!venue || !inside) return finish(world, player, 'failed', a.kind === 'rest' || a.kind === 'eat' ? 'home-lost' : 'venue-removed', events);
    if ((a.kind === 'rest' || a.kind === 'eat') && venue.id !== player.homeBuildingId) return finish(world, player, 'failed', 'home-lost', events);
  }
  const elapsed = Math.min(a.durationMinutes, a.elapsedMinutes + minutes);
  const next = { ...player, activity: { ...a, elapsedMinutes: elapsed } };
  return elapsed >= a.durationMinutes ? finish(world, next, 'completed', null, events) : next;
}

/**
 * Keeps the player consistent after structural city changes (commands, undo/redo, population changes).
 * Clears dangling references, re-routes on the next tick and relocates only when the ground under the player vanished.
 */
export function reconcilePlayer(world: WorldState, previous: WorldState | undefined): Change {
  let player = world.player;
  if (!player) return { state: world, events: [] };
  const events: SimulationEvent[] = [], tick = world.clock.tick, revision = world.revision;
  const nav = new RoadNavigator(world.plan);
  const before = new Map((previous?.plan.buildings ?? world.plan.buildings).map((b) => [b.id, b]));
  const citizens = new Set(world.citizens.map((c) => c.id));
  if (player.homeBuildingId !== null && nav.getBuilding(player.homeBuildingId)?.kind !== 'home') {
    events.push({ type: 'player.home-lost', tick, buildingId: player.homeBuildingId });
    player = { ...player, homeBuildingId: null };
  }
  if (player.acquaintances.some((id) => !citizens.has(id))) player = { ...player, acquaintances: player.acquaintances.filter((id) => citizens.has(id)) };
  const planChanged = previous !== undefined && previous.plan !== world.plan;
  const relocate = (reason: 'building-removed' | 'building-moved' | 'road-removed') => {
    const road = nav.nearestRoad(player!.position, PLAYER_LIMITS.relocationRadius);
    const position = road ? { x: road.x + 0.5, y: road.y + 0.5 } : player!.position;
    events.push({ type: 'player.relocated', tick, position, reason, stranded: road === null });
    player = { ...player!, position, movement: standing(null, revision) };
  };
  const m = player.movement;
  const current = m.currentBuildingId === null ? undefined : nav.getBuilding(m.currentBuildingId);
  const old = m.currentBuildingId === null ? undefined : before.get(m.currentBuildingId);
  if (m.currentBuildingId !== null && !current) relocate('building-removed');
  else if (current && old && (old.position.x !== current.position.x || old.position.y !== current.position.y) && containsPosition(old, player.position)) {
    if (m.status === 'inside' || player.activity.phase === 'performing') {
      player = { ...player, position: buildingCenter(current), movement: insideMovement(current.id, revision) };
      events.push({ type: 'player.relocated', tick, position: player.position, reason: 'building-moved', stranded: false });
    } else relocate('building-moved');
  } else if (planChanged && m.status !== 'inside') {
    const cell = nav.grid.get(tileOf(player.position));
    const onGround = cell?.type === 'road' || cell?.type === 'building' && cell.buildingId === m.currentBuildingId;
    if (!onGround && previous && new RoadNavigator(previous.plan).grid.get(tileOf(player.position))?.type === 'road') relocate('road-removed');
    else if (m.status === 'travelling') player = { ...player, movement: { ...m, status: 'standing', route: [], nextWaypoint: 0, heading: STILL, plannedRevision: -1,
      currentBuildingId: cell?.type === 'building' ? cell.buildingId : null, destinationBuildingId: null } };
  }
  // A plan change invalidates any route; travelling activities re-route on the next tick.
  if (planChanged && player.movement.status === 'travelling') player = { ...player, movement: { ...player.movement, status: 'standing', route: [], nextWaypoint: 0, heading: STILL, plannedRevision: -1, destinationBuildingId: null } };
  const a = player.activity;
  if (a.kind !== 'idle') {
    const venueGone = a.buildingId !== null && !nav.getBuilding(a.buildingId);
    const homeGone = (a.kind === 'rest' || a.kind === 'eat') && a.buildingId !== player.homeBuildingId;
    const citizenGone = a.citizenId !== null && !citizens.has(a.citizenId);
    const performingElsewhere = a.phase === 'performing' && a.buildingId !== null && !(player.movement.status === 'inside' && player.movement.currentBuildingId === a.buildingId);
    const reason: PlayerFailureReason | null = citizenGone ? 'citizen-left' : homeGone ? 'home-lost' : venueGone ? 'venue-removed' : performingElsewhere ? 'venue-removed' : null;
    if (reason) player = finish(world, player, 'failed', reason, events);
  }
  return { state: withPlayer(world, player), events };
}

/** Structural validation for saves and snapshots; called from validateWorld. */
export function validatePlayer(world: WorldState, assert: (condition: boolean, message: string) => asserts condition): void {
  const p = world.player;
  if (p === undefined) return;
  const plan = world.plan;
  const byId = new Map(plan.buildings.map((b) => [b.id, b]));
  const inPlan = (q: Position) => Number.isFinite(q.x) && Number.isFinite(q.y) && q.x >= 0 && q.y >= 0 && q.x < plan.width && q.y < plan.height;
  assert(p.version === 1 && p.id === PLAYER_ID, 'invalid player identity');
  assert(normalizePlayerName(p.name) === p.name, 'invalid player name');
  assert(isPlayerAppearance(p.appearance), 'invalid player appearance');
  assert(p.homeBuildingId === null || byId.get(p.homeBuildingId)?.kind === 'home', 'player references an invalid home');
  if (p.homeBuildingId !== null && world.population) {
    const residents = world.citizens.filter((c) => c.homeBuildingId === p.homeBuildingId).length;
    assert(residents + 1 <= byId.get(p.homeBuildingId)!.capacity, 'player home exceeds housing capacity');
  }
  assert(inPlan(p.position), 'player position must be inside the plan');
  assert(Number.isSafeInteger(p.createdTick) && p.createdTick >= 0 && p.createdTick <= world.clock.tick, 'invalid player creation tick');
  for (const need of NEEDS) assert(Number.isFinite(p.needs[need]) && p.needs[need] >= 0 && p.needs[need] <= 100, 'player needs must be in [0, 100]');
  const citizenIds = new Set(world.citizens.map((c) => c.id));
  assert(Array.isArray(p.acquaintances) && p.acquaintances.length <= PLAYER_LIMITS.acquaintances && new Set(p.acquaintances).size === p.acquaintances.length &&
    p.acquaintances.every((id) => citizenIds.has(id)), 'invalid player acquaintances');
  const a = p.activity;
  const kinds: readonly PlayerActivityKind[] = ['idle', 'move', 'rest', 'eat', 'visit', 'greet', 'socialize'];
  assert(kinds.includes(a.kind) && ['idle', 'travelling', 'performing'].includes(a.phase), 'invalid player activity');
  assert((a.kind === 'idle') === (a.phase === 'idle'), 'idle activity must have an idle phase');
  assert(a.buildingId === null || byId.has(a.buildingId), 'player activity references an unknown building');
  assert(a.citizenId === null || citizenIds.has(a.citizenId), 'player activity references an unknown resident');
  assert(a.tile === null || Number.isSafeInteger(a.tile.x) && Number.isSafeInteger(a.tile.y) && inPlan(a.tile), 'invalid player destination tile');
  assert(Number.isFinite(a.durationMinutes) && a.durationMinutes >= 0 && Number.isFinite(a.elapsedMinutes) && a.elapsedMinutes >= 0 && a.elapsedMinutes <= a.durationMinutes, 'invalid player activity progress');
  assert(a.kind === 'idle' || a.kind === 'move' ? a.durationMinutes === 0 : a.durationMinutes === PLAYER_BALANCE.activities[a.kind].minutes, 'player activity duration does not match its definition');
  assert((a.kind !== 'greet' && a.kind !== 'socialize') || a.citizenId !== null, 'social activity needs a resident');
  const m = p.movement;
  assert(['inside', 'travelling', 'standing'].includes(m.status), 'invalid player movement');
  assert(m.currentBuildingId === null || byId.has(m.currentBuildingId), 'player movement references an unknown building');
  assert(m.destinationBuildingId === null || byId.has(m.destinationBuildingId), 'player movement references an unknown destination');
  assert([m.heading.x, m.heading.y].every((v) => v === 0 || v === 1 || v === -1) && Math.abs(m.heading.x) + Math.abs(m.heading.y) <= 1, 'invalid player heading');
  assert(Number.isSafeInteger(m.plannedRevision) && m.plannedRevision >= -1 && m.plannedRevision <= world.revision, 'invalid player route revision');
  assert(Array.isArray(m.route) && m.route.length <= NPC_LIMITS.searchNodes + 8 && m.route.every(inPlan), 'invalid player route');
  assert(Number.isSafeInteger(m.nextWaypoint) && m.nextWaypoint >= 0 && m.nextWaypoint <= m.route.length, 'invalid player route cursor');
  assert(m.status === 'travelling' || m.route.length === 0 && m.nextWaypoint === 0, 'stationary player cannot retain a route');
  if (m.status === 'inside') {
    const b = m.currentBuildingId === null ? undefined : byId.get(m.currentBuildingId);
    assert(b !== undefined && containsPosition(b, p.position) && (b.id === p.homeBuildingId || providesLeisure(b)), 'player can only be inside their home or a public venue');
  } else {
    // Standing or walking: the ground under the player is a road, the building whose entrance leg they use, or open
    // ground only after a city edit left them stranded with no road nearby.
    const cellBuilding = plan.buildings.find((b) => containsPosition(b, p.position));
    assert(!cellBuilding || cellBuilding.id === m.currentBuildingId || cellBuilding.id === m.destinationBuildingId, 'player stands inside a building they are not using');
  }
  if (m.status === 'travelling') {
    assert(a.phase === 'travelling' && m.route.length > 0 && m.nextWaypoint > 0 && m.nextWaypoint < m.route.length && m.plannedRevision === world.revision, 'invalid active player route');
    assert(m.destinationBuildingId === null || byId.get(m.destinationBuildingId)!.id === p.homeBuildingId || providesLeisure(byId.get(m.destinationBuildingId)!), 'player route enters a private building');
    const roads = new Set(plan.roads.map((t) => `${t.x},${t.y}`));
    let from = p.position;
    for (const to of m.route.slice(m.nextWaypoint)) {
      assert(from.x === to.x || from.y === to.y, 'player route contains a diagonal shortcut');
      const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y), samples = Math.ceil(length * 2);
      for (let i = 0; i <= samples; i += 1) {
        const t = samples === 0 ? 0 : i / samples;
        const q = { x: Math.floor(from.x + (to.x - from.x) * t), y: Math.floor(from.y + (to.y - from.y) * t) };
        const building = plan.buildings.find((b) => containsPosition(b, q));
        assert(roads.has(`${q.x},${q.y}`) || building !== undefined && (building.id === m.currentBuildingId || building.id === m.destinationBuildingId), 'player route crosses a non-walkable tile');
      }
      from = to;
    }
  }
  if (p.lastOutcome !== null) {
    const o = p.lastOutcome;
    assert(kinds.includes(o.kind) && ['completed', 'cancelled', 'failed'].includes(o.result) && Number.isSafeInteger(o.tick) && o.tick >= 0 && o.tick <= world.clock.tick &&
      Number.isFinite(o.elapsedMinutes) && o.elapsedMinutes >= 0, 'invalid player outcome');
  }
}

export function clonePlayer(p: PlayerCharacter): PlayerCharacter {
  const pos = (q: Position) => ({ x: q.x, y: q.y });
  return {
    version: p.version, id: p.id, name: p.name,
    appearance: { skinTone: p.appearance.skinTone, hairStyle: p.appearance.hairStyle, hairColor: p.appearance.hairColor,
      outfit: p.appearance.outfit, outfitColor: p.appearance.outfitColor, accessory: p.appearance.accessory },
    homeBuildingId: p.homeBuildingId, position: pos(p.position),
    movement: { status: p.movement.status, heading: pos(p.movement.heading), currentBuildingId: p.movement.currentBuildingId,
      destinationBuildingId: p.movement.destinationBuildingId, route: p.movement.route.map(pos), nextWaypoint: p.movement.nextWaypoint,
      plannedRevision: p.movement.plannedRevision },
    activity: { kind: p.activity.kind, phase: p.activity.phase, buildingId: p.activity.buildingId, citizenId: p.activity.citizenId,
      tile: p.activity.tile === null ? null : pos(p.activity.tile), durationMinutes: p.activity.durationMinutes, elapsedMinutes: p.activity.elapsedMinutes },
    needs: { energy: p.needs.energy, hunger: p.needs.hunger, social: p.needs.social, mood: p.needs.mood },
    acquaintances: [...p.acquaintances], createdTick: p.createdTick,
    lastOutcome: p.lastOutcome === null ? null : { ...p.lastOutcome },
  };
}

/** What the player can do right now, with honest reasons; used by the Life HUD. */
export interface PlayerActionAvailability {
  readonly action: PlayerActionKind | 'go-home' | 'cancel';
  readonly available: boolean;
  readonly reason: LifeRejectionReason | null;
}

export function playerActionAvailability(world: WorldState, nav: RoadNavigator, citizenId?: string): readonly PlayerActionAvailability[] {
  const player = world.player;
  if (!player) return [];
  const check = (action: PlayerActionKind | 'go-home', command: LifeCommand): PlayerActionAvailability => {
    const result = applyLifeCommand(world, command, nav);
    return { action, available: result.reason === null, reason: result.reason };
  };
  const list: PlayerActionAvailability[] = [];
  const atHome = player.movement.status === 'inside' && player.movement.currentBuildingId === player.homeBuildingId && player.homeBuildingId !== null;
  list.push(atHome ? { action: 'go-home', available: false, reason: 'already-home' } :
    player.homeBuildingId ? check('go-home', { type: 'player.move-to', destination: { type: 'building', buildingId: player.homeBuildingId } }) :
      { action: 'go-home', available: false, reason: 'no-home' });
  list.push(check('rest', { type: 'player.start-activity', activity: 'rest' }));
  list.push(check('eat', { type: 'player.start-activity', activity: 'eat' }));
  list.push(check('visit', { type: 'player.start-activity', activity: 'visit' }));
  if (citizenId) {
    list.push(check('greet', { type: 'player.start-activity', activity: 'greet', citizenId }));
    list.push(check('socialize', { type: 'player.start-activity', activity: 'socialize', citizenId }));
  }
  const busy = player.activity.kind !== 'idle' || player.movement.status === 'travelling';
  list.push({ action: 'cancel', available: busy, reason: busy ? null : 'nothing-to-cancel' });
  return list;
}
