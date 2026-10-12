import { describe, expect, it } from 'vitest';
import {
  BUILDING_CATALOG, containsPosition, createWorld, deserializeWorld, housingSummary, playerHomeOptions, providesLeisure,
  serializeWorld, Simulation, validateWorld,
} from '../src/index.js';
import type { BuildingType, CityCommand, CitySnapshot, LifeCommand, PlayerAppearance, Position, WorldState } from '../src/index.js';
import { npcBuilding } from './npcFixture.js';

const look: PlayerAppearance = { skinTone: 1, hairStyle: 'bun', hairColor: 2, outfit: 'jacket', outfitColor: 3, accessory: 'scarf' };
const TYPES = Object.keys(BUILDING_CATALOG) as BuildingType[];

/** Small deterministic PRNG for scenario generation (independent of the simulation's own RNG). */
function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)), pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]! };
}

/** A grid of streets with homes, jobs and two parks: enough structure for commutes and leisure. */
function neighbourhood(seed = 'audit'): WorldState {
  const roads: Position[] = [];
  for (let x = 1; x < 39; x += 1) { roads.push({ x, y: 4 }, { x, y: 12 }); }
  for (let y = 5; y < 12; y += 1) roads.push({ x: 1, y }, { x: 20, y });
  return createWorld({ id: 'audit', seed, startingFunds: 50_000, clock: { paused: true },
    plan: { id: 'audit-plan', name: 'Audit', width: 40, height: 22, blockedTiles: [], roads, buildings: [
      npcBuilding('villa-a', 'villa', 2, 5), npcBuilding('villa-b', 'villa', 5, 5), npcBuilding('town-a', 'townhouse', 8, 5),
      npcBuilding('apt-a', 'apartment', 12, 5), npcBuilding('park-a', 'park', 21, 5), npcBuilding('office-a', 'office', 26, 5),
      npcBuilding('mall-a', 'mall', 2, 13), npcBuilding('park-b', 'park', 30, 13), npcBuilding('club-a', 'clubhouse', 10, 13),
    ] } });
}

/** Occupied rooms = assigned residents + the housed player. Never derived from where sprites happen to stand. */
function occupied(world: WorldState, homeId: string): number {
  return world.citizens.filter((c) => c.homeBuildingId === homeId).length + (world.player?.homeBuildingId === homeId ? 1 : 0);
}

/** Invariants beyond `validateWorld` that every gameplay system relies on. */
function checkInvariants(world: WorldState, label: string) {
  expect(() => validateWorld(world), label).not.toThrow();
  const byId = new Map(world.plan.buildings.map((b) => [b.id, b]));
  for (const b of world.plan.buildings.filter((entry) => entry.kind === 'home')) expect(occupied(world, b.id), `${label}: ${b.id} over capacity`).toBeLessThanOrEqual(b.capacity);
  // Home options, the housing summary and the raw state agree, and the player is counted exactly once.
  const options = playerHomeOptions(world);
  for (const o of options) {
    expect(o.residents, `${label}: ${o.buildingId} residents`).toBe(world.citizens.filter((c) => c.homeBuildingId === o.buildingId).length);
    expect(o.occupied, `${label}: ${o.buildingId} occupied`).toBe(occupied(world, o.buildingId));
    expect(o.freeRooms).toBe(Math.max(0, o.capacity - o.occupied));
    expect(o.available, `${label}: ${o.buildingId} availability`).toBe(!o.current && o.occupied < o.capacity);
  }
  const summary = housingSummary(world);
  expect(summary.freeRooms, `${label}: free rooms`).toBe(options.reduce((sum, o) => sum + o.freeRooms, 0));
  // A walking resident is on a road or on the entrance leg of the building it is leaving or entering.
  for (const c of world.citizens) {
    const m = c.movement;
    if (!m || m.status === 'inside') continue;
    const under = world.plan.buildings.find((b) => containsPosition(b, c.position));
    expect(!under || under.id === m.currentBuildingId || under.id === m.destinationBuildingId, `${label}: ${c.id} stands inside ${under?.id}`).toBe(true);
  }
  // Visitors only fill public venues, within capacity.
  const visitors = new Map<string, number>();
  for (const c of world.citizens) if (c.activity === 'leisure' && c.movement?.status === 'inside' && c.movement.currentBuildingId) visitors.set(c.movement.currentBuildingId, (visitors.get(c.movement.currentBuildingId) ?? 0) + 1);
  for (const [id, count] of visitors) { const b = byId.get(id)!; expect(providesLeisure(b)).toBe(true); expect(count).toBeLessThanOrEqual(b.capacity); }
}

