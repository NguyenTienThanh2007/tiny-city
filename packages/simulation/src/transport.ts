import { getGameTime } from './clock.js';
import { tileKey } from './grid.js';
import { buildingCenter, RoadNavigator, type RouteResult } from './navigation.js';
import { insideMovement } from './population.js';
import { TRANSPORT } from './transportConfig.js';
import { decodePath, directionBetween, encodePath, TransportNetwork } from './transportGraph.js';
import type {
  Building, BusLine, BusStop, Citizen, CitizenActivity, CitizenMovement, Position, SimulationEvent, TransportCommand, TransportDayStats,
  TransportRejectionReason, TransportState, Trip, Vehicle, VehicleModel, WorldState,
} from './types.js';

/**
 * Phase 6 transportation state, commands, mode choice and reconciliation. The per-tick vehicle movement lives in
 * `transportStep.ts`.
 *
 * Vehicles exist only because of real demand: a resident's car trip (their own car, which stays where they parked
 * it), a bus line the player created, or a staffed mall's delivery van. Walking stays the default; `planTrip` picks a
 * mode from door-to-door estimates when a resident leaves a building.
 */

/** FNV-1a: stable 32-bit hash (same as Life's venue ranking). */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

const ownershipKey = (home: Building | undefined) =>
  home?.type === 'villa' || home?.type === 'duplex' || home?.type === 'townhouse' || home?.type === 'apartment' ? home.type : 'other';
/** Whether a resident owns a car: a stable per-resident draw against their home type's ownership rate. */
export function ownsCar(citizenId: string, home: Building | undefined): boolean {
  return hash(`car|${citizenId}`) % 100 < TRANSPORT.carOwnership[ownershipKey(home)];
}
/** A resident's car model and color, stable for their ID (larger homes lean to larger cars). */
export function carLook(citizenId: string, home: Building | undefined): { model: VehicleModel; color: number } {
  const roll = hash(`model|${citizenId}`) % 100;
  const key = ownershipKey(home);
  const [compact, sedan] = key === 'villa' ? [15, 50] : key === 'apartment' ? [55, 90] : [35, 75];
  return { model: roll < compact ? 'compact' : roll < sedan ? 'sedan' : 'suv', color: hash(`color|${citizenId}`) % 8 };
}
export const carIdOf = (citizenId: string) => `car-${citizenId}`;
export const vanIdOf = (mallId: string) => `van-${mallId}`;
export const busIdOf = (lineId: string, k: number) => `${lineId}-bus-${k}`;

export function emptyDay(day: number): TransportDayStats {
  return { day, walkTrips: 0, carTrips: 0, busTrips: 0, carCompleted: 0, carMinutes: 0, carExpected: 0, busCompleted: 0, busMinutes: 0, busExpected: 0, boardings: 0,
    fullBuses: 0, gaveUp: 0, cancelled: 0, stalls: 0, peakVehicles: 0 };
}

export function createTransport(world: WorldState): TransportState {
  return { version: 1, nextStopId: 1, nextLineId: 1, nextTripId: 1, stops: [], lines: [], vehicles: [], trips: [], parkedCars: {},
    congestion: {}, routing: {}, vanRounds: {}, today: emptyDay(getGameTime(world.clock).day), history: [], experience: { car: 100, bus: 100 } };
}

export function cloneVehicle(v: Vehicle): Vehicle {
  return { id: v.id, kind: v.kind, model: v.model, color: v.color, origin: { x: v.origin.x, y: v.origin.y }, path: v.path, edge: v.edge,
    offset: v.offset, speed: v.speed, state: v.state, waitTicks: v.waitTicks, grants: v.grants.map((g) => ({ index: g.index, mask: g.mask })),
    ownerId: v.ownerId, destinationBuildingId: v.destinationBuildingId, lineId: v.lineId, stopIndex: v.stopIndex, passengers: [...v.passengers],
    dwell: v.dwell, departedTick: v.departedTick, plannedRevision: v.plannedRevision };
}

export function cloneTransport(t: TransportState): TransportState {
  return {
    version: t.version, nextStopId: t.nextStopId, nextLineId: t.nextLineId, nextTripId: t.nextTripId,
    stops: t.stops.map((s) => ({ id: s.id, name: s.name, tile: { x: s.tile.x, y: s.tile.y } })),
    lines: t.lines.map((l) => ({ id: l.id, name: l.name, color: l.color, stopIds: [...l.stopIds], buses: l.buses, status: l.status,
      suspendedReason: l.suspendedReason, lastDispatchTick: l.lastDispatchTick })),
    vehicles: t.vehicles.map(cloneVehicle),
    trips: t.trips.map((trip) => ({ ...trip })),
    parkedCars: { ...t.parkedCars }, congestion: { ...t.congestion }, routing: { ...t.routing }, vanRounds: { ...t.vanRounds },
    today: { ...t.today }, history: t.history.map((d) => ({ ...d })), experience: { car: t.experience.car, bus: t.experience.bus },
  };
}

const KINDS = new Set(['car', 'van', 'bus']);
const MODELS = new Set(['compact', 'sedan', 'suv', 'van', 'bus']);
const STATES = new Set(['departing', 'moving', 'queued', 'junction', 'dwelling']);
const PHASES = new Set(['to-stop', 'waiting', 'riding', 'driving']);

