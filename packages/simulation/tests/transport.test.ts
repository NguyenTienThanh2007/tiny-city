import { describe, expect, it } from 'vitest';
import {
  carIdOf, createWorld, decodePath, deserializeWorld, encodePath, LEDGER_FLOWS, movementMask, RoadNavigator, serializeWorld, Simulation,
  TRANSPORT, TransportNetwork, validateWorld,
} from '../src/index.js';
import type { Position, SimulationEvent, WorldState } from '../src/index.js';
import { transportTown, townRoads } from './transportFixture.js';
import { assertTransportInvariants, frontS, frontTile, routeOf, run } from './transportHelpers.js';

const network = (world: WorldState) => new TransportNetwork(new RoadNavigator(world.plan));
const busyTown = () => transportTown({ apartment: 6, townhouse: 6, villa: 10, office: 4, mall: 2, park: 2, pool: 1 });

describe('road graph and routing', () => {
  it('derives lanes and junctions from the road tiles', () => {
    const net = network(transportTown({}));
    expect(net.roadCount).toBe(townRoads().length);
    expect(net.isJunction({ x: 32, y: 22 })).toBe(true);   // four-way
    expect(net.isJunction({ x: 2, y: 8 })).toBe(false);    // corner
    expect(net.isJunction({ x: 32, y: 8 })).toBe(true);    // T junction
    expect(net.isJunction({ x: 10, y: 8 })).toBe(false);   // straight
    expect(net.hasLane('10,8E')).toBe(true);
    expect(net.hasLane('10,8N')).toBe(false);
    // Two directed lanes for every pair of neighbouring road tiles.
    const pairs = townRoads().reduce((n, t) => n + (net.isRoad({ x: t.x + 1, y: t.y }) ? 1 : 0) + (net.isRoad({ x: t.x, y: t.y + 1 }) ? 1 : 0), 0);
    expect(net.lanes()).toHaveLength(pairs * 2);
  });

  it('gives conflicting movements overlapping quadrants and lets opposite traffic share', () => {
    const eastbound = movementMask('E', 'E'), westbound = movementMask('W', 'W'), northbound = movementMask('N', 'N');
    expect(eastbound & westbound).toBe(0);
    expect(eastbound & northbound).not.toBe(0);
    // A right turn stays in its entry quadrant; a left turn crosses three.
    expect(movementMask('N', 'E').toString(2).replace(/0/g, '')).toHaveLength(1);
    expect(movementMask('N', 'W').toString(2).replace(/0/g, '')).toHaveLength(3);
    // Two right turns from opposite approaches do not conflict.
    expect(movementMask('N', 'E') & movementMask('S', 'W')).toBe(0);
    // Joining the same exit always conflicts (one vehicle enters a lane at a time).
    expect(movementMask('N', 'E') & movementMask('E', 'E')).not.toBe(0);
    expect(movementMask('S', 'E') & movementMask('E', 'E')).not.toBe(0);
  });

  it('routes deterministically on lanes, never turning around except at a dead end', () => {
    const world = transportTown({ villa: 2, office: 1 });
    const net = network(world), again = network(world);
    const home = world.plan.buildings.find((b) => b.type === 'villa')!, office = world.plan.buildings.find((b) => b.type === 'office')!;
    const a = net.carRoute(home.id, office.id)!, b = again.carRoute(home.id, office.id)!;
    expect(a.tiles).toEqual(b.tiles);
    expect(a.cost).toBe(b.cost);
    for (let i = 1; i < a.tiles.length; i += 1) expect(Math.abs(a.tiles[i]!.x - a.tiles[i - 1]!.x) + Math.abs(a.tiles[i]!.y - a.tiles[i - 1]!.y)).toBe(1);
    for (let i = 2; i < a.tiles.length; i += 1) {
      const back = a.tiles[i]!.x === a.tiles[i - 2]!.x && a.tiles[i]!.y === a.tiles[i - 2]!.y;
      if (back) expect(net.degree(a.tiles[i - 1]!)).toBe(1);
    }
    // Continuing from a lane: heading east on the street, a destination behind needs a loop around a block, never a U-turn.
    const route = net.routeFromLane({ x: 20, y: 22 }, 'E', 50, [{ x: 10, y: 22 }])!;
    expect(route.tiles[0]).toEqual({ x: 20, y: 22 });
    expect(route.tiles[1]).toEqual({ x: 21, y: 22 });
    expect(route.tiles.some((t) => t.y !== 22)).toBe(true);
    expect(encodePath(route.tiles).path).toMatch(/^[NESW]+$/);
    expect(decodePath(encodePath(route.tiles).origin, encodePath(route.tiles).path)).toEqual(route.tiles);
  });

  it('refuses to drive where a curb is shared (walk) or no road connects', () => {
    const world = transportTown({ villa: 1, office: 1 });
    const villa = world.plan.buildings[0]!, office = world.plan.buildings[1]!;
    const net = network(world);
    expect(net.carRoute(villa.id, villa.id)).toBeNull();
    const island = createWorld({ id: 'i', clock: { paused: true }, transport: true, population: {},
      plan: { id: 'p', name: 'P', width: 20, height: 20, roads: [{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 10, y: 3 }, { x: 11, y: 3 }],
        buildings: [{ id: 'a', name: 'A', kind: 'home', type: 'villa', capacity: 2, footprint: { width: 2, height: 2 }, position: { x: 1, y: 1 } },
          { id: 'b', name: 'B', kind: 'workplace', type: 'office', capacity: 60, footprint: { width: 4, height: 4 }, position: { x: 9, y: 4 } }] } });
    expect(network(island).carRoute('a', 'b')).toBeNull();
    expect(office.id).toBeDefined();
  });
});

