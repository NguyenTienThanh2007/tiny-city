/**
 * Phase 6 transportation constants. Positions and speeds are integers: a tile is `unitsPerTile` units, a speed is
 * units per tick (one tick is one game minute at the default clock), so every authoritative calculation is integer
 * arithmetic and replays exactly. Tune transportation here, never inline.
 */
export const TRANSPORT = Object.freeze({
  version: 1 as const,
  unitsPerTile: 100,
  /**
   * Vehicle dynamics. Lengths are the body along the lane (a car is half a tile, a bus most of one); `brake` limits
   * speed so a vehicle can always stop within the free distance ahead (v ≤ √(2·brake·distance)).
   */
  vehicles: Object.freeze({
    car: Object.freeze({ maxSpeed: 60, accel: 20, brake: 30, length: 50 }),
    van: Object.freeze({ maxSpeed: 55, accel: 15, brake: 25, length: 54 }),
    bus: Object.freeze({ maxSpeed: 50, accel: 12, brake: 20, length: 90 }),
  }),
  /** Minimum free space kept to the vehicle ahead. */
  gap: 10,
  /** A vehicle without permission stops this far before an intersection tile. */
  stopMargin: 2,
  /** Riders a bus can carry. */
  busCapacity: 24,
  /** Dwell at a stop: base ticks plus one tick per `boardingPerTick` riders getting on or off. */
  busDwellTicks: 1,
  boardingPerTick: 8,
  /** Line limits. */
  maxLines: 12,
  maxStops: 64,
  minStopsPerLine: 2,
  maxStopsPerLine: 12,
  minBusesPerLine: 1,
  maxBusesPerLine: 6,
  /** Hard cap on vehicles on the street; over it, residents walk instead of driving (documented, never silent). */
  activeVehicleLimit: 400,
  /** Longest stored route (tiles). */
  maxRouteTiles: 2048,
  /**
   * Stall handling: after `stallReroute` ticks without progress a vehicle looks for another route; after `stallLimit`
   * it pulls over (the driver walks on, the car is taken home), so no jam is ever permanent.
   */
  stallReroute: 20,
  stallLimit: 120,
  /** Completed trips by a mode needed in a day before that day changes residents' remembered slowdown. */
  experienceMinTrips: 10,
  /** Mode choice (game minutes). Trips this short on foot are always walked. */
  walkAlwaysMinutes: 12,
  /** Getting the car out and parking it at the other end. */
  carOverheadMinutes: 4,
  /** Expected extra wait per car already queued to leave the same lot. */
  departureMinutesPerQueuedCar: 2,
  /** Furthest a resident walks to or from a stop (tiles, measured along the street grid). */
  stopWalkTiles: 8,
  /** A resident who has waited this long gives up and walks. */
  maxWaitMinutes: 90,
  /** Car ownership by home type (percent of residents), decided per resident by a stable hash. */
  carOwnership: Object.freeze({ villa: 80, duplex: 70, townhouse: 60, apartment: 40, other: 50 }),
  /** Routing: costs in lane units. Turning and crossing an intersection cost a little extra. */
  routing: Object.freeze({ epochTicks: 30, junction: 20, rightTurn: 10, leftTurn: 25, uTurn: 120, maxCongestionPenalty: 300,
    /** Congestion penalty = smoothed delay / this. */
    congestionDivisor: 8, cacheSize: 512, maxStates: 40_000 }),
  /** Smoothed congestion per lane: each tick c ← c − ⌊c / 2^decayShift⌋ + delay (equilibrium ≈ 16 × delay per tick). */
  congestion: Object.freeze({ decayShift: 4, levels: Object.freeze({ slow: 160, heavy: 480, jammed: 960 }) }),
  /** Mall delivery vans: one per staffed mall with local sales on its last settled day, during opening hours. */
  vans: Object.freeze({ firstDeparture: 540, lastDeparture: 1020 }),
  /** Money (whole dollars). Fares go to the treasury; car running costs leave the city; buses cost the city per day. */
  fare: 2,
  carTripCost: 2,
  busDailyCost: 40,
  historyDays: 7,
});

export type VehicleDynamics = (typeof TRANSPORT.vehicles)[keyof typeof TRANSPORT.vehicles];