/** Package-local snapshot validation; every reference must resolve and every vehicle must be on real road lanes. */
export function validateTransport(world: WorldState, assert: (condition: boolean, message: string) => asserts condition): void {
  const t = world.transport;
  const vehicleCitizens = world.citizens.filter((c) => c.movement?.status === 'vehicle');
  if (t === undefined) { assert(vehicleCitizens.length === 0, 'residents use transport without a transport system'); return; }
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  const cursor = (prefix: string, id: string, next: number) => {
    const match = new RegExp(`^${prefix}-([1-9]\\d*)$`).exec(id);
    return match !== null && Number(match[1]) < next;
  };
  assert(t.version === 1 && [t.nextStopId, t.nextLineId, t.nextTripId].every((n) => Number.isSafeInteger(n) && n >= 1), 'invalid transport version or cursors');
  const roads = new Set(world.plan.roads.map(tileKey));
  const buildings = new Map(world.plan.buildings.map((b) => [b.id, b]));
  const citizens = new Map(world.citizens.map((c) => [c.id, c]));
  assert(t.stops.length <= TRANSPORT.maxStops && t.lines.length <= TRANSPORT.maxLines, 'too many stops or lines');
  const stops = new Map<string, BusStop>(), stopTiles = new Set<string>();
  for (const stop of t.stops) {
    assert(cursor('stop', stop.id, t.nextStopId) && !stops.has(stop.id), 'invalid or duplicate stop id');
    assert(typeof stop.name === 'string' && stop.name.trim().length > 0 && stop.name.length <= 40, 'invalid stop name');
    assert(roads.has(tileKey(stop.tile)) && !stopTiles.has(tileKey(stop.tile)), 'stops must be on distinct road tiles');
    stops.set(stop.id, stop); stopTiles.add(tileKey(stop.tile));
  }
  const lines = new Map<string, BusLine>();
  for (const line of t.lines) {
    assert(cursor('line', line.id, t.nextLineId) && !lines.has(line.id), 'invalid or duplicate line id');
    assert(typeof line.name === 'string' && line.name.trim().length > 0 && line.name.length <= 40 && count(line.color) && line.color < 8, 'invalid line name or color');
    assert(line.stopIds.length <= TRANSPORT.maxStopsPerLine && new Set(line.stopIds).size === line.stopIds.length && line.stopIds.every((id) => stops.has(id)), 'invalid line stops');
    assert(line.status === 'suspended' || line.stopIds.length >= TRANSPORT.minStopsPerLine, 'an active line needs at least two stops');
    assert(Number.isSafeInteger(line.buses) && line.buses >= TRANSPORT.minBusesPerLine && line.buses <= TRANSPORT.maxBusesPerLine, 'invalid bus count');
    assert(line.status === 'active' ? line.suspendedReason === null : line.suspendedReason === 'stop-removed' || line.suspendedReason === 'unreachable', 'invalid line status');
    assert(Number.isSafeInteger(line.lastDispatchTick) && line.lastDispatchTick >= -1, 'invalid dispatch tick');
    lines.set(line.id, line);
  }
  assert(t.vehicles.length <= TRANSPORT.activeVehicleLimit + TRANSPORT.maxLines * TRANSPORT.maxBusesPerLine + world.plan.buildings.length, 'too many vehicles');
  const vehicles = new Map<string, Vehicle>();
  const riders = new Set<string>();
  let previousId = '';
  for (const v of t.vehicles) {
    assert(typeof v.id === 'string' && v.id > previousId, 'vehicles must be unique and sorted by id');
    previousId = v.id;
    assert(KINDS.has(v.kind) && MODELS.has(v.model) && STATES.has(v.state) && count(v.color) && v.color < 8, 'invalid vehicle kind, model, state or color');
    assert(typeof v.path === 'string' && /^[NESW]+$/.test(v.path) && v.path.length < TRANSPORT.maxRouteTiles, 'invalid vehicle route');
    const route = decodePath(v.origin, v.path);
    assert(route.every((tile) => roads.has(tileKey(tile))), 'vehicle route leaves the road network');
    assert(Number.isSafeInteger(v.edge) && v.edge >= 0 && v.edge <= route.length - 2 && Number.isSafeInteger(v.offset) && v.offset >= 0 && v.offset <= TRANSPORT.unitsPerTile, 'invalid vehicle position');
    const dyn = TRANSPORT.vehicles[v.kind];
    assert(Number.isSafeInteger(v.speed) && v.speed >= 0 && v.speed <= dyn.maxSpeed && count(v.waitTicks) && count(v.departedTick) && count(v.dwell), 'invalid vehicle motion');
    assert(Number.isSafeInteger(v.plannedRevision) && v.plannedRevision >= -1 && v.plannedRevision <= world.revision, 'invalid vehicle route revision');
    assert(v.grants.every((g) => Number.isSafeInteger(g.index) && g.index >= 0 && g.index < route.length && Number.isInteger(g.mask) && g.mask > 0 && g.mask <= 15), 'invalid junction grant');
    assert(v.state !== 'departing' || v.grants.length === 0, 'a departing vehicle cannot hold a junction');
    if (v.kind === 'car') {
      assert(v.ownerId !== null && v.id === carIdOf(v.ownerId) && citizens.has(v.ownerId), 'car without a resident owner');
      assert(v.destinationBuildingId !== null && buildings.has(v.destinationBuildingId) && v.lineId === null && v.passengers.length === 0, 'invalid car trip');
    } else if (v.kind === 'van') {
      assert(v.ownerId !== null && v.id === vanIdOf(v.ownerId) && buildings.get(v.ownerId)?.type === 'mall', 'van without a mall');
      assert(v.destinationBuildingId !== null && buildings.has(v.destinationBuildingId) && v.passengers.length === 0, 'invalid van trip');
    } else {
      const line = v.lineId === null ? undefined : lines.get(v.lineId);
      assert(line !== undefined && line.status === 'active' && Number.isSafeInteger(v.stopIndex) && v.stopIndex >= 0 && v.stopIndex < line.stopIds.length, 'bus without an active line');
      assert(v.passengers.length <= TRANSPORT.busCapacity && new Set(v.passengers).size === v.passengers.length, 'bus capacity exceeded');
      for (const id of v.passengers) { assert(!riders.has(id), 'resident on two buses'); riders.add(id); }
    }
    vehicles.set(v.id, v);
  }
  const trips = new Map<string, Trip>();
  previousId = '';
  for (const trip of t.trips) {
    assert(trip.citizenId > previousId && cursor('trip', trip.id, t.nextTripId), 'trips must be unique per resident and sorted');
    previousId = trip.citizenId;
    const c = citizens.get(trip.citizenId);
    assert(c !== undefined && PHASES.has(trip.phase) && (trip.mode === 'car' || trip.mode === 'bus'), 'trip without a resident or with an invalid phase');
    assert(buildings.has(trip.originBuildingId) || trip.phase !== 'driving' || vehicles.get(trip.vehicleId ?? '')?.state !== 'departing', 'departing trip without its origin');
    assert(buildings.has(trip.destinationBuildingId) && c.movement?.destinationBuildingId === trip.destinationBuildingId, 'trip destination does not match the resident');
    assert(count(trip.startedTick) && count(trip.phaseTick) && Number.isFinite(trip.estimatedMinutes) && trip.estimatedMinutes >= 0, 'invalid trip timing');
    if (trip.mode === 'car') {
      const car = vehicles.get(trip.vehicleId ?? '');
      assert(trip.phase === 'driving' && car?.kind === 'car' && car.ownerId === c.id && car.destinationBuildingId === trip.destinationBuildingId, 'car trip without its car');
    } else {
      const line = lines.get(trip.lineId ?? '');
      assert(trip.phase !== 'driving' && line !== undefined && stops.has(trip.alightStopId ?? '') && line.stopIds.includes(trip.alightStopId!), 'bus trip without its line');
      if (trip.phase === 'to-stop' || trip.phase === 'waiting') assert(trip.boardStopId !== null && line.stopIds.includes(trip.boardStopId) && trip.vehicleId === null, 'bus trip without its stop');
      if (trip.phase === 'riding') assert(vehicles.get(trip.vehicleId ?? '')?.passengers.includes(c.id) === true, 'rider is not on the bus');
    }
    assert(trip.phase === 'to-stop' ? c.movement?.status === 'travelling' : c.movement?.status === 'vehicle', 'trip phase does not match the resident movement');
    trips.set(trip.citizenId, trip);
  }
  for (const c of vehicleCitizens) assert(trips.has(c.id) && trips.get(c.id)!.phase !== 'to-stop' && c.movement!.destinationBuildingId !== null, 'resident in transport without a trip');
  for (const id of riders) assert(trips.get(id)?.phase === 'riding', 'bus rider without a riding trip');
  for (const [owner, building] of Object.entries(t.parkedCars)) assert(citizens.has(owner) && buildings.has(building), 'parked car with an unknown owner or place');
  for (const map of [t.congestion, t.routing]) for (const [key, value] of Object.entries(map)) {
    assert(/^-?\d+,-?\d+[NESW]$/.test(key) && Number.isSafeInteger(value) && value > 0, 'invalid congestion entry');
  }
  for (const [mall, n] of Object.entries(t.vanRounds)) assert(buildings.has(mall) && count(n), 'invalid van round');
  assert([t.experience.car, t.experience.bus].every((v) => Number.isSafeInteger(v) && v >= 100 && v <= 400), 'invalid travel experience');
  assert(t.history.length <= TRANSPORT.historyDays, 'transport history exceeds its bound');
  for (const day of [...t.history, t.today]) assert(Object.values(day).every(count), 'invalid transport statistics');
  assert(t.today.day === getGameTime(world.clock).day || t.today.day === getGameTime(world.clock).day - 1, 'transport day is out of step with the clock');
  assertNoOverlaps(world, vehicles, assert);
}