type Step =
  | { kind: 'city'; command: CityCommand } | { kind: 'batch'; commands: CityCommand[] } | { kind: 'tick'; steps: number }
  | { kind: 'undo' } | { kind: 'save-load' } | { kind: 'life'; command: LifeCommand };

function randomStep(world: WorldState, r: ReturnType<typeof prng>): Step {
  const roll = r.next();
  const position = () => ({ x: r.int(0, world.plan.width - 4), y: r.int(0, world.plan.height - 4) });
  const building = () => world.plan.buildings.length ? r.pick(world.plan.buildings) : undefined;
  const road = () => world.plan.roads.length ? r.pick(world.plan.roads) : { x: 0, y: 0 };
  const cityCommand = (): CityCommand => {
    const kind = r.next();
    const target = building();
    if (kind < 0.4 || !target) return { type: 'city.build', buildingType: r.pick(TYPES), position: position() };
    if (kind < 0.6) return { type: 'city.demolish', buildingId: target.id };
    if (kind < 0.8) return { type: 'city.move-building', buildingId: target.id, position: position() };
    return r.next() < 0.5 ? { type: 'city.edit-roads', add: [], remove: [road()] } : { type: 'city.edit-roads', add: [position()], remove: [] };
  };
  if (roll < 0.25) return { kind: 'city', command: cityCommand() };
  if (roll < 0.32) return { kind: 'batch', commands: [cityCommand(), cityCommand()] };
  if (roll < 0.6) return { kind: 'tick', steps: r.int(1, 90) };
  if (roll < 0.68) return { kind: 'undo' };
  if (roll < 0.74) return { kind: 'save-load' };
  const home = world.plan.buildings.filter((b) => b.kind === 'home');
  const lifeRoll = r.next();
  if (!world.player) return { kind: 'life', command: { type: 'player.create', name: 'Mai', appearance: look, ...(r.next() < 0.5 && home.length ? { homeBuildingId: r.pick(home).id } : {}) } };
  if (lifeRoll < 0.3 && home.length) return { kind: 'life', command: { type: 'player.move-in', homeBuildingId: r.pick(home).id } };
  if (lifeRoll < 0.6) return { kind: 'life', command: { type: 'player.move-to', destination: { type: 'tile', position: road() } } };
  if (lifeRoll < 0.75) return { kind: 'life', command: { type: 'player.start-activity', activity: r.pick(['rest', 'eat', 'visit'] as const) } };
  if (lifeRoll < 0.85 && world.citizens.length) return { kind: 'life', command: { type: 'player.start-activity', activity: 'greet', citizenId: r.pick(world.citizens).id } };
  return { kind: 'life', command: { type: 'player.cancel' } };
}

/** Runs one scenario the way the frontend does: snapshots for undo, serialized saves, one simulation instance. */
function runScenario(seed: number, length: number, onStep?: (world: WorldState, step: Step, before: WorldState, index: number) => void) {
  const r = prng(seed);
  let sim = new Simulation(neighbourhood(`seed-${seed}`));
  sim.enablePopulation({ maxCitizens: 1000 });
  const history: CitySnapshot[] = [];
  const steps: Step[] = [];
  for (let i = 0; i < length; i += 1) {
    const before = sim.getState();
    const step = randomStep(before, r);
    steps.push(step);
    switch (step.kind) {
      case 'city': { const snapshot = sim.getCitySnapshot(); if (sim.execute(step.command).applied) history.push(snapshot); break; }
      case 'batch': { const snapshot = sim.getCitySnapshot(); if (sim.executeBatch(step.commands).applied) history.push(snapshot); break; }
      case 'tick': sim.step(step.steps); break;
      case 'undo': { const snapshot = history.pop(); if (snapshot) sim.restoreCity(snapshot); break; }
      case 'save-load': sim = new Simulation(deserializeWorld(serializeWorld(sim.getState()))); break;
      case 'life': sim.executeLife(step.command); break;
    }
    onStep?.(sim.getState(), step, before, i);
  }
  return { sim, steps };
}

