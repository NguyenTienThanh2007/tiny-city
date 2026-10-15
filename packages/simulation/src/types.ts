/** All world coordinates are grid tiles, with x right and y down. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

export type BuildingKind = 'home' | 'workplace' | 'park';
export type BuildingType = 'villa' | 'duplex' | 'townhouse' | 'apartment' | 'park' | 'clubhouse' | 'pool' | 'mall' | 'office' |
  /** Phase 7 entertainment venues. */
  'cafe' | 'shops' | 'market' | 'cinema' | 'nightclub' | 'stage' | 'plaza' | 'amusement';

export interface Building {
  readonly id: string;
  readonly name: string;
  readonly kind: BuildingKind;
  /** Top-left tile of the footprint. */
  readonly position: Position;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly capacity: number;
  /** Catalog-backed builds use a type; legacy authored buildings may omit it. */
  readonly type?: BuildingType;
}

/** A static layout; rendering styles and textures belong to the consumer. */
export interface CityPlan {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly buildings: readonly Building[];
  readonly roads: readonly Position[];
  readonly blockedTiles: readonly Position[];
}

/** Allows Phase 0 authored fixtures to omit newly introduced tile collections. */
export type CityPlanInput = Omit<CityPlan, 'roads' | 'blockedTiles'> & Partial<Pick<CityPlan, 'roads' | 'blockedTiles'>>;

/**
 * The city treasury in whole dollars. `totalSpent` is construction spending (what undo/redo rewinds). Phase 5 adds the
 * running totals of operating income and expenses (absent in older saves, meaning 0), so
 * `balance + totalSpent + operatingExpenses === openingBalance + operatingIncome` always holds.
 */
export interface CityBudget {
  readonly openingBalance: number;
  readonly balance: number;
  readonly totalSpent: number;
  readonly operatingIncome?: number;
  readonly operatingExpenses?: number;
}

/** Phase 5 economy. Whole dollars and integer percents throughout; see `economyConfig.ts`. */
export interface EconomyPolicy {
  /** Percent of each resident's wage. */
  readonly residentialTaxRate: number;
  /** Percent of each business's revenue. */
  readonly commercialTaxRate: number;
}

/** A resident's money: their savings and what happened to them on the last settled day. */
export interface ResidentAccount {
  readonly balance: number;
  /** Wage plus city support. */
  readonly income: number;
  readonly taxes: number;
  /** Housing, shopping and venue fees. */
  readonly spending: number;
}

export type BusinessStatus = 'profitable' | 'loss' | 'understaffed' | 'weak-demand' | 'unstaffed';

/** The last settled day of one economically active building (a business or a public amenity). */
export interface BuildingFinance {
  readonly buildingId: string;
  /** Phase 7 adds the entertainment venues (businesses and the city's stage and plaza) by building type. */
  readonly role: 'office' | 'mall' | 'park' | 'pool' | 'clubhouse' | 'cafe' | 'shops' | 'market' | 'cinema' | 'nightclub' | 'stage' | 'plaza' | 'amusement';
  readonly workers: number;
  readonly jobs: number;
  readonly revenue: number;
  readonly payroll: number;
  /** A business's own operating costs, or the city's upkeep for an amenity. */
  readonly upkeep: number;
  readonly tax: number;
  readonly profit: number;
  /** Amenities: leisure visits that day and the fees charged for them. */
  readonly visits: number;
  readonly fees: number;
  /** Malls: the shopping demand directed to this mall that day. */
  readonly demand: number;
  readonly status: BusinessStatus | 'public';
  /** Consecutive settled days with a loss. */
  readonly lossStreak: number;
}

export type EconomyAccountKind = 'treasury' | 'residents' | 'business' | 'external';
export type LedgerCategory =
  | 'resident.arrival' | 'resident.departure' | 'business.services' | 'business.sales' | 'business.wages'
  | 'tax.residential' | 'tax.commercial' | 'city.support' | 'resident.housing' | 'resident.shopping-outside'
  | 'resident.venue-fees' | 'business.upkeep' | 'business.profit' | 'business.loss-cover' | 'city.public-services'
  | 'city.road-upkeep' | 'city.amenity-upkeep' | 'city.construction' | 'city.construction-refund'
  | 'transit.fares' | 'resident.car-costs' | 'city.transit-operations'
  /** Phase 7: what the city pays performers and crews for the events it hosts. */
  | 'city.events';

/** One recorded money movement. Internal transfers move money between city actors; `external` creates or removes it. */
export interface LedgerEntry {
  readonly id: string;
  readonly day: number;
  readonly tick: number;
  readonly category: LedgerCategory;
  readonly amount: number;
  readonly from: EconomyAccountKind;
  readonly to: EconomyAccountKind;
  readonly buildingId: string | null;
  /** Residents (or buildings) the entry aggregates. */
  readonly count: number;
}