/** No two vehicle bodies overlap on the same lane (the core collision invariant). */
function assertNoOverlaps(world: WorldState, vehicles: ReadonlyMap<string, Vehicle>, assert: (condition: boolean, message: string) => asserts condition): void {
  const lanes = new Map<string, { rear: number; front: number; id: string }[]>();
  for (const v of vehicles.values()) {
    if (v.state === 'departing') continue;
    const route = decodePath(v.origin, v.path);
    const s = v.edge * TRANSPORT.unitsPerTile + v.offset, len = TRANSPORT.vehicles[v.kind].length;
    for (const body of bodyOnLanes(route, s, len)) {
      const list = lanes.get(body.lane) ?? [];
      list.push({ rear: body.rear, front: body.front, id: v.id });
      lanes.set(body.lane, list);
    }
  }
  for (const list of lanes.values()) {
    list.sort((a, b) => a.rear - b.rear || (a.id < b.id ? -1 : 1));
    for (let i = 1; i < list.length; i += 1) assert(list[i]!.rear >= list[i - 1]!.front || list[i]!.id === list[i - 1]!.id, 'vehicles overlap on a lane');
  }
  void world;
}

/** The lane segments a body covers: `rear`/`front` are offsets (0–100) along each lane. */
export function bodyOnLanes(route: readonly Position[], s: number, length: number): { lane: string; edge: number; rear: number; front: number }[] {
  const out: { lane: string; edge: number; rear: number; front: number }[] = [];
  const U = TRANSPORT.unitsPerTile;
  const last = route.length - 2;
  const rear = s - length;
  const first = rear <= 0 ? 0 : Math.min(last, Math.floor(rear / U));
  const end = s <= 0 ? 0 : Math.min(last, Math.ceil(s / U) - 1);
  for (let e = first; e <= end; e += 1) {
    const d = directionBetween(route[e]!, route[e + 1]!)!;
    const lo = Math.max(0, rear - e * U), hi = Math.min(U, s - e * U);
    if (hi > lo || hi === lo && s === e * U) out.push({ lane: `${route[e]!.x},${route[e]!.y}${d}`, edge: e, rear: lo, front: hi });
  }
  return out;
}

/* ───────────────────────────── Mode choice ───────────────────────────── */

/**
 * Day rollover of the remembered slowdown: three parts yesterday's memory, one part the day just finished (when at
 * least `experienceMinTrips` trips by that mode completed; otherwise memory relaxes towards 100).
 */
