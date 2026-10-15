import { describe, expect, it } from 'vitest';
import {
  applyCityCommandBatch, createWorld, deserializeWorld, PLAYER_BALANCE, playerActionAvailability, playerHomeOptions, RoadNavigator,
  serializeWorld, Simulation, validateWorld,
} from '../src/index.js';
import type { LifeCommand, PlayerAppearance, SimulationEvent, WorldState } from '../src/index.js';
import { npcBuilding } from './npcFixture.js';

const look: PlayerAppearance = { skinTone: 2, hairStyle: 'curly', hairColor: 3, outfit: 'overalls', outfitColor: 4, accessory: 'backpack' };
const create = (homeBuildingId = 'villa', name = 'Linh Tran'): LifeCommand => ({ type: 'player.create', name, appearance: look, homeBuildingId });

/** Road along y=5 (x 2..26); villa, apartment, park, office and a second villa all touch it. */
function lifeWorld(options: { population?: boolean; disconnected?: boolean } = {}): WorldState {
  return createWorld({ id: 'life-world', seed: 'life', startingFunds: 10_000, clock: { paused: true },
    ...(options.population ? { population: { maxCitizens: 1000 } } : {}),
    plan: { id: 'life-plan', name: 'Life street', width: 32, height: 20, blockedTiles: [],
      roads: Array.from({ length: 25 }, (_, i) => ({ x: i + 2, y: 5 })).filter((p) => !options.disconnected || p.x !== 15),
      buildings: [npcBuilding('villa', 'villa', 2, 6), npcBuilding('flat', 'apartment', 5, 6), npcBuilding('park', 'park', 10, 6),
        npcBuilding('office', 'office', 20, 6), npcBuilding('villa-2', 'villa', 15, 6)] } });
}
function withPlayer(options: { population?: boolean; disconnected?: boolean; home?: string } = {}) {
  const sim = new Simulation(lifeWorld(options));
  const result = sim.executeLife(create(options.home ?? 'villa'));
  expect(result.reason).toBeNull();
  return sim;
}
/** Edits a serialized snapshot, re-validating it on load. */
function mutate(world: WorldState, edit: (raw: any) => void): WorldState {
  const raw = JSON.parse(serializeWorld(world));
  edit(raw);
  return deserializeWorld(JSON.stringify(raw));
}
function runUntil(sim: Simulation, done: (events: readonly SimulationEvent[]) => boolean, limit = 2000) {
  const all: SimulationEvent[] = [];
  for (let i = 0; i < limit; i += 1) {
    const events = sim.step().events;
    all.push(...events);
    if (done(events)) return all;
  }
  throw new Error('condition not reached');
}
const ended = (events: readonly SimulationEvent[]) => events.some((e) => e.type === 'player.activity-ended');
const valid = (sim: Simulation) => expect(() => validateWorld(sim.getState())).not.toThrow();

describe('player identity and character creation', () => {
  it('creates a typed, validated player inside the chosen home', () => {
    const sim = withPlayer();
    const player = sim.getPlayer()!;
    expect(player).toMatchObject({ id: 'player-1', name: 'Linh Tran', homeBuildingId: 'villa', appearance: look,
      movement: { status: 'inside', currentBuildingId: 'villa' }, activity: { kind: 'idle' }, needs: PLAYER_BALANCE.initialNeeds });
    expect(player.position).toEqual({ x: 3.5, y: 7.5 });
    valid(sim);
  });

  it('normalizes names and supports Vietnamese diacritics', () => {
    const sim = new Simulation(lifeWorld());
    expect(sim.executeLife(create('villa', '  Nguyễn Thị Mai  ')).reason).toBeNull();
    expect(sim.getPlayer()!.name).toBe('Nguyễn Thị Mai');
  });

  it.each(['', '   ', 'x'.repeat(25), '<script>', 'Two  spaces', '-dash', 42])('rejects invalid name %j', (name) => {
    const sim = new Simulation(lifeWorld()), before = sim.getState();
    const result = sim.executeLife({ type: 'player.create', name: name as string, appearance: look, homeBuildingId: 'villa' });
    expect(result.reason).toBe('invalid-name');
    expect(result.events).toEqual([{ type: 'player.command-rejected', tick: 0, commandType: 'player.create', reason: 'invalid-name' }]);
    expect(sim.getState()).toBe(before);
  });

  it.each([
    { ...look, skinTone: 6 }, { ...look, hairColor: -1 }, { ...look, outfitColor: 1.5 }, { ...look, hairStyle: 'mohawk' },
    { ...look, accessory: 'url(javascript:alert(1))' }, { ...look, extra: 'x' }, null,
  ])('rejects out-of-range or untrusted appearance %#', (appearance) => {
    const sim = new Simulation(lifeWorld());
    expect(sim.executeLife({ type: 'player.create', name: 'Mai', appearance: appearance as PlayerAppearance, homeBuildingId: 'villa' }).reason).toBe('invalid-appearance');
    expect(sim.getPlayer()).toBeUndefined();
  });

  it('allows only one player and re-customization later', () => {
    const sim = withPlayer();
    expect(sim.executeLife(create('flat')).reason).toBe('player-exists');
    const next = { ...look, hairStyle: 'bun' as const, outfitColor: 9 };
    expect(sim.executeLife({ type: 'player.customize', name: 'Linh', appearance: next }).reason).toBeNull();
    expect(sim.getPlayer()).toMatchObject({ name: 'Linh', appearance: next, homeBuildingId: 'villa' });
  });

  it('never creates a player automatically, including when loading or enabling residents', () => {
    const world = lifeWorld();
    expect(world.player).toBeUndefined();
    const sim = new Simulation(deserializeWorld(serializeWorld(world)));
    sim.enablePopulation();
    sim.step(60);
    expect(sim.getState().player).toBeUndefined();
    expect(serializeWorld(sim.getState())).not.toContain('player');
  });
});

