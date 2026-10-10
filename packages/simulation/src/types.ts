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
}

export type CitizenActivity = 'sleep' | 'home' | 'work' | 'leisure' | 'idle';

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
}

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
