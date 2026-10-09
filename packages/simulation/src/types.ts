/** All world coordinates are grid tiles, with x right and y down. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

export type BuildingKind = 'home' | 'workplace' | 'park';

export interface Building {
  readonly id: string;
  readonly name: string;
  readonly kind: BuildingKind;
  /** Top-left tile of the footprint. */
  readonly position: Position;
  readonly footprint: { readonly width: number; readonly height: number };
  readonly capacity: number;
}

/** A static layout; rendering styles and textures belong to the consumer. */
export interface CityPlan {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly buildings: readonly Building[];
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
  readonly schemaVersion: 1;
  readonly id: string;
  readonly plan: CityPlan;
  readonly clock: ClockState;
  readonly randomState: number;
  readonly citizens: readonly Citizen[];
}

export type WorldCommand =
  | { readonly type: 'citizen.relocate'; readonly citizenId: string; readonly position: Position }
  | { readonly type: 'citizen.set-schedule'; readonly citizenId: string; readonly schedule: DailySchedule };

export type CommandRejectionReason = 'citizen-not-found' | 'invalid-position' | 'invalid-schedule';

export type SimulationEvent =
  | { readonly type: 'command.applied'; readonly tick: number; readonly commandType: WorldCommand['type']; readonly citizenId: string }
  | { readonly type: 'command.rejected'; readonly tick: number; readonly commandType: WorldCommand['type']; readonly citizenId: string; readonly reason: CommandRejectionReason }
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
