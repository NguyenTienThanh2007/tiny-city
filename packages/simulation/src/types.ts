/** All world coordinates are grid tiles, with x right and y down. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

export type BuildingKind = 'home' | 'workplace' | 'park';
export type BuildingType = 'villa' | 'duplex' | 'townhouse' | 'apartment' | 'park' | 'clubhouse' | 'pool' | 'mall' | 'office';

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
  readonly role: 'office' | 'mall' | 'park' | 'pool' | 'clubhouse';
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
  | 'city.road-upkeep' | 'city.amenity-upkeep' | 'city.construction' | 'city.construction-refund';

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
  readonly income: { readonly residentialTax: number; readonly commercialTax: number; readonly venueFees: number; readonly constructionRefunds: number };
  /** Treasury outflows. */
  readonly expenses: { readonly publicServices: number; readonly roads: number; readonly amenities: number; readonly unemploymentSupport: number; readonly construction: number };
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
  readonly status: 'inside' | 'travelling' | 'waiting';
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
  'invalid-destination' | 'unreachable' | 'stranded' | 'building-not-found' | 'not-leisure' | 'no-venue' | 'venue-full' |
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

export interface LifeCommandResult extends SimulationResult {
  readonly applied: boolean;
  readonly reason: LifeRejectionReason | null;
}