export interface EconomyDayReport {
  readonly day: number;
  readonly treasuryOpen: number;
  readonly treasuryClose: number;
  /** Treasury inflows. */
  readonly income: { readonly residentialTax: number; readonly commercialTax: number; readonly venueFees: number; readonly constructionRefunds: number;
    /** Phase 6 bus fares (absent in older reports, meaning 0). */
    readonly transitFares?: number };
  /** Treasury outflows. */
  readonly expenses: { readonly publicServices: number; readonly roads: number; readonly amenities: number; readonly unemploymentSupport: number; readonly construction: number;
    /** Phase 6 bus operations (absent in older reports, meaning 0). */
    readonly transit?: number;
    /** Phase 7 city events (absent in older reports, meaning 0). */
    readonly events?: number };
  /** City costs the treasury could not pay (never owed later). */
  readonly unpaid: { readonly upkeep: number; readonly support: number };
  readonly population: number;
  readonly employed: number;
  readonly jobs: number;
  readonly wages: number;
  readonly housing: number;
  /** What residents wanted to spend shopping, and where it went. */
  readonly shoppingDemand: number;
  readonly shoppingLocal: number;
  readonly shoppingOutside: number;
  readonly feesWaived: number;
  readonly residentSavings: number;
  readonly arrivals: number;
  readonly departures: number;
  readonly businesses: number;
  readonly profitableBusinesses: number;
  readonly businessRevenue: number;
  readonly businessProfit: number;
  readonly confidence: number;
  readonly amenityCoverage: number;
  readonly localShoppingRate: number;
  /** Phase 6: bus boardings and car trips that day (absent in older reports). */
  readonly transitRides?: number;
  readonly carTrips?: number;
  /** Phase 6: what residents paid for their own car trips (to the outside economy). */
  readonly carCosts?: number;
  /** Phase 7: what residents paid at entertainment businesses, and what they could not pay (absent in older reports). */
  readonly leisureSpending?: number;
  readonly leisureWaived?: number;
}

export type EconomyAlertKind = 'treasury-low' | 'deficit' | 'upkeep-unpaid' | 'unemployment' | 'understaffed' |
  'business-loss' | 'shopping-demand' | 'improving';
export interface EconomyAlert {
  /** Stable deduplication key (kind, plus the building for building alerts). */
  readonly id: string;
  readonly kind: EconomyAlertKind;
  readonly severity: 'info' | 'warning';
  readonly day: number;
  readonly buildingId: string | null;
  readonly value: number;
}

/** What has happened so far on the current (unsettled) day. */
export interface EconomyToday {
  readonly day: number;
  /** Leisure venue → visits today. */
  readonly visits: Readonly<Record<string, number>>;
  /** Resident → venue fees owed for today's visits, collected at settlement. */
  readonly fees: Readonly<Record<string, number>>;
  /** Phase 6: resident → bus fares owed for today's boardings (absent in older saves). */
  readonly fares?: Readonly<Record<string, number>>;
  /** Phase 6: resident → running costs of today's car trips (absent in older saves). */
  readonly carCosts?: Readonly<Record<string, number>>;
  /** Phase 7: resident → venue → purchases at entertainment businesses today (absent in older saves). */
  readonly purchases?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Phase 7: event → what the city owes for hosting it (recorded when it starts; absent in older saves). */
  readonly eventCosts?: Readonly<Record<string, number>>;
}

export interface EconomyState {
  readonly version: 1;
  readonly policy: EconomyPolicy;
  /** The last day whose settlement ran (or was skipped because the economy began mid-day). Settlement is idempotent on it. */
  readonly lastSettledDay: number;
  readonly nextTransactionId: number;
  /** `budget.totalSpent` at the last settlement, so construction since then is recorded exactly once. */
  readonly constructionSpentAtSettlement: number;
  readonly today: EconomyToday;
  readonly residents: Readonly<Record<string, ResidentAccount>>;
  readonly buildings: Readonly<Record<string, BuildingFinance>>;
  /** Newest last, at most `ECONOMY.historyDays`. */
  readonly history: readonly EconomyDayReport[];
  /** Newest last, at most `ECONOMY.ledgerEntries`. */
  readonly ledger: readonly LedgerEntry[];
  /** Lifetime total per ledger category, kept when old entries leave the bounded ledger. */
  readonly totals: Readonly<Partial<Record<LedgerCategory, number>>>;
  /** Conditions that are currently true (an alert is announced once, when it becomes active). */
  readonly alerts: readonly EconomyAlert[];
}

export interface EconomyOptions { readonly policy?: Partial<EconomyPolicy> }

export type EconomyCommand = { readonly type: 'economy.set-policy'; readonly policy: EconomyPolicy };
export type EconomyRejectionReason = 'economy-disabled' | 'invalid-policy' | 'unchanged-policy';


/** Phase 6 transportation. Tiles are road tiles; a lane position is measured in integer units (100 per tile). */
export type CompassDirection = 'N' | 'E' | 'S' | 'W';
export type VehicleKind = 'car' | 'van' | 'bus';
export type VehicleModel = 'compact' | 'sedan' | 'suv' | 'van' | 'bus';
/**
 * 'departing': waiting in the lot for room to pull out (not on the street yet). 'moving'/'queued': on the street,
 * with or without progress this tick. 'junction': stopped at an intersection waiting for its turn. 'dwelling': a bus
 * serving a stop.
 */
export type VehicleState = 'departing' | 'moving' | 'queued' | 'junction' | 'dwelling';

/** A granted intersection crossing: quadrant mask per junction tile, released once the vehicle's rear leaves the tile. */
export interface JunctionGrant {
  /** Route tile index of the junction tile. */
  readonly index: number;
  /** Quadrants as a 4-bit mask (bit 0 NW, 1 NE, 2 SW, 3 SE). */
  readonly mask: number;
}