export function nextExperience(previous: TransportState['experience'], day: TransportDayStats): TransportState['experience'] {
  const blend = (memory: number, count: number, actual: number, expected: number) => {
    const observed = count >= TRANSPORT.experienceMinTrips && expected > 0 ? Math.min(400, Math.max(100, Math.round(actual * 100 / expected))) : 100;
    return Math.max(100, Math.round((memory * 3 + observed) / 4));
  };
  return { car: blend(previous.car, day.carCompleted, day.carMinutes, day.carExpected), bus: blend(previous.bus, day.busCompleted, day.busMinutes, day.busExpected) };
}

/** A resident's stable tolerance for a mode: their estimate is scaled by 80–120 percent. */
export const tolerance = (citizenId: string, mode: 'car' | 'bus') => 80 + hash(`${mode}|${citizenId}`) % 41;

export type TripPlan = { readonly mode: 'walk' } | { readonly mode: 'bus'; readonly route: readonly Position[] } | { readonly mode: 'car' };
const routeTiles = (route: readonly Position[]) => {
  let length = 0;
  for (let i = 1; i < route.length; i += 1) length += Math.abs(route[i]!.x - route[i - 1]!.x) + Math.abs(route[i]!.y - route[i - 1]!.y);
  return length;
};

/**
 * Per-tick mode choice and the hand-offs between walking (Life) and transport. Life calls `plan` when a resident
 * leaves a building, `reachedStop` when a walk ends, and `cancel` when it re-plans a walk; `advanceTransport` then
 * applies what was recorded. Deterministic: decisions depend only on the world state and the call order.
 */
export class TripPlanner {
  readonly started: { trip: Trip; vehicle: Vehicle | null }[] = [];
  readonly atStop = new Set<string>();
  readonly cancelled = new Set<string>();
  walkTrips = 0;
  private nextTripId: number;
  private readonly toStop: Set<string>;
  private readonly stops: Map<string, BusStop>;
  private readonly vehicleIds: Set<string>;

  constructor(private readonly world: WorldState, private readonly network: TransportNetwork) {
    const t = world.transport!;
    this.nextTripId = t.nextTripId;
    this.toStop = new Set(t.trips.filter((trip) => trip.phase === 'to-stop').map((trip) => trip.citizenId));
    this.stops = new Map(t.stops.map((s) => [s.id, s]));
    this.vehicleIds = new Set(t.vehicles.map((v) => v.id));
  }

  get nextTrip(): number { return this.nextTripId; }

  /** Resident `c` is inside `origin` and starting a trip to `target`; `walk` is their walking route. */
  plan(c: Citizen, origin: Building, target: Building, activity: CitizenActivity, walk: RouteResult): TripPlan {
    if (!walk.route || !c.attributes) return { mode: 'walk' };
    const t = this.world.transport!;
    const speed = c.attributes.walkingSpeed;
    const walkMinutes = routeTiles(walk.route) / speed;
    if (walkMinutes <= TRANSPORT.walkAlwaysMinutes) { this.walkTrips += 1; return { mode: 'walk' }; }
    const home = this.network.navigator.getBuilding(c.homeBuildingId);
    const tick = this.world.clock.tick;
    // Car: the resident's own car, if it is parked where they are.
    let car: { minutes: number; tiles: readonly Position[]; expected: number } | null = null;
    let mustDrive = false;
    const carId = carIdOf(c.id);
    if (ownsCar(c.id, home) && (t.parkedCars[c.id] ?? c.homeBuildingId) === origin.id && !this.vehicleIds.has(carId) &&
        t.vehicles.length + this.started.filter((s) => s.vehicle).length < TRANSPORT.activeVehicleLimit) {
      const route = this.network.carRoute(origin.id, target.id);
      if (route) {
        // Cars already waiting to leave this lot add to the wait (a jammed exit makes walking or the bus win).
        const queued = t.vehicles.filter((v) => v.state === 'departing' && v.kind === 'car' && tileKey(v.origin) === tileKey(route.tiles[0]!)).length +
          this.started.filter((s) => s.vehicle && tileKey(s.vehicle.origin) === tileKey(route.tiles[0]!)).length;
        const expected = route.cost / TRANSPORT.vehicles.car.maxSpeed + TRANSPORT.carOverheadMinutes + queued * TRANSPORT.departureMinutesPerQueuedCar;
        car = { minutes: expected * t.experience.car * tolerance(c.id, 'car') / 10_000, tiles: route.tiles, expected };
        // A car left away from home is always driven back (it never stays stranded at work).
        mustDrive = origin.id !== c.homeBuildingId;
      }
    }
    let bus: { minutes: number; lineId: string; board: BusStop; alight: string; route: readonly Position[]; expected: number } | null = null;
    if (!mustDrive && t.lines.length) {
      const option = this.network.busOption(origin, target, speed, t.lines, this.stops);
      const minutes = option ? option.minutes * t.experience.bus * tolerance(c.id, 'bus') / 10_000 : Infinity;
      if (option && minutes < walkMinutes && (!car || minutes < car.minutes)) {
        const board = this.stops.get(option.boardStopId)!;
        const leg = this.network.navigator.routeToRoad(c.position, origin.id, [board.tile]);
        if (leg.route) bus = { minutes, lineId: option.lineId, board, alight: option.alightStopId, route: leg.route, expected: option.minutes };
      }
    }
    const id = `trip-${this.nextTripId}`;
    if (car && (mustDrive || car.minutes < walkMinutes && (!bus || car.minutes <= bus.minutes))) {
      this.nextTripId += 1;
      const look = carLook(c.id, home);
      const { origin: start, path } = encodePath(car.tiles);
      const vehicle: Vehicle = { id: carId, kind: 'car', model: look.model, color: look.color, origin: start, path, edge: 0, offset: 0, speed: 0,
        state: 'departing', waitTicks: 0, grants: [], ownerId: c.id, destinationBuildingId: target.id, lineId: null, stopIndex: 0, passengers: [],
        dwell: 0, departedTick: tick, plannedRevision: this.world.revision };
      this.started.push({ vehicle, trip: { id, citizenId: c.id, mode: 'car', phase: 'driving', originBuildingId: origin.id, destinationBuildingId: target.id,
        vehicleId: carId, lineId: null, boardStopId: null, alightStopId: null, startedTick: tick, phaseTick: tick, estimatedMinutes: Math.round(car.expected) } });
      this.vehicleIds.add(carId);
      return { mode: 'car' };
    }
    if (bus) {
      this.nextTripId += 1;
      this.started.push({ vehicle: null, trip: { id, citizenId: c.id, mode: 'bus', phase: 'to-stop', originBuildingId: origin.id, destinationBuildingId: target.id,
        vehicleId: null, lineId: bus.lineId, boardStopId: bus.board.id, alightStopId: bus.alight, startedTick: tick, phaseTick: tick, estimatedMinutes: Math.round(bus.expected) } });
      this.toStop.add(c.id);
      return { mode: 'bus', route: bus.route };
    }
    this.walkTrips += 1;
    void activity;
    return { mode: 'walk' };
  }

