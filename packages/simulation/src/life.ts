import { buildingCenter, containsPosition, NPC_LIMITS, RoadNavigator } from './navigation.js';
import { insideMovement, providesLeisure } from './population.js';
import type { Building, Citizen, CitizenMovement, ScheduleEntry, SimulationEvent, WorldState } from './types.js';

/** FNV-1a: a stable, platform-independent 32-bit hash. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

/**
 * Each resident has a deterministic personal ranking of public venues (rendezvous hashing), so evenings spread across
 * every park, pool and clubhouse instead of filling the first by ID; adding a venue only moves the residents who now
 * prefer it. Falls through the ranking while a venue is full.
 */
export function preferredVenue(citizenId: string, venues: readonly Building[], hasRoom: (venue: Building) => boolean): string | null {
  let best: Building | null = null, bestScore = -1;
  for (const venue of venues) {
    if (!hasRoom(venue)) continue;
    const score = hash(`${citizenId}|${venue.id}`);
    if (score > bestScore || score === bestScore && best !== null && venue.id < best.id) { best = venue; bestScore = score; }
  }
  return best?.id ?? null;
}

export function scheduledEntry(citizen: Citizen, minute: number): ScheduleEntry {
  let active = citizen.schedule.entries[0]!;
  for (const e of citizen.schedule.entries) { if (e.startMinute > minute) break; active = e; }
  return active;
}

/** One fixed update; route requests and individual walking loops have deterministic bounds. */
export function advanceDailyLife(world: WorldState, navigator: RoadNavigator, minute: number) {
  const events: SimulationEvent[] = [], tick = world.clock.tick;
  const leisure = navigator.leisureBuildings;
  const reservations = new Map<string, number>();
  const holdsReservation = (m: CitizenMovement) => m.arrivalActivity === 'leisure' && m.destinationBuildingId !== null && (m.status !== 'waiting' || m.plannedRevision === -1);
  for (const c of world.citizens) {
    const m = c.movement!;
    if (holdsReservation(m)) reservations.set(m.destinationBuildingId!, (reservations.get(m.destinationBuildingId!) ?? 0) + 1);
  }
  let routeRequests = 0;
  const citizens = world.citizens.map(c => {
    const entry = scheduledEntry(c, minute), oldMovement = c.movement!;
    if (holdsReservation(oldMovement)) {
      const id = oldMovement.destinationBuildingId!; reservations.set(id, (reservations.get(id) ?? 1) - 1);
    }
    let activity = entry.activity, destination = entry.targetBuildingId;
    if (activity === 'sleep' || activity === 'home') destination ??= c.homeBuildingId;
    if (activity === 'work' && !c.workBuildingId) { activity = 'home'; destination = c.homeBuildingId; }
    else if (activity === 'work') destination = c.workBuildingId;
    if (activity === 'leisure') {
      const available = (id: string | null) => { const b = navigator.getBuilding(id); return b && providesLeisure(b) && (reservations.get(b.id) ?? 0) < b.capacity ? b.id : null; };
      destination = available(destination) ?? available(oldMovement.arrivalActivity === 'leisure' ? oldMovement.destinationBuildingId : null) ??
        preferredVenue(c.id, leisure, (b) => (reservations.get(b.id) ?? 0) < b.capacity);
      if (destination) reservations.set(destination, (reservations.get(destination) ?? 0) + 1);
      else { activity = 'home'; destination = c.homeBuildingId; }
    }
    let position = c.position, movement: CitizenMovement = oldMovement;
    const target = navigator.getBuilding(destination);
    if (!target || activity === 'idle' || activity === 'travel') {
      activity = 'idle'; destination = null;
      movement = { ...oldMovement, status: 'waiting', destinationBuildingId: null, arrivalActivity: 'idle', route: [], nextWaypoint: 0, heading: { x: 0, y: 0 }, plannedRevision: world.revision };
    } else if (oldMovement.status !== 'travelling' && oldMovement.currentBuildingId === target.id && containsPosition(target, position)) {
      movement = insideMovement(target.id, world.revision, activity);
    } else {
      const needsRoute = destination !== oldMovement.destinationBuildingId || oldMovement.plannedRevision !== world.revision || oldMovement.status === 'inside';
      if (needsRoute) {
        movement = { ...oldMovement, destinationBuildingId: target.id, arrivalActivity: activity, route: [], nextWaypoint: 0, heading: { x: 0, y: 0 }, status: 'waiting', plannedRevision: -1 };
        if (routeRequests < NPC_LIMITS.routesPerTick) {
          routeRequests += 1;
          const result = navigator.routeFrom(position, oldMovement.currentBuildingId, target.id);
          movement = { ...movement, plannedRevision: world.revision };
          if (result.route) movement = { ...movement, route: result.route, nextWaypoint: 1, status: 'travelling' };
          else events.push({ type: 'citizen.route-blocked', tick, citizenId: c.id, destinationBuildingId: target.id, reason: result.reason });
        }
      } else if (movement.arrivalActivity !== activity) movement = { ...movement, arrivalActivity: activity };
      if (movement.status === 'travelling') {
        let distance = c.attributes!.walkingSpeed * world.clock.minutesPerTick, index = movement.nextWaypoint;
        let heading = movement.heading;
        while (index < movement.route.length && distance > 0) {
          const next = movement.route[index]!, dx = next.x - position.x, dy = next.y - position.y;
          const length = Math.abs(dx) + Math.abs(dy); heading = { x: Math.sign(dx), y: Math.sign(dy) };
          if (length <= distance + 1e-12) { position = next; distance = Math.max(0, distance - length); index += 1; }
          else { position = { x: position.x + heading.x * distance, y: position.y + heading.y * distance }; distance = 0; }
        }
        const cell = navigator.grid.get({ x: Math.floor(position.x), y: Math.floor(position.y) });
        const currentBuildingId = cell?.type === 'building' && (cell.buildingId === target.id || cell.buildingId === oldMovement.currentBuildingId) ? cell.buildingId : null;
        movement = { ...movement, nextWaypoint: index, heading, currentBuildingId };
        if (index >= movement.route.length) {
          position = buildingCenter(target); movement = insideMovement(target.id, world.revision, activity);
          events.push({ type: 'citizen.arrived', tick, citizenId: c.id, buildingId: target.id });
        } else activity = 'travel';
      } else activity = 'idle';
    }
    if (position.x !== c.position.x || position.y !== c.position.y) events.push({ type: 'citizen.moved', tick, citizenId: c.id, position, heading: movement.heading });
    if (movement.arrivalActivity === 'leisure' && destination !== null && movement.status === 'waiting' && movement.plannedRevision !== -1) reservations.set(destination,(reservations.get(destination)??1)-1);
    if (activity !== c.activity || destination !== c.targetBuildingId) events.push({ type: 'citizen.activity-changed', tick, citizenId: c.id, activity, targetBuildingId: destination });
    return { ...c, position, movement, activity, targetBuildingId: destination };
  });
  return { state: { ...world, citizens }, events };
}
