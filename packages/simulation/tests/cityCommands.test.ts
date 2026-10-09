import { describe, expect, it } from 'vitest';
import { applyCityCommand, Simulation, validateBuildingPlacement, validateRoadPlacement } from '../src/index.js';
import type { BuildingType, CityCommand, CityRejectionReason, WorldState } from '../src/index.js';
import { createDemoWorldFixture } from '../src/fixtures.js';
import { cityFixture, testHome } from './cityFixture.js';

function rejected(world: WorldState, command: CityCommand, reason: CityRejectionReason) {
  const simulation = new Simulation(world);
  const before = simulation.getState();
  const result = simulation.execute(command);
  expect(result.applied).toBe(false);
  expect(result.state).toBe(before);
  expect(result.events).toEqual([{ type: 'city.command-rejected', tick: before.clock.tick, commandType: command.type, reason, commandIndex: 0 }]);
}

describe('building placement and demolition commands', () => {
  it('ignores client-supplied costs, IDs, and footprints in favor of the catalog', () => {
    const command = { type: 'city.build' as const, buildingType: 'park' as const, position: { x: 0, y: 0 },
      cost: 0, id: 'forged', footprint: { width: 1, height: 1 } };
    const result = new Simulation(cityFixture()).execute(command);
    expect(result.state.budget.totalSpent).toBe(80);
    expect(result.state.plan.buildings[0]).toMatchObject({ id: 'building-1', footprint: { width: 4, height: 4 } });
  });

  it('builds canonical entities, debits budget, and emits typed immutable events while paused', () => {
    const simulation = new Simulation(cityFixture({ roads: [{ x: 3, y: 4 }] }));
    const result = simulation.execute({ type: 'city.build', buildingType: 'villa', position: { x: 4, y: 4 } });
    expect(result.applied).toBe(true);
    expect(result.state.plan.buildings[0]).toEqual({ ...testHome, id: 'building-1', name: 'Villa 01' });
    expect(result.state.budget).toEqual({ openingBalance: 1000, balance: 880, totalSpent: 120 });
    expect(result.state.clock.tick).toBe(0);
    expect(result.state.clock.paused).toBe(true);
    expect(result.state.revision).toBe(1);
    expect(result.state.nextBuildingId).toBe(2);
    expect(result.events.map((event) => event.type)).toEqual(['city.building-built', 'city.budget-changed', 'city.road-network-changed']);
    expect(Object.isFrozen(result.state.plan.buildings[0]?.position)).toBe(true);
    expect(Object.isFrozen(result.events[0])).toBe(true);
  });

  it.each([{ x: 4, y: 3 }, { x: 4, y: 6 }, { x: 3, y: 4 }, { x: 6, y: 4 }])('accepts road contact on each footprint edge %j', (road) => {
    expect(validateBuildingPlacement(cityFixture({ roads: [road] }), 'villa', { x: 4, y: 4 }).valid).toBe(true);
  });

  it('rejects corner-only roads and requires access for both villas and clubhouses', () => {
    const world = cityFixture({ roads: [{ x: 3, y: 3 }] });
    for (const buildingType of ['villa', 'clubhouse'] as const) {
      rejected(world, { type: 'city.build', buildingType, position: { x: 4, y: 4 } }, 'road-required');
    }
    expect(new Simulation(world).execute({ type: 'city.build', buildingType: 'park', position: { x: 4, y: 4 } }).applied).toBe(true);
  });

  it.each([{ x: -1, y: 4 }, { x: 15, y: 4 }, { x: 4, y: 15 }])('validates the entire footprint at map boundary %j', (position) => {
    rejected(cityFixture(), { type: 'city.build', buildingType: 'park', position }, 'out-of-bounds');
  });

  it.each([{ x: 1.5, y: 0 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }])('rejects non-grid building position %j', (position) => {
    rejected(cityFixture(), { type: 'city.build', buildingType: 'park', position }, 'invalid-position');
  });

  it('rejects buildings, roads, and blocked tiles anywhere inside the proposed footprint', () => {
    rejected(cityFixture({ buildings: [testHome] }), { type: 'city.build', buildingType: 'park', position: { x: 2, y: 2 } }, 'occupied-tile');
    rejected(cityFixture({ roads: [{ x: 5, y: 5 }] }), { type: 'city.build', buildingType: 'park', position: { x: 2, y: 2 } }, 'occupied-tile');
    rejected(cityFixture({ blockedTiles: [{ x: 5, y: 5 }] }), { type: 'city.build', buildingType: 'park', position: { x: 2, y: 2 } }, 'blocked-tile');
  });

  it('checks funds, type, and names without consuming IDs or RNG', () => {
    rejected(cityFixture({ funds: 79 }), { type: 'city.build', buildingType: 'park', position: { x: 0, y: 0 } }, 'insufficient-funds');
    rejected(cityFixture(), { type: 'city.build', buildingType: 'unknown' as BuildingType, position: { x: 0, y: 0 } }, 'invalid-building-type');
    rejected(cityFixture(), { type: 'city.build', buildingType: 'park', position: { x: 0, y: 0 }, name: '   ' }, 'invalid-name');
    const simulation = new Simulation(cityFixture());
    const seed = simulation.getState().randomState;
    simulation.execute({ type: 'city.build', buildingType: 'park', position: { x: 15, y: 15 } });
    expect(simulation.execute({ type: 'city.build', buildingType: 'park', position: { x: 0, y: 0 }, name: ' Named park ' }).state.plan.buildings[0]?.id).toBe('building-1');
    expect(simulation.getState().plan.buildings[0]?.name).toBe('Named park');
    expect(simulation.getState().randomState).toBe(seed);
  });

  it('demolishes without refunds, releases all occupied tiles, and rejects missing/in-use buildings', () => {
    const simulation = new Simulation(cityFixture({ buildings: [testHome] }));
    const budget = simulation.getState().budget;
    const grid = simulation.getOccupancyGrid();
    const result = simulation.execute({ type: 'city.demolish', buildingId: testHome.id });
    expect(result.applied).toBe(true);
    expect(result.state.budget).toEqual(budget);
    expect(simulation.getOccupancyGrid()).not.toBe(grid);
    expect(simulation.getOccupancyGrid().get({ x: 4, y: 4 })).toBeNull();
    expect(result.events[0]).toMatchObject({ type: 'city.building-demolished', buildingId: testHome.id });
    rejected(cityFixture(), { type: 'city.demolish', buildingId: 'missing' }, 'building-not-found');
    rejected(createDemoWorldFixture(), { type: 'city.demolish', buildingId: 'home-maple' }, 'building-in-use');
  });

  it('supports deterministic IDs despite an imported ID collision and rejects counter exhaustion', () => {
    const simulation = new Simulation(cityFixture({ buildings: [{ ...testHome, id: 'building-1' }] }));
    expect(simulation.execute({ type: 'city.build', buildingType: 'park', position: { x: 8, y: 8 } }).state.plan.buildings.at(-1)?.id).toBe('building-2');
    rejected({ ...cityFixture(), nextBuildingId: Number.MAX_SAFE_INTEGER }, { type: 'city.build', buildingType: 'park', position: { x: 0, y: 0 } }, 'state-limit-reached');
    rejected({ ...cityFixture(), revision: Number.MAX_SAFE_INTEGER }, { type: 'city.build', buildingType: 'park', position: { x: 0, y: 0 } }, 'state-limit-reached');
  });
});

