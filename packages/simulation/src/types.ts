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

export interface CityBudget {
  readonly openingBalance: number;
  readonly balance: number;
  readonly totalSpent: number;
}

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

export interface LifeCommandResult extends SimulationResult {
  readonly applied: boolean;
  readonly reason: LifeRejectionReason | null;
}