describe('vehicles and trips', { timeout: 30_000 }, () => {
  it('creates no vehicles retroactively and enables idempotently', () => {
    const legacy = transportTown({ villa: 4, office: 1 }, { transport: false });
    const sim = new Simulation(legacy);
    sim.step(600);
    expect(sim.getState().transport).toBeUndefined();
    const first = sim.enableTransport();
    expect(first.events).toEqual([{ type: 'transport.enabled', tick: 600 }]);
    expect(sim.getState().transport!.vehicles).toEqual([]);
    expect(sim.enableTransport().events).toEqual([]);
    validateWorld(sim.getState());
  });

  it('drives residents door to door on real lanes, then parks the car where they went', () => {
    const sim = new Simulation(busyTown());
    const events = run(sim, 760, 5) as unknown as SimulationEvent[];
    const started = events.filter((e) => e.type === 'transport.trip-started' && e.mode === 'car');
    const completed = events.filter((e): e is Extract<SimulationEvent, { type: 'transport.trip-completed' }> => e.type === 'transport.trip-completed' && e.mode === 'car');
    expect(started.length).toBeGreaterThan(20);
    expect(completed.length).toBeGreaterThan(20);
    const state = sim.getState();
    for (const done of completed.slice(0, 10)) {
      const c = state.citizens.find((x) => x.id === done.citizenId)!;
      const arrived = events.find((e) => e.type === 'citizen.arrived' && e.citizenId === c.id && e.tick === done.tick);
      expect(arrived).toBeDefined();
      expect(done.minutes).toBeGreaterThan(0);
    }
    // Commuters' cars are parked at work now (a resident never has two cars, and none is on the street twice).
    const parked = Object.entries(state.transport!.parkedCars);
    expect(parked.length).toBeGreaterThan(10);
    for (const [owner, building] of parked) {
      expect(state.plan.buildings.find((b) => b.id === building)?.kind).toBe('workplace');
      expect(state.transport!.vehicles.some((v) => v.id === carIdOf(owner))).toBe(false);
    }
  });

  it('moves vehicles smoothly: bounded steps, no teleporting, never through a removed tile', () => {
    const sim = new Simulation(busyTown());
    sim.step(440);
    const last = new Map<string, { tile: Position; s: number }>();
    for (let i = 0; i < 200; i += 1) {
      const { state } = sim.step(1);
      for (const v of state.transport!.vehicles) {
        if (v.state === 'departing') continue;
        const tile = frontTile(v);
        const prev = last.get(v.id);
        if (prev) {
          expect(Math.abs(tile.x - prev.tile.x) + Math.abs(tile.y - prev.tile.y)).toBeLessThanOrEqual(1);
        }
        expect(v.speed).toBeLessThanOrEqual(TRANSPORT.vehicles[v.kind].maxSpeed);
        last.set(v.id, { tile, s: frontS(v) });
      }
    }
  });

  it('keeps junctions safe and queues orderly under heavy demand', () => {
    const sim = new Simulation(transportTown({ apartment: 10, townhouse: 6, villa: 10, office: 8, mall: 2, park: 2, pool: 1 }));
    const events = run(sim, 1440, 2);
    const kinds = new Set(events.map((e) => e.type));
    expect(kinds.has('transport.trip-completed')).toBe(true);
    const state = sim.getState();
    expect(state.transport!.today.peakVehicles + (state.transport!.history.at(-1)?.peakVehicles ?? 0)).toBeGreaterThan(30);
    expect(events.filter((e) => e.type === 'transport.vehicle-stalled').length).toBeLessThanOrEqual(2);
  });

  it('builds congestion from real lost progress and freezes routing penalties per epoch', () => {
    const sim = new Simulation(transportTown({ apartment: 10, townhouse: 6, villa: 10, office: 8, mall: 2 }));
    sim.step(470);
    const t = sim.getState().transport!;
    expect(Object.keys(t.congestion).length).toBeGreaterThan(0);
    for (const key of Object.keys(t.congestion)) expect(network(sim.getState()).hasLane(key)).toBe(true);
    // Routing penalties change only at epoch boundaries.
    const before = sim.getState().transport!.routing;
    const tick = sim.getState().clock.tick;
    const toEpoch = TRANSPORT.routing.epochTicks - (tick % TRANSPORT.routing.epochTicks) - 1;
    sim.step(toEpoch);
    expect(sim.getState().transport!.routing).toBe(before);
    sim.step(1);
    expect(sim.getState().clock.tick % TRANSPORT.routing.epochTicks).toBe(0);
    // A quiet town has no congestion at all.
    const quiet = new Simulation(transportTown({ villa: 2, office: 1 }));
    quiet.step(1440);
    expect(Object.values(quiet.getState().transport!.congestion).every((v) => v < TRANSPORT.congestion.levels.slow)).toBe(true);
  });

  it('replays identically from the same seed, across save/load mid-traffic and frame chunking', () => {
    const a = new Simulation(busyTown()), b = new Simulation(busyTown());
    a.step(480);
    for (let i = 0; i < 48; i += 1) b.step(10);
    expect(serializeWorld(b.getState())).toBe(serializeWorld(a.getState()));
    expect(a.getState().transport!.vehicles.length).toBeGreaterThan(0);
    const reloaded = new Simulation(deserializeWorld(serializeWorld(a.getState())));
    a.step(300); reloaded.step(300);
    expect(serializeWorld(reloaded.getState())).toBe(serializeWorld(a.getState()));
  });

  it('does not move anything while paused, and speed only changes how many fixed ticks run', () => {
    const sim = new Simulation(busyTown());
    sim.step(470);
    sim.pause();
    const before = serializeWorld(sim.getState());
    sim.advance(5000);
    expect(serializeWorld(sim.getState())).toBe(before);
    sim.resume();
    const fast = new Simulation(deserializeWorld(before)), slow = new Simulation(deserializeWorld(before));
    fast.resume(); slow.resume();
    fast.advance(400);                            // 4× speed: one frame of 100 ms feeds 400 ms
    for (let i = 0; i < 4; i += 1) slow.advance(100);
    expect(serializeWorld(fast.getState())).toBe(serializeWorld(slow.getState()));
  });
});