describe('road-edit commands', () => {
  it('adds roads with aggregate cost, removes them free, and rebuilds graph indexes', () => {
    const simulation = new Simulation(cityFixture({ roads: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }));
    const graph = simulation.getRoadGraph();
    expect(graph.getComponents()).toHaveLength(2);
    const add = simulation.execute({ type: 'city.edit-roads', add: [{ x: 1, y: 0 }, { x: 2, y: 1 }], remove: [] });
    expect(add.state.budget.balance).toBe(984);
    expect(simulation.getRoadGraph()).not.toBe(graph);
    expect(simulation.getRoadGraph().getComponents()).toHaveLength(1);
    expect(add.events).toContainEqual({ type: 'city.budget-changed', tick: 0, revision: 1, spent: 16, balance: 984 });
    const remove = simulation.execute({ type: 'city.edit-roads', add: [], remove: [{ x: 1, y: 0 }] });
    expect(remove.state.budget).toEqual(add.state.budget);
    expect(simulation.getRoadGraph().getComponents()).toHaveLength(2);
  });

  it('allows network disconnection and reports isolated buildings without NPC behavior', () => {
    const simulation = new Simulation(cityFixture({ buildings: [testHome], roads: [{ x: 3, y: 4 }] }));
    const result = simulation.execute({ type: 'city.edit-roads', add: [], remove: [{ x: 3, y: 4 }] });
    expect(result.applied).toBe(true);
    expect(result.events.at(-1)).toMatchObject({ type: 'city.road-network-changed', componentCount: 0, isolatedBuildingIds: [testHome.id] });
  });

  it('atomically rejects duplicates, conflicting edits, missing roads, and empty edits', () => {
    const world = cityFixture({ roads: [{ x: 0, y: 0 }] });
    rejected(world, { type: 'city.edit-roads', add: [{ x: 1, y: 0 }, { x: 1, y: 0 }], remove: [] }, 'duplicate-road-edit');
    rejected(world, { type: 'city.edit-roads', add: [], remove: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }, 'duplicate-road-edit');
    rejected(world, { type: 'city.edit-roads', add: [{ x: 0, y: 0 }], remove: [{ x: 0, y: 0 }] }, 'conflicting-road-edit');
    rejected(world, { type: 'city.edit-roads', add: [], remove: [{ x: 1, y: 0 }] }, 'road-not-found');
    rejected(world, { type: 'city.edit-roads', add: [], remove: [] }, 'empty-road-edit');
    rejected(world, { type: 'city.edit-roads', add: [{ x: 0, y: 0 }], remove: [] }, 'road-already-exists');
  });

  it('rejects overlaps, boundaries, blocked cells, and fractional road edits', () => {
    rejected(cityFixture({ buildings: [testHome] }), { type: 'city.edit-roads', add: [{ x: 4, y: 4 }], remove: [] }, 'occupied-tile');
    rejected(cityFixture({ blockedTiles: [{ x: 0, y: 0 }] }), { type: 'city.edit-roads', add: [{ x: 0, y: 0 }], remove: [] }, 'blocked-tile');
    rejected(cityFixture(), { type: 'city.edit-roads', add: [{ x: 16, y: 0 }], remove: [] }, 'out-of-bounds');
    rejected(cityFixture(), { type: 'city.edit-roads', add: [], remove: [{ x: -1, y: 0 }] }, 'out-of-bounds');
    rejected(cityFixture(), { type: 'city.edit-roads', add: [{ x: 0.5, y: 0 }], remove: [] }, 'invalid-position');
    expect(validateRoadPlacement(cityFixture({ funds: 0 }), { x: 0, y: 0 })).toEqual({ valid: false, reason: 'insufficient-funds' });
  });

  it('rejects an unaffordable aggregate edit without removing existing roads or spending funds', () => {
    rejected(cityFixture({ funds: 8, roads: [{ x: 0, y: 0 }] }), {
      type: 'city.edit-roads', add: [{ x: 1, y: 0 }, { x: 2, y: 0 }], remove: [{ x: 0, y: 0 }],
    }, 'insufficient-funds');
  });

  it('does not mutate unfrozen caller-owned preview data', () => {
    const world = JSON.parse(JSON.stringify(cityFixture())) as WorldState;
    const before = JSON.stringify(world);
    expect(applyCityCommand(world, { type: 'city.edit-roads', add: [{ x: 0, y: 0 }], remove: [] }).applied).toBe(true);
    expect(JSON.stringify(world)).toBe(before);
    expect(Object.isFrozen(world.plan)).toBe(false);
  });
});
