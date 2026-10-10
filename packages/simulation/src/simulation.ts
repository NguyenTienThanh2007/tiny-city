import { advanceClock, getGameTime, stepClock } from './clock.js';
import type { CityCommand, CityCommandResult, CityPlan, CitySnapshot, ClockState, Citizen, ScheduleEntry, SimulationEvent, SimulationResult, WorldCommand, WorldState } from './types.js';
import { cloneWorld, freeze, isPositionInPlan, validateSchedule, validateWorld } from './world.js';
import { applyCityCommand, applyCityCommandBatch, copyCityCommand } from './cityCommands.js';
import { compareTiles, OccupancyGrid } from './grid.js';
import { RoadGraph } from './roads.js';

function copyCommand(command: WorldCommand): WorldCommand {
  switch (command.type) {
    case 'citizen.relocate':
      return { ...command, position: { ...command.position } };
    case 'citizen.set-schedule':
      return { ...command, schedule: { entries: command.schedule.entries.map((entry) => ({ ...entry })) } };
    case 'city.build':
    case 'city.demolish':
    case 'city.move-building':
    case 'city.edit-roads': return copyCityCommand(command);
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
  private indexedPlan: CityPlan | null = null;
  private occupancy: OccupancyGrid | null = null;
  private roadGraph: RoadGraph | null = null;

  constructor(initialState: WorldState) {
    validateWorld(initialState);
    this.state = freeze(cloneWorld(initialState));
  }

  getState(): WorldState {
    return this.state;
  }

  /** Legacy label-only update. Structural edits must use commands or history restoration. */
  replacePlan(plan: CityPlan): SimulationResult {
    const next = { ...this.state, plan };
    validateWorld(next);
    const geometry = (value: CityPlan) => JSON.stringify([value.id, value.width, value.height,
      [...value.roads].sort(compareTiles).map((tile) => [tile.x, tile.y]),
      [...value.blockedTiles].sort(compareTiles).map((tile) => [tile.x, tile.y]),
      value.buildings.map((building) => [building.id, building.type ?? null, building.kind, building.capacity,
        building.position.x, building.position.y, building.footprint.width, building.footprint.height])]);
    if (geometry(plan) !== geometry(this.state.plan)) throw new RangeError('Structural changes require city commands or restoreCity');
    return this.restoreCity({ ...this.getCitySnapshot(), plan });
  }

  getCitySnapshot(): CitySnapshot {
    return freeze({ plan: this.state.plan, budget: this.state.budget, nextBuildingId: this.state.nextBuildingId });
  }

  /** Undo/redo restores city data while time, RNG, and command queues keep progressing. */
  restoreCity(snapshot: CitySnapshot): SimulationResult {
    if (!Number.isSafeInteger(snapshot.nextBuildingId) || snapshot.nextBuildingId <= 0) throw new RangeError('invalid snapshot building ID cursor');
    if (this.state.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('revision limit reached');
    const next = { ...this.state, plan: snapshot.plan, budget: snapshot.budget,
      nextBuildingId: Math.max(this.state.nextBuildingId, snapshot.nextBuildingId), revision: this.state.revision + 1 };
    validateWorld(next);
    this.state = freeze(cloneWorld(next));
    return freeze({ state: this.state, events: [{ type: 'city.restored', tick: this.state.clock.tick, revision: this.state.revision }],
      steps: 0, alpha: this.state.clock.accumulatedMs / this.state.clock.fixedStepMs });
  }

  execute(command: CityCommand): CityCommandResult {
    const result = applyCityCommand(this.state, copyCityCommand(command));
    this.state = result.state;
    return result;
  }

  executeBatch(commands: readonly CityCommand[]): CityCommandResult {
    const result = applyCityCommandBatch(this.state, commands.map(copyCityCommand));
    this.state = result.state;
    return result;
  }

  private ensureIndexes(): void {
    if (this.indexedPlan === this.state.plan) return;
    this.occupancy = new OccupancyGrid(this.state.plan);
    this.roadGraph = new RoadGraph(this.state.plan.roads);
    this.indexedPlan = this.state.plan;
  }

  getOccupancyGrid(): OccupancyGrid {
    this.ensureIndexes();
    return this.occupancy!;
  }

  getRoadGraph(): RoadGraph {
    this.ensureIndexes();
    return this.roadGraph!;
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
    this.state = freeze({ ...this.state, clock });
    for (const command of this.commands) {
      if (command.type === 'city.build' || command.type === 'city.demolish' || command.type === 'city.move-building' || command.type === 'city.edit-roads') {
        const result = applyCityCommand(this.state, command);
        this.state = result.state;
        events.push(...result.events);
        continue;
      }
      const citizens = [...this.state.citizens];
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
      this.state = freeze({ ...this.state, citizens });
    }
    this.commands = [];
    const citizens = this.state.citizens.map((citizen) => {
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