describe('Phase 4.5 world invariants under random city, AI, history, save and Life sequences', () => {
  // AUDIT_SEEDS / AUDIT_STEPS widen the sweep locally (the Phase 4.5 audit ran 60 × 400); CI keeps the default.
  const seeds = Number(process.env.AUDIT_SEEDS ?? 8), length = Number(process.env.AUDIT_STEPS ?? 220);
  for (const seed of Array.from({ length: seeds }, (_, i) => i + 1)) {
    it(`holds every invariant after each step (seed ${seed})`, () => {
      runScenario(seed, length, (world, step, _before, index) => checkInvariants(world, `seed ${seed} step ${index} ${step.kind}`));
    });
  }

  it('is deterministic: identical seeds and commands give identical worlds', () => {
    const a = runScenario(11, 160).sim.getState(), b = runScenario(11, 160).sim.getState();
    expect(serializeWorld(a)).toBe(serializeWorld(b));
  });

  it('save/load is lossless: continuing after a reload matches continuing without one', () => {
    const { sim } = runScenario(12, 120);
    const reloaded = new Simulation(deserializeWorld(serializeWorld(sim.getState())));
    expect(serializeWorld(reloaded.getState())).toBe(serializeWorld(sim.getState()));
    sim.step(400); reloaded.step(400);
    expect(serializeWorld(reloaded.getState())).toBe(serializeWorld(sim.getState()));
  });

  it('city edits keep every still-valid home and job assignment', () => {
    runScenario(21, 200, (world, step, before, index) => {
      if (step.kind !== 'city' || before.plan === world.plan) return;
      const homes = new Map(world.plan.buildings.map((b) => [b.id, b]));
      const previous = new Map(before.plan.buildings.map((b) => [b.id, b]));
      const after = new Map(world.citizens.map((c) => [c.id, c]));
      for (const c of before.citizens) {
        const home = homes.get(c.homeBuildingId);
        // A home that still exists with the same capacity keeps its residents.
        if (home && previous.get(c.homeBuildingId)?.capacity === home.capacity) {
          expect(after.get(c.id)?.homeBuildingId, `step ${index}: ${c.id} lost a valid home`).toBe(c.homeBuildingId);
        }
        if (c.workBuildingId && homes.has(c.workBuildingId) && after.has(c.id)) {
          expect(after.get(c.id)!.workBuildingId, `step ${index}: ${c.id} lost a valid job`).toBe(c.workBuildingId);
        }
      }
    });
  });
});

