import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/index.js';
import { cityFixture } from './cityFixture.js';

describe('authoritative city runner and history', () => {
  it('executes queued city commands FIFO on whole ticks and copies their inputs', () => {
    const simulation = new Simulation(cityFixture());
    const tile = { x: 3, y: 4 };
    simulation.enqueue({ type: 'city.edit-roads', add: [tile], remove: [] });
    simulation.enqueue({ type: 'city.build', buildingType: 'villa', position: { x: 4, y: 4 } });
    tile.x = 10;
    simulation.resume();
    expect(simulation.advance(99).events).toEqual([]);
    expect(simulation.pendingCommandCount).toBe(2);
    const result = simulation.advance(1);
    expect(result.state.plan.roads).toEqual([{ x: 3, y: 4 }]);
    expect(result.state.plan.buildings[0]?.id).toBe('building-1');
    expect(result.state.budget.balance).toBe(872);
    expect(result.events.filter((event) => event.type === 'city.building-built' || event.type === 'city.roads-edited').map((event) => event.type))
      .toEqual(['city.roads-edited', 'city.building-built']);
    expect(result.events.every((event) => event.tick === 1)).toBe(true);
    expect(simulation.pendingCommandCount).toBe(0);
  });

  it('rejects a queued edit and still processes later valid city and citizen commands', () => {
    const simulation = new Simulation(cityFixture());
    simulation.enqueue({ type: 'city.build', buildingType: 'villa', position: { x: 4, y: 4 } });
    simulation.enqueue({ type: 'city.edit-roads', add: [{ x: 3, y: 4 }], remove: [] });
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'missing', position: { x: 0, y: 0 } });
    const result = simulation.step();
    expect(result.events[0]).toMatchObject({ type: 'city.command-rejected', reason: 'road-required', tick: 1 });
    expect(result.state.plan.roads).toHaveLength(1);
    expect(result.state.budget.balance).toBe(992);
    expect(result.events).toContainEqual({ type: 'command.rejected', commandType: 'citizen.relocate', citizenId: 'missing', reason: 'citizen-not-found', tick: 1 });
  });

  it('applies atomic road/build batches and rolls back every effect when one command fails', () => {
    const simulation = new Simulation(cityFixture());
    const before = simulation.getState();
    const failed = simulation.executeBatch([
      { type: 'city.edit-roads', add: [{ x: 3, y: 4 }], remove: [] },
      { type: 'city.build', buildingType: 'villa', position: { x: 4, y: 4 } },
      { type: 'city.build', buildingType: 'park', position: { x: 4, y: 4 } },
    ]);
    expect(failed.applied).toBe(false);
    expect(failed.state).toBe(before);
    expect(failed.events).toEqual([{ type: 'city.command-rejected', commandType: 'city.build', reason: 'occupied-tile', tick: 0, commandIndex: 2 }]);
    const success = simulation.executeBatch([
      { type: 'city.edit-roads', add: [{ x: 3, y: 4 }], remove: [] },
      { type: 'city.build', buildingType: 'villa', position: { x: 4, y: 4 } },
    ]);
    expect(success.applied).toBe(true);
    expect(success.state.plan.buildings[0]?.id).toBe('building-1');
    expect(success.state.revision).toBe(2);
    expect(success.state.budget).toEqual({ openingBalance: 1000, balance: 872, totalSpent: 128 });
    expect(simulation.executeBatch([]).events).toEqual([]);
  });

  it('restores city snapshots without rewinding time, RNG, pending commands, or ID high-water marks', () => {
    const simulation = new Simulation(cityFixture({ roads: [{ x: 3, y: 4 }] }));
    const beforeBuild = simulation.getCitySnapshot();
    simulation.execute({ type: 'city.build', buildingType: 'villa', position: { x: 4, y: 4 } });
    const built = simulation.getCitySnapshot();
    simulation.step(5);
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'missing', position: { x: 0, y: 0 } });
    const beforeUndo = simulation.getState();
    const restored = simulation.restoreCity(beforeBuild);
    expect(restored.events[0]).toMatchObject({ type: 'city.restored', tick: 5 });
    expect(restored.state.budget.balance).toBe(1000);
    expect(restored.state.clock).toEqual(beforeUndo.clock);
    expect(restored.state.randomState).toBe(beforeUndo.randomState);
    expect(restored.state.nextBuildingId).toBe(2);
    expect(simulation.pendingCommandCount).toBe(1);
    expect(simulation.getOccupancyGrid().get({ x: 4, y: 4 })).toBeNull();
    simulation.restoreCity(built);
    expect(simulation.getState().budget.balance).toBe(880);
    simulation.restoreCity(beforeBuild);
    expect(simulation.execute({ type: 'city.build', buildingType: 'villa', position: { x: 4, y: 4 } }).state.plan.buildings[0]?.id).toBe('building-2');
  });

  it('rejects corrupt history snapshots atomically and prevents raw layout/cost bypass', () => {
    const simulation = new Simulation(cityFixture());
    const before = simulation.getState();
    const snapshot = simulation.getCitySnapshot();
    expect(() => simulation.restoreCity({ ...snapshot, budget: { ...snapshot.budget, balance: 0 } })).toThrow(/ledger/);
    expect(() => simulation.restoreCity({ ...snapshot, nextBuildingId: -1 })).toThrow(/cursor/);
    expect(() => simulation.replacePlan({ ...snapshot.plan, roads: [{ x: 0, y: 0 }] })).toThrow(/commands/);
    expect(simulation.getState()).toBe(before);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('keeps derived indexes stable over time-only ticks and refreshes them after restoration', () => {
    const simulation = new Simulation(cityFixture({ roads: [{ x: 0, y: 0 }] }));
    const grid = simulation.getOccupancyGrid();
    const graph = simulation.getRoadGraph();
    simulation.step(3);
    expect(simulation.getOccupancyGrid()).toBe(grid);
    expect(simulation.getRoadGraph()).toBe(graph);
    simulation.restoreCity(simulation.getCitySnapshot());
    expect(simulation.getOccupancyGrid()).not.toBe(grid);
    expect(simulation.getRoadGraph().getComponents()).toEqual(graph.getComponents());
  });
});
