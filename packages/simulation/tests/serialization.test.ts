import { describe, expect, it } from 'vitest';
import { deserializeWorld, serializeWorld, Simulation } from '../src/index.js';
import type { CityCommand, WorldState } from '../src/index.js';
import { createDemoWorldFixture } from '../src/fixtures.js';
import { cityFixture } from './cityFixture.js';

const commands: readonly CityCommand[] = [
  { type: 'city.edit-roads', add: [{ x: 3, y: 4 }, { x: 3, y: 5 }, { x: 2, y: 4 }], remove: [] },
  { type: 'city.build', buildingType: 'villa', position: { x: 4, y: 4 } },
  { type: 'city.build', buildingType: 'park', position: { x: 8, y: 8 } },
  { type: 'city.edit-roads', add: [], remove: [{ x: 2, y: 4 }] },
];

describe('Phase 1 deterministic serialization and restoration', () => {
  it('replays identical city commands into byte-identical world snapshots', () => {
    const a = new Simulation(cityFixture());
    const b = new Simulation(cityFixture());
    a.executeBatch(commands);
    for (const command of commands) b.execute(command);
    a.resume(); b.resume();
    a.advance(450);
    for (const delta of [17, 183, 249, 1]) b.advance(delta);
    expect(serializeWorld(a.getState())).toBe(serializeWorld(b.getState()));
  });

  it('roundtrips clock remainder, RNG, ledger, IDs, revision, order, and derived indexes', () => {
    const simulation = new Simulation(cityFixture());
    simulation.executeBatch(commands);
    simulation.resume();
    simulation.advance(1234);
    simulation.pause();
    const serialized = serializeWorld(simulation.getState());
    const restored = new Simulation(deserializeWorld(serialized));
    expect(restored.getState()).toEqual(simulation.getState());
    expect(serializeWorld(restored.getState())).toBe(serialized);
    expect(restored.getRoadGraph().getComponents()).toEqual(simulation.getRoadGraph().getComponents());
    expect(restored.getOccupancyGrid().get({ x: 4, y: 5 })).toEqual({ type: 'building', buildingId: 'building-1' });
    const next: CityCommand = { type: 'city.build', buildingType: 'park', position: { x: 0, y: 8 } };
    expect(restored.execute(next)).toEqual(simulation.execute(next));
    expect(restored.step()).toEqual(simulation.step());
  });

  it('canonicalizes object keys and excludes unknown fields and queued/runtime indexes', () => {
    const world = cityFixture();
    const reversed = Object.fromEntries(Object.entries(world).reverse()) as unknown as WorldState;
    expect(serializeWorld(reversed)).toBe(serializeWorld(world));
    const extra = { ...world, renderer: { texture: 'not-a-contract-field' } };
    expect(serializeWorld(extra)).toBe(serializeWorld(world));
    const simulation = new Simulation(world);
    simulation.enqueue({ type: 'city.edit-roads', add: [{ x: 0, y: 0 }], remove: [] });
    const restored = new Simulation(deserializeWorld(serializeWorld(simulation.getState())));
    expect(restored.pendingCommandCount).toBe(0);
  });

  it('migrates a Phase 0 world with editor roads/opening funds while preserving schedules and time', () => {
    const world = createDemoWorldFixture();
    const legacy = { schemaVersion: 1, id: world.id, clock: { ...world.clock, tick: 42, accumulatedMs: 25 },
      randomState: world.randomState, citizens: world.citizens,
      plan: { id: world.plan.id, name: world.plan.name, width: world.plan.width, height: world.plan.height, buildings: world.plan.buildings } };
    const migrated = deserializeWorld(JSON.stringify(legacy), { startingFunds: 321, roads: [{ x: 0, y: 0 }] });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.clock).toEqual(legacy.clock);
    expect(migrated.randomState).toBe(world.randomState);
    expect(migrated.citizens).toEqual(world.citizens);
    expect(migrated.plan.roads).toEqual([{ x: 0, y: 0 }]);
    expect(migrated.budget).toEqual({ openingBalance: 321, balance: 321, totalSpent: 0 });
    expect(migrated.plan.buildings[0]?.type).toBe('villa');
    expect(migrated.plan.buildings.find((building) => building.id === 'market')?.type).toBeUndefined();
  });

  it.each(['null', '{}', '{broken', '{"schemaVersion":99}'])('rejects unsupported or malformed snapshots %s', (serialized) => {
    expect(() => deserializeWorld(serialized)).toThrow(RangeError);
  });

  it('rejects corrupt budgets, overlaps, catalog footprints, clock values, and citizen references', () => {
    const world = cityFixture({ roads: [{ x: 0, y: 0 }] });
    expect(() => deserializeWorld(JSON.stringify({ ...world, budget: { ...world.budget, balance: -1 } }))).toThrow(/budget/);
    expect(() => deserializeWorld(JSON.stringify({ ...world, plan: { ...world.plan, roads: [{ x: 0, y: 0 }, { x: 0, y: 0 }] } }))).toThrow(/overlapping/);
    expect(() => deserializeWorld(JSON.stringify({ ...world, clock: { ...world.clock, tick: -1 } }))).toThrow(/tick/);
    const simulation = new Simulation(world);
    simulation.execute({ type: 'city.build', buildingType: 'park', position: { x: 4, y: 4 } });
    const built = simulation.getState();
    expect(() => deserializeWorld(JSON.stringify({ ...built, plan: { ...built.plan, buildings: [{ ...built.plan.buildings[0], footprint: { width: 1, height: 1 } }] } }))).toThrow(/catalog/);
    const demo = createDemoWorldFixture();
    expect(() => deserializeWorld(JSON.stringify({ ...demo, citizens: [{ ...demo.citizens[0], homeBuildingId: 'missing' }] }))).toThrow(/unknown home/);
  });
});