describe('Phase 4.5 confirmed bug regressions', () => {
  it('a city edit while a resident walks out of work toward a venue neither crashes nor puts them "at leisure" inside the workplace', () => {
    // Mall workers leave at ~17:00 for the clubhouse; stop the first one still on the mall's entrance leg.
    const sim = new Simulation(createWorld({ id: 'leg', seed: 'leg', startingFunds: 10_000, clock: { paused: true },
      plan: { id: 'leg-plan', name: 'Leg', width: 40, height: 20, blockedTiles: [], roads: Array.from({ length: 36 }, (_, i) => ({ x: i + 1, y: 5 })),
        buildings: [npcBuilding('apt', 'apartment', 2, 6), npcBuilding('mall', 'mall', 10, 6), npcBuilding('club', 'clubhouse', 20, 6)] } }));
    sim.enablePopulation({ maxCitizens: 1000 });
    let walker: string | undefined;
    for (let i = 0; i < 2000 && !walker; i += 1) {
      sim.step(1);
      walker = sim.getState().citizens.find((c) => c.movement?.status === 'travelling' && c.movement.currentBuildingId === 'mall' && c.movement.destinationBuildingId === 'club')?.id;
    }
    expect(walker).toBeDefined();
    // Any plan change reconciles movement; before the fix this threw "invalid leisure destination role".
    const result = sim.execute({ type: 'city.edit-roads', add: [{ x: 38, y: 5 }], remove: [] });
    expect(result.applied).toBe(true);
    const c = sim.getState().citizens.find((entry) => entry.id === walker)!;
    expect(c.activity).not.toBe('leisure');
    expect(c.movement!.status === 'inside' ? c.activity : 'stopped').toMatch(/^(work|stopped)$/);
    checkInvariants(sim.getState(), 'after edit');
    sim.step(60);
    checkInvariants(sim.getState(), 'after resuming');
  });

  it('a resident whose road tile is removed mid-walk steps to the nearest road and still arrives (never stuck on grass)', () => {
    const roads = [...Array.from({ length: 25 }, (_, i) => ({ x: i + 2, y: 5 })), ...Array.from({ length: 25 }, (_, i) => ({ x: i + 2, y: 4 }))];
    const sim = new Simulation(createWorld({ id: 'strand', seed: 'strand', startingFunds: 10_000, clock: { paused: true },
      plan: { id: 'strand-plan', name: 'Two streets', width: 32, height: 20, blockedTiles: [], roads,
        buildings: [npcBuilding('home', 'villa', 2, 6), npcBuilding('office', 'office', 20, 6)] } }));
    sim.enablePopulation({ maxCitizens: 1000 });
    let walker: string | undefined, tile: Position | undefined;
    for (let i = 0; i < 2000 && !walker; i += 1) {
      sim.step(1);
      const c = sim.getState().citizens.find((entry) => entry.movement?.status === 'travelling' && entry.position.y > 5 - 1e-9 && entry.position.y < 6 &&
        entry.position.x > 8 && entry.position.x < 16 && entry.movement.destinationBuildingId === 'office');
      if (c) { walker = c.id; tile = { x: Math.floor(c.position.x), y: 5 }; }
    }
    expect(walker).toBeDefined();
    expect(sim.execute({ type: 'city.edit-roads', add: [], remove: [tile!] }).applied).toBe(true);
    checkInvariants(sim.getState(), 'after removal');
    let arrived = false;
    for (let i = 0; i < 600 && !arrived; i += 1) {
      sim.step(1);
      const c = sim.getState().citizens.find((entry) => entry.id === walker)!;
      arrived = c.movement!.status === 'inside' && c.movement!.currentBuildingId === 'office';
    }
    expect(arrived).toBe(true);
  });

  it('a building restored by undo on top of a walking resident does not trap them inside it', () => {
    const roads = Array.from({ length: 30 }, (_, i) => ({ x: i + 1, y: 5 }));
    const sim = new Simulation(createWorld({ id: 'undo', seed: 'undo', startingFunds: 10_000, clock: { paused: true },
      plan: { id: 'undo-plan', name: 'Undo', width: 36, height: 20, blockedTiles: [], roads,
        buildings: [npcBuilding('home', 'villa', 2, 6), npcBuilding('office', 'office', 24, 6), npcBuilding('shop', 'townhouse', 12, 6)] } }));
    sim.enablePopulation({ maxCitizens: 1000 });
    // Demolish the townhouse, pave its lot as a shortcut street, let a resident walk onto it, then undo both edits.
    const before = sim.getCitySnapshot();
    sim.execute({ type: 'city.demolish', buildingId: 'shop' });
    const paved = Array.from({ length: 3 }, (_, i) => ({ x: 13, y: 6 + i }));
    const afterDemolish = sim.getCitySnapshot();
    expect(sim.execute({ type: 'city.edit-roads', add: paved, remove: [] }).applied).toBe(true);
    // Put a resident on the new street (as if walking there) through the public relocate command.
    const id = sim.getState().citizens[0]!.id;
    sim.enqueue({ type: 'citizen.relocate', citizenId: id, position: { x: 13.5, y: 7.5 } });
    sim.step(1);
    sim.restoreCity(afterDemolish);
    checkInvariants(sim.getState(), 'after undoing the street');
    sim.restoreCity(before);
    checkInvariants(sim.getState(), 'after undoing the demolition');
    sim.step(600);
    checkInvariants(sim.getState(), 'after resuming');
  });
});