describe('home and residency', () => {
  it('lists homes with real vacancy and rejects invalid homes', () => {
    const sim = new Simulation(lifeWorld({ population: true }));
    const options = playerHomeOptions(sim.getState());
    expect(options.map((o) => [o.buildingId, o.residents, o.capacity, o.available])).toEqual([
      ['villa', 2, 2, false], ['flat', 24, 24, false], ['villa-2', 2, 2, false]]);
    expect(sim.executeLife(create('villa')).reason).toBe('home-full');
    expect(sim.executeLife(create('office')).reason).toBe('not-a-home');
    expect(sim.executeLife(create('missing')).reason).toBe('home-not-found');
  });

  it('occupies exactly one housing slot that residents never fill or take back', () => {
    const sim = withPlayer();
    sim.enablePopulation();
    expect(sim.getBuildingOccupancy('villa').residentIds).toHaveLength(1);
    expect(sim.getBuildingOccupancy('villa-2').residentIds).toHaveLength(2);
    sim.step(30);
    expect(sim.getBuildingOccupancy('villa').residentIds).toHaveLength(1);
    valid(sim);
    // Demolishing the flat displaces residents, but none are moved into the player's slot.
    const before = sim.getState().citizens.length;
    sim.execute({ type: 'city.demolish', buildingId: 'flat' });
    expect(sim.getBuildingOccupancy('villa').residentIds).toHaveLength(1);
    expect(sim.getState().citizens.length).toBe(before - 24);
    valid(sim);
  });

  it('moves into another home with a vacancy as an explicit relocation', () => {
    const sim = withPlayer();
    expect(sim.executeLife({ type: 'player.move-in', homeBuildingId: 'villa' }).reason).toBe('already-home');
    const result = sim.executeLife({ type: 'player.move-in', homeBuildingId: 'flat' });
    expect(result.reason).toBeNull();
    expect(result.events).toContainEqual({ type: 'player.moved-in', tick: 0, homeBuildingId: 'flat', previousHomeBuildingId: 'villa' });
    expect(sim.getPlayer()).toMatchObject({ homeBuildingId: 'flat', movement: { status: 'inside', currentBuildingId: 'flat' } });
    sim.enablePopulation();
    expect(sim.getBuildingOccupancy('flat').residentIds).toHaveLength(23);
    expect(sim.getBuildingOccupancy('villa').residentIds).toHaveLength(2);
  });

  it('handles demolition of the home: home lost, relocated to the curb, activity failed', () => {
    const sim = withPlayer();
    sim.executeLife({ type: 'player.start-activity', activity: 'rest' });
    expect(sim.getPlayer()!.activity).toMatchObject({ kind: 'rest', phase: 'performing' });
    const result = sim.execute({ type: 'city.demolish', buildingId: 'villa' });
    const types = result.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['player.home-lost', 'player.relocated', 'player.activity-ended']));
    const player = sim.getPlayer()!;
    expect(player.homeBuildingId).toBeNull();
    expect(player.movement.status).toBe('standing');
    expect(sim.getNavigator().grid.get({ x: Math.floor(player.position.x), y: Math.floor(player.position.y) })?.type).toBe('road');
    expect(player.lastOutcome).toMatchObject({ kind: 'rest', result: 'failed', reason: 'home-lost' });
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'rest' }).reason).toBe('no-home');
    expect(sim.executeLife({ type: 'player.move-in', homeBuildingId: 'villa-2' }).reason).toBeNull();
    valid(sim);
  });

  it('follows a moved home while inside it', () => {
    const sim = withPlayer();
    const result = sim.execute({ type: 'city.move-building', buildingId: 'villa', position: { x: 23, y: 3 } });
    expect(result.applied).toBe(true);
    expect(sim.getPlayer()).toMatchObject({ position: { x: 24.5, y: 4.5 }, movement: { status: 'inside', currentBuildingId: 'villa' } });
    expect(result.events.some((e) => e.type === 'player.relocated' && e.reason === 'building-moved')).toBe(true);
    valid(sim);
  });
});