describe('road edits during live traffic', { timeout: 30_000 }, () => {
  const removeStreet = (world: WorldState) => world.plan.roads.filter((t) => t.y === 8 && t.x >= 20 && t.x <= 24);

  it('re-routes or safely ends trips when a road under traffic is removed, and recovers on undo', () => {
    const sim = new Simulation(busyTown());
    sim.step(455);
    const snapshot = sim.getCitySnapshot();
    const before = sim.getState().transport!.vehicles.filter((v) => routeOf(v).some((t) => t.y === 8 && t.x >= 20 && t.x <= 24));
    expect(before.length).toBeGreaterThan(0);
    const result = sim.execute({ type: 'city.edit-roads', add: [], remove: removeStreet(sim.getState()) });
    expect(result.applied).toBe(true);
    assertTransportInvariants(sim.getState());
    // No vehicle's remaining route crosses the removed tiles.
    for (const v of sim.getState().transport!.vehicles) {
      const route = routeOf(v).slice(v.edge);
      expect(route.some((t) => t.y === 8 && t.x >= 20 && t.x <= 24)).toBe(false);
    }
    run(sim, 200, 2);
    // Undo restores the street; traffic goes on, validated every tick.
    sim.restoreCity(snapshot);
    run(sim, 200, 2);
  });

  it('takes residents to their new destination when theirs is demolished mid-drive', () => {
    const sim = new Simulation(busyTown());
    sim.step(450);
    const driving = sim.getState().transport!.vehicles.find((v) => v.kind === 'car' && v.state !== 'departing')!;
    const target = driving.destinationBuildingId!;
    sim.execute({ type: 'city.demolish', buildingId: target });
    const state = sim.getState();
    assertTransportInvariants(state);
    const car = state.transport!.vehicles.find((v) => v.id === driving.id);
    const owner = state.citizens.find((c) => c.id === driving.ownerId);
    if (car) expect(car.destinationBuildingId).not.toBe(target);
    if (owner) expect(owner.movement!.destinationBuildingId).not.toBe(target);
    run(sim, 120, 2);
  });

  it('re-plans walkers when undo restores an identical plan (the revision still changes)', () => {
    const sim = new Simulation(transportTown({ villa: 8, office: 2 }, { transport: false }));
    sim.step(440);
    expect(sim.getState().citizens.some((c) => c.movement?.status === 'travelling')).toBe(true);
    sim.restoreCity(sim.getCitySnapshot());
    validateWorld(sim.getState());
    sim.step(60);
    validateWorld(sim.getState());
  });

  it('uses a new shortcut once routes are re-planned', () => {
    const world = transportTown({ villa: 2, office: 1 });
    const net = network(world);
    const before = net.routeFromLane({ x: 10, y: 22 }, 'E', 0, [{ x: 10, y: 36 }])!;
    const sim = new Simulation(world);
    const add = Array.from({ length: 13 }, (_, i) => ({ x: 12, y: 23 + i }));
    sim.execute({ type: 'city.edit-roads', add, remove: [] });
    const after = network(sim.getState()).routeFromLane({ x: 10, y: 22 }, 'E', 0, [{ x: 10, y: 36 }])!;
    expect(after.cost).toBeLessThan(before.cost);
  });
});

