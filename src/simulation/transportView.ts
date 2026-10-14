import { BUILDING_CATALOG, decodePath, RoadNavigator, TRANSPORT, TransportNetwork } from '@tiny-city/simulation';
import type { BusLine, Position, TransportDayStats, TransportRejectionReason, Trip, Vehicle, WorldState } from '@tiny-city/simulation';

/**
 * Phase 6 transportation view models. Every number comes from the authoritative world (`world.transport`, the plan
 * and the economy reports); nothing is estimated for display except where labelled (a line's loop time from its real
 * route). Pure functions, so panels and tests agree.
 */
const U = TRANSPORT.unitsPerTile;
/** One free-flow network per plan (view models are recomputed at the HUD refresh rate). */
const networks = new WeakMap<object, TransportNetwork>();
export function networkFor(world: WorldState): TransportNetwork {
  let network = networks.get(world.plan);
  if (!network) { network = new TransportNetwork(new RoadNavigator(world.plan)); networks.set(world.plan, network); }
  return network;
}

export const MODEL_LABELS: Record<Vehicle['model'], string> = { compact: 'Compact car', sedan: 'Sedan', suv: 'SUV', van: 'Delivery van', bus: 'City bus' };
export const STATE_LABELS: Record<Vehicle['state'], string> = {
  departing: 'Pulling out', moving: 'Driving', queued: 'In traffic', junction: 'Waiting at an intersection', dwelling: 'At a stop',
};
export const CONGESTION_LABELS = ['Free-flowing', 'Slow', 'Heavy', 'Jammed'] as const;

export const rejectionText: Record<TransportRejectionReason, string> = {
  'transport-disabled': 'Transportation is not running in this city yet.',
  'invalid-command': 'That bus line request was not valid.',
  'line-limit': `A city can run at most ${TRANSPORT.maxLines} bus lines.`,
  'stop-limit': `A city can have at most ${TRANSPORT.maxStops} bus stops.`,
  'too-few-stops': `A line needs at least ${TRANSPORT.minStopsPerLine} stops.`,
  'too-many-stops': `A line can have at most ${TRANSPORT.maxStopsPerLine} stops.`,
  'duplicate-stop': 'Each stop can only be on a line once.',
  'not-a-road': 'Bus stops go on road tiles.',
  'stop-at-junction': 'Stops cannot be on an intersection; pick a straight stretch of road.',
  unreachable: 'Buses cannot drive between these stops on the current roads.',
  'line-not-found': 'That bus line no longer exists.',
  'invalid-buses': `A line runs ${TRANSPORT.minBusesPerLine}–${TRANSPORT.maxBusesPerLine} buses.`,
  'invalid-name': 'Line names need 1–40 characters.',
  unchanged: 'Nothing changed.',
};

const buildingName = (world: WorldState, id: string | null) => id ? world.plan.buildings.find((b) => b.id === id)?.name ?? 'a demolished building' : '—';
const citizenName = (world: WorldState, id: string | null) => id ? world.citizens.find((c) => c.id === id)?.name ?? 'a former resident' : '—';
export const average = (minutes: number, count: number) => count > 0 ? Math.round(minutes / count) : null;

/** Severity of a smoothed lane delay: 0 free, 1 slow, 2 heavy, 3 jammed. */
export function congestionLevel(value: number): 0 | 1 | 2 | 3 {
  const l = TRANSPORT.congestion.levels;
  return value >= l.jammed ? 3 : value >= l.heavy ? 2 : value >= l.slow ? 1 : 0;
}

export interface TransportOverview {
  readonly onStreet: number;
  readonly pullingOut: number;
  readonly cars: number;
  readonly buses: number;
  readonly vans: number;
  readonly journeys: { readonly driving: number; readonly waiting: number; readonly riding: number; readonly toStop: number };
  /** The day with data shown in the KPIs: today once trips completed, else the last full day. */
  readonly stats: TransportDayStats;
  readonly statsLabel: 'today' | 'yesterday';
  readonly avgCar: number | null;
  readonly avgBus: number | null;
  readonly modeShare: { readonly walk: number; readonly car: number; readonly bus: number } | null;
  /** Lanes by congestion level (lanes with any traffic memory) and the share of road lanes slow or worse. */
  readonly congestion: { readonly lanes: number; readonly slow: number; readonly heavy: number; readonly jammed: number; readonly status: 0 | 1 | 2 | 3 };
  readonly network: { readonly roads: number; readonly components: number; readonly isolatedBuildings: number; readonly suspendedLines: number };
  readonly busesInService: number;
  readonly dailyBusCost: number;
  readonly lastFares: number | null;
  readonly experience: { readonly car: number; readonly bus: number };
}