  /** A walk just ended: true when it was the walk to a bus stop (the resident now waits there). */
  reachedStop(citizenId: string): boolean {
    if (!this.toStop.has(citizenId) || this.cancelled.has(citizenId)) return false;
    this.atStop.add(citizenId);
    return true;
  }

  /** Life re-planned a walk (a road edit, or a new destination): any walk to a stop is abandoned. */
  cancel(citizenId: string): void {
    if (this.toStop.has(citizenId)) { this.cancelled.add(citizenId); this.toStop.delete(citizenId); }
  }
}

/** Movement for a resident who now walks from a road tile (alighted, gave up, or lost their vehicle). */
export function walkingFrom(movement: CitizenMovement): CitizenMovement {
  return { ...movement, status: 'waiting', currentBuildingId: null, route: [], nextWaypoint: 0, plannedRevision: -1, heading: { x: 0, y: 0 } };
}

/**
 * Puts a resident back on foot near `position`: on that road tile, the nearest road within 8 tiles, or home.
 * Used when a trip ends somewhere a walk can start from.
 */
export function strandedOnFoot(c: Citizen, position: Position, navigator: RoadNavigator, revision: number): Citizen {
  const movement = c.movement!;
  const tile = { x: Math.floor(position.x), y: Math.floor(position.y) };
  if (navigator.graph.getComponentId(tile) !== null) return { ...c, position: { x: tile.x + 0.5, y: tile.y + 0.5 }, activity: 'idle', movement: walkingFrom(movement) };
  const road = navigator.nearestRoad(position, 8);
  if (road) return { ...c, position: { x: road.x + 0.5, y: road.y + 0.5 }, activity: 'idle', movement: walkingFrom(movement) };
  const home = navigator.getBuilding(c.homeBuildingId)!;
  return { ...c, position: buildingCenter(home), activity: 'home', targetBuildingId: home.id, movement: insideMovement(home.id, revision, 'home') };
}

/**
 * A departing car's driver gives up waiting to pull out (or the drive became impossible) and walks from the lot's
 * curb instead, so mode choice never loops on the same blocked car.
 */
export function backInside(c: Citizen, building: Building, navigator: RoadNavigator, revision: number): Citizen {
  const curb = navigator.getAccessPoints(building.id)[0];
  return strandedOnFoot(c, curb ? { x: curb.x + 0.5, y: curb.y + 0.5 } : buildingCenter(building), navigator, revision);
}

/* ───────────────────────────── Commands ───────────────────────────── */

export interface TransportChange {
  readonly state: WorldState;
  readonly events: SimulationEvent[];
  readonly reason: TransportRejectionReason | null;
  readonly lineId: string | null;
}

const isTile = (p: unknown): p is Position => p !== null && typeof p === 'object' && Number.isSafeInteger((p as Position).x) && Number.isSafeInteger((p as Position).y);