export interface Vehicle {
  readonly id: string;
  readonly kind: VehicleKind;
  readonly model: VehicleModel;
  /** Body color palette index (the renderer owns the palette). */
  readonly color: number;
  /** First tile of the route and the compass steps from it (one letter per tile): compact and always on roads. */
  readonly origin: Position;
  readonly path: string;
  /** Front of the vehicle: route edge (from tile `edge` to tile `edge + 1`) and integer progress along it, 0–100. */
  readonly edge: number;
  readonly offset: number;
  /** Integer units per tick. */
  readonly speed: number;
  readonly state: VehicleState;
  /** Consecutive ticks without progress (stall detection). */
  readonly waitTicks: number;
  readonly grants: readonly JunctionGrant[];
  /** Cars: the owner; vans: the mall they serve. */
  readonly ownerId: string | null;
  /** Cars and vans: where the vehicle is heading (a building). */
  readonly destinationBuildingId: string | null;
  /** Buses: the line, the index of the stop being driven to, riders (citizen IDs, boarding order) and dwell ticks left. */
  readonly lineId: string | null;
  readonly stopIndex: number;
  readonly passengers: readonly string[];
  readonly dwell: number;
  readonly departedTick: number;
  /** World revision the route was planned at; older routes are re-planned a few vehicles per tick (new shortcuts). */
  readonly plannedRevision: number;
}

export interface BusStop {
  readonly id: string;
  readonly name: string;
  readonly tile: Position;
}

export interface BusLine {
  readonly id: string;
  readonly name: string;
  /** Route color palette index. */
  readonly color: number;
  /** Served in order, then back to the first (a loop). */
  readonly stopIds: readonly string[];
  /** Buses assigned to the line. */
  readonly buses: number;
  /** 'suspended' while a stop is missing or the loop cannot be driven; buses are withdrawn until it can. */
  readonly status: 'active' | 'suspended';
  readonly suspendedReason: 'stop-removed' | 'unreachable' | null;
  readonly lastDispatchTick: number;
}

export type TripMode = 'car' | 'bus';
/** 'to-stop': walking to the boarding stop; 'waiting': at the stop; 'riding': on a bus; 'driving': in their car. */
export type TripPhase = 'to-stop' | 'waiting' | 'riding' | 'driving';

export interface Trip {
  readonly id: string;
  readonly citizenId: string;
  readonly mode: TripMode;
  readonly phase: TripPhase;
  readonly originBuildingId: string;
  readonly destinationBuildingId: string;
  readonly vehicleId: string | null;
  readonly lineId: string | null;
  readonly boardStopId: string | null;
  readonly alightStopId: string | null;
  readonly startedTick: number;
  /** Tick the current phase began (waiting time at a stop). */
  readonly phaseTick: number;
  /** Door-to-door estimate when the mode was chosen, in game minutes. */
  readonly estimatedMinutes: number;
}

export interface TransportDayStats {
  readonly day: number;
  /** Trips started from a building, by mode. */
  readonly walkTrips: number;
  readonly carTrips: number;
  readonly busTrips: number;
  /** Completed car and bus trips and their total door-to-door minutes. */
  readonly carCompleted: number;
  readonly carMinutes: number;
  /** What those completed trips were expected to take when chosen (experience: actual ÷ expected). */
  readonly carExpected: number;
  readonly busCompleted: number;
  readonly busMinutes: number;
  readonly busExpected: number;
  readonly boardings: number;
  /** Times a waiting resident could not board because the bus was full. */
  readonly fullBuses: number;
  /** Residents who gave up waiting, trips cancelled by road edits, and vehicles pulled over after a long stall. */
  readonly gaveUp: number;
  readonly cancelled: number;
  readonly stalls: number;
  /** Highest number of vehicles on the street at once. */
  readonly peakVehicles: number;
}

export interface TransportState {
  readonly version: 1;
  readonly nextStopId: number;
  readonly nextLineId: number;
  readonly nextTripId: number;
  readonly stops: readonly BusStop[];
  readonly lines: readonly BusLine[];
  /** Vehicles on the street (or pulling out), sorted by ID. Parked cars are not vehicles. */
  readonly vehicles: readonly Vehicle[];
  /** Residents currently using transport, sorted by citizen ID. Walking trips are not recorded here. */
  readonly trips: readonly Trip[];
  /** Car owner → building where their car is parked, only when that is not their home. */
  readonly parkedCars: Readonly<Record<string, string>>;
  /** Directed lane (`x,yD`) → smoothed delay (units of lost progress), sparse. Drives the congestion overlay. */
  readonly congestion: Readonly<Record<string, number>>;
  /** Routing penalties frozen from `congestion` at the last routing epoch (routes depend only on saved state). */
  readonly routing: Readonly<Record<string, number>>;
  /** Vans: mall → the next home on its delivery round (rotates deterministically). */
  readonly vanRounds: Readonly<Record<string, number>>;
  readonly today: TransportDayStats;
  /** Newest last, at most `TRANSPORT.historyDays`. */
  readonly history: readonly TransportDayStats[];
  /**
   * How much slower than expected driving and the bus have been lately (percent, ≥ 100), smoothed day by day.
   * Residents scale their estimates by it, so a jammed commute shifts some of them to other modes the next day.
   */
  readonly experience: { readonly car: number; readonly bus: number };
}