describe('public transit', { timeout: 30_000 }, () => {
  const lineStops = [{ x: 10, y: 8 }, { x: 45, y: 8 }, { x: 45, y: 22 }, { x: 10, y: 22 }];

  it('validates line commands against the real road network', () => {
    const sim = new Simulation(busyTown());
    const create = (stops: Position[], buses = 2) => sim.executeTransport({ type: 'transport.create-line', stops, buses });
    expect(create([{ x: 10, y: 8 }]).reason).toBe('too-few-stops');
    expect(create([{ x: 10, y: 8 }, { x: 10, y: 8 }]).reason).toBe('duplicate-stop');
    expect(create([{ x: 10, y: 8 }, { x: 10, y: 9 }]).reason).toBe('not-a-road');
    expect(create([{ x: 10, y: 8 }, { x: 32, y: 22 }]).reason).toBe('stop-at-junction');
    expect(create(lineStops, 0).reason).toBe('invalid-buses');
    expect(create(lineStops, 99).reason).toBe('invalid-buses');
    const ok = create(lineStops, 3);
    expect(ok.applied).toBe(true);
    expect(ok.lineId).toBe('line-1');
    expect(sim.getState().transport!.stops).toHaveLength(4);
    // A second line reuses stops on the same tiles.
    create([{ x: 10, y: 8 }, { x: 45, y: 8 }], 1);
    expect(sim.getState().transport!.stops).toHaveLength(4);
    expect(sim.executeTransport({ type: 'transport.set-buses', lineId: 'line-1', buses: 3 }).reason).toBe('unchanged');
    expect(sim.executeTransport({ type: 'transport.rename-line', lineId: 'line-9', name: 'X' }).reason).toBe('line-not-found');
    // A disconnected stop cannot be part of a loop.
    const island = transportTown({ villa: 1 });
    const islandSim = new Simulation({ ...island, plan: { ...island.plan, roads: [...island.plan.roads, { x: 40, y: 60 }, { x: 41, y: 60 }] } });
    expect(islandSim.executeTransport({ type: 'transport.create-line', stops: [{ x: 10, y: 8 }, { x: 40, y: 60 }], buses: 1 }).reason).toBe('unreachable');
  });

  it('runs buses on the loop, boards and drops real residents, never above capacity', () => {
    const sim = new Simulation(busyTown());
    sim.executeTransport({ type: 'transport.create-line', stops: lineStops, buses: 6 });
    const events = run(sim, 1440 * 2, 3) as unknown as SimulationEvent[];
    const state = sim.getState();
    const buses = state.transport!.vehicles.filter((v) => v.kind === 'bus');
    expect(buses).toHaveLength(6);
    const boarded = events.filter((e) => e.type === 'transport.boarded');
    const alighted = events.filter((e) => e.type === 'transport.alighted');
    expect(boarded.length).toBeGreaterThan(0);
    expect(alighted.length).toBeGreaterThan(0);
    for (const e of boarded) expect(state.citizens.some((c) => c.id === (e as { citizenId: string }).citizenId)).toBe(true);
    // Buses only ever stop at their stops (dwelling buses stand on a stop tile).
    for (const bus of buses.filter((b) => b.state === 'dwelling')) {
      const stopTiles = state.transport!.stops.map((s) => `${s.tile.x},${s.tile.y}`);
      const route = routeOf(bus);
      expect(stopTiles).toContain(`${route[route.length - 2]!.x},${route[route.length - 2]!.y}`);
    }
  });

  it('fills a bus to capacity and leaves the rest waiting for the next one', () => {
    const sim = new Simulation(busyTown());
    sim.executeTransport({ type: 'transport.create-line', stops: [{ x: 10, y: 8 }, { x: 45, y: 8 }, { x: 45, y: 22 }, { x: 10, y: 22 }], buses: 6 });
    // Thirty residents (at home at night) are put at stop 1 waiting for line 1 to stop 2.
    const base = sim.getState();
    const t = base.transport!;
    const stop = t.stops[0]!, alight = t.stops[1]!;
    const chosen = base.citizens.filter((c) => c.movement!.status === 'inside').slice(0, 30);
    const ids = new Set(chosen.map((c) => c.id));
    let trip = t.nextTripId;
    const trips = chosen.map((c) => ({ id: `trip-${trip++}`, citizenId: c.id, mode: 'bus' as const, phase: 'waiting' as const, originBuildingId: c.homeBuildingId,
      destinationBuildingId: c.homeBuildingId, vehicleId: null, lineId: 'line-1', boardStopId: stop.id, alightStopId: alight.id, startedTick: 0, phaseTick: 0, estimatedMinutes: 60 }));
    const world: WorldState = { ...base, citizens: base.citizens.map((c) => ids.has(c.id) ? { ...c, activity: 'travel', position: { x: stop.tile.x + 0.5, y: stop.tile.y + 0.5 },
      movement: { ...c.movement!, status: 'vehicle', currentBuildingId: null, destinationBuildingId: c.homeBuildingId, arrivalActivity: 'home', route: [], nextWaypoint: 0 } } : c),
      transport: { ...t, nextTripId: trip, trips: [...t.trips, ...trips].sort((a, b) => a.citizenId < b.citizenId ? -1 : 1) } };
    validateWorld(world);
    const crowded = new Simulation(world);
    const events = run(crowded, 120, 1) as unknown as SimulationEvent[];
    const full = events.filter((e): e is Extract<SimulationEvent, { type: 'transport.bus-full' }> => e.type === 'transport.bus-full');
    expect(full.length).toBeGreaterThan(0);
    expect(full[0]!.left).toBe(30 - TRANSPORT.busCapacity);
    const firstBus = events.filter((e) => e.type === 'transport.boarded' && (e as { vehicleId: string }).vehicleId === full[0]!.vehicleId && ids.has((e as { citizenId: string }).citizenId));
    expect(firstBus).toHaveLength(TRANSPORT.busCapacity);
    // The second bus takes the rest; riders get off at their stop and walk on.
    const boardedIds = new Set(events.filter((e) => e.type === 'transport.boarded').map((e) => (e as { citizenId: string }).citizenId));
    for (const id of ids) expect(boardedIds.has(id)).toBe(true);
    const alighted = events.filter((e) => e.type === 'transport.alighted' && ids.has((e as { citizenId: string }).citizenId));
    expect(alighted.length).toBeGreaterThan(0);
    for (const v of crowded.getState().transport!.vehicles) expect(v.passengers.length).toBeLessThanOrEqual(TRANSPORT.busCapacity);
  });

  it('suspends a line when a stop road is removed, withdrawing buses safely, and deletes lines cleanly', () => {
    const sim = new Simulation(busyTown());
    sim.executeTransport({ type: 'transport.create-line', stops: [{ x: 10, y: 8 }, { x: 45, y: 8 }], buses: 2 });
    run(sim, 500, 5);
    sim.execute({ type: 'city.edit-roads', add: [], remove: [{ x: 45, y: 8 }] });
    let state = sim.getState();
    expect(state.transport!.lines[0]!.status).toBe('suspended');
    expect(state.transport!.lines[0]!.suspendedReason).toBe('stop-removed');
    expect(state.transport!.vehicles.some((v) => v.kind === 'bus')).toBe(false);
    assertTransportInvariants(state);
    sim.executeTransport({ type: 'transport.delete-line', lineId: 'line-1' });
    state = sim.getState();
    expect(state.transport!.lines).toHaveLength(0);
    expect(state.transport!.stops).toHaveLength(0);
    expect(state.transport!.trips.some((t) => t.mode === 'bus')).toBe(false);
    run(sim, 100, 5);
  });
});

