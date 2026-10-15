import { buildingCenter, containsPosition, NPC_LIMITS, RoadNavigator } from './navigation.js';
import { insideMovement, providesLeisure } from './population.js';
import type { TripPlanner } from './transport.js';
import type { Building, Citizen, CitizenActivity, CitizenMovement, ScheduleEntry, SimulationEvent, WorldState } from './types.js';

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

/**
 * One fixed update; route requests and individual walking loops have deterministic bounds.
 * Phase 6: with a `planner`, a resident leaving a building may drive or take the bus instead of walking; residents in
 * transport (`status: 'vehicle'`) only have their destination updated here, and `advanceTransport` moves them.
 */
export type LifeOverride = (c: Citizen, entry: ScheduleEntry) => { activity: CitizenActivity; destination: string | null } | null;

export function advanceDailyLife(world: WorldState, navigator: RoadNavigator, minute: number, planner?: TripPlanner, override?: LifeOverride) {
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
    // Phase 7: society decides outings, days off and free evenings; its destination is already reserved there.
    const decided = override?.(c, entry) ?? null;
    let activity = decided?.activity ?? entry.activity, destination = decided ? decided.destination : entry.targetBuildingId;
    if (activity === 'sleep' || activity === 'home') destination ??= c.homeBuildingId;
    if (activity === 'work' && !c.workBuildingId) { activity = 'home'; destination = c.homeBuildingId; }
    else if (activity === 'work') destination = c.workBuildingId;
    if (activity === 'leisure' && !decided) {
      const available = (id: string | null) => { const b = navigator.getBuilding(id); return b && providesLeisure(b) && (reservations.get(b.id) ?? 0) < b.capacity ? b.id : null; };
      destination = available(destination) ?? available(oldMovement.arrivalActivity === 'leisure' ? oldMovement.destinationBuildingId : null) ??
        preferredVenue(c.id, leisure, (b) => (reservations.get(b.id) ?? 0) < b.capacity);
      if (destination) reservations.set(destination, (reservations.get(destination) ?? 0) + 1);
      else { activity = 'home'; destination = c.homeBuildingId; }
    }
    let position = c.position, movement: CitizenMovement = oldMovement;
    const target = navigator.getBuilding(destination);
    if (oldMovement.status === 'vehicle') {
      // In a car or bus, or at a stop: the trip carries on; only a new destination is recorded (transport re-routes).
      const next = target && activity !== 'idle' && activity !== 'travel' ? target : navigator.getBuilding(c.homeBuildingId)!;
      const arrival = next.id === target?.id ? activity : 'home';
      if (next.id !== oldMovement.destinationBuildingId || arrival !== oldMovement.arrivalActivity) movement = { ...oldMovement, destinationBuildingId: next.id, arrivalActivity: arrival };
      if (c.activity !== 'travel' || c.targetBuildingId !== next.id) events.push({ type: 'citizen.activity-changed', tick, citizenId: c.id, activity: 'travel', targetBuildingId: next.id });
      return { ...c, movement, activity: 'travel' as const, targetBuildingId: next.id };
    }
    if (!target || activity === 'idle' || activity === 'travel') {
      activity = 'idle'; destination = null;
      movement = { ...oldMovement, status: 'waiting', destinationBuildingId: null, arrivalActivity: 'idle', route: [], nextWaypoint: 0, heading: { x: 0, y: 0 }, plannedRevision: world.revision };
    } else if (oldMovement.status !== 'travelling' && oldMovement.currentBuildingId === target.id && containsPosition(target, position)) {
      // Already inside: keep the same movement object when nothing changes (no per-tick allocation for residents at rest).
      const m = oldMovement;
      movement = m.status === 'inside' && m.destinationBuildingId === target.id && m.arrivalActivity === activity && m.plannedRevision === world.revision &&
        m.route.length === 0 && m.heading.x === 0 && m.heading.y === 0 ? m : insideMovement(target.id, world.revision, activity);
    } else {
      const needsRoute = destination !== oldMovement.destinationBuildingId || oldMovement.plannedRevision !== world.revision || oldMovement.status === 'inside';
      if (needsRoute) {
        planner?.cancel(c.id);
        movement = { ...oldMovement, destinationBuildingId: target.id, arrivalActivity: activity, route: [], nextWaypoint: 0, heading: { x: 0, y: 0 }, status: 'waiting', plannedRevision: -1 };
        if (routeRequests < NPC_LIMITS.routesPerTick) {
          routeRequests += 1;
          const result = navigator.routeFrom(position, oldMovement.currentBuildingId, target.id);
          movement = { ...movement, plannedRevision: world.revision };
          // Mode choice happens when leaving a building (inside it, or waiting in it for a route).
          const origin = oldMovement.status === 'inside' || oldMovement.status === 'waiting' ? navigator.getBuilding(oldMovement.currentBuildingId) : undefined;
          const plan = planner && origin && result.route && containsPosition(origin, position) ? planner.plan(c, origin, target, activity, result) : null;
          if (plan?.mode === 'car') {
            // Pulling out of the lot: transport takes over (the resident stays put until the car is on the street).
            movement = { ...movement, status: 'vehicle', currentBuildingId: null, route: [], nextWaypoint: 0 };
            events.push({ type: 'citizen.activity-changed', tick, citizenId: c.id, activity: 'travel', targetBuildingId: target.id });
            return { ...c, movement, activity: 'travel' as const, targetBuildingId: target.id };
          }
          const route = plan?.mode === 'bus' ? plan.route : result.route;
          if (route) movement = { ...movement, route, nextWaypoint: 1, status: 'travelling' };
          else events.push({ type: 'citizen.route-blocked', tick, citizenId: c.id, destinationBuildingId: target.id, reason: result.reason ?? 'unreachable' });
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
        if (index >= movement.route.length && planner?.reachedStop(c.id)) {
          // At the bus stop: transport takes over until the resident gets off.
          movement = { ...movement, status: 'vehicle', currentBuildingId: null, route: [], nextWaypoint: 0, heading: { x: 0, y: 0 } };
          activity = 'travel';
        } else if (index >= movement.route.length) {
          position = buildingCenter(target); movement = insideMovement(target.id, world.revision, activity);
          events.push({ type: 'citizen.arrived', tick, citizenId: c.id, buildingId: target.id });
        } else activity = 'travel';
      } else activity = 'idle';
    }
    if (position.x !== c.position.x || position.y !== c.position.y) events.push({ type: 'citizen.moved', tick, citizenId: c.id, position, heading: movement.heading });
    if (movement.arrivalActivity === 'leisure' && destination !== null && movement.status === 'waiting' && movement.plannedRevision !== -1) reservations.set(destination,(reservations.get(destination)??1)-1);
    if (activity !== c.activity || destination !== c.targetBuildingId) events.push({ type: 'citizen.activity-changed', tick, citizenId: c.id, activity, targetBuildingId: destination });
    if (position === c.position && movement === oldMovement && activity === c.activity && destination === c.targetBuildingId) return c;
    return { ...c, position, movement, activity, targetBuildingId: destination };
  });
  return { state: { ...world, citizens }, events };
}