describe('needs', () => {
  it('decay deterministically per game minute and stay bounded', () => {
    const sim = withPlayer();
    sim.step(60);
    const { needs } = sim.getPlayer()!;
    const start = PLAYER_BALANCE.initialNeeds;
    expect(needs.energy).toBeCloseTo(start.energy - 60 * PLAYER_BALANCE.decay.energy, 6);
    expect(needs.hunger).toBeCloseTo(start.hunger - 60 * PLAYER_BALANCE.decay.hunger, 6);
    expect(needs.social).toBeCloseTo(start.social - 60 * PLAYER_BALANCE.decay.social, 6);
    sim.step(6000);
    for (const value of Object.values(sim.getPlayer()!.needs)) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(100); }
    expect(sim.getPlayer()!.needs).toMatchObject({ energy: 0, hunger: 0, social: 0 });
    valid(sim);
  });

  it('never progress while paused and match exactly at 1x, 2x and 4x', () => {
    const paused = withPlayer();
    const before = paused.getPlayer()!.needs;
    paused.advance(5000);
    expect(paused.getPlayer()!.needs).toEqual(before);
    const runs = [1, 2, 4].map((speed) => {
      const sim = withPlayer();
      sim.resume();
      for (let i = 0; i < 120 / speed; i += 1) sim.advance(100 * speed);
      return sim.getPlayer()!.needs;
    });
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it('emits level-change events and mood follows the other needs', () => {
    const sim = withPlayer();
    const events = runUntil(sim, (ev) => ev.some((e) => e.type === 'player.need-changed' && e.need === 'hunger' && e.level === 'low'));
    expect(events.filter((e) => e.type === 'player.need-changed').map((e) => e.type === 'player.need-changed' && `${e.need}:${e.level}`)).toContain('hunger:low');
    expect(sim.getPlayer()!.needs.mood).toBeLessThan(PLAYER_BALANCE.initialNeeds.mood);
  });

  it('exhaustion blocks socializing and visits but not resting', () => {
    const tired = new Simulation(mutate(withPlayer({ population: false }).getState(), (raw) => { raw.player.needs.energy = 5; }));
    expect(tired.executeLife({ type: 'player.start-activity', activity: 'visit' }).reason).toBe('too-tired');
    expect(tired.executeLife({ type: 'player.start-activity', activity: 'rest' }).reason).toBeNull();
  });
});

describe('navigation', () => {
  it('walks progressively along roads to a clicked tile and completes', () => {
    const sim = withPlayer();
    const result = sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 12, y: 5 } } });
    expect(result.reason).toBeNull();
    expect(sim.getPlayer()!.movement.status).toBe('travelling');
    const nav = new RoadNavigator(sim.getState().plan);
    const events = runUntil(sim, (ev) => {
      const p = sim.getPlayer()!;
      const cell = nav.grid.get({ x: Math.floor(p.position.x), y: Math.floor(p.position.y) });
      // Never through grass or another building: only the road or the player's own home.
      expect(cell?.type === 'road' || cell?.type === 'building' && cell.buildingId === 'villa').toBe(true);
      return ended(ev);
    });
    expect(events.some((e) => e.type === 'player.arrived')).toBe(true);
    expect(sim.getPlayer()).toMatchObject({ position: { x: 12.5, y: 5.5 }, movement: { status: 'standing' }, lastOutcome: { kind: 'move', result: 'completed' } });
    valid(sim);
  });

  it('rejects grass, out-of-bounds and disconnected destinations with actionable reasons', () => {
    const sim = withPlayer({ disconnected: true });
    const move = (x: number, y: number) => sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x, y } } }).reason;
    expect(move(1, 1)).toBe('invalid-destination');
    expect(move(99, 1)).toBe('invalid-destination');
    expect(move(20, 5)).toBe('unreachable');
    expect(sim.executeLife({ type: 'player.move-to', destination: { type: 'building', buildingId: 'nope' } }).reason).toBe('building-not-found');
    expect(sim.getPlayer()!.activity.kind).toBe('idle');
  });

  it('stops on the curb outside private buildings and enters only the home', () => {
    const sim = withPlayer();
    sim.executeLife({ type: 'player.move-to', destination: { type: 'building', buildingId: 'office' } });
    runUntil(sim, ended);
    const p = sim.getPlayer()!;
    expect(p.movement.status).toBe('standing');
    expect(p.position.y).toBe(5.5);
    sim.executeLife({ type: 'player.move-to', destination: { type: 'building', buildingId: 'villa' } });
    runUntil(sim, ended);
    expect(sim.getPlayer()!.movement).toMatchObject({ status: 'inside', currentBuildingId: 'villa' });
  });

  it('cancels and replaces movement deterministically', () => {
    const sim = withPlayer();
    sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 24, y: 5 } } });
    sim.step(10);
    const midway = sim.getPlayer()!.position;
    const replaced = sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 4, y: 5 } } });
    expect(replaced.events[0]).toMatchObject({ type: 'player.activity-ended', outcome: { kind: 'move', result: 'cancelled' } });
    expect(sim.getPlayer()!.position).toEqual(midway);
    sim.step(3);
    const cancelled = sim.executeLife({ type: 'player.cancel' });
    expect(cancelled.reason).toBeNull();
    const stopped = sim.getPlayer()!;
    expect(stopped.movement.status).toBe('standing');
    sim.step(20);
    expect(sim.getPlayer()!.position).toEqual(stopped.position);
    expect(sim.executeLife({ type: 'player.cancel' }).reason).toBe('nothing-to-cancel');
    valid(sim);
  });

  it('re-routes after road edits and recovers when the road under the player is removed', () => {
    const sim = withPlayer();
    sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 24, y: 5 } } });
    sim.step(8);
    // Detour-free removal ahead of the player: the route becomes unreachable and the move fails clearly.
    const cut = sim.execute({ type: 'city.edit-roads', add: [], remove: [{ x: 18, y: 5 }] });
    expect(cut.applied).toBe(true);
    expect(sim.getPlayer()!.movement).toMatchObject({ status: 'standing', plannedRevision: -1 });
    const blocked = runUntil(sim, ended, 5);
    expect(blocked.some((e) => e.type === 'player.route-blocked')).toBe(true);
    expect(sim.getPlayer()!.lastOutcome).toMatchObject({ result: 'failed', reason: 'unreachable' });
    // Removing the tile under the player relocates them to the nearest curb.
    const here = sim.getPlayer()!.position;
    const removed = sim.execute({ type: 'city.edit-roads', add: [], remove: [{ x: Math.floor(here.x), y: Math.floor(here.y) }] });
    expect(removed.events.some((e) => e.type === 'player.relocated' && e.reason === 'road-removed' && !e.stranded)).toBe(true);
    valid(sim);
  });

  it('reports stranded players and lets them recover by moving in', () => {
    const sim = withPlayer();
    sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 2, y: 5 } } });
    runUntil(sim, ended);
    const roads = sim.getState().plan.roads;
    const result = sim.execute({ type: 'city.edit-roads', add: [], remove: roads.map((t) => ({ ...t })) });
    expect(result.events.some((e) => e.type === 'player.relocated' && e.stranded)).toBe(true);
    expect(sim.executeLife({ type: 'player.move-to', destination: { type: 'building', buildingId: 'park' } }).reason).toBe('stranded');
    expect(sim.executeLife({ type: 'player.move-in', homeBuildingId: 'villa-2' }).reason).toBeNull();
    valid(sim);
  });

  it('walks slower when exhausted', () => {
    const fresh = withPlayer();
    const tired = new Simulation(mutate(withPlayer().getState(), (raw) => { raw.player.needs.energy = 5; }));
    for (const sim of [fresh, tired]) { sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 24, y: 5 } } }); sim.step(10); }
    expect(tired.getPlayer()!.position.x).toBeLessThan(fresh.getPlayer()!.position.x);
  });
});

