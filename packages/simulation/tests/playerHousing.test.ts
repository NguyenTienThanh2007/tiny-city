import { describe, expect, it } from 'vitest';
import {
  applyCityCommandBatch, createWorld, deserializeWorld, housingSummary, playerHomeOptions, serializeWorld, Simulation, validateWorld,
} from '../src/index.js';
import type { PlayerAppearance, WorldState } from '../src/index.js';
import { npcBuilding } from './npcFixture.js';

const look: PlayerAppearance = { skinTone: 1, hairStyle: 'bun', hairColor: 2, outfit: 'jacket', outfitColor: 3, accessory: 'scarf' };

/** Two villas and an office on one street, with residents welcomed: every room is taken (the reported bug). */
function fullNeighbourhood(): Simulation {
  const sim = new Simulation(createWorld({ id: 'full', seed: 'full', startingFunds: 10_000, clock: { paused: true },
    plan: { id: 'full-plan', name: 'Full street', width: 40, height: 20, blockedTiles: [], roads: Array.from({ length: 34 }, (_, i) => ({ x: i + 2, y: 5 })),
      buildings: [npcBuilding('villa-a', 'villa', 2, 6), npcBuilding('villa-b', 'villa', 5, 6), npcBuilding('office', 'office', 28, 6)] } }));
  sim.enablePopulation({ maxCitizens: 1000 });
  return sim;
}
const homes = (world: WorldState) => new Map(world.citizens.map((c) => [c.id, c.homeBuildingId]));
function invariants(sim: Simulation) {
  const world = sim.getState();
  expect(() => validateWorld(world)).not.toThrow();
  for (const b of world.plan.buildings.filter((entry) => entry.kind === 'home')) {
    const taken = world.citizens.filter((c) => c.homeBuildingId === b.id).length + (world.player?.homeBuildingId === b.id ? 1 : 0);
    expect(taken).toBeLessThanOrEqual(b.capacity);
  }
  expect(new Set(world.citizens.map((c) => c.id)).size).toBe(world.citizens.length);
}