export type TransportCommand =
  | { readonly type: 'transport.create-line'; readonly stops: readonly Position[]; readonly buses: number; readonly name?: string }
  | { readonly type: 'transport.delete-line'; readonly lineId: string }
  | { readonly type: 'transport.set-buses'; readonly lineId: string; readonly buses: number }
  | { readonly type: 'transport.rename-line'; readonly lineId: string; readonly name: string };
export type TransportRejectionReason = 'transport-disabled' | 'invalid-command' | 'line-limit' | 'stop-limit' | 'too-few-stops' |
  'too-many-stops' | 'duplicate-stop' | 'not-a-road' | 'stop-at-junction' | 'unreachable' | 'line-not-found' | 'invalid-buses' |
  'invalid-name' | 'unchanged';

export interface CitySnapshot {
  readonly plan: CityPlan;
  readonly budget: CityBudget;
  readonly nextBuildingId: number;
  /** Managed resident identities/assignments for history; time and RNG never rewind. */
  readonly citizens?: readonly Citizen[];
}

export type CitizenActivity = 'sleep' | 'home' | 'work' | 'leisure' | 'idle' | 'travel';

export interface PopulationOptions { readonly maxCitizens?: number }
export interface PopulationState {
  readonly version: 1;
  readonly maxCitizens: number;
  readonly nextCitizenId: number;
}
export interface CitizenAttributes {
  readonly age: number;
  /** Tiles per game minute, independent of wall-clock/frame rate. */
  readonly walkingSpeed: number;
  readonly scheduleOffset: number;
}
export interface CitizenMovement {
  /**
   * 'vehicle' (Phase 6): the transport system owns this resident's movement (pulling out, driving, waiting at a bus
   * stop or riding a bus); `WorldState.transport.trips` holds the details. The route stays empty.
   */
  readonly status: 'inside' | 'travelling' | 'waiting' | 'vehicle';
  /** Unit heading in tile coordinates, or {x:0,y:0} when stationary. */
  readonly heading: Position;
  readonly currentBuildingId: string | null;
  readonly destinationBuildingId: string | null;
  readonly arrivalActivity: CitizenActivity;
  readonly route: readonly Position[];
  readonly nextWaypoint: number;
  /** -1 queues a retry; a failed route at the current revision waits for an edit. */
  readonly plannedRevision: number;
}
export interface BuildingOccupancy {
  readonly buildingId: string;
  readonly residentIds: readonly string[];
  readonly workerIds: readonly string[];
  readonly visitorIds: readonly string[];
}

export interface ScheduleEntry {
  /** Integer minute in [0, 1440); entries are ascending and begin at 0. */
  readonly startMinute: number;
  readonly activity: CitizenActivity;
  readonly targetBuildingId: string | null;
}

/** Repeats daily; each entry lasts until the next entry or midnight. */
export interface DailySchedule {
  readonly entries: readonly ScheduleEntry[];
}

export interface Citizen {
  readonly id: string;
  readonly name: string;
  readonly homeBuildingId: string;
  readonly workBuildingId: string | null;
  readonly position: Position;
  readonly activity: CitizenActivity;
  readonly targetBuildingId: string | null;
  readonly schedule: DailySchedule;
  readonly attributes?: CitizenAttributes;
  readonly movement?: CitizenMovement;
  readonly scheduleMode?: 'generated' | 'custom';
}

export interface ClockState {
  readonly tick: number;
  /** Real elapsed milliseconds per simulation tick. */
  readonly fixedStepMs: number;
  /** Game minutes advanced by each tick. */
  readonly minutesPerTick: number;
  /** Fractional real time carried to the next advance call. */
  readonly accumulatedMs: number;
  readonly paused: boolean;
}

/** JSON-safe snapshot. Pending commands are owned by the Simulation instance. */
export interface WorldState {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly plan: CityPlan;
  readonly clock: ClockState;
  readonly randomState: number;
  readonly citizens: readonly Citizen[];
  readonly budget: CityBudget;
  readonly revision: number;
  readonly nextBuildingId: number;
  /** Absent in legacy Phase 0–2 saves. Explicit opt-in activates Phase 3A. */
  readonly population?: PopulationState;
  /** Phase 4 Life Mode character. Absent until a player is explicitly created; never auto-created on load. */
  readonly player?: PlayerCharacter;
  /** Phase 5 economy. Absent in older saves; enabled explicitly, never retroactively billed. */
  readonly economy?: EconomyState;
  /** Phase 6 transportation. Absent in older saves; enabled explicitly, with no vehicles until trips start. */
  readonly transport?: TransportState;
  /** Phase 7 living society. Absent in older saves; enabled explicitly, never replayed retroactively. */
  readonly society?: SocietyState;
}

/** Phase 7 living society. Every number is an integer; see `societyConfig.ts`. */
export type Interest = 'food' | 'shopping' | 'film' | 'music' | 'nightlife' | 'outdoors' | 'arts' | 'thrills' | 'fitness';
/** What a resident does on an outing (decided by the venue type, or `visit` for a friend's home). */
export type OutingKind = 'dine' | 'shop' | 'market' | 'movie' | 'club' | 'event' | 'rides' | 'park' | 'plaza' | 'swim' | 'lounge' | 'visit';
export type CityEventKind = 'concert' | 'performance' | 'movie-night' | 'festival';

