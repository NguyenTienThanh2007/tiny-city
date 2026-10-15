import { getGameTime } from './clock.js';
import { tileKey } from './grid.js';
import { buildingCenter } from './navigation.js';
import { insideMovement } from './population.js';
import { TRANSPORT } from './transportConfig.js';
import { decodePath, directionBetween, encodePath, laneKey, movementMask, TransportNetwork, type LinePlan } from './transportGraph.js';
import { backInside, bodyOnLanes, busIdOf, emptyDay, nextExperience, strandedOnFoot, TripPlanner, vanIdOf, walkingFrom } from './transport.js';
import { recordTransit } from './economy.js';
import type { BusLine, BusStop, Citizen, EconomyState, JunctionGrant, Position, SimulationEvent, TransportDayStats, Trip, Vehicle, VehicleState, WorldState } from './types.js';

/**
 * One fixed tick of transportation (after residents have decided where to go):
 *
 * 1. hand-offs from Life (new car and bus trips, residents reaching stops), destination changes, bus dispatch and
 *    delivery vans;
 * 2. intersection permissions (quadrant reservations, granted atomically for a whole run of junction tiles together
 *    with room to leave it, so a vehicle never stops inside a junction and junctions cannot deadlock);
 * 3. movement: each vehicle accelerates towards its top speed but never beyond what lets it stop behind the vehicle
 *    ahead, at an intersection it may not enter yet, or at its destination (v ≤ √(2·brake·free));
 * 4. arrivals, bus stops (riders get off, waiting residents board in arrival order up to capacity), vehicles pulling
 *    out of lots when there is room, long waits and stalls;
 * 5. congestion bookkeeping: lost progress per lane, smoothed; routing reads a snapshot taken every routing epoch.
 *
 * Everything is integer arithmetic over saved state, iterated in a fixed order, so replays are exact.
 */
const U = TRANSPORT.unitsPerTile;
const GAP = TRANSPORT.gap;
/** A request waiting at least this long blocks later, conflicting requests for one tick (first come, first served). */
const FAIR_WAIT = 2;
/** A vehicle waiting this long to pull out claims its spot in the lane (traffic behind yields). */
const MERGE_WAIT = 3;

interface Live {
  v: Vehicle;
  route: readonly Position[];
  /** Front of the vehicle in route units. */
  s: number;
  speed: number;
  state: VehicleState;
  waitTicks: number;
  grants: JunctionGrant[];
  destination: string | null;
  stopIndex: number;
  passengers: string[];
  dwell: number;
  len: number;
  dyn: (typeof TRANSPORT.vehicles)[keyof typeof TRANSPORT.vehicles];
  plannedRevision: number;
  routeChanged: boolean;
  retarget: boolean;
  removed: boolean;
  withdraw: boolean;
}
interface Body { live: Live; rear: number; front: number }
interface Hold { live: Live; mask: number; index: number }

const edgeOf = (live: Live, s = live.s) => s <= 0 ? 0 : Math.min(live.route.length - 2, Math.ceil(s / U) - 1);
/** Lane and tile keys per decoded route (routes are shared, immutable arrays reused across ticks). */
const laneKeys = new WeakMap<readonly Position[], string[]>();
const tileKeys = new WeakMap<readonly Position[], string[]>();
const laneAt = (route: readonly Position[], e: number) => {
  let keys = laneKeys.get(route);
  if (!keys) { keys = []; laneKeys.set(route, keys); }
  return keys[e] ??= laneKey(route[e]!, directionBetween(route[e]!, route[e + 1]!)!);
};
const tileAtIndex = (route: readonly Position[], i: number) => {
  let keys = tileKeys.get(route);
  if (!keys) { keys = []; tileKeys.set(route, keys); }
  return keys[i] ??= tileKey(route[i]!);
};
const maskAt = (route: readonly Position[], i: number) =>
  movementMask(i === 0 ? null : directionBetween(route[i - 1]!, route[i]!), i < route.length - 1 ? directionBetween(route[i]!, route[i + 1]!) : null);
/** Route tile containing the front (tile i spans [100i − 50, 100i + 50)). */
const tileAt = (live: Live) => live.route[Math.max(0, Math.min(live.route.length - 1, Math.floor((live.s + U / 2) / U)))]!;

function liveOf(v: Vehicle): Live {
  const dyn = TRANSPORT.vehicles[v.kind];
  return { v, route: decodePath(v.origin, v.path), s: v.edge * U + v.offset, speed: v.speed, state: v.state, waitTicks: v.waitTicks,
    grants: v.grants.map((g) => ({ ...g })), destination: v.destinationBuildingId, stopIndex: v.stopIndex, passengers: [...v.passengers],
    dwell: v.dwell, len: dyn.length, dyn, plannedRevision: v.plannedRevision, routeChanged: false, retarget: false, removed: false, withdraw: false };
}

const NONE: readonly never[] = Object.freeze([]);
const sameGrants = (a: readonly JunctionGrant[], b: readonly JunctionGrant[]) => a.length === b.length && a.every((g, i) => g.index === b[i]!.index && g.mask === b[i]!.mask);
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