describe('Life Mode housing in fully occupied cities', () => {
  it('reproduces the bug: every home is full and residents fill new homes at once without a player', () => {
    const sim = fullNeighbourhood();
    expect(playerHomeOptions(sim.getState()).every((o) => !o.available)).toBe(true);
    sim.execute({ type: 'city.build', buildingType: 'villa', position: { x: 10, y: 6 } });
    // With no player there is nothing to reserve for: Phase 3 behavior is unchanged.
    expect(playerHomeOptions(sim.getState()).every((o) => !o.available)).toBe(true);
  });

  it('keeps the created character unplaced instead of losing it when no home is free', () => {
    const sim = fullNeighbourhood();
    expect(sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look, homeBuildingId: 'villa-a' }).reason).toBe('home-full');
    const created = sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    expect(created.reason).toBeNull();
    expect(sim.getPlayer()).toMatchObject({ homeBuildingId: null, movement: { status: 'unplaced' }, activity: { kind: 'idle' } });
    expect(housingSummary(sim.getState())).toEqual({ homes: 2, rooms: 4, residents: 4, freeRooms: 0, playerRoomHeld: true });
    // Life has not started: no needs progress and no actions until the character moves in.
    const needs = sim.getPlayer()!.needs;
    sim.step(300);
    expect(sim.getPlayer()!.needs).toEqual(needs);
    for (const command of [{ type: 'player.move-to', destination: { type: 'tile', position: { x: 5, y: 5 } } }, { type: 'player.start-activity', activity: 'visit' }, { type: 'player.cancel' }] as const) {
      expect(sim.executeLife(command).reason).toBe('not-placed');
    }
    expect(sim.executeLife({ type: 'player.create', name: 'Twin', appearance: look }).reason).toBe('player-exists');
    invariants(sim);
  });

  it('holds one room in newly built housing for the player and never evicts existing residents', () => {
    const sim = fullNeighbourhood();
    const before = homes(sim.getState());
    sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    const built = sim.execute({ type: 'city.build', buildingType: 'villa', position: { x: 10, y: 6 } });
    const villa = built.events.find((e) => e.type === 'city.building-built');
    expect(villa?.type).toBe('city.building-built');
    const id = villa?.type === 'city.building-built' ? villa.building.id : '';
    // One new resident, one room left for the player.
    expect(sim.getBuildingOccupancy(id).residentIds).toHaveLength(1);
    expect(playerHomeOptions(sim.getState()).find((o) => o.buildingId === id)).toMatchObject({ residents: 1, capacity: 2, available: true });
    for (const [citizen, home] of before) expect(sim.getCitizen(citizen)?.homeBuildingId).toBe(home);
    expect(built.events.some((e) => e.type === 'citizen.removed')).toBe(false);
    invariants(sim);
    // Repeated reconciliation (more edits, enabling again) never consumes the held room.
    sim.execute({ type: 'city.edit-roads', add: [{ x: 3, y: 4 }], remove: [] });
    sim.enablePopulation();
    sim.step(30);
    expect(sim.getBuildingOccupancy(id).residentIds).toHaveLength(1);
    const moved = sim.executeLife({ type: 'player.move-in', homeBuildingId: id });
    expect(moved.reason).toBeNull();
    expect(sim.getPlayer()).toMatchObject({ homeBuildingId: id, movement: { status: 'inside', currentBuildingId: id } });
    // Life starts: the character can walk.
    expect(sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: { x: 20, y: 5 } } }).reason).toBeNull();
    sim.step(20);
    expect(sim.getPlayer()!.position.x).toBeGreaterThan(10);
    invariants(sim);
  });

  it('holds exactly one room in a new apartment, then fills homes normally once the player lives somewhere', () => {
    const sim = fullNeighbourhood();
    sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    sim.execute({ type: 'city.build', buildingType: 'apartment', position: { x: 10, y: 6 } });
    const apartment = sim.getState().plan.buildings.at(-1)!;
    expect(sim.getBuildingOccupancy(apartment.id).residentIds).toHaveLength(23);
    sim.executeLife({ type: 'player.move-in', homeBuildingId: apartment.id });
    sim.execute({ type: 'city.build', buildingType: 'villa', position: { x: 16, y: 6 } });
    expect(sim.getBuildingOccupancy(sim.getState().plan.buildings.at(-1)!.id).residentIds).toHaveLength(2);
    expect(sim.getBuildingOccupancy(apartment.id).residentIds).toHaveLength(23);
    invariants(sim);
  });

  it('handles demolition of the player home exactly like the same demolition without a player, then allows reassignment', () => {
    const withPlayer = fullNeighbourhood();
    withPlayer.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    withPlayer.execute({ type: 'city.build', buildingType: 'villa', position: { x: 10, y: 6 } });
    const villa = withPlayer.getState().plan.buildings.at(-1)!.id;
    withPlayer.executeLife({ type: 'player.move-in', homeBuildingId: villa });
    const demolish = withPlayer.execute({ type: 'city.demolish', buildingId: 'villa-a' });
    const removed = demolish.events.filter((e) => e.type === 'citizen.removed').map((e) => e.type === 'citizen.removed' && e.citizenId);
    // villa-a's two residents lose housing; nobody else is touched.
    expect(removed).toHaveLength(2);
    invariants(withPlayer);
    const lost = withPlayer.execute({ type: 'city.demolish', buildingId: villa });
    expect(lost.events.map((e) => e.type)).toContain('player.home-lost');
    expect(lost.events.filter((e) => e.type === 'citizen.removed')).toHaveLength(1);
    expect(withPlayer.getPlayer()).toMatchObject({ homeBuildingId: null, movement: { status: 'standing' } });
    // Homeless again: the next home built keeps a room for the player.
    withPlayer.execute({ type: 'city.build', buildingType: 'townhouse', position: { x: 16, y: 6 } });
    const town = withPlayer.getState().plan.buildings.at(-1)!.id;
    expect(withPlayer.getBuildingOccupancy(town).residentIds).toHaveLength(3);
    expect(withPlayer.executeLife({ type: 'player.move-in', homeBuildingId: town }).reason).toBeNull();
    invariants(withPlayer);
  });

  it('survives undo/redo of the new home and keeps the character unplaced', () => {
    const sim = fullNeighbourhood();
    sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    const snapshot = sim.getCitySnapshot();
    sim.execute({ type: 'city.build', buildingType: 'villa', position: { x: 10, y: 6 } });
    const after = sim.getCitySnapshot();
    sim.restoreCity(snapshot);
    expect(sim.getState().citizens).toHaveLength(4);
    expect(sim.getPlayer()!.movement.status).toBe('unplaced');
    sim.restoreCity(after);
    const villa = sim.getState().plan.buildings.at(-1)!.id;
    expect(playerHomeOptions(sim.getState()).find((o) => o.buildingId === villa)?.available).toBe(true);
    expect(sim.executeLife({ type: 'player.move-in', homeBuildingId: villa }).reason).toBeNull();
    invariants(sim);
  });

  it('keeps a room in AI-planned housing (one atomic batch) for the waiting player', () => {
    const sim = fullNeighbourhood();
    sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    const preview = applyCityCommandBatch(sim.getState(), [{ type: 'city.build', buildingType: 'villa', position: { x: 10, y: 6 } },
      { type: 'city.build', buildingType: 'villa', position: { x: 13, y: 6 } }]);
    expect(preview.applied).toBe(true);
    expect(sim.getState().citizens).toHaveLength(4);
    sim.executeBatch([{ type: 'city.build', buildingType: 'villa', position: { x: 10, y: 6 } }, { type: 'city.build', buildingType: 'villa', position: { x: 13, y: 6 } }]);
    expect(housingSummary(sim.getState())).toMatchObject({ rooms: 8, residents: 7, freeRooms: 1 });
    const free = playerHomeOptions(sim.getState()).find((o) => o.available)!;
    expect(sim.executeLife({ type: 'player.move-in', homeBuildingId: free.buildingId }).reason).toBeNull();
    invariants(sim);
  });

  it('round-trips unplaced players and loads legacy fully occupied saves without creating anyone', () => {
    const legacy = fullNeighbourhood().getState();
    const loaded = new Simulation(deserializeWorld(serializeWorld(legacy)));
    expect(loaded.getPlayer()).toBeUndefined();
    loaded.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    const restored = new Simulation(deserializeWorld(serializeWorld(loaded.getState())));
    expect(restored.getState()).toEqual(loaded.getState());
    restored.execute({ type: 'city.build', buildingType: 'villa', position: { x: 10, y: 6 } });
    loaded.execute({ type: 'city.build', buildingType: 'villa', position: { x: 10, y: 6 } });
    expect(serializeWorld(restored.getState())).toBe(serializeWorld(loaded.getState()));
    expect(() => deserializeWorld(serializeWorld(loaded.getState()).replace('"status":"unplaced"', '"status":"unplaced","x":1').replace('"homeBuildingId":null', '"homeBuildingId":"villa-a"')))
      .toThrow(/Invalid world snapshot/);
  });

  it('reserves the room before residents arrive when the character is created first', () => {
    const sim = new Simulation(createWorld({ id: 'new', seed: 'new', startingFunds: 1000, clock: { paused: true },
      plan: { id: 'new-plan', name: 'New', width: 20, height: 12, blockedTiles: [], roads: Array.from({ length: 12 }, (_, i) => ({ x: i + 2, y: 5 })),
        buildings: [npcBuilding('villa-a', 'villa', 2, 6), npcBuilding('villa-b', 'villa', 5, 6)] } }));
    sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    sim.enablePopulation({ maxCitizens: 1000 });
    expect(sim.getState().citizens).toHaveLength(3);
    expect(playerHomeOptions(sim.getState()).filter((o) => o.available)).toHaveLength(1);
    invariants(sim);
  });
});