export function transportOverview(world: WorldState): TransportOverview | null {
  const t = world.transport;
  if (!t) return null;
  const street = t.vehicles.filter((v) => v.state !== 'departing');
  const yesterday = t.history.at(-1) ?? null;
  const useToday = t.today.carCompleted + t.today.busCompleted + t.today.walkTrips > 0 || !yesterday;
  const stats = useToday ? t.today : yesterday!;
  const trips = stats.walkTrips + stats.carTrips + stats.busTrips;
  const values = Object.values(t.congestion);
  const levels = [0, 0, 0, 0];
  for (const v of values) levels[congestionLevel(v)]! += 1;
  const network = networkFor(world);
  const navigator = network.navigator;
  const lanes = Math.max(1, network.lanes().length);
  const share = (levels[1]! + levels[2]! + levels[3]!) / lanes;
  const status = levels[3]! > 0 && levels[3]! / lanes > 0.02 ? 3 : share > 0.15 ? 2 : share > 0.04 ? 1 : 0;
  const isolated = world.plan.buildings.filter((b) => (b.type ? BUILDING_CATALOG[b.type].requiresRoad : b.kind !== 'park') && navigator.getAccessPoints(b.id).length === 0).length;
  const busesInService = t.lines.filter((l) => l.status === 'active').reduce((sum, l) => sum + l.buses, 0);
  const last = world.economy?.history.at(-1);
  return {
    onStreet: street.length, pullingOut: t.vehicles.length - street.length,
    cars: street.filter((v) => v.kind === 'car').length, buses: street.filter((v) => v.kind === 'bus').length, vans: street.filter((v) => v.kind === 'van').length,
    journeys: { driving: t.trips.filter((x) => x.phase === 'driving').length, waiting: t.trips.filter((x) => x.phase === 'waiting').length,
      riding: t.trips.filter((x) => x.phase === 'riding').length, toStop: t.trips.filter((x) => x.phase === 'to-stop').length },
    stats, statsLabel: useToday ? 'today' : 'yesterday',
    avgCar: average(stats.carMinutes, stats.carCompleted), avgBus: average(stats.busMinutes, stats.busCompleted),
    modeShare: trips ? { walk: Math.round(stats.walkTrips * 100 / trips), car: Math.round(stats.carTrips * 100 / trips), bus: Math.round(stats.busTrips * 100 / trips) } : null,
    congestion: { lanes: values.length, slow: levels[1]!, heavy: levels[2]!, jammed: levels[3]!, status },
    network: { roads: world.plan.roads.length, components: navigator.graph.getComponents().length, isolatedBuildings: isolated, suspendedLines: t.lines.filter((l) => l.status !== 'active').length },
    busesInService, dailyBusCost: busesInService * TRANSPORT.busDailyCost,
    lastFares: last?.income.transitFares ?? null,
    experience: t.experience,
  };
}

export interface LineView {
  readonly line: BusLine;
  readonly stops: readonly { readonly id: string; readonly name: string; readonly tile: Position; readonly waiting: number }[];
  readonly onStreet: number;
  readonly riders: number;
  readonly waiting: number;
  readonly capacity: number;
  /** One lap on the real route at the bus's top speed plus a dwell per stop (game minutes); null while suspended. */
  readonly loopMinutes: number | null;
  readonly headway: number | null;
  readonly dailyCost: number;
}

export function lineViews(world: WorldState): LineView[] {
  const t = world.transport;
  if (!t) return [];
  const network = networkFor(world);
  const stops = new Map(t.stops.map((s) => [s.id, s]));
  return t.lines.map((line) => {
    const buses = t.vehicles.filter((v) => v.lineId === line.id && v.state !== 'departing');
    const waitingAt = (stopId: string) => t.trips.filter((x) => x.phase === 'waiting' && x.lineId === line.id && x.boardStopId === stopId).length;
    const plan = line.status === 'active' ? network.linePlan(line, stops).plan : null;
    const loop = plan ? Math.round(plan.loopUnits / TRANSPORT.vehicles.bus.maxSpeed + line.stopIds.length * (TRANSPORT.busDwellTicks + 1)) : null;
    return { line, stops: line.stopIds.map((id) => ({ id, name: stops.get(id)?.name ?? id, tile: stops.get(id)?.tile ?? { x: 0, y: 0 }, waiting: waitingAt(id) })),
      onStreet: buses.length, riders: buses.reduce((n, b) => n + b.passengers.length, 0), waiting: t.trips.filter((x) => x.phase === 'waiting' && x.lineId === line.id).length,
      capacity: buses.length * TRANSPORT.busCapacity, loopMinutes: loop, headway: loop === null ? null : Math.max(1, Math.floor(loop / line.buses)),
      dailyCost: line.status === 'active' ? line.buses * TRANSPORT.busDailyCost : 0 };
  });
}

export interface VehicleView {
  readonly id: string;
  readonly title: string;
  readonly model: string;
  readonly state: string;
  readonly speed: number;
  readonly from: string | null;
  readonly to: string | null;
  readonly driver: string | null;
  readonly line: string | null;
  readonly nextStop: string | null;
  readonly passengers: number | null;
  readonly capacity: number | null;
  readonly minutes: number;
  readonly remainingTiles: number;
}