/** Bus line management. Stops are free to place; buses cost the city every day (settled by the economy). */
export function applyTransportCommand(world: WorldState, command: TransportCommand, network: TransportNetwork): TransportChange {
  const tick = world.clock.tick;
  const reject = (reason: TransportRejectionReason): TransportChange => ({ state: world, reason, lineId: null,
    events: [{ type: 'transport.command-rejected', tick, commandType: (command?.type ?? 'transport.create-line') as TransportCommand['type'], reason }] });
  const t = world.transport;
  if (!t) return reject('transport-disabled');
  if (command === null || typeof command !== 'object') return reject('invalid-command');
  const validName = (name: unknown) => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 40;
  const validBuses = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= TRANSPORT.minBusesPerLine && Number(n) <= TRANSPORT.maxBusesPerLine;
  switch (command.type) {
    case 'transport.create-line': {
      if (!Array.isArray(command.stops) || !command.stops.every(isTile)) return reject('invalid-command');
      if (t.lines.length >= TRANSPORT.maxLines) return reject('line-limit');
      if (command.stops.length < TRANSPORT.minStopsPerLine) return reject('too-few-stops');
      if (command.stops.length > TRANSPORT.maxStopsPerLine) return reject('too-many-stops');
      if (new Set(command.stops.map(tileKey)).size !== command.stops.length) return reject('duplicate-stop');
      if (!validBuses(command.buses)) return reject('invalid-buses');
      if (command.name !== undefined && !validName(command.name)) return reject('invalid-name');
      for (const tile of command.stops) {
        if (!network.isRoad(tile)) return reject('not-a-road');
        if (network.isJunction(tile)) return reject('stop-at-junction');
      }
      const existing = new Map(t.stops.map((s) => [tileKey(s.tile), s]));
      const created = command.stops.filter((tile) => !existing.has(tileKey(tile)));
      if (t.stops.length + created.length > TRANSPORT.maxStops) return reject('stop-limit');
      let nextStopId = t.nextStopId;
      const stops = [...t.stops];
      const stopIds = command.stops.map((tile) => {
        const found = existing.get(tileKey(tile));
        if (found) return found.id;
        const stop: BusStop = { id: `stop-${nextStopId}`, name: `Stop ${nextStopId}`, tile: { x: tile.x, y: tile.y } };
        nextStopId += 1; stops.push(stop); existing.set(tileKey(tile), stop);
        return stop.id;
      });
      const id = `line-${t.nextLineId}`;
      const line: BusLine = { id, name: command.name?.trim() ?? `Line ${t.nextLineId}`, color: (t.nextLineId - 1) % 8, stopIds, buses: command.buses,
        status: 'active', suspendedReason: null, lastDispatchTick: -1 };
      const plan = network.linePlan(line, new Map(stops.map((s) => [s.id, s])));
      if (!plan.plan) return reject('unreachable');
      return { reason: null, lineId: id, events: [{ type: 'transport.line-changed', tick, lineId: id, status: 'created', reason: null }],
        state: { ...world, transport: { ...t, nextStopId, nextLineId: t.nextLineId + 1, stops, lines: [...t.lines, line] } } };
    }
    case 'transport.delete-line': {
      const line = t.lines.find((l) => l.id === command.lineId);
      if (!line) return reject('line-not-found');
      const removed = removeLine(world, line.id, network.navigator);
      return { reason: null, lineId: line.id, state: removed.state,
        events: [...removed.events, { type: 'transport.line-changed', tick, lineId: line.id, status: 'deleted', reason: null }] };
    }
    case 'transport.set-buses': {
      const line = t.lines.find((l) => l.id === command.lineId);
      if (!line) return reject('line-not-found');
      if (!validBuses(command.buses)) return reject('invalid-buses');
      if (line.buses === command.buses) return reject('unchanged');
      return { reason: null, lineId: line.id, events: [],
        state: { ...world, transport: { ...t, lines: t.lines.map((l) => l.id === line.id ? { ...l, buses: command.buses } : l) } } };
    }
    case 'transport.rename-line': {
      const line = t.lines.find((l) => l.id === command.lineId);
      if (!line) return reject('line-not-found');
      if (!validName(command.name)) return reject('invalid-name');
      if (line.name === command.name.trim()) return reject('unchanged');
      return { reason: null, lineId: line.id, events: [],
        state: { ...world, transport: { ...t, lines: t.lines.map((l) => l.id === line.id ? { ...l, name: command.name.trim() } : l) } } };
    }
    default: return reject('invalid-command');
  }
}

/**
 * Removes a line: its buses leave the street (riders get off where the bus is and walk on), residents waiting for it
 * walk instead, and stops no other line uses are removed.
 */
function removeLine(world: WorldState, lineId: string, navigator: RoadNavigator): { state: WorldState; events: SimulationEvent[] } {
  const t = world.transport!;
  const tick = world.clock.tick;
  const events: SimulationEvent[] = [];
  const citizens = new Map(world.citizens.map((c) => [c.id, c]));
  const buses = t.vehicles.filter((v) => v.lineId === lineId);
  const affected = new Set<string>();
  for (const bus of buses) {
    const route = decodePath(bus.origin, bus.path);
    const at = route[Math.min(route.length - 1, Math.round((bus.edge * TRANSPORT.unitsPerTile + bus.offset) / TRANSPORT.unitsPerTile))]!;
    for (const id of bus.passengers) {
      const c = citizens.get(id);
      if (c) { citizens.set(id, strandedOnFoot(c, { x: at.x + 0.5, y: at.y + 0.5 }, navigator, world.revision)); affected.add(id); }
    }
  }
  for (const trip of t.trips) {
    if (trip.lineId !== lineId) continue;
    affected.add(trip.citizenId);
    const c = citizens.get(trip.citizenId);
    if (c && trip.phase === 'waiting') citizens.set(c.id, strandedOnFoot(c, c.position, navigator, world.revision));
    else if (c && trip.phase === 'to-stop') citizens.set(c.id, { ...c, movement: walkingFrom(c.movement!) });
    events.push({ type: 'transport.trip-cancelled', tick, citizenId: trip.citizenId, mode: 'bus', reason: 'line-removed' });
  }
  const lines = t.lines.filter((l) => l.id !== lineId);
  const used = new Set(lines.flatMap((l) => l.stopIds));
  return { events, state: { ...world, citizens: world.citizens.map((c) => citizens.get(c.id)!),
    transport: { ...t, lines, stops: t.stops.filter((s) => used.has(s.id)), vehicles: t.vehicles.filter((v) => v.lineId !== lineId),
      trips: t.trips.filter((trip) => !affected.has(trip.citizenId)), today: { ...t.today, cancelled: t.today.cancelled + affected.size } } } };
}

/* ───────────────────────────── Reconciliation ───────────────────────────── */

/**
 * After a city edit, undo or redo (deterministic):
 * - stops on removed roads are deleted and dropped from their lines; a line with fewer than two stops, or whose loop
 *   can no longer be driven, is suspended and its buses withdrawn (riders walk on); a line suspended as unreachable
 *   resumes by itself once the loop can be driven again;
 * - a vehicle on a removed tile pulls over (its driver or riders walk on from the nearest road; a car is taken home);
 *   a vehicle whose remaining route lost a tile is re-routed from its current lane, or pulls over if it cannot be;
 *   other routes stay valid and are improved a few vehicles per tick (new shortcuts);
 * - a trip whose destination was demolished heads home instead; trips of residents who left the city end;
 * - cars parked at demolished buildings are taken home.
 */