/** Stable 0–100 traits, generated once per resident from their identity and then stored. */
export interface Personality {
  /** Seeks company and groups (high) or quiet and small groups (low). */
  readonly sociability: number;
  /** Tries new places (high) or returns to favourites (low). */
  readonly curiosity: number;
  /** Stamina for late nights and long outings. */
  readonly vitality: number;
  /** Careful with money: weighs prices more and keeps a larger cushion. */
  readonly frugality: number;
  /** Drawn to community events and public gatherings. */
  readonly community: number;
}

/** 0–100, 100 is fully satisfied. The same scale and meaning as the Life Mode player's needs. */
export interface ResidentNeeds {
  readonly energy: number;
  readonly hunger: number;
  readonly social: number;
  /** Leisure satisfaction. */
  readonly fun: number;
}

/** A decided outing. Companions on the same outing share its `id`. */
export interface Outing {
  readonly id: string;
  readonly kind: OutingKind;
  readonly venueId: string;
  readonly eventId: string | null;
  /** Residents going together (not including this resident). */
  readonly companions: readonly string[];
  /** For a friend's home visit: the friend who hosts. */
  readonly hostId: string | null;
  readonly decidedTick: number;
  /** Leaves when it must to arrive by `startTick` (events, cinema screenings) or right away. */
  readonly startTick: number;
  readonly endTick: number;
  /** Cancelled if not arrived by then (late for an event, or stuck). */
  readonly arriveByTick: number;
  readonly status: 'travelling' | 'present';
  /** What was charged on arrival (0 for free activities), so one outing is never charged twice. */
  readonly spent: number;
}

/** Why the last outing was chosen (top factors) or why the resident stayed in; shown in the profile. */
export interface SocialChoice {
  readonly tick: number;
  readonly kind: OutingKind | 'stay-home';
  readonly venueId: string | null;
  /** Factor codes such as `hungry`, `interest:music`, `friend:npc-4`, `event:event-3`, `cheap`, `nearby`, `tired`. */
  readonly reasons: readonly string[];
  /** Options weighed (reachable, open, affordable and with room). */
  readonly options: number;
}

export interface SocialProfile {
  readonly traits: Personality;
  readonly interests: readonly Interest[];
  readonly needs: ResidentNeeds;
  readonly outing: Outing | null;
  /** The resident is hosting a friend at home until this tick (0 when not hosting). */
  readonly hostingUntil: number;
  /** No outing is considered before this tick (cool-down after an outing or a decision to stay in). */
  readonly nextDecisionTick: number;
  /** Outings started today and the day they were counted on. */
  readonly outingsToday: number;
  readonly day: number;
  /** Venues visited most recently, newest last (bounded): novelty for the curious, favourites for the rest. */
  readonly recent: readonly string[];
  readonly lastChoice: SocialChoice | null;
}

/** An undirected relationship; `a < b` (citizen IDs), so each pair has exactly one edge. */
export interface Relationship {
  readonly a: string;
  readonly b: string;
  /** 1–100: acquaintance below 40, friend from 40, close friend from 75. */
  readonly strength: number;
  readonly since: number;
  /** Game day of the last time they spent together, and what they gained that day (capped per day). */
  readonly lastDay: number;
  readonly gainedToday: number;
}

export interface CityEvent {
  readonly id: string;
  readonly kind: CityEventKind;
  readonly name: string;
  readonly venueId: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly capacity: number;
  /** Ticket per attendee (paid to the city for public venues); 0 for free events. */
  readonly price: number;
  /** What the city pays to host it, recorded when it starts. */
  readonly cost: number;
  readonly organizer: 'city' | 'player';
  readonly status: 'scheduled' | 'running' | 'finished' | 'cancelled';
  readonly cancelReason: 'venue-removed' | 'player' | null;
  /** Residents who arrived (each counted and charged once). */
  readonly attendees: readonly string[];
}

export interface SocietyDayStats {
  readonly day: number;
  readonly outings: number;
  readonly groupOutings: number;
  readonly visitsByKind: Readonly<Partial<Record<OutingKind, number>>>;
  readonly eventAttendance: number;
  readonly newFriendships: number;
  readonly cancelled: number;
  /** Times a wanted venue was full (demand the city could add room for). */
  readonly turnedAway: number;
  readonly spending: number;
}

export interface SocietyState {
  readonly version: 1;
  readonly nextOutingId: number;
  readonly nextEventId: number;
  /** The last day the event calendar was filled for (events are never created for days that have passed). */
  readonly scheduledThrough: number;
  readonly residents: Readonly<Record<string, SocialProfile>>;
  /** Sorted by (a, b); at most `SOCIETY.relationshipsPerResident` per resident. */
  readonly relationships: readonly Relationship[];
  /** Scheduled, running and recently finished events, sorted by start; bounded. */
  readonly events: readonly CityEvent[];
  readonly today: SocietyDayStats;
  /** Newest last, at most `SOCIETY.historyDays`. */
  readonly history: readonly SocietyDayStats[];
}

export type SocietyCommand =
  | { readonly type: 'society.schedule-event'; readonly venueId: string; readonly kind: CityEventKind; readonly day: number; readonly startMinute: number }
  | { readonly type: 'society.cancel-event'; readonly eventId: string };
export type SocietyRejectionReason = 'society-disabled' | 'invalid-command' | 'venue-not-found' | 'unsupported-event' | 'invalid-time' |
  'venue-busy' | 'event-limit' | 'insufficient-funds' | 'event-not-found' | 'event-started';