function frozenVehicle(live: Live): Vehicle {
  let route = live.route, s = live.s, grants = live.grants, changed = live.routeChanged;
  // Keep stored routes short: drop tiles more than one edge behind the rear (the body never spans more than two edges).
  const keepFrom = Math.max(0, Math.floor((s - live.len) / U) - 1);
  if (keepFrom >= 8) {
    route = route.slice(keepFrom); s -= keepFrom * U;
    grants = grants.map((g) => ({ index: g.index - keepFrom, mask: g.mask }));
    changed = true;
  }
  const encoded = changed ? encodePath(route) : { origin: live.v.origin, path: live.v.path };
  const edge = s <= 0 ? 0 : Math.min(route.length - 2, Math.ceil(s / U) - 1);
  // Reuse unchanged parts (and shared empty arrays) so a tick allocates as little as possible.
  const v = live.v;
  const nextGrants = grants.length === 0 ? NONE : sameGrants(grants, v.grants) ? v.grants : grants;
  const nextPassengers = live.passengers.length === 0 ? NONE : sameIds(live.passengers, v.passengers) ? v.passengers : live.passengers;
  const offset = s - edge * U;
  if (!changed && edge === v.edge && offset === v.offset && live.speed === v.speed && live.state === v.state && live.waitTicks === v.waitTicks &&
      nextGrants === v.grants && live.destination === v.destinationBuildingId && live.stopIndex === v.stopIndex && nextPassengers === v.passengers &&
      live.dwell === v.dwell && live.plannedRevision === v.plannedRevision) return v;
  return { ...v, origin: encoded.origin, path: encoded.path, edge, offset, speed: live.speed, state: live.state,
    waitTicks: live.waitTicks, grants: nextGrants, destinationBuildingId: live.destination, stopIndex: live.stopIndex, passengers: nextPassengers,
    dwell: live.dwell, plannedRevision: live.plannedRevision };
}

export interface TransportTickResult { readonly state: WorldState; readonly events: SimulationEvent[] }

