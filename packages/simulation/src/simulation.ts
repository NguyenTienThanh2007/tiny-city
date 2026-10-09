import { advanceClock, getGameTime, stepClock } from './clock.js';
import type { CityPlan, ClockState, Citizen, ScheduleEntry, SimulationEvent, SimulationResult, WorldCommand, WorldState } from './types.js';
import { cloneWorld, freeze, isPositionInPlan, validateSchedule, validateWorld } from './world.js';

function copyCommand(command: WorldCommand): WorldCommand {
  switch (command.type) {
    case 'citizen.relocate':
      return { ...command, position: { ...command.position } };
    case 'citizen.set-schedule':
      return { ...command, schedule: { entries: command.schedule.entries.map((entry) => ({ ...entry })) } };
    default:
      throw new TypeError('unsupported command type');
  }
}

function scheduledEntry(citizen: Citizen, minuteOfDay: number): ScheduleEntry {
  // World validation guarantees an entry at midnight and ascending start times.
  let active = citizen.schedule.entries[0]!;
  for (const entry of citizen.schedule.entries) {
    if (entry.startMinute > minuteOfDay) break;
    active = entry;
  }
  return active;
}

/** Headless deterministic runner. Event delivery belongs to the caller. */
export class Simulation {
  private state: WorldState;
  private commands: WorldCommand[] = [];

  constructor(initialState: WorldState) {
    validateWorld(initialState);
    this.state = freeze(cloneWorld(initialState));
  }

  getState(): WorldState {
    return this.state;
  }

  /** Replace an editor-authored layout without restarting time or dropping commands. */
  replacePlan(plan: CityPlan): void {
    const next = { ...this.state, plan };
    validateWorld(next);
    this.state = freeze(cloneWorld(next));
  }

  get pendingCommandCount(): number {
    return this.commands.length;
  }

  /** Commands are copied on enqueue, then consumed FIFO at the next executed tick. */
  enqueue(command: WorldCommand): void {
    this.commands.push(freeze(copyCommand(command)));
  }

  pause(): void {
    this.setPaused(true);
  }

  resume(): void {
    this.setPaused(false);
  }

  private setPaused(paused: boolean): void {
    this.state = freeze({ ...this.state, clock: { ...this.state.clock, paused } });
  }

  advance(elapsedMs: number): SimulationResult {
    const next = advanceClock(this.state.clock, elapsedMs);
    return this.run(next.clock, next.steps);
  }

  /** Executes exact ticks, including while paused; does not consume fractional time. */
  step(steps = 1): SimulationResult {
    return this.run(stepClock(this.state.clock, steps), steps);
  }

  private run(clock: ClockState, steps: number): SimulationResult {
    const events: SimulationEvent[] = [];
    const firstTick = this.state.clock.tick;
    for (let i = 1; i <= steps; i += 1) {
      this.runTick({ ...clock, tick: firstTick + i }, events);
    }
    this.state = freeze({ ...this.state, clock });
    return freeze({ state: this.state, events, steps, alpha: clock.accumulatedMs / clock.fixedStepMs });
  }

  private runTick(clock: ClockState, events: SimulationEvent[]): void {
    const { tick } = clock;
    const previousDay = getGameTime(this.state.clock).day;
    const time = getGameTime(clock);
    let citizens = [...this.state.citizens];
    for (const command of this.commands) {
      const index = citizens.findIndex((citizen) => citizen.id === command.citizenId);
      const citizen = citizens[index];
      const details = { tick, commandType: command.type, citizenId: command.citizenId };
      if (!citizen) {
        events.push({ type: 'command.rejected', ...details, reason: 'citizen-not-found' });
        continue;
      }
      switch (command.type) {
        case 'citizen.relocate':
          if (!isPositionInPlan(command.position, this.state.plan)) {
            events.push({ type: 'command.rejected', ...details, reason: 'invalid-position' });
            continue;
          }
          citizens[index] = { ...citizen, position: command.position };
          break;
        case 'citizen.set-schedule':
          try {
            validateSchedule(command.schedule, this.state.plan);
          } catch {
            events.push({ type: 'command.rejected', ...details, reason: 'invalid-schedule' });
            continue;
          }
          citizens[index] = { ...citizen, schedule: command.schedule };
          break;
      }
      events.push({ type: 'command.applied', ...details });
    }
    this.commands = [];
    citizens = citizens.map((citizen) => {
      const entry = scheduledEntry(citizen, time.minuteOfDay);
      if (citizen.activity === entry.activity && citizen.targetBuildingId === entry.targetBuildingId) return citizen;
      events.push({ type: 'citizen.activity-changed', tick, citizenId: citizen.id,
        activity: entry.activity, targetBuildingId: entry.targetBuildingId });
      return { ...citizen, activity: entry.activity, targetBuildingId: entry.targetBuildingId };
    });
    for (let day = previousDay + 1; day <= time.day; day += 1) {
      events.push({ type: 'clock.day-started', tick, day });
    }
    events.push({ type: 'clock.ticked', tick, ...time });
    this.state = freeze({ ...this.state, clock, citizens });
  }
}