export interface SocietyCommandResult extends SimulationResult {
  readonly applied: boolean;
  readonly reason: SocietyRejectionReason | null;
  readonly eventId: string | null;
}

export type PlayerHairStyle = 'short' | 'long' | 'bun' | 'curly' | 'cap' | 'buzz';
export type PlayerOutfit = 'tee' | 'dress' | 'jacket' | 'overalls' | 'hoodie';
export type PlayerAccessory = 'none' | 'glasses' | 'backpack' | 'scarf' | 'sunhat';

/** Bounded, typed choices. Colors are palette indices; the renderer owns the palettes. */
export interface PlayerAppearance {
  readonly skinTone: number;
  readonly hairStyle: PlayerHairStyle;
  readonly hairColor: number;
  readonly outfit: PlayerOutfit;
  readonly outfitColor: number;
  readonly accessory: PlayerAccessory;
}

/** Every need is in [0, 100]; 100 is fully satisfied (rested, fed, connected, happy). */
export interface PlayerNeeds {
  readonly energy: number;
  readonly hunger: number;
  readonly social: number;
  readonly mood: number;
}
export type PlayerNeed = keyof PlayerNeeds;
export type PlayerNeedLevel = 'good' | 'fair' | 'low' | 'critical';

export type PlayerActivityKind = 'idle' | 'move' | 'rest' | 'eat' | 'visit' | 'greet' | 'socialize';
export type PlayerFailureReason = 'unreachable' | 'home-lost' | 'venue-removed' | 'venue-full' | 'citizen-left' |
  'citizen-unavailable' | 'too-tired' | 'route-lost';

export interface PlayerActivity {
  readonly kind: PlayerActivityKind;
  readonly phase: 'idle' | 'travelling' | 'performing';
  /** Destination or venue (home, park, any building for move). */
  readonly buildingId: string | null;
  /** Resident for greet/socialize. */
  readonly citizenId: string | null;
  /** Road tile for move-to-tile. */
  readonly tile: Position | null;
  /** Game minutes the performing phase lasts; 0 for idle and move. */
  readonly durationMinutes: number;
  readonly elapsedMinutes: number;
}

export interface PlayerMovement {
  /** 'unplaced': created but not yet moved in (no world position, no needs progress). */
  readonly status: 'inside' | 'travelling' | 'standing' | 'unplaced';
  readonly heading: Position;
  /** Building the player is inside, or whose private entrance leg they are on. */
  readonly currentBuildingId: string | null;
  /** Building being entered at the end of the route (own home or a leisure venue). */
  readonly destinationBuildingId: string | null;
  readonly route: readonly Position[];
  readonly nextWaypoint: number;
  /** -1 requests a fresh route on the next tick (city edits, moving social targets). */
  readonly plannedRevision: number;
}

export interface PlayerOutcome {
  readonly kind: PlayerActivityKind;
  readonly result: 'completed' | 'cancelled' | 'failed';
  readonly reason: PlayerFailureReason | null;
  readonly tick: number;
  readonly buildingId: string | null;
  readonly citizenId: string | null;
  readonly elapsedMinutes: number;
}

export interface PlayerCharacter {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly appearance: PlayerAppearance;
  /**
   * Null before the first move-in (unplaced) or after the home was lost. While null, population reconciliation keeps
   * one room free for the player instead of creating new residents in it; existing residents are never displaced.
   */
  readonly homeBuildingId: string | null;
  readonly position: Position;
  readonly movement: PlayerMovement;
  readonly activity: PlayerActivity;
  readonly needs: PlayerNeeds;
  /** Residents met through greet/socialize, oldest first, bounded and pruned when residents leave. */
  readonly acquaintances: readonly string[];
  readonly createdTick: number;
  readonly lastOutcome: PlayerOutcome | null;
}

export type PlayerDestination =
  | { readonly type: 'tile'; readonly position: Position }
  | { readonly type: 'building'; readonly buildingId: string };

export type PlayerActionKind = 'rest' | 'eat' | 'visit' | 'greet' | 'socialize';

export type LifeCommand =
  | { readonly type: 'player.create'; readonly name: string; readonly appearance: PlayerAppearance; readonly homeBuildingId?: string }
  | { readonly type: 'player.customize'; readonly name: string; readonly appearance: PlayerAppearance }
  | { readonly type: 'player.move-in'; readonly homeBuildingId: string }
  | { readonly type: 'player.move-to'; readonly destination: PlayerDestination }
  | { readonly type: 'player.start-activity'; readonly activity: PlayerActionKind; readonly buildingId?: string; readonly citizenId?: string }
  | { readonly type: 'player.cancel' };

export type LifeRejectionReason = 'invalid-command' | 'player-exists' | 'player-not-found' | 'invalid-name' |
  'invalid-appearance' | 'home-not-found' | 'not-a-home' | 'home-full' | 'already-home' | 'no-home' |
  'invalid-destination' | 'unreachable' | 'stranded' | 'building-not-found' | 'not-leisure' | 'no-venue' | 'venue-full' | 'venue-closed' |
  'citizen-not-found' | 'citizen-unavailable' | 'too-tired' | 'nothing-to-cancel' | 'not-placed';

export type PlayerSocialTopic = 'introduction' | 'commute' | 'leisure' | 'neighbourhood' | 'rest';

