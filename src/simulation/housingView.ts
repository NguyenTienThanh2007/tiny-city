import { Simulation } from '@tiny-city/simulation';
import type { BuildingOccupancy, Citizen, PlayerCharacter, WorldState } from '@tiny-city/simulation';

/**
 * Read-only housing presentation. Occupied rooms = assigned residents + the housed player; residents at work or out
 * still hold their room, visitors never take one. Nothing here is inferred from where sprites stand.
 */
export interface HomeOccupancy {
  readonly capacity: number;
  /** Assigned NPC residents. */
  readonly residents: number;
  /** True when this building is the player's home (their room counts once). */
  readonly player: boolean;
  readonly occupied: number;
  readonly freeRooms: number;
}

export function homeOccupancy(capacity: number, occupancy: BuildingOccupancy | null, player: PlayerCharacter | undefined, buildingId: string): HomeOccupancy {
  const residents = occupancy?.residentIds.length ?? 0;
  const own = player?.homeBuildingId === buildingId;
  const occupied = residents + (own ? 1 : 0);
  return { capacity, residents, player: own, occupied, freeRooms: Math.max(0, capacity - occupied) };
}

/** Where an assigned resident is right now, so "lives here" is never confused with "is inside". */
export function residentWhereabouts(citizen: Citizen, homeId: string): string {
  const m = citizen.movement;
  if (!m) return citizen.activity === 'sleep' ? 'Asleep at home' : 'Lives here';
  if (m.status === 'inside' && m.currentBuildingId === homeId) return citizen.activity === 'sleep' ? 'Asleep at home' : 'At home';
  if (m.status === 'inside' && m.currentBuildingId === citizen.workBuildingId) return 'At work';
  if (m.status === 'inside') return 'Out visiting';
  if (m.status === 'travelling') return m.destinationBuildingId === homeId ? 'Walking home' : 'Out walking';
  return 'Out';
}

export interface WelcomeProjection {
  /** Residents who would share the chosen home with the player. */
  readonly roommates: number;
  /** Residents who would live in the city. */
  readonly residents: number;
}

/**
 * What "Move in & start" with "welcome residents" will actually produce, computed by the real engine on a throwaway
 * copy (move in, then welcome residents). Returns null when the move-in itself would be rejected.
 */
export function projectWelcome(world: WorldState, homeBuildingId: string, maxCitizens = 1000): WelcomeProjection | null {
  if (world.population) return null;
  const preview = new Simulation(world);
  if (!preview.executeLife({ type: 'player.move-in', homeBuildingId }).applied) return null;
  const { state } = preview.enablePopulation({ maxCitizens });
  return { roommates: state.citizens.filter((c) => c.homeBuildingId === homeBuildingId).length, residents: state.citizens.length };
}