export function advanceTransport(world: WorldState, network: TransportNetwork, planner: TripPlanner | null): TransportTickResult {
  const t = world.transport!;
  const tick = world.clock.tick;
  const { day, minuteOfDay } = getGameTime(world.clock);
  const events: SimulationEvent[] = [];
  let today: TransportDayStats = t.today.day === day ? t.today : emptyDay(day);
  const history = t.today.day === day ? t.history : [...t.history, t.today].slice(-TRANSPORT.historyDays);
  const experience = t.today.day === day ? t.experience : nextExperience(t.experience, t.today);
  // Copy-on-write: residents, parked cars and van rounds are only copied when this tick changes them.
  let citizens: readonly Citizen[] = world.citizens;
  let citizenIndex: Map<string, number> | null = null;
  const indexOf = (id: string) => (citizenIndex ??= new Map(world.citizens.map((c, i) => [c.id, i]))).get(id);
  const getCitizen = (id: string) => { const i = indexOf(id); return i === undefined ? undefined : citizens[i]; };
  const setCitizen = (c: Citizen) => {
    if (citizens === world.citizens) citizens = world.citizens.slice();
    (citizens as Citizen[])[indexOf(c.id)!] = c;
  };
  const trips = new Map(t.trips.map((trip) => [trip.citizenId, trip]));
  const tripSet = trips.set.bind(trips), tripDelete = trips.delete.bind(trips);
  trips.set = (key, value) => { tripsChanged = true; return tripSet(key, value); };
  trips.delete = (key) => { tripsChanged = true; return tripDelete(key); };
  const stops = new Map<string, BusStop>(t.stops.map((s) => [s.id, s]));
  let lines: readonly BusLine[] = t.lines;
  let economy: EconomyState | undefined = world.economy;
  let parkedCars: Record<string, string> = t.parkedCars as Record<string, string>;
  const parkCar = (owner: string, building: string | null) => {
    if ((parkedCars[owner] ?? null) === building) return;
    if (parkedCars === t.parkedCars) parkedCars = { ...t.parkedCars };
    if (building === null) delete parkedCars[owner]; else parkedCars[owner] = building;
  };
  let vanRounds: Record<string, number> = t.vanRounds as Record<string, number>;
  let tripsChanged = false;
  let nextTripId = planner ? Math.max(planner.nextTrip, t.nextTripId) : t.nextTripId;
  const lives: Live[] = t.vehicles.map(liveOf);
  let streetCache: Live[] | null = null;
  const byId = new Map(lives.map((l) => [l.v.id, l]));
  const navigator = network.navigator;
  const cancelTrip = (trip: Trip, reason: Extract<SimulationEvent, { type: 'transport.trip-cancelled' }>['reason']) => {
    trips.delete(trip.citizenId);
    today = { ...today, cancelled: today.cancelled + (reason === 'gave-up' ? 0 : 1), gaveUp: today.gaveUp + (reason === 'gave-up' ? 1 : 0) };
    events.push({ type: 'transport.trip-cancelled', tick, citizenId: trip.citizenId, mode: trip.mode, reason });
  };
  const addVehicle = (v: Vehicle) => { const live = liveOf(v); lives.push(live); byId.set(v.id, live); return live; };

  // 1. Hand-offs from Life.
  if (planner) {
    for (const { trip, vehicle } of planner.started) {
      trips.set(trip.citizenId, trip);
      if (vehicle) addVehicle(vehicle);
      today = trip.mode === 'car' ? { ...today, carTrips: today.carTrips + 1 } : { ...today, busTrips: today.busTrips + 1 };
      events.push({ type: 'transport.trip-started', tick, citizenId: trip.citizenId, mode: trip.mode, destinationBuildingId: trip.destinationBuildingId, estimatedMinutes: trip.estimatedMinutes });
    }
    today = { ...today, walkTrips: today.walkTrips + planner.walkTrips };
    for (const id of planner.cancelled) {
      const trip = trips.get(id);
      if (trip?.phase === 'to-stop') { trips.delete(id); events.push({ type: 'transport.trip-cancelled', tick, citizenId: id, mode: 'bus', reason: 'destination-changed' }); }
    }
    for (const id of planner.atStop) {
      const trip = trips.get(id);
      if (trip?.phase === 'to-stop') trips.set(id, { ...trip, phase: 'waiting', phaseTick: tick });
    }
  }
  // Destination changes (the schedule moved on, or the destination was demolished).
  for (const trip of [...trips.values()]) {
    if (trip.phase === 'to-stop') continue;
    const c = getCitizen(trip.citizenId);
    const wanted = c?.movement?.destinationBuildingId ?? null;
    if (!c || wanted === null || wanted === trip.destinationBuildingId) continue;
    if (trip.phase === 'driving') {
      const car = byId.get(trip.vehicleId!);
      trips.set(trip.citizenId, { ...trip, destinationBuildingId: wanted });
      if (car) { car.destination = wanted; car.retarget = true; }
    } else if (trip.phase === 'waiting') {
      cancelTrip(trip, 'destination-changed');
      setCitizen({ ...c, activity: 'idle', movement: walkingFrom(c.movement!) });
    } else {
      const bus = byId.get(trip.vehicleId!);
      const line = lines.find((l) => l.id === trip.lineId);
      const next = bus && line ? line.stopIds[bus.stopIndex] ?? trip.alightStopId : trip.alightStopId;
      trips.set(trip.citizenId, { ...trip, destinationBuildingId: wanted, alightStopId: next });
    }
  }

  // Bus lines: dispatch missing buses one at a time at the first stop (spaced by the headway), withdraw extra ones.
  const plans = new Map<string, LinePlan>();
  for (const line of lines) {
    if (line.status !== 'active') continue;
    const result = network.linePlan(line, stops);
    if (result.plan) plans.set(line.id, result.plan);
  }
  const busRoute = (plan: LinePlan, target: number): Position[] => {
    const k = plan.legs.length;
    return [...plan.legs[(target - 1 + k) % k]!, plan.legs[target]![1]!];
  };
  const dispatched = lines.map((line) => {
    const plan = plans.get(line.id);
    if (!plan) return line;
    const buses = lives.filter((l) => l.v.lineId === line.id);
    for (const bus of buses) if (Number(bus.v.id.slice(bus.v.id.lastIndexOf('-') + 1)) > line.buses) bus.withdraw = true;
    const present = new Set(buses.map((b) => b.v.id));
    const missing = Array.from({ length: line.buses }, (_, i) => i + 1).find((k) => !present.has(busIdOf(line.id, k)));
    const loopMinutes = plan.loopUnits / TRANSPORT.vehicles.bus.maxSpeed + line.stopIds.length * (TRANSPORT.busDwellTicks + 1);
    const headway = Math.max(1, Math.floor(loopMinutes / line.buses));
    if (missing === undefined || line.lastDispatchTick >= 0 && tick - line.lastDispatchTick < headway || buses.some((b) => b.state === 'departing')) return line;
    const route = busRoute(plan, 0);
    const { origin, path } = encodePath(route);
    const s = (route.length - 2) * U + 40;
    const edge = Math.min(route.length - 2, Math.ceil(s / U) - 1);
    addVehicle({ id: busIdOf(line.id, missing), kind: 'bus', model: 'bus', color: line.color, origin, path, edge, offset: s - edge * U, speed: 0,
      state: 'departing', waitTicks: 0, grants: [], ownerId: null, destinationBuildingId: null, lineId: line.id, stopIndex: 0, passengers: [], dwell: 0,
      departedTick: tick, plannedRevision: world.revision });
    return { ...line, lastDispatchTick: tick };
  });
  if (dispatched.some((line, i) => line !== lines[i])) lines = dispatched;

  // Delivery vans: a staffed mall with local sales sends its van on a round of the city's homes during opening hours.
  if (minuteOfDay >= TRANSPORT.vans.firstDeparture && minuteOfDay <= TRANSPORT.vans.lastDeparture) {
    const homes = world.plan.buildings.filter((b) => b.kind === 'home').sort((a, b) => a.id < b.id ? -1 : 1);
    for (const mall of world.plan.buildings.filter((b) => b.type === 'mall').sort((a, b) => a.id < b.id ? -1 : 1)) {
      const finance = economy?.buildings[mall.id];
      if (!finance || finance.status === 'unstaffed' || finance.revenue <= 0 || !homes.length || byId.has(vanIdOf(mall.id))) continue;
      if (lives.filter((l) => l.v.kind !== 'bus').length >= TRANSPORT.activeVehicleLimit) break;
      const round = vanRounds[mall.id] ?? 0;
      vanRounds = { ...vanRounds, [mall.id]: round + 1 };
      const home = homes[round % homes.length]!;
      const route = network.carRoute(mall.id, home.id);
      if (!route) continue;
      const { origin, path } = encodePath(route.tiles);
      addVehicle({ id: vanIdOf(mall.id), kind: 'van', model: 'van', color: hashColor(mall.id), origin, path, edge: 0, offset: 0, speed: 0, state: 'departing',
        waitTicks: 0, grants: [], ownerId: mall.id, destinationBuildingId: home.id, lineId: null, stopIndex: 0, passengers: [], dwell: 0,
        departedTick: tick, plannedRevision: world.revision });
    }
  }

  // Re-planning: destination changes, routes planned before a road edit (a few per tick), and stalled vehicles.
  let replans = 0;
  for (const live of [...lives].sort((a, b) => a.v.id < b.v.id ? -1 : 1)) {
    if (live.v.kind === 'bus' || live.removed) continue;
    const stale = live.plannedRevision < world.revision;
    const stalled = live.waitTicks > 0 && live.waitTicks % TRANSPORT.stallReroute === 0;
    if (!live.retarget && !stale && !stalled) continue;
    if (!live.retarget && replans >= 24) continue;
    // Committed to a junction movement (granted, or inside one): re-plan once it is through.
    if (live.grants.length || live.state !== 'departing' && occupiesJunction(live)) continue;
    replans += 1;
    if (live.state === 'departing') {
      const trip = live.v.kind === 'car' ? trips.get(live.v.ownerId!) : undefined;
      const from = live.v.kind === 'van' ? live.v.ownerId! : trip?.originBuildingId;
      const fresh = from ? network.carRoute(from, live.destination!) : null;
      if (fresh) { live.route = fresh.tiles; live.s = 0; live.routeChanged = true; live.plannedRevision = world.revision; live.retarget = false; }
      else removeVehicle(live, live.retarget ? 'destination-changed' : 'unreachable');
      continue;
    }
    const e = edgeOf(live);
    const from = live.route[e]!, to = live.route[e + 1]!;
    const next = network.routeFromLane(from, directionBetween(from, to)!, live.s - e * U, network.access(live.destination!));
    live.plannedRevision = world.revision;
    if (!next) { if (live.retarget) removeVehicle(live, 'destination-changed'); continue; }
    const behind = e > 0 ? [live.route[e - 1]!] : [];
    live.route = [...behind, ...next.tiles];
    live.s = live.s - (e - behind.length) * U;
    live.routeChanged = true;
    live.retarget = false;
  }

  /** Whether a vehicle's body is inside a junction tile. */
  function occupiesJunction(live: Live): boolean {
    const rear = live.s - live.len;
    for (let i = Math.max(0, Math.floor(rear / U)); i <= Math.min(live.route.length - 1, Math.ceil(live.s / U)); i += 1) {
      if (i * U - U / 2 < live.s && i * U + U / 2 > rear && network.isJunction(live.route[i]!)) return true;
    }
    return false;
  }
  /** Takes a vehicle off the street: its driver or riders walk on from where it is; a car goes home. */
  function removeVehicle(live: Live, reason: 'unreachable' | 'stalled' | 'withdrawn' | 'gave-up' | 'destination-changed') {
    if (live.removed) return;
    live.removed = true;
    streetCache = null;
    const at = tileAt(live);
    const here = { x: at.x + 0.5, y: at.y + 0.5 };
    if (live.v.kind === 'car') {
      const owner = getCitizen(live.v.ownerId!);
      const trip = trips.get(live.v.ownerId!);
      if (owner && trip) {
        cancelTrip(trip, reason === 'withdrawn' ? 'unreachable' : reason);
        const origin = navigator.getBuilding(trip.originBuildingId);
        setCitizen(live.state === 'departing' && origin ? backInside(owner, origin, navigator, world.revision) : strandedOnFoot(owner, live.state === 'departing' ? owner.position : here, navigator, world.revision));
      }
      parkCar(live.v.ownerId!, null);
    } else if (live.v.kind === 'bus') {
      for (const id of live.passengers) {
        const rider = getCitizen(id), trip = trips.get(id);
        if (!rider) continue;
        if (trip) {
          if (reason === 'withdrawn') { trips.delete(id); events.push({ type: 'transport.alighted', tick, citizenId: id, vehicleId: live.v.id, stopId: stopAt(live)?.id ?? '' }); }
          else cancelTrip(trip, 'stalled');
        }
        setCitizen(strandedOnFoot(rider, here, navigator, world.revision));
      }
      live.passengers = [];
    }
    if (reason === 'stalled') { today = { ...today, stalls: today.stalls + 1 }; events.push({ type: 'transport.vehicle-stalled', tick, vehicleId: live.v.id }); }
  }
  /** The stop a bus is driving to (or serving). */
  function stopAt(live: Live): BusStop | undefined {
    const line = lines.find((l) => l.id === live.v.lineId);
    return line ? stops.get(line.stopIds[live.stopIndex] ?? '') : undefined;
  }
  /** Where a vehicle's trip ends on its current route: a car parks at the curb tile; a bus stops 40 units past its stop tile. */
  function endOf(live: Live): number {
    const last = live.route.length - 1;
    if (live.v.kind !== 'bus') return last * U;
    const stop = stopAt(live);
    if (stop && last >= 1 && tileKey(live.route[last - 1]!) === tileKey(stop.tile)) return (last - 1) * U + 40;
    return last * U;
  }

  // Buses finishing their dwell leave for the next stop (or are withdrawn there).
  for (const live of lives) {
    if (live.removed || live.v.kind !== 'bus' || live.state !== 'dwelling') continue;
    if (live.dwell > 0) continue;
    const line = lines.find((l) => l.id === live.v.lineId);
    const plan = line ? plans.get(line.id) : undefined;
    if (!line || !plan || live.withdraw) { removeVehicle(live, 'withdrawn'); continue; }
    const target = (live.stopIndex + 1) % line.stopIds.length;
    const nextRoute = busRoute(plan, target);
    const last = live.route.length - 1;
    const continues = last >= 1 && tileKey(live.route[last - 1]!) === tileKey(nextRoute[0]!) && tileKey(live.route[last]!) === tileKey(nextRoute[1]!);
    if (continues) { live.route = nextRoute; live.s = 40; }
    else {
      // The loop changed under the bus (a road edit): drive on from where it stands to the next stop.
      const e = edgeOf(live);
      const from = live.route[e]!, to = live.route[e + 1]!;
      const stop = stops.get(line.stopIds[target]!)!;
      const next = network.routeFromLane(from, directionBetween(from, to)!, live.s - e * U, [stop.tile], true);
      if (!next) { removeVehicle(live, 'withdrawn'); continue; }
      const behind = e > 0 ? [live.route[e - 1]!] : [];
      live.s = live.s - (e - behind.length) * U;
      live.route = [...behind, ...next.tiles];
    }
    live.routeChanged = true;
    live.stopIndex = target;
    live.state = 'moving';
  }

  // 2–3. Junction permissions and movement.
  /** Vehicles on the street (cached; reset whenever a vehicle leaves the lot or the street). */
  const street = () => streetCache ??= lives.filter((l) => !l.removed && l.state !== 'departing');
  const lanes = new Map<string, Body[]>();
  const index = (live: Live) => {
    for (const b of bodyOnLanes(live.route, live.s, live.len)) {
      const list = lanes.get(b.lane);
      const body = { live, rear: b.rear, front: b.front };
      if (list) list.push(body); else lanes.set(b.lane, [body]);
    }
  };
  const unindex = (live: Live) => {
    for (const b of bodyOnLanes(live.route, live.s, live.len)) {
      const list = lanes.get(b.lane);
      if (!list) continue;
      const i = list.findIndex((x) => x.live === live);
      if (i >= 0) list.splice(i, 1);
    }
  };
  for (const live of street()) index(live);

  /** Bodies ahead of `live` along its own route, up to `limit` (route units), as route-coordinate intervals. */
  const ahead = (live: Live, limit: number) => {
    const out = new Map<Live, { rear: number; front: number }>();
    const last = edgeOf(live, Math.min(limit, (live.route.length - 1) * U));
    for (let e = edgeOf(live); e <= last; e += 1) {
      for (const b of lanes.get(laneAt(live.route, e)) ?? []) {
        if (b.live === live) continue;
        const rear = e * U + b.rear, front = e * U + b.front;
        if (front <= live.s) continue;
        const seen = out.get(b.live);
        if (!seen) out.set(b.live, { rear, front });
        else out.set(b.live, { rear: Math.min(seen.rear, rear), front: Math.max(seen.front, front) });
      }
    }
    return out;
  };
  const nearestRear = (live: Live, limit: number) => {
    let best = Infinity;
    for (const o of ahead(live, limit).values()) best = Math.min(best, o.rear);
    return best;
  };

  /** Comfortable stopping distance at a speed (the movement rule itself never overshoots the free distance). */
  const stopping = (speed: number, brake: number) => Math.ceil(speed * speed / (2 * brake));
  /**
   * Whether traffic on the street is too close to a body about to appear there: a vehicle behind it on one of those
   * lanes (or about to enter them) that could not stop comfortably behind it, or one overlapping it.
   */
  /** Lane → street vehicles on it or about to enter it (their current and next two lanes). Rebuilt when needed. */
  let upcoming = new Map<string, { live: Live; e: number }[]>();
  const buildUpcoming = () => {
    upcoming = new Map();
    for (const other of street()) {
      const e0 = edgeOf(other);
      for (let e = Math.max(0, e0 - 1); e <= Math.min(other.route.length - 2, e0 + 2); e += 1) {
        const lane = laneAt(other.route, e);
        const list = upcoming.get(lane);
        if (list) list.push({ live: other, e }); else upcoming.set(lane, [{ live: other, e }]);
      }
    }
  };
  /**
   * Whether traffic on the street is too close to a body about to appear there: a vehicle behind it on one of those
   * lanes (or about to enter them) that could not stop behind it (comfortably, unless the merge has waited long), or
   * one overlapping it.
   */
  const approaching = (live: Live, bodies: readonly { lane: string; rear: number; front: number }[], comfortable = true) => {
    for (const b of bodies) {
      for (const { live: other, e } of upcoming.get(b.lane) ?? []) {
        if (other === live || other.removed) continue;
        const front = other.s - e * U, rear = front - other.len;
        if (rear >= b.front + GAP) continue;
        if (front <= b.rear - GAP - (comfortable ? stopping(other.speed, other.dyn.brake) : 0)) continue;
        return true;
      }
    }
    return false;
  };
  buildUpcoming();
  // A vehicle that has waited to pull out claims its spot once traffic can stop for it: it joins the lane index, so
  // the cars behind brake and let it in (no merge waits forever behind a steady stream).
  for (const live of lives) {
    if (live.removed || live.state !== 'departing' || live.waitTicks < MERGE_WAIT) continue;
    if (live.v.kind !== 'bus' && network.isJunction(live.route[0]!)) continue;
    const bodies = bodyOnLanes(live.route, live.s, live.len);
    const clear = bodies.every((b) => (lanes.get(b.lane) ?? []).every((o) => o.front + GAP <= b.rear || o.rear >= b.front + GAP));
    // Polite at first (traffic can stop comfortably), insistent after a while (a queued car behind simply stays put).
    if (clear && !approaching(live, bodies, live.waitTicks < MERGE_WAIT * 3)) index(live);
  }
  const holds = new Map<string, Hold[]>();
  const hold = (live: Live, i: number, mask: number) => {
    const key = tileAtIndex(live.route, i);
    const list = holds.get(key);
    const entry = { live, mask, index: i };
    if (list) list.push(entry); else holds.set(key, [entry]);
  };
  const buildHolds = () => {
    holds.clear();
    for (const live of street()) {
      const granted = new Set(live.grants.map((g) => g.index));
      for (const g of live.grants) hold(live, g.index, g.mask);
      const rear = live.s - live.len;
      for (let i = Math.max(0, Math.floor(rear / U)); i <= Math.min(live.route.length - 1, Math.ceil(live.s / U)); i += 1) {
        if (granted.has(i) || !(i * U - U / 2 < live.s && i * U + U / 2 > rear) || !network.isJunction(live.route[i]!)) continue;
        hold(live, i, maskAt(live.route, i));
      }
    }
  };
  buildHolds();
  /** Same tiles, in the same order, through this junction run: such vehicles may follow each other in. */
  const samePath = (a: Live, ai: number, b: Live, bi: number, span: number) => {
    for (let d = -1; d <= span + 1; d += 1) {
      const x = a.route[ai + d], y = b.route[bi + d];
      if (x === undefined && y === undefined) continue;
      if (x === undefined || y === undefined || x.x !== y.x || x.y !== y.y) return false;
    }
    return true;
  };
  const blocked = new Map<string, number>();
  /** The next run of junction tiles ahead of the front that this vehicle may not enter yet. */
  const nextRun = (live: Live): { k: number; m: number } | null => {
    const granted = new Set(live.grants.map((g) => g.index));
    for (let k = Math.max(0, Math.floor((live.s + U / 2) / U)); k < live.route.length; k += 1) {
      if (k * U - U / 2 <= live.s) continue;
      if (k * U - U / 2 - live.s > live.dyn.maxSpeed + TRANSPORT.stopMargin + U) return null;
      if (!network.isJunction(live.route[k]!) || granted.has(k)) continue;
      let m = k;
      while (m + 1 < live.route.length && network.isJunction(live.route[m + 1]!)) m += 1;
      return { k, m };
    }
    return null;
  };
  /**
   * Grants junction tiles k…m if no other vehicle holds a conflicting quadrant (vehicles taking exactly the same path
   * may follow each other) and there is room to leave the last tile completely (for followers, behind them).
   */
  const tryGrant = (live: Live, k: number, m: number): boolean => {
    const masks: number[] = [];
    for (let i = k; i <= m; i += 1) masks.push(i === 0 && live.state === 'departing' ? 0b1111 : maskAt(live.route, i));
    const peers = new Set<Live>();
    for (let i = k; i <= m; i += 1) {
      const key = tileAtIndex(live.route, i), mask = masks[i - k]!;
      if (live.waitTicks < FAIR_WAIT && ((blocked.get(key) ?? 0) & mask)) return false;
      for (const h of holds.get(key) ?? []) {
        if (h.live === live || !(h.mask & mask)) continue;
        if (live.state !== 'departing' && samePath(live, i, h.live, h.index, m - i)) { peers.add(h.live); continue; }
        if (live.waitTicks >= FAIR_WAIT) for (let j = k; j <= m; j += 1) blocked.set(tileAtIndex(live.route, j), (blocked.get(tileAtIndex(live.route, j)) ?? 0) | masks[j - k]!);
        return false;
      }
    }
    const end = endOf(live);
    const exit = Math.min(m * U + U / 2 + live.len, end);
    if (exit < end || m < live.route.length - 1) {
      const items: { rear: number; front: number; speed: number; peer: Live | null }[] = [...ahead(live, exit + 4 * U).entries()]
        .map(([other, o]) => ({ ...o, speed: other.state === 'departing' ? 0 : other.speed, peer: peers.has(other) ? other : null }));
      for (let j = m + 1; j < live.route.length; j += 1) {
        if (!network.isJunction(live.route[j]!)) continue;
        const line = j * U - U / 2 - TRANSPORT.stopMargin + GAP;
        items.push({ rear: line, front: line, speed: 0, peer: null });
        break;
      }
      items.sort((a, b) => a.front - b.front);
      let needed = exit;
      for (const item of items) {
        if (item.peer) { needed += GAP + item.peer.len; continue; }
        // A moving vehicle ahead is credited with one tick of its current speed (a stream keeps its gaps); a stopped
        // one only with where it stands.
        if (item.rear + item.speed - GAP < needed) return false;
        break;
      }
    }
    for (let i = k; i <= m; i += 1) { live.grants.push({ index: i, mask: masks[i - k]! }); hold(live, i, masks[i - k]!); }
    return true;
  };

  const desiredOf = (live: Live) => Math.min(live.dyn.maxSpeed, live.speed + live.dyn.accel);
  // Junction requests, longest wait first.
  const requests = street().filter((l) => l.state !== 'dwelling').map((live) => ({ live, run: nextRun(live) }))
    .filter((r): r is { live: Live; run: { k: number; m: number } } => r.run !== null &&
      r.run.k * U - U / 2 - TRANSPORT.stopMargin - r.live.s <= desiredOf(r.live))
    .sort((a, b) => b.live.waitTicks - a.live.waitTicks || (a.live.v.id < b.live.v.id ? -1 : 1));
  for (const r of requests) tryGrant(r.live, r.run.k, r.run.m);

  // Movement, front to back within each lane.
  const delays = new Map<string, number>();
  const movers = street().filter((l) => l.state !== 'dwelling').map((live) => ({ live, lane: laneAt(live.route, edgeOf(live)), offset: live.s - edgeOf(live) * U }))
    .sort((a, b) => a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : b.offset - a.offset || (a.live.v.id < b.live.v.id ? -1 : 1));
  for (const { live, lane } of movers) {
    const desired = desiredOf(live);
    const end = endOf(live);
    const toEnd = Math.max(0, end - live.s);
    let free = toEnd;
    const rear = nearestRear(live, live.s + desired + GAP + U);
    if (rear !== Infinity) free = Math.min(free, rear - GAP - live.s);
    let atJunction = false;
    const run = nextRun(live);
    if (run) {
      const line = run.k * U - U / 2 - TRANSPORT.stopMargin;
      if (line - live.s < free) { free = line - live.s; atJunction = true; }
    }
    const cap = (distance: number) => Math.floor(Math.sqrt(2 * live.dyn.brake * Math.max(0, distance)));
    const move = Math.max(0, Math.min(desired, cap(free), free));
    const unhindered = Math.max(0, Math.min(desired, cap(toEnd), toEnd));
    if (unhindered > move) delays.set(lane, (delays.get(lane) ?? 0) + unhindered - move);
    if (move > 0) { unindex(live); live.s += move; index(live); }
    live.speed = move;
    live.waitTicks = move > 0 ? 0 : live.waitTicks + 1;
    live.state = move > 0 ? 'moving' : atJunction && free <= 0 ? 'junction' : 'queued';
    const behind = live.s - live.len;
    live.grants = live.grants.filter((g) => behind < g.index * U + U / 2);
  }

  // 4. Arrivals and bus stops.
  const stopQueues = new Map<string, Trip[]>();
  for (const trip of trips.values()) {
    if (trip.phase !== 'waiting') continue;
    const list = stopQueues.get(trip.boardStopId!) ?? [];
    list.push(trip);
    stopQueues.set(trip.boardStopId!, list);
  }
  for (const list of stopQueues.values()) list.sort((a, b) => a.phaseTick - b.phaseTick || (a.citizenId < b.citizenId ? -1 : 1));
  for (const live of lives) {
    if (live.removed || live.state === 'departing') continue;
    const end = endOf(live);
    if (live.v.kind === 'bus') {
      const stop = stopAt(live);
      if (!stop) continue;
      const arriving = live.state !== 'dwelling' && live.s >= end;
      if (!arriving && live.state !== 'dwelling') continue;
      if (live.state === 'dwelling') live.dwell = Math.max(0, live.dwell - 1);
      let moved = 0;
      if (arriving) {
        // Riders for this stop get off and walk on.
        const staying: string[] = [];
        for (const id of live.passengers) {
          const trip = trips.get(id), rider = getCitizen(id);
          if (!rider || !trip) continue;
          if (trip.alightStopId !== stop.id) { staying.push(id); continue; }
          trips.delete(id);
          moved += 1;
          setCitizen({ ...rider, position: { x: stop.tile.x + 0.5, y: stop.tile.y + 0.5 }, activity: 'idle', movement: walkingFrom(rider.movement!) });
          today = { ...today, busCompleted: today.busCompleted + 1, busMinutes: today.busMinutes + (tick - trip.startedTick), busExpected: today.busExpected + trip.estimatedMinutes };
          events.push({ type: 'transport.alighted', tick, citizenId: id, vehicleId: live.v.id, stopId: stop.id });
          events.push({ type: 'transport.trip-completed', tick, citizenId: id, mode: 'bus', minutes: tick - trip.startedTick });
        }
        live.passengers = staying;
      }
      // Waiting residents board in arrival order while there is room (also during the dwell).
      const queue = stopQueues.get(stop.id) ?? [];
      const remaining: Trip[] = [];
      let full = 0, boarded = 0;
      for (const trip of queue) {
        if (trip.lineId !== live.v.lineId || live.withdraw) { remaining.push(trip); continue; }
        if (live.passengers.length >= TRANSPORT.busCapacity) { full += 1; remaining.push(trip); continue; }
        const rider = getCitizen(trip.citizenId);
        if (!rider) continue;
        live.passengers.push(rider.id);
        moved += 1; boarded += 1;
        trips.set(rider.id, { ...trip, phase: 'riding', vehicleId: live.v.id, phaseTick: tick });
        today = { ...today, boardings: today.boardings + 1 };
        if (economy) economy = recordTransit(economy, 'fare', rider.id, TRANSPORT.fare);
        events.push({ type: 'transport.boarded', tick, citizenId: rider.id, vehicleId: live.v.id, stopId: stop.id });
      }
      stopQueues.set(stop.id, remaining);
      // Reported once per stop visit: when the bus pulls in, or when it fills up while boarding.
      if (full > 0 && (arriving || boarded > 0)) {
        today = { ...today, fullBuses: today.fullBuses + full };
        events.push({ type: 'transport.bus-full', tick, vehicleId: live.v.id, stopId: stop.id, left: full });
      }
      if (arriving) { live.state = 'dwelling'; live.speed = 0; live.dwell = TRANSPORT.busDwellTicks + Math.ceil(moved / TRANSPORT.boardingPerTick); }
      else if (moved > 0) live.dwell = Math.max(live.dwell, Math.ceil(moved / TRANSPORT.boardingPerTick));
      continue;
    }
    if (live.s < end) continue;
    // A car or van reached its curb: it parks in the lot.
    unindex(live);
    live.removed = true;
    streetCache = null;
    if (live.v.kind === 'van') {
      if (live.destination !== live.v.ownerId) {
        // Delivered: head back to the mall from here (a fresh trip, departing from the home's curb).
        const back = network.carRoute(live.destination!, live.v.ownerId!);
        if (back) {
          const { origin, path } = encodePath(back.tiles);
          const van = addVehicle({ ...live.v, origin, path, edge: 0, offset: 0, speed: 0, state: 'departing', waitTicks: 0, grants: [],
            destinationBuildingId: live.v.ownerId, departedTick: tick, plannedRevision: world.revision });
          van.routeChanged = false;
        }
      }
      continue;
    }
    const owner = getCitizen(live.v.ownerId!), trip = trips.get(live.v.ownerId!);
    const destination = navigator.getBuilding(live.destination);
    if (!owner || !trip || !destination) continue;
    trips.delete(owner.id);
    const activity = owner.movement!.arrivalActivity;
    setCitizen({ ...owner, position: buildingCenter(destination), activity, targetBuildingId: destination.id, movement: insideMovement(destination.id, world.revision, activity) });
    parkCar(owner.id, destination.id === owner.homeBuildingId ? null : destination.id);
    const minutes = tick - trip.startedTick;
    today = { ...today, carCompleted: today.carCompleted + 1, carMinutes: today.carMinutes + minutes, carExpected: today.carExpected + trip.estimatedMinutes };
    if (economy) economy = recordTransit(economy, 'car', owner.id, TRANSPORT.carTripCost);
    events.push({ type: 'citizen.arrived', tick, citizenId: owner.id, buildingId: destination.id });
    events.push({ type: 'transport.trip-completed', tick, citizenId: owner.id, mode: 'car', minutes });
  }

  // Pulling out: vehicles leave their lot (or a bus enters service at its first stop) when the lane has room.
  const departing = lives.filter((l) => !l.removed && l.state === 'departing').sort((a, b) => b.waitTicks - a.waitTicks || (a.v.id < b.v.id ? -1 : 1));
  if (departing.length) { buildHolds(); buildUpcoming(); }
  for (const live of departing) {
    const s0 = live.s;
    let ok: boolean;
    if (live.v.kind !== 'bus' && network.isJunction(live.route[0]!)) {
      let m = 0;
      while (m + 1 < live.route.length && network.isJunction(live.route[m + 1]!)) m += 1;
      ok = !approaching(live, bodyOnLanes(live.route, s0, live.len), live.waitTicks < MERGE_WAIT * 3) && tryGrant(live, 0, m);
    } else {
      const bodies = bodyOnLanes(live.route, s0, live.len);
      ok = bodies.every((b) => (lanes.get(b.lane) ?? []).every((o) => o.live === live || o.front + GAP <= b.rear || o.rear >= b.front + GAP)) &&
        !approaching(live, bodies, live.waitTicks < MERGE_WAIT * 3);
      // A bus entering service must not stop inside a junction's box with its tail.
      if (ok && live.v.kind === 'bus') {
        const tailTile = Math.floor((s0 - live.len + U / 2) / U);
        for (let i = Math.max(0, tailTile); i <= Math.floor((s0 + U / 2) / U); i += 1) if (network.isJunction(live.route[i]!)) ok = false;
      }
    }
    if (!ok) {
      live.waitTicks += 1;
      // A driver who cannot get out of a full lot for this long walks instead (not a traffic stall).
      if (live.waitTicks >= TRANSPORT.stallLimit) removeVehicle(live, live.v.kind === 'car' ? 'gave-up' : 'stalled');
      continue;
    }
    live.waitTicks = 0;
    live.state = live.v.kind === 'bus' ? 'dwelling' : 'moving';
    streetCache = null;
    live.dwell = live.v.kind === 'bus' ? TRANSPORT.busDwellTicks : 0;
    unindex(live);
    index(live);
    for (let e = 0; e <= Math.min(live.route.length - 2, edgeOf(live) + 2); e += 1) {
      const lane = laneAt(live.route, e);
      const list = upcoming.get(lane);
      if (list) list.push({ live, e }); else upcoming.set(lane, [{ live, e }]);
    }
    if (live.v.kind === 'car') {
      const owner = getCitizen(live.v.ownerId!);
      if (owner) setCitizen({ ...owner, position: { x: live.route[0]!.x + 0.5, y: live.route[0]!.y + 0.5 } });
    }
  }

  // Long stalls end: the vehicle pulls over (no jam is permanent).
  for (const live of lives) if (!live.removed && live.state !== 'departing' && live.state !== 'dwelling' && live.waitTicks >= TRANSPORT.stallLimit) { unindex(live); removeVehicle(live, 'stalled'); }

  // Residents who waited too long give up and walk.
  for (const trip of [...trips.values()]) {
    if (trip.phase !== 'waiting' || tick - trip.phaseTick < TRANSPORT.maxWaitMinutes) continue;
    const c = getCitizen(trip.citizenId);
    cancelTrip(trip, 'gave-up');
    if (c) setCitizen({ ...c, activity: 'idle', movement: walkingFrom(c.movement!) });
  }

  // Drivers and riders are where their vehicle is.
  const remaining = lives.filter((l) => !l.removed);
  for (const live of remaining) {
    if (live.state === 'departing') continue;
    const at = tileAt(live);
    const here = { x: at.x + 0.5, y: at.y + 0.5 };
    const ids = live.v.kind === 'car' ? [live.v.ownerId!] : live.passengers;
    for (const id of ids) {
      const c = getCitizen(id);
      if (c && (c.position.x !== here.x || c.position.y !== here.y)) setCitizen({ ...c, position: here });
    }
  }

  // 5. Congestion: lost progress per lane, smoothed; routing penalties frozen once per epoch.
  const congestion: Record<string, number> = {};
  const decay = TRANSPORT.congestion.decayShift;
  for (const [key, value] of Object.entries(t.congestion)) {
    const next = value - (value >> decay) + (delays.get(key) ?? 0);
    if (next > 0 && network.hasLane(key)) congestion[key] = next;
  }
  for (const [key, delay] of delays) if (!(key in t.congestion) && delay > 0) congestion[key] = delay;
  let routing = t.routing;
  if (tick % TRANSPORT.routing.epochTicks === 0) {
    const snapshot: Record<string, number> = {};
    for (const key of Object.keys(congestion).sort()) {
      const penalty = Math.min(TRANSPORT.routing.maxCongestionPenalty, Math.floor(congestion[key]! / TRANSPORT.routing.congestionDivisor));
      if (penalty > 0) snapshot[key] = penalty;
    }
    routing = snapshot;
  }
  const onStreet = remaining.filter((l) => l.state !== 'departing').length;
  if (onStreet > today.peakVehicles) today = { ...today, peakVehicles: onStreet };
  const vehicles = remaining.map(frozenVehicle).sort((a, b) => a.id < b.id ? -1 : 1);
  const tripList = tripsChanged ? [...trips.values()].sort((a, b) => a.citizenId < b.citizenId ? -1 : 1) : t.trips;
  return { events, state: { ...world, citizens, ...(economy ? { economy } : {}),
    transport: { ...t, nextTripId, lines, vehicles, trips: tripList, parkedCars, congestion: sortedRecord(congestion), routing, vanRounds, today, history, experience } } };
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]!]));
}
function hashColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 8;
}
