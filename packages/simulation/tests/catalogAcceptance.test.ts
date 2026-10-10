import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOG, CONSTRUCTION_COSTS, createWorld, deserializeWorld, footprintTiles,
  serializeWorld, Simulation, validateBuildingMove, validateBuildingPlacement } from '../src/index.js';
import type { BuildingType, CityCommand, CityRejectionReason, Position } from '../src/index.js';

const types = Object.keys(BUILDING_CATALOG) as BuildingType[];
function engine(funds = 5000) {
  return new Simulation(createWorld({ id: 'acceptance', startingFunds: funds, seed: 123,
    plan: { id: 'acceptance-plan', name: 'Acceptance', width: 32, height: 32,
      roads: Array.from({ length: 28 }, (_, x) => ({ x, y: 10 })), blockedTiles: [{ x: 31, y: 31 }], buildings: [] } }));
}

for (const type of types) describe(`${type} acceptance`, () => {
  const spec = BUILDING_CATALOG[type];
  const build: CityCommand = { type: 'city.build', buildingType: type, position: { x: 2, y: 11 } };

  it('derives the authoritative footprint, capacity, cost, ID and typed events', () => {
    const simulation = engine();
    const before = simulation.getCitySnapshot();
    const result = simulation.execute(build);
    expect(result.applied).toBe(true);
    const building = result.state.plan.buildings[0]!;
    expect(building).toMatchObject({ id: 'building-1', type, kind: spec.kind, capacity: spec.capacity, footprint: spec.footprint });
    expect(CONSTRUCTION_COSTS[type]).toBe(spec.cost);
    expect(result.state.budget.balance).toBe(5000 - spec.cost);
    expect(result.events.map((event) => event.type)).toEqual(['city.building-built', 'city.budget-changed', 'city.road-network-changed']);
    for (const tile of footprintTiles(building)) {
      expect(simulation.getOccupancyGrid().get(tile)).toEqual({ type: 'building', buildingId: building.id });
    }
    simulation.restoreCity(before);
    expect(simulation.getState().plan.buildings).toEqual([]);
    expect(simulation.getState().budget.balance).toBe(5000);
    const rebuilt = simulation.execute(build);
    expect(rebuilt.state.plan.buildings[0]?.id).toBe('building-2');
  });

  it.each<[string, Position, CityRejectionReason]>([
    ['map edge', { x: 31, y: 1 }, 'out-of-bounds'],
    ['road overlap', { x: 2, y: 10 }, 'occupied-tile'],
    ['blocked footprint corner', { x: 32 - spec.footprint.width, y: 32 - spec.footprint.height }, 'blocked-tile'],
  ])('rejects %s atomically', (_, position, reason) => {
    const simulation = engine();
    const before = simulation.getState();
    const result = simulation.execute({ ...build, position });
    expect(result.applied).toBe(false);
    expect(result.state).toBe(before);
    expect(result.events).toMatchObject([{ type: 'city.command-rejected', reason }]);
  });

  it('checks funds and the declared road requirement', () => {
    expect(validateBuildingPlacement(engine(spec.cost - 1).getState(), type, build.position))
      .toEqual({ valid: false, reason: 'insufficient-funds' });
    const isolated = validateBuildingPlacement(engine().getState(), type, { x: 20, y: 20 });
    expect(isolated).toEqual(spec.requiresRoad ? { valid: false, reason: 'road-required' } : { valid: true, cost: spec.cost });
  });

  it('moves without charging or changing identity; restores exact world and derived indexes', () => {
    const simulation = engine();
    simulation.execute(build);
    const beforeMove = simulation.getCitySnapshot();
    const original = simulation.getState().plan.buildings[0]!;
    const funds = simulation.getState().budget.balance;
    expect(validateBuildingMove(simulation.getState(), original.id, original.position))
      .toEqual({ valid: false, reason: 'unchanged-position' });
    const result = simulation.execute({ type: 'city.move-building', buildingId: original.id, position: { x: 15, y: 11 } });
    expect(result.applied).toBe(true);
    expect(result.state.budget.balance).toBe(funds);
    expect(result.state.nextBuildingId).toBe(2);
    expect(result.events[0]).toMatchObject({ type: 'city.building-moved', buildingId: original.id, from: original.position, to: { x: 15, y: 11 } });
    expect(simulation.getOccupancyGrid().get(original.position)).toBeNull();
    const saved = serializeWorld(simulation.getState());
    const restored = new Simulation(deserializeWorld(saved));
    expect(serializeWorld(restored.getState())).toBe(saved);
    expect(restored.getOccupancyGrid().get({ x: 15, y: 11 })).toEqual({ type: 'building', buildingId: original.id });
    expect(restored.getRoadGraph().getAdjacentComponents(restored.getState().plan.buildings[0]!)).toEqual(['0,10']);
    simulation.restoreCity(beforeMove);
    expect(simulation.getState().plan.buildings[0]).toEqual(original);
    const resultAfterUndo = simulation.execute({ type: 'city.demolish', buildingId: original.id });
    expect(resultAfterUndo.applied).toBe(true);
    expect(resultAfterUndo.state.budget.balance).toBe(funds);
    expect(resultAfterUndo.events[0]?.type).toBe('city.building-demolished');
    expect(simulation.getOccupancyGrid().get(original.position)).toBeNull();
  });
});

it('copies queued move positions, keeps citizen references, and rejects failed multi-edit batches', () => {
  const simulation = engine();
  simulation.execute({ type: 'city.build', buildingType: 'villa', position: { x: 2, y: 11 } });
  const world = simulation.getState();
  const withCitizen = new Simulation({ ...world, citizens: [{ id: 'resident', name: 'Resident', homeBuildingId: 'building-1',
    workBuildingId: null, targetBuildingId: 'building-1', activity: 'home', position: { x: 2, y: 11 },
    schedule: { entries: [{ startMinute: 0, activity: 'home', targetBuildingId: 'building-1' }] } }] });
  const destination = { x: 15, y: 11 };
  withCitizen.enqueue({ type: 'city.move-building', buildingId: 'building-1', position: destination });
  destination.x = 31;
  withCitizen.step();
  expect(withCitizen.getState().plan.buildings[0]?.position).toEqual({ x: 15, y: 11 });
  expect(withCitizen.getState().citizens[0]?.homeBuildingId).toBe('building-1');
  const before = withCitizen.getState();
  const rejected = withCitizen.executeBatch([
    { type: 'city.move-building', buildingId: 'building-1', position: { x: 2, y: 11 } },
    { type: 'city.demolish', buildingId: 'building-1' },
  ]);
  expect(rejected.state).toBe(before);
  expect(rejected.events).toMatchObject([{ type: 'city.command-rejected', reason: 'building-in-use', commandIndex: 1 }]);
});