describe('activities', () => {
  it('rest travels home first, then performs for a fixed duration with gradual effects', () => {
    const sim = withPlayer();
    sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 12, y: 5 } } });
    runUntil(sim, ended);
    const start = sim.executeLife({ type: 'player.start-activity', activity: 'rest' });
    expect(start.events).toContainEqual(expect.objectContaining({ type: 'player.activity-started', activity: 'rest', phase: 'travelling' }));
    runUntil(sim, (ev) => ev.some((e) => e.type === 'player.activity-started' && e.phase === 'performing'));
    const energy = sim.getPlayer()!.needs.energy;
    sim.step(10);
    expect(sim.getPlayer()!.needs.energy).toBeCloseTo(energy + 10 * PLAYER_BALANCE.activities.rest.energy, 6);
    expect(sim.getPlayer()!.activity.elapsedMinutes).toBe(10);
    runUntil(sim, ended);
    expect(sim.getPlayer()!.lastOutcome).toMatchObject({ kind: 'rest', result: 'completed', elapsedMinutes: 120 });
    valid(sim);
  });

  it('keeps partial gains when an activity is cancelled', () => {
    const sim = withPlayer();
    sim.executeLife({ type: 'player.start-activity', activity: 'eat' });
    sim.step(10);
    const hunger = sim.getPlayer()!.needs.hunger;
    expect(hunger).toBeCloseTo(PLAYER_BALANCE.initialNeeds.hunger + 10 * PLAYER_BALANCE.activities.eat.hunger, 6);
    expect(sim.executeLife({ type: 'player.cancel' }).events[0]).toMatchObject({ outcome: { kind: 'eat', result: 'cancelled', elapsedMinutes: 10 } });
    expect(sim.getPlayer()!.needs.hunger).toBe(hunger);
    expect(sim.getPlayer()!.movement.status).toBe('inside');
  });

  it('visits the nearest reachable park and leaves the player there', () => {
    const sim = withPlayer();
    const result = sim.executeLife({ type: 'player.start-activity', activity: 'visit' });
    expect(result.reason).toBeNull();
    expect(sim.getPlayer()!.activity).toMatchObject({ kind: 'visit', buildingId: 'park' });
    runUntil(sim, ended);
    expect(sim.getPlayer()).toMatchObject({ movement: { status: 'inside', currentBuildingId: 'park' }, lastOutcome: { kind: 'visit', result: 'completed' } });
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'visit', buildingId: 'office' }).reason).toBe('not-leisure');
    valid(sim);
  });

  it('respects venue capacity using real resident visitors', () => {
    const world = createWorld({ id: 'busy', seed: 'busy', startingFunds: 1000, clock: { paused: true }, population: { maxCitizens: 1000 },
      plan: { id: 'busy-plan', name: 'Busy', width: 32, height: 20, blockedTiles: [], roads: Array.from({ length: 25 }, (_, i) => ({ x: i + 2, y: 5 })),
        buildings: [npcBuilding('flat', 'apartment', 2, 6), npcBuilding('park', 'park', 10, 6), npcBuilding('villa', 'villa', 16, 6)] } });
    const sim = new Simulation(world);
    for (const c of sim.getState().citizens) sim.enqueue({ type: 'citizen.set-schedule', citizenId: c.id, schedule: { entries: [{ startMinute: 0, activity: 'leisure', targetBuildingId: 'park' }] } });
    sim.step(80);
    expect(sim.getBuildingOccupancy('park').visitorIds).toHaveLength(20);
    // The villa's two slots are full too; free one by moving the player in only where capacity allows.
    expect(sim.executeLife(create('villa')).reason).toBe('home-full');
    const empty = new Simulation(mutate(sim.getState(), (raw) => { raw.citizens = raw.citizens.filter((c: { homeBuildingId: string }) => c.homeBuildingId !== 'villa'); }));
    expect(empty.executeLife(create('villa')).reason).toBeNull();
    expect(empty.executeLife({ type: 'player.start-activity', activity: 'visit', buildingId: 'park' }).reason).toBe('venue-full');
    expect(empty.executeLife({ type: 'player.start-activity', activity: 'visit' }).reason).toBe('venue-full');
  });

  it('reports when the city has no venue at all', () => {
    const sim = withPlayer();
    sim.execute({ type: 'city.demolish', buildingId: 'park' });
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'visit' }).reason).toBe('no-venue');
  });
});