export type CitizenCommand =
  | { readonly type: 'citizen.relocate'; readonly citizenId: string; readonly position: Position }
  | { readonly type: 'citizen.set-schedule'; readonly citizenId: string; readonly schedule: DailySchedule };

export type CityCommand =
  | { readonly type: 'city.build'; readonly buildingType: BuildingType; readonly position: Position; readonly name?: string }
  | { readonly type: 'city.demolish'; readonly buildingId: string }
  | { readonly type: 'city.move-building'; readonly buildingId: string; readonly position: Position }
  | { readonly type: 'city.edit-roads'; readonly add: readonly Position[]; readonly remove: readonly Position[] };

export type WorldCommand = CitizenCommand | CityCommand;

export type CityRejectionReason = 'invalid-building-type' | 'invalid-position' | 'out-of-bounds' |
  'blocked-tile' | 'occupied-tile' | 'road-required' | 'insufficient-funds' | 'invalid-name' |
  'building-not-found' | 'building-in-use' | 'road-already-exists' | 'road-not-found' |
  'duplicate-road-edit' | 'conflicting-road-edit' | 'empty-road-edit' | 'unchanged-position' | 'state-limit-reached';

export type PlacementValidation = { readonly valid: true; readonly cost: number } |
  { readonly valid: false; readonly reason: CityRejectionReason };

export type CommandRejectionReason = 'citizen-not-found' | 'invalid-position' | 'invalid-schedule';