export function reconcileTransport(world: WorldState, previous: WorldState): { state: WorldState; events: SimulationEvent[] } {
  const t = world.transport;
  if (!t) return { state: world, events: [] };
  const tick = world.clock.tick;
  const events: SimulationEvent[] = [];
  const navigator = new RoadNavigator(world.plan);
  const network = new TransportNetwork(navigator);
  const buildings = new Map(world.plan.buildings.map((b) => [b.id, b]));
  const citizens = new Map(world.citizens.map((c) => [c.id, c]));
  let today = t.today;
  // Stops and lines.
  const stops = t.stops.filter((s) => network.isRoad(s.tile));
  const stopMap = new Map(stops.map((s) => [s.id, s]));
  const lines = t.lines.map((line): BusLine => {
    const stopIds = line.stopIds.filter((id) => stopMap.has(id));
    const lost = stopIds.length !== line.stopIds.length;
    if (stopIds.length < TRANSPORT.minStopsPerLine) return { ...line, stopIds, status: 'suspended', suspendedReason: 'stop-removed' };
    if (line.status === 'suspended' && line.suspendedReason === 'stop-removed' && !lost) return { ...line, stopIds };
    const plan = network.linePlan({ id: line.id, stopIds }, stopMap);
    if (!plan.plan) return { ...line, stopIds, status: 'suspended', suspendedReason: 'unreachable' };
    return { ...line, stopIds, status: 'active', suspendedReason: null };
  });
  for (const line of lines) {
    const before = t.lines.find((l) => l.id === line.id)!;
    if (before.status !== line.status || before.suspendedReason !== line.suspendedReason) events.push({ type: 'transport.line-changed', tick, lineId: line.id, status: line.status, reason: line.suspendedReason });
  }
  const lineMap = new Map(lines.map((l) => [l.id, l]));
  const trips = new Map(t.trips.map((trip) => [trip.citizenId, trip]));
  const parkedCars: Record<string, string> = {};
  for (const [owner, building] of Object.entries(t.parkedCars)) {
    const c = citizens.get(owner);
    if (c && buildings.has(building) && building !== c.homeBuildingId && ownsCar(owner, buildings.get(c.homeBuildingId))) parkedCars[owner] = building;
  }
  const cancel = (citizenId: string, mode: Trip['mode'], reason: Extract<SimulationEvent, { type: 'transport.trip-cancelled' }>['reason']) => {
    trips.delete(citizenId);
    today = { ...today, cancelled: today.cancelled + 1 };
    events.push({ type: 'transport.trip-cancelled', tick, citizenId, mode, reason });
  };
  // Residents who left the city, and destinations that no longer exist.
  for (const trip of [...trips.values()]) {
    const c = citizens.get(trip.citizenId);
    if (!c) { trips.delete(trip.citizenId); continue; }
    if (trip.phase === 'to-stop') {
      // Population reconciliation already reset this walker (any city edit re-plans walks); the stop walk ends here.
      trips.delete(trip.citizenId);
      if (c.movement?.status === 'travelling') citizens.set(c.id, { ...c, movement: walkingFrom(c.movement) });
      continue;
    }
    if (!buildings.has(trip.destinationBuildingId) || c.movement?.destinationBuildingId !== trip.destinationBuildingId) {
      const home = c.homeBuildingId;
      const destination = c.movement?.destinationBuildingId && buildings.has(c.movement.destinationBuildingId) ? c.movement.destinationBuildingId : home;
      trips.set(c.id, { ...trip, destinationBuildingId: destination });
      citizens.set(c.id, { ...c, targetBuildingId: destination, movement: { ...c.movement!, destinationBuildingId: destination,
        arrivalActivity: destination === home ? 'home' : c.movement!.arrivalActivity } });
    }
    if (trip.phase === 'waiting' && (!stopMap.has(trip.boardStopId ?? '') || lineMap.get(trip.lineId ?? '')?.status !== 'active' ||
        !lineMap.get(trip.lineId!)!.stopIds.includes(trip.alightStopId ?? ''))) {
      cancel(c.id, 'bus', 'stop-removed');
      citizens.set(c.id, strandedOnFoot(citizens.get(c.id)!, c.position, navigator, world.revision));
    }
  }
  // Vehicles.
  const vehicles: Vehicle[] = [];
  for (const v of t.vehicles) {
    const route = decodePath(v.origin, v.path);
    const s = v.edge * TRANSPORT.unitsPerTile + v.offset;
    const atTile = route[Math.min(route.length - 1, Math.round(s / TRANSPORT.unitsPerTile))]!;
    const owner = v.ownerId === null ? undefined : citizens.get(v.ownerId);
    const trip = v.kind === 'car' && v.ownerId ? trips.get(v.ownerId) : undefined;
    const pullOver = (reason: 'road-removed' | 'unreachable') => {
      if (v.kind === 'car' && owner) {
        if (trip) cancel(owner.id, 'car', reason);
        const origin = buildings.get(trip?.originBuildingId ?? '');
        citizens.set(owner.id, v.state === 'departing' && origin ? backInside(owner, origin, navigator, world.revision) : strandedOnFoot(owner, v.state === 'departing' && trip ?
          buildingCenter(buildings.get(owner.homeBuildingId)!) : { x: atTile.x + 0.5, y: atTile.y + 0.5 }, navigator, world.revision));
        delete parkedCars[owner.id];
      }
      if (v.kind === 'bus') for (const id of v.passengers) {
        const rider = citizens.get(id);
        if (!rider) continue;
        if (trips.has(id)) cancel(id, 'bus', reason);
        citizens.set(id, strandedOnFoot(rider, { x: atTile.x + 0.5, y: atTile.y + 0.5 }, navigator, world.revision));
      }
    };
    if (v.kind === 'car' && (!owner || !trip)) continue;
    if (v.kind === 'van' && (!buildings.has(v.ownerId!) || buildings.get(v.ownerId!)!.type !== 'mall')) continue;
    if (v.kind === 'bus') {
      const line = lineMap.get(v.lineId ?? '');
      const riders = v.passengers.filter((id) => citizens.has(id) && trips.get(id)?.phase === 'riding');
      if (!line || line.status !== 'active') { pullOver('road-removed'); continue; }
      if (v.stopIndex >= line.stopIds.length) { pullOver('road-removed'); continue; }
      const kept: Vehicle = { ...v, passengers: riders };
      const checked = keepOrReroute(kept, route, network, world.revision, () => {
        const stop = stopMap.get(line.stopIds[kept.stopIndex]!)!;
        return [stop.tile];
      });
      if (checked) vehicles.push(checked); else pullOver('road-removed');
      continue;
    }
    // Cars and vans.
    let destination = v.destinationBuildingId!;
    if (v.kind === 'car') destination = trips.get(v.ownerId!)!.destinationBuildingId;
    if (!buildings.has(destination)) destination = v.kind === 'van' ? v.ownerId! : owner!.homeBuildingId;
    if (v.state === 'departing') {
      const origin = v.kind === 'van' ? v.ownerId! : trip!.originBuildingId;
      const fresh = buildings.has(origin) ? network.carRoute(origin, destination) : null;
      if (!fresh) { pullOver('unreachable'); continue; }
      const { origin: start, path } = encodePath(fresh.tiles);
      vehicles.push({ ...v, origin: start, path, edge: 0, offset: 0, destinationBuildingId: destination, plannedRevision: world.revision });
      continue;
    }
    const target = { ...v, destinationBuildingId: destination };
    const changed = destination !== v.destinationBuildingId;
    const checked = keepOrReroute(target, route, network, world.revision, () => network.access(destination), changed);
    if (checked) vehicles.push(checked); else pullOver(network.isRoad(atTile) ? 'unreachable' : 'road-removed');
  }
  // Trips whose vehicle is gone (pulled over above) were cancelled; riders on removed buses too.
  const liveVehicles = new Set(vehicles.map((v) => v.id));
  for (const trip of [...trips.values()]) {
    if (trip.phase === 'riding' && !liveVehicles.has(trip.vehicleId ?? '')) trips.delete(trip.citizenId);
    if (trip.phase === 'driving' && !liveVehicles.has(trip.vehicleId ?? '')) trips.delete(trip.citizenId);
  }
  const congestion = Object.fromEntries(Object.entries(t.congestion).filter(([key]) => network.hasLane(key)));
  const routing = Object.fromEntries(Object.entries(t.routing).filter(([key]) => network.hasLane(key)));
  const vanRounds = Object.fromEntries(Object.entries(t.vanRounds).filter(([mall]) => buildings.get(mall)?.type === 'mall'));
  void previous;
  return { events, state: { ...world, citizens: world.citizens.filter((c) => citizens.has(c.id)).map((c) => citizens.get(c.id)!),
    transport: { ...t, stops, lines, vehicles, trips: [...trips.values()].sort((a, b) => a.citizenId < b.citizenId ? -1 : 1), parkedCars,
      congestion, routing, vanRounds, today } } };
}