describe('resident interactions', () => {
  /** Player plus residents; npc-1 is placed on the street and idles there. */
  function social() {
    const sim = withPlayer({ home: 'villa-2' });
    sim.enablePopulation();
    const npc = sim.getState().citizens.find((c) => c.homeBuildingId === 'flat')!;
    sim.enqueue({ type: 'citizen.set-schedule', citizenId: npc.id, schedule: { entries: [{ startMinute: 0, activity: 'idle', targetBuildingId: null }] } });
    sim.enqueue({ type: 'citizen.relocate', citizenId: npc.id, position: { x: 9.5, y: 5.5 } });
    sim.step();
    return { sim, npc: sim.getCitizen(npc.id)! };
  }

  it('approaches a real resident, greets them and remembers the first meeting', () => {
    const { sim, npc } = social();
    expect(npc.movement!.status).toBe('waiting');
    const result = sim.executeLife({ type: 'player.start-activity', activity: 'greet', citizenId: npc.id });
    expect(result.reason).toBeNull();
    const events = runUntil(sim, ended);
    const interaction = events.find((e) => e.type === 'player.interaction');
    expect(interaction).toMatchObject({ citizenId: npc.id, kind: 'greet', topic: 'introduction', firstMeeting: true });
    expect(sim.getPlayer()!.acquaintances).toEqual([npc.id]);
    expect(sim.getPlayer()!.lastOutcome).toMatchObject({ kind: 'greet', result: 'completed' });
    // The resident's own state and schedule were never touched by the player.
    expect(sim.getCitizen(npc.id)!.schedule).toEqual(npc.schedule);
    expect(sim.getCitizen(npc.id)!.position).toEqual(npc.position);
    const again = sim.executeLife({ type: 'player.start-activity', activity: 'socialize', citizenId: npc.id });
    expect(again.events).toContainEqual(expect.objectContaining({ type: 'player.interaction', firstMeeting: false, topic: 'neighbourhood' }));
    const social0 = sim.getPlayer()!.needs.social;
    sim.step(10);
    expect(sim.getPlayer()!.needs.social).toBeCloseTo(social0 + 10 * PLAYER_BALANCE.activities.socialize.social, 6);
    valid(sim);
  });

  it('cannot interrupt residents inside private buildings', () => {
    const sim = withPlayer({ home: 'villa-2' });
    sim.enablePopulation();
    const homebody = sim.getState().citizens.find((c) => c.movement!.status === 'inside')!;
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'greet', citizenId: homebody.id }).reason).toBe('citizen-unavailable');
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'greet', citizenId: 'npc-999' }).reason).toBe('citizen-not-found');
  });

  it('ends the conversation when the resident walks away on their own schedule', () => {
    const { sim, npc } = social();
    sim.executeLife({ type: 'player.start-activity', activity: 'socialize', citizenId: npc.id });
    runUntil(sim, (ev) => ev.some((e) => e.type === 'player.interaction'));
    sim.enqueue({ type: 'citizen.set-schedule', citizenId: npc.id, schedule: { entries: [{ startMinute: 0, activity: 'work', targetBuildingId: null }] } });
    const events = runUntil(sim, ended, 200);
    const end = events.find((e) => e.type === 'player.activity-ended');
    expect(end).toMatchObject({ outcome: { kind: 'socialize', result: 'failed', reason: 'citizen-left' } });
    expect(sim.getCitizen(npc.id)!.activity === 'travel' || sim.getCitizen(npc.id)!.movement!.status === 'inside').toBe(true);
  });

  it('fails cleanly when the resident leaves the city mid-approach', () => {
    const { sim, npc } = social();
    sim.executeLife({ type: 'player.start-activity', activity: 'greet', citizenId: npc.id });
    const result = sim.execute({ type: 'city.demolish', buildingId: 'flat' });
    expect(result.events.some((e) => e.type === 'citizen.removed' && e.citizenId === npc.id)).toBe(true);
    expect(sim.getPlayer()!.lastOutcome).toMatchObject({ kind: 'greet', result: 'failed', reason: 'citizen-left' });
    valid(sim);
  });

  it('offers honest per-action availability', () => {
    const { sim, npc } = social();
    const nav = sim.getNavigator();
    const list = playerActionAvailability(sim.getState(), nav, npc.id);
    expect(list.map((a) => [a.action, a.available, a.reason])).toEqual([
      ['go-home', false, 'already-home'], ['rest', true, null], ['eat', true, null], ['visit', true, null],
      ['greet', true, null], ['socialize', true, null], ['cancel', false, 'nothing-to-cancel']]);
  });
});