export type SimulationEvent =
  | { readonly type: 'citizen.created'; readonly tick: number; readonly citizen: Citizen }
  | { readonly type: 'citizen.removed'; readonly tick: number; readonly citizenId: string; readonly reason: 'housing-lost' | 'population-limit' }
  | { readonly type: 'citizen.assignment-changed'; readonly tick: number; readonly citizenId: string; readonly homeBuildingId: string; readonly workBuildingId: string | null }
  | { readonly type: 'citizen.moved'; readonly tick: number; readonly citizenId: string; readonly position: Position; readonly heading: Position }
  | { readonly type: 'citizen.arrived'; readonly tick: number; readonly citizenId: string; readonly buildingId: string }
  | { readonly type: 'citizen.route-blocked'; readonly tick: number; readonly citizenId: string; readonly destinationBuildingId: string; readonly reason: 'unreachable' | 'search-limit' }
  | { readonly type: 'population.changed'; readonly tick: number; readonly count: number }
  | { readonly type: 'command.applied'; readonly tick: number; readonly commandType: CitizenCommand['type']; readonly citizenId: string }
  | { readonly type: 'command.rejected'; readonly tick: number; readonly commandType: CitizenCommand['type']; readonly citizenId: string; readonly reason: CommandRejectionReason }
  | { readonly type: 'city.building-built'; readonly tick: number; readonly revision: number; readonly building: Building }
  | { readonly type: 'city.building-demolished'; readonly tick: number; readonly revision: number; readonly buildingId: string }
  | { readonly type: 'city.building-moved'; readonly tick: number; readonly revision: number; readonly buildingId: string; readonly from: Position; readonly to: Position }
  | { readonly type: 'city.roads-edited'; readonly tick: number; readonly revision: number; readonly added: readonly Position[]; readonly removed: readonly Position[] }
  | { readonly type: 'city.budget-changed'; readonly tick: number; readonly revision: number; readonly spent: number; readonly balance: number }
  | { readonly type: 'city.road-network-changed'; readonly tick: number; readonly revision: number; readonly componentCount: number; readonly isolatedBuildingIds: readonly string[] }
  | { readonly type: 'city.restored'; readonly tick: number; readonly revision: number }
  | { readonly type: 'city.command-rejected'; readonly tick: number; readonly commandType: CityCommand['type']; readonly reason: CityRejectionReason; readonly commandIndex: number }
  | { readonly type: 'citizen.activity-changed'; readonly tick: number; readonly citizenId: string; readonly activity: CitizenActivity; readonly targetBuildingId: string | null }
  | { readonly type: 'clock.day-started'; readonly tick: number; readonly day: number }
  | { readonly type: 'player.created'; readonly tick: number; readonly player: PlayerCharacter }
  | { readonly type: 'player.customized'; readonly tick: number; readonly name: string }
  | { readonly type: 'player.moved-in'; readonly tick: number; readonly homeBuildingId: string; readonly previousHomeBuildingId: string | null }
  | { readonly type: 'player.home-lost'; readonly tick: number; readonly buildingId: string }
  | { readonly type: 'player.relocated'; readonly tick: number; readonly position: Position; readonly reason: 'building-removed' | 'building-moved' | 'road-removed'; readonly stranded: boolean }
  | { readonly type: 'player.route-blocked'; readonly tick: number; readonly reason: 'unreachable' | 'search-limit' }
  | { readonly type: 'player.arrived'; readonly tick: number; readonly buildingId: string | null; readonly position: Position }
  | { readonly type: 'player.activity-started'; readonly tick: number; readonly activity: PlayerActivityKind; readonly phase: PlayerActivity['phase']; readonly buildingId: string | null; readonly citizenId: string | null }
  | { readonly type: 'player.activity-ended'; readonly tick: number; readonly outcome: PlayerOutcome }
  | { readonly type: 'player.interaction'; readonly tick: number; readonly citizenId: string; readonly kind: 'greet' | 'socialize'; readonly topic: PlayerSocialTopic; readonly firstMeeting: boolean }
  | { readonly type: 'player.need-changed'; readonly tick: number; readonly need: PlayerNeed; readonly level: PlayerNeedLevel; readonly previous: PlayerNeedLevel; readonly value: number }
  | { readonly type: 'player.command-rejected'; readonly tick: number; readonly commandType: LifeCommand['type']; readonly reason: LifeRejectionReason }
  | { readonly type: 'economy.enabled'; readonly tick: number; readonly firstDay: number }
  | { readonly type: 'economy.day-settled'; readonly tick: number; readonly day: number; readonly report: EconomyDayReport }
  | { readonly type: 'economy.policy-changed'; readonly tick: number; readonly policy: EconomyPolicy }
  | { readonly type: 'economy.alert'; readonly tick: number; readonly alert: EconomyAlert }
  | { readonly type: 'economy.command-rejected'; readonly tick: number; readonly commandType: EconomyCommand['type']; readonly reason: EconomyRejectionReason }
  | { readonly type: 'transport.enabled'; readonly tick: number }
  | { readonly type: 'transport.trip-started'; readonly tick: number; readonly citizenId: string; readonly mode: TripMode; readonly destinationBuildingId: string; readonly estimatedMinutes: number }
  | { readonly type: 'transport.trip-completed'; readonly tick: number; readonly citizenId: string; readonly mode: TripMode; readonly minutes: number }
  | { readonly type: 'transport.trip-cancelled'; readonly tick: number; readonly citizenId: string; readonly mode: TripMode; readonly reason: 'road-removed' | 'unreachable' | 'stop-removed' | 'line-removed' | 'gave-up' | 'stalled' | 'destination-changed' }
  | { readonly type: 'transport.boarded'; readonly tick: number; readonly citizenId: string; readonly vehicleId: string; readonly stopId: string }
  | { readonly type: 'transport.alighted'; readonly tick: number; readonly citizenId: string; readonly vehicleId: string; readonly stopId: string }
  | { readonly type: 'transport.bus-full'; readonly tick: number; readonly vehicleId: string; readonly stopId: string; readonly left: number }
  | { readonly type: 'transport.vehicle-stalled'; readonly tick: number; readonly vehicleId: string }
  | { readonly type: 'transport.line-changed'; readonly tick: number; readonly lineId: string; readonly status: BusLine['status'] | 'created' | 'deleted'; readonly reason: BusLine['suspendedReason'] }
  | { readonly type: 'transport.command-rejected'; readonly tick: number; readonly commandType: TransportCommand['type']; readonly reason: TransportRejectionReason }
  | { readonly type: 'society.enabled'; readonly tick: number }
  | { readonly type: 'society.outing-planned'; readonly tick: number; readonly citizenId: string; readonly outingId: string; readonly kind: OutingKind; readonly venueId: string; readonly companions: readonly string[]; readonly reasons: readonly string[] }
  | { readonly type: 'society.outing-arrived'; readonly tick: number; readonly citizenId: string; readonly outingId: string; readonly venueId: string; readonly spent: number }
  | { readonly type: 'society.outing-ended'; readonly tick: number; readonly citizenId: string; readonly outingId: string; readonly venueId: string; readonly result: 'completed' | 'cancelled'; readonly reason: 'venue-removed' | 'unreachable' | 'late' | 'event-cancelled' | 'host-left' | 'obligation' | null }
  | { readonly type: 'society.turned-away'; readonly tick: number; readonly citizenId: string; readonly venueId: string }
  | { readonly type: 'society.relationship-changed'; readonly tick: number; readonly a: string; readonly b: string; readonly level: 'acquaintance' | 'friend' | 'close-friend'; readonly strength: number }
  | { readonly type: 'society.event-scheduled'; readonly tick: number; readonly event: CityEvent }
  | { readonly type: 'society.event-started'; readonly tick: number; readonly eventId: string; readonly venueId: string; readonly expected: number }
  | { readonly type: 'society.event-ended'; readonly tick: number; readonly eventId: string; readonly venueId: string; readonly attendance: number }
  | { readonly type: 'society.event-cancelled'; readonly tick: number; readonly eventId: string; readonly venueId: string; readonly reason: 'venue-removed' | 'player' }
  | { readonly type: 'society.command-rejected'; readonly tick: number; readonly commandType: SocietyCommand['type']; readonly reason: SocietyRejectionReason }
  | { readonly type: 'clock.ticked'; readonly tick: number; readonly day: number; readonly minuteOfDay: number };

export interface SimulationResult {
  readonly state: WorldState;
  readonly events: readonly SimulationEvent[];
  readonly steps: number;
  /** Fraction of the next fixed step, for presentation interpolation. */
  readonly alpha: number;
}

export interface CityCommandResult extends SimulationResult {
  readonly applied: boolean;
}

export interface EconomyCommandResult extends SimulationResult {
  readonly applied: boolean;
  readonly reason: EconomyRejectionReason | null;
}

export interface TransportCommandResult extends SimulationResult {
  readonly applied: boolean;
  readonly reason: TransportRejectionReason | null;
  /** The line a create command made. */
  readonly lineId: string | null;
}

export interface LifeCommandResult extends SimulationResult {
  readonly applied: boolean;
  readonly reason: LifeRejectionReason | null;
}