export function vehicleView(world: WorldState, id: string): VehicleView | null {
  const t = world.transport;
  const v = t?.vehicles.find((x) => x.id === id);
  if (!t || !v) return null;
  const route = decodePath(v.origin, v.path);
  const remainingTiles = Math.max(0, route.length - 1 - Math.round((v.edge * U + v.offset) / U));
  const minutes = world.clock.tick - v.departedTick;
  const common = { id, model: MODEL_LABELS[v.model], state: STATE_LABELS[v.state], speed: v.speed, minutes, remainingTiles };
  if (v.kind === 'bus') {
    const line = t.lines.find((l) => l.id === v.lineId);
    const stop = t.stops.find((s) => s.id === line?.stopIds[v.stopIndex]);
    return { ...common, title: `${line?.name ?? 'Bus'} · bus ${v.id.slice(v.id.lastIndexOf('-') + 1)}`, from: null, to: null, driver: null,
      line: line?.name ?? null, nextStop: stop?.name ?? null, passengers: v.passengers.length, capacity: TRANSPORT.busCapacity };
  }
  if (v.kind === 'van') {
    const back = v.destinationBuildingId === v.ownerId;
    return { ...common, title: `${buildingName(world, v.ownerId)} delivery van`, from: back ? 'Delivery round' : buildingName(world, v.ownerId),
      to: back ? buildingName(world, v.ownerId) : buildingName(world, v.destinationBuildingId), driver: null, line: null, nextStop: null, passengers: null, capacity: null };
  }
  const trip = t.trips.find((x) => x.citizenId === v.ownerId);
  return { ...common, title: `${citizenName(world, v.ownerId)}'s ${MODEL_LABELS[v.model].toLowerCase()}`, from: buildingName(world, trip?.originBuildingId ?? null),
    to: buildingName(world, v.destinationBuildingId), driver: citizenName(world, v.ownerId), line: null, nextStop: null, passengers: null, capacity: null };
}

/** What a resident is doing in transport, for inspectors and Life Mode ("Driving to Office 03", …). Null when walking or inside. */
export function tripText(world: WorldState, citizenId: string): string | null {
  const t = world.transport;
  const trip: Trip | undefined = t?.trips.find((x) => x.citizenId === citizenId);
  if (!t || !trip) return null;
  const to = buildingName(world, trip.destinationBuildingId);
  const line = t.lines.find((l) => l.id === trip.lineId)?.name ?? 'the bus';
  const stop = (id: string | null) => t.stops.find((s) => s.id === id)?.name ?? 'a stop';
  switch (trip.phase) {
    case 'driving': {
      const car = t.vehicles.find((v) => v.id === trip.vehicleId);
      return car?.state === 'departing' ? `Getting the car out to drive to ${to}` : `Driving to ${to}`;
    }
    case 'to-stop': return `Walking to ${stop(trip.boardStopId)} for ${line}`;
    case 'waiting': return `Waiting at ${stop(trip.boardStopId)} for ${line} · ${world.clock.tick - trip.phaseTick} min`;
    case 'riding': return `On ${line} to ${stop(trip.alightStopId)}, then walking to ${to}`;
  }
}

export interface StopView { readonly id: string; readonly name: string; readonly lines: readonly string[]; readonly waiting: number; readonly nextBus: number | null }
/** A stop: the lines serving it, residents waiting and the nearest bus's distance in route minutes (from real positions). */
export function stopView(world: WorldState, stopId: string): StopView | null {
  const t = world.transport;
  const stop = t?.stops.find((s) => s.id === stopId);
  if (!t || !stop) return null;
  const lines = t.lines.filter((l) => l.stopIds.includes(stopId));
  let nextBus: number | null = null;
  for (const bus of t.vehicles.filter((v) => v.kind === 'bus' && lines.some((l) => l.id === v.lineId))) {
    const route = decodePath(bus.origin, bus.path);
    const line = lines.find((l) => l.id === bus.lineId)!;
    if (line.stopIds[bus.stopIndex] !== stopId) continue;
    const at = route.findIndex((tile, i) => i >= bus.edge && tile.x === stop.tile.x && tile.y === stop.tile.y);
    if (at < 0) continue;
    const minutes = Math.max(0, Math.round((at * U - (bus.edge * U + bus.offset)) / TRANSPORT.vehicles.bus.maxSpeed));
    nextBus = nextBus === null ? minutes : Math.min(nextBus, minutes);
  }
  return { id: stop.id, name: stop.name, lines: lines.map((l) => l.name), waiting: t.trips.filter((x) => x.phase === 'waiting' && x.boardStopId === stopId).length, nextBus };
}

/** Bus-line editor: a quick local check of a tile before sending the command (the simulation validates again). */
export function stopTileProblem(world: WorldState, tile: Position): TransportRejectionReason | null {
  const network = networkFor(world);
  if (!network.isRoad(tile)) return 'not-a-road';
  if (network.isJunction(tile)) return 'stop-at-junction';
  return null;
}