describe('integration, persistence and determinism', () => {
  it('AI-style previews never mutate the player', () => {
    const sim = withPlayer();
    sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 20, y: 5 } } });
    sim.step(5);
    const live = sim.getState();
    const preview = applyCityCommandBatch(live, [{ type: 'city.demolish', buildingId: 'villa' }, { type: 'city.edit-roads', add: [], remove: [{ x: 26, y: 5 }] }]);
    expect(preview.applied).toBe(true);
    expect(preview.state.player!.homeBuildingId).toBeNull();
    expect(sim.getState()).toBe(live);
    expect(sim.getPlayer()!.homeBuildingId).toBe('villa');
  });

  it('undo/redo restores the city without rewinding the player', () => {
    const sim = withPlayer();
    const snapshot = sim.getCitySnapshot();
    sim.execute({ type: 'city.build', buildingType: 'villa', position: { x: 23, y: 3 } });
    sim.executeLife({ type: 'player.start-activity', activity: 'eat' });
    sim.step(5);
    const player = sim.getPlayer()!;
    sim.restoreCity(snapshot);
    expect(sim.getPlayer()).toEqual(player);
    // Undoing the construction of the home itself clears the home and fails the meal honestly.
    const snap2 = sim.getCitySnapshot();
    sim.execute({ type: 'city.build', buildingType: 'villa', position: { x: 23, y: 3 } });
    const built = sim.getState().plan.buildings.at(-1)!.id;
    expect(sim.executeLife({ type: 'player.move-in', homeBuildingId: built }).reason).toBeNull();
    const undo = sim.restoreCity(snap2);
    expect(undo.events.map((e) => e.type)).toEqual(expect.arrayContaining(['city.restored', 'player.home-lost', 'player.relocated']));
    expect(sim.getPlayer()!.homeBuildingId).toBeNull();
    valid(sim);
  });

  it('survives save/load mid-route and continues exactly as an uninterrupted run', () => {
    const a = withPlayer({ population: false });
    a.enablePopulation();
    a.executeLife({ type: 'player.start-activity', activity: 'visit' });
    a.step(7);
    const restored = new Simulation(deserializeWorld(serializeWorld(a.getState())));
    expect(restored.getState()).toEqual(a.getState());
    a.step(150); restored.step(150);
    expect(serializeWorld(restored.getState())).toBe(serializeWorld(a.getState()));
  });

  it('is deterministic for identical command sequences', () => {
    const run = () => {
      const sim = withPlayer();
      sim.enablePopulation();
      sim.executeLife({ type: 'player.start-activity', activity: 'visit' });
      sim.step(90);
      sim.executeLife({ type: 'player.start-activity', activity: 'rest' });
      sim.step(200);
      return serializeWorld(sim.getState());
    };
    expect(run()).toBe(run());
  });

  it('rejects corrupted player snapshots', () => {
    const world = withPlayer().getState();
    const bad = [
      (raw: any) => { raw.player.name = ''; },
      (raw: any) => { raw.player.needs.energy = 150; },
      (raw: any) => { raw.player.homeBuildingId = 'office'; },
      (raw: any) => { raw.player.movement.currentBuildingId = 'office'; raw.player.position = { x: 21.5, y: 7.5 }; },
      (raw: any) => { raw.player.appearance.hairStyle = '<img>'; },
      (raw: any) => { raw.player.activity = { kind: 'rest', phase: 'performing', buildingId: 'villa', citizenId: null, tile: null, durationMinutes: 1, elapsedMinutes: 0 }; },
      (raw: any) => { raw.player.acquaintances = ['npc-404']; },
      (raw: any) => { raw.player.id = 'npc-1'; },
    ];
    for (const edit of bad) expect(() => mutate(world, edit)).toThrow(/Invalid world snapshot/);
  });
});