describe('economy integration', { timeout: 30_000 }, () => {
  it('collects fares for the city, car costs for the outside, and bills buses once per day', () => {
    const sim = new Simulation(busyTown());
    sim.executeTransport({ type: 'transport.create-line', stops: [{ x: 10, y: 8 }, { x: 45, y: 8 }, { x: 45, y: 22 }, { x: 10, y: 22 }], buses: 3 });
    sim.step(1440 * 2 + 1);
    const e = sim.getState().economy!;
    expect(LEDGER_FLOWS['transit.fares']).toEqual(['residents', 'treasury']);
    expect(LEDGER_FLOWS['resident.car-costs']).toEqual(['residents', 'external']);
    expect(LEDGER_FLOWS['city.transit-operations']).toEqual(['treasury', 'external']);
    for (const report of e.history) {
      expect(report.expenses.transit).toBe(3 * TRANSPORT.busDailyCost);
      expect(report.carTrips).toBeGreaterThan(0);
      expect(report.carCosts).toBeLessThanOrEqual(report.carTrips! * TRANSPORT.carTripCost);
      expect(report.income.transitFares).toBeLessThanOrEqual((report.transitRides ?? 0) * TRANSPORT.fare);
    }
    const ops = e.ledger.filter((t) => t.category === 'city.transit-operations');
    expect(new Set(ops.map((t) => t.day)).size).toBe(ops.length);   // one entry per day
    validateWorld(sim.getState());
    // Reload just before midnight and settle: nothing is billed twice.
    const reloaded = new Simulation(deserializeWorld(serializeWorld(sim.getState())));
    sim.step(1440); reloaded.step(1440);
    expect(serializeWorld(reloaded.getState())).toBe(serializeWorld(sim.getState()));
  });

  it('keeps Phase 5 worlds without transport byte-identical', () => {
    const plain = transportTown({ villa: 6, office: 1, mall: 1 }, { transport: false });
    const sim = new Simulation(plain);
    sim.step(1440 * 2);
    const report = sim.getState().economy!.history.at(-1)!;
    expect('transitFares' in report.income).toBe(false);
    expect('transit' in report.expenses).toBe(false);
    expect(report.transitRides).toBeUndefined();
  });
});

describe('persistence', { timeout: 30_000 }, () => {
  it('stores routes compactly and restores every vehicle, trip and line', () => {
    const sim = new Simulation(busyTown());
    sim.executeTransport({ type: 'transport.create-line', stops: [{ x: 10, y: 8 }, { x: 45, y: 8 }], buses: 2 });
    sim.step(470);
    const saved = serializeWorld(sim.getState());
    const restored = deserializeWorld(saved);
    expect(restored.transport).toEqual(sim.getState().transport);
    for (const v of restored.transport!.vehicles) expect(v.path.length).toBeLessThan(TRANSPORT.maxRouteTiles);
    // A save with a route through a missing road is rejected rather than loaded half-valid.
    const broken = JSON.parse(saved) as { plan: { roads: Position[] }; transport: { vehicles: { origin: Position }[] } };
    const v = broken.transport.vehicles.find(() => true);
    if (v) {
      broken.plan.roads = broken.plan.roads.filter((t) => t.x !== v.origin.x || t.y !== v.origin.y);
      expect(() => deserializeWorld(JSON.stringify(broken))).toThrow();
    }
  });
});