/**
 * A vehicle whose remaining route still exists keeps it; otherwise it is re-routed from its current lane (or pulls
 * over: null). `forceReroute` re-plans even a valid route (the destination changed).
 */
function keepOrReroute(v: Vehicle, route: readonly Position[], network: TransportNetwork, revision: number, goals: () => readonly Position[], forceReroute = false): Vehicle | null {
  const s = v.edge * TRANSPORT.unitsPerTile + v.offset;
  const len = TRANSPORT.vehicles[v.kind].length;
  const firstNeeded = Math.max(0, Math.floor((s - len) / TRANSPORT.unitsPerTile));
  const remaining = route.slice(firstNeeded);
  const intact = remaining.every((tile) => network.isRoad(tile));
  if (intact && !forceReroute) {
    if (firstNeeded === 0 || route.slice(0, firstNeeded).every((tile) => network.isRoad(tile))) return v;
    // Tiles already driven past were removed: forget them (the stored route only ever holds real roads).
    const { origin, path } = encodePath(remaining);
    const shift = firstNeeded * TRANSPORT.unitsPerTile;
    const s2 = s - shift, edge = s2 <= 0 ? 0 : Math.min(remaining.length - 2, Math.ceil(s2 / TRANSPORT.unitsPerTile) - 1);
    return { ...v, origin, path, edge, offset: s2 - edge * TRANSPORT.unitsPerTile,
      grants: v.grants.map((g) => ({ index: g.index - firstNeeded, mask: g.mask })).filter((g) => g.index >= 0) };
  }
  // The body must still be on real lanes to drive on.
  const current = Math.min(route.length - 2, v.edge);
  const body = route.slice(firstNeeded, current + 2);
  if (!body.every((tile) => network.isRoad(tile))) return null;
  if (v.state === 'dwelling' && v.kind === 'bus' && intact) return v;
  // A vehicle inside (or cleared into) a junction is committed to its movement there: keep the route up to the tile
  // after the last such junction and re-plan only from that exit lane.
  const U = TRANSPORT.unitsPerTile;
  let exit = current + 1;
  for (let i = firstNeeded; i < route.length; i += 1) {
    const occupied = i * U - U / 2 < s && i * U + U / 2 > s - TRANSPORT.vehicles[v.kind].length;
    if ((v.grants.some((g) => g.index === i) || occupied && network.isJunction(route[i]!)) && i + 1 < route.length) exit = Math.max(exit, i + 1);
  }
  const committed = route.slice(firstNeeded, exit + 1);
  if (!committed.every((tile) => network.isRoad(tile))) return null;
  const from = route[exit - 1]!, to = route[exit]!;
  const direction = directionBetween(from, to)!;
  const laneOffset = exit - 1 === current ? s - current * U : 0;
  const next = network.routeFromLane(from, direction, laneOffset, goals());
  if (!next) return null;
  const tiles = [...route.slice(firstNeeded, exit - 1), ...next.tiles];
  const shift = firstNeeded;
  const { origin, path } = encodePath(tiles);
  const s2 = s - shift * U;
  const edge = s2 <= 0 ? 0 : Math.min(tiles.length - 2, Math.ceil(s2 / U) - 1);
  return { ...v, origin, path, edge, offset: s2 - edge * U,
    grants: v.grants.map((g) => ({ index: g.index - shift, mask: g.mask })).filter((g) => g.index >= 0 && g.index < tiles.length && tileKey(tiles[g.index]!) === tileKey(route[g.index + shift] ?? { x: -1, y: -1 })),
    plannedRevision: revision };
}

export { routeTiles };