describe('direct control (Phase 8A player.walk)', () => {
  const walk = (x: number, y: number): LifeCommand => ({ type: 'player.walk', position: { x, y } });
  /** The life street plus a spur tile north of the road at (10, 4), for corner checks. */
  function spurSim() {
    const base = lifeWorld();
    const sim = new Simulation({ ...base, plan: { ...base.plan, roads: [...base.plan.roads, { x: 10, y: 4 }] } });
    expect(sim.executeLife(create()).reason).toBeNull();
    return sim;
  }

  it('steps out of the home through its door onto an access tile, then walks along the street', () => {
    const sim = withPlayer();
    expect(sim.executeLife(walk(6.5, 5.5)).reason).toBe('not-walkable');
    const out = sim.executeLife(walk(2.5, 5.3));
    expect(out.reason).toBeNull();
    expect(sim.getPlayer()).toMatchObject({ position: { x: 2.5, y: 5.3 }, movement: { status: 'standing', currentBuildingId: null, route: [] } });
    for (let x = 3.3; x <= 8.5; x += 0.8) expect(sim.executeLife(walk(Math.round(x * 10) / 10, 5.5)).reason).toBeNull();
    expect(sim.getPlayer()!.position).toEqual({ x: 8.1, y: 5.5 });
    valid(sim);
  });

  it('refuses long steps, open ground, other buildings and positions outside the map', () => {
    const sim = withPlayer();
    sim.executeLife(walk(3.5, 5.5));
    const before = sim.getState();
    expect(sim.executeLife(walk(4.8, 5.5)).reason).toBe('step-too-long');
    expect(sim.executeLife(walk(3.5, 4.6)).reason).toBe('not-walkable');
    expect(sim.executeLife(walk(4.0, 6.2)).reason).toBe('not-walkable');
    expect(sim.executeLife(walk(Number.NaN, 5.5)).reason).toBe('invalid-destination');
    expect(sim.executeLife(walk(-0.1, 5.5)).reason).toBe('invalid-destination');
    expect(sim.getState()).toBe(before);
  });

  it('never cuts a corner through a tile that is not walkable', () => {
    const sim = spurSim();
    sim.executeLife(walk(3.5, 5.1));
    for (const x of [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 9.9]) expect(sim.executeLife(walk(x, 5.1)).reason).toBeNull();
    // Crossing y = 5 at x = 9.95 enters the open tile (9, 4); crossing exactly through the corner (10, 5) also counts it.
    expect(sim.executeLife(walk(10.1, 4.85)).reason).toBe('not-walkable');
    expect(sim.executeLife(walk(10.1, 4.9)).reason).toBe('not-walkable');
    expect(sim.executeLife(walk(10.1, 4.95)).reason).toBeNull();
    expect(sim.getPlayer()!.position).toEqual({ x: 10.1, y: 4.95 });
    valid(sim);
  });

  it('replaces a route or an activity, like choosing a new destination', () => {
    const sim = withPlayer();
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'visit', buildingId: 'park' }).reason).toBeNull();
    sim.step(); sim.step();
    const p = sim.getPlayer()!;
    expect(p.movement.status).toBe('travelling');
    // Wherever the walk has got to (still on the home's entrance leg, or on the street), direct control takes over.
    const result = sim.executeLife(walk(p.position.x, p.position.y - 0.05));
    expect(result.reason).toBeNull();
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'player.activity-ended', outcome: expect.objectContaining({ kind: 'visit', result: 'cancelled' }) }));
    expect(sim.getPlayer()).toMatchObject({ activity: { kind: 'idle' }, movement: { status: 'standing', route: [] } });
    // Click-to-move still works from wherever direct control left the character.
    expect(sim.executeLife({ type: 'player.move-to', destination: { type: 'building', buildingId: 'park' } }).reason).toBeNull();
    valid(sim);
  });

  it('tires the character by the distance walked, and saves and replays exactly', () => {
    const run = () => {
      const sim = withPlayer();
      sim.executeLife(walk(2.5, 5.5));
      for (let i = 1; i <= 10; i += 1) { sim.executeLife(walk(2.5 + i * 0.9, 5.5)); sim.step(); }
      return sim;
    };
    const a = run(), b = run();
    expect(serializeWorld(a.getState())).toBe(serializeWorld(b.getState()));
    const reference = withPlayer();
    for (let i = 0; i < 10; i += 1) reference.step();
    const spent = reference.getPlayer()!.needs.energy - a.getPlayer()!.needs.energy;
    expect(spent).toBeCloseTo(9 * PLAYER_BALANCE.walkingEnergy / PLAYER_BALANCE.walkingSpeed, 3);
    const loaded = deserializeWorld(serializeWorld(a.getState()));
    expect(loaded.player).toEqual(a.getPlayer());
  });

  it('changes only the player: the rest of the world keeps its identity (no deep clone per step)', () => {
    const sim = withPlayer({ home: 'flat' });
    sim.enablePopulation();
    expect(sim.executeLife(walk(5.5, 5.5)).reason).toBeNull();
    const before = sim.getState();
    expect(sim.executeLife(walk(6.3, 5.5)).reason).toBeNull();
    const after = sim.getState();
    expect(after.citizens.length).toBeGreaterThan(0);
    expect(after).not.toBe(before);
    for (const key of Object.keys(after) as (keyof WorldState)[]) if (key !== 'player') expect(after[key]).toBe(before[key]);
    expect(Object.isFrozen(after.player)).toBe(true);
    expect(after.player!.position).toEqual({ x: 6.3, y: 5.5 });
    expect(deserializeWorld(serializeWorld(after))).toEqual(after);
    valid(sim);
  });

  it('needs a placed character', () => {
    const sim = new Simulation(lifeWorld());
    expect(sim.executeLife(walk(2.5, 5.5)).reason).toBe('player-not-found');
    sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    expect(sim.executeLife(walk(2.5, 5.5)).reason).toBe('not-placed');
  });
});
