import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOG, createWorld, getGameTime, playerHomeOptions, Simulation } from '@tiny-city/simulation';
import type { BuildingType } from '@tiny-city/simulation';
import { DEFAULT_APPEARANCE } from '../game/playerLook';
import { initialCity } from '../data/initialCity';
import { createCityWorld } from './cityAdapter';
import { homeOccupancy, projectWelcome, residentWhereabouts } from './housingView';

const building = (id: string, type: BuildingType, x: number, y: number) => ({ id, name: id, type, kind: BUILDING_CATALOG[type].kind,
  capacity: BUILDING_CATALOG[type].capacity, position: { x, y }, footprint: BUILDING_CATALOG[type].footprint });

describe('housing presentation (Phase 4.5 occupancy)', () => {
  it('reproduces the report: the sample city lists 0 of 2 rooms before moving in, then residents fill the other rooms', () => {
    const sim = new Simulation(createCityWorld(initialCity));
    sim.executeLife({ type: 'player.create', name: 'Mai', appearance: DEFAULT_APPEARANCE });
    const home = playerHomeOptions(sim.getState())[0]!;
    expect(home).toMatchObject({ occupied: 0, capacity: 2, available: true });
    // The projection is what confirming with "welcome residents" will really do (same engine, throwaway copy).
    const projection = projectWelcome(sim.getState(), home.buildingId)!;
    sim.executeLife({ type: 'player.move-in', homeBuildingId: home.buildingId });
    sim.enablePopulation({ maxCitizens: 1000 });
    const world = sim.getState();
    expect(projection).toEqual({ roommates: world.citizens.filter((c) => c.homeBuildingId === home.buildingId).length, residents: world.citizens.length });
    expect(projection.roommates).toBe(1);
    // After moving in, the player's home is full: one resident plus the player, counted once.
    const own = playerHomeOptions(world).find((o) => o.buildingId === home.buildingId)!;
    expect(own).toMatchObject({ residents: 1, occupied: 2, freeRooms: 0, current: true, available: false });
    expect(homeOccupancy(2, sim.getBuildingOccupancy(home.buildingId), world.player, home.buildingId)).toEqual({ capacity: 2, residents: 1, player: true, occupied: 2, freeRooms: 0 });
    // Every other villa: two assigned residents, whether they are home, at work or out.
    for (const o of playerHomeOptions(world).filter((entry) => !entry.current)) expect(o).toMatchObject({ occupied: 2, freeRooms: 0 });
  });

  it('a resident at work still holds their room; visitors never take one', () => {
    const sim = new Simulation(createWorld({ id: 'work', seed: 'work', clock: { paused: true }, startingFunds: 100,
      plan: { id: 'p', name: 'p', width: 30, height: 12, roads: Array.from({ length: 24 }, (_, i) => ({ x: i + 2, y: 4 })), blockedTiles: [],
        buildings: [building('home', 'villa', 2, 5), building('park', 'park', 8, 5), building('office', 'office', 16, 5)] } }));
    sim.enablePopulation({ maxCitizens: 1000 });
    while (getGameTime(sim.getState().clock).minuteOfDay < 10 * 60) sim.step(10); // 10:00: residents are at work
    const world = sim.getState();
    const worker = world.citizens.find((c) => c.movement?.status === 'inside' && c.movement.currentBuildingId === c.workBuildingId)!;
    expect(worker).toBeDefined();
    expect(residentWhereabouts(worker, worker.homeBuildingId)).toBe('At work');
    const rooms = homeOccupancy(2, sim.getBuildingOccupancy(worker.homeBuildingId), world.player, worker.homeBuildingId);
    expect(rooms.residents).toBe(world.citizens.filter((c) => c.homeBuildingId === worker.homeBuildingId).length);
    expect(rooms.occupied).toBeGreaterThanOrEqual(1);
    for (const b of world.plan.buildings.filter((entry) => entry.kind === 'home')) expect(sim.getBuildingOccupancy(b.id).visitorIds).toEqual([]);
  });

  it('never projects a move-in the engine would reject, and projects nothing once residents exist', () => {
    const sim = new Simulation(createCityWorld(initialCity));
    sim.executeLife({ type: 'player.create', name: 'Mai', appearance: DEFAULT_APPEARANCE });
    expect(projectWelcome(sim.getState(), 'no-such-home')).toBeNull();
    sim.enablePopulation({ maxCitizens: 1000 });
    expect(projectWelcome(sim.getState(), playerHomeOptions(sim.getState())[0]!.buildingId)).toBeNull();
  });
});
