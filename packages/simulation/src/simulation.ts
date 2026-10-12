import { advanceClock, getGameTime, stepClock } from './clock.js';
import type { BuildingOccupancy, CityCommand, CityCommandResult, CityPlan, CitySnapshot, ClockState, Citizen, LifeCommand, LifeCommandResult, PlayerCharacter, PopulationOptions, SimulationEvent, SimulationResult, WorldCommand, WorldState } from './types.js';
import { cloneWorld, freeze, isPositionInPlan, validateSchedule, validateWorld } from './world.js';
import { applyCityCommand, applyCityCommandBatch, copyCityCommand } from './cityCommands.js';
import { compareTiles, OccupancyGrid } from './grid.js';
import { RoadGraph } from './roads.js';
import { buildingCenter, RoadNavigator } from './navigation.js';
import { initializePopulation, insideMovement, providesLeisure, reconcilePopulation } from './population.js';
import { advanceDailyLife, scheduledEntry } from './life.js';
import { advancePlayer, applyLifeCommand, reconcilePlayer } from './player.js';

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

/** City data is validated before the player's references into it are reconciled. */
function withoutPlayer(world: WorldState): WorldState {
  const { player: _player, ...rest } = world;
  return rest;
}

/** Headless deterministic runner. Event delivery belongs to the caller. */
export class Simulation {
  private state: WorldState;
  private commands: WorldCommand[] = [];
  private indexedPlan: CityPlan | null = null;
  private occupancy: OccupancyGrid | null = null;
  private roadGraph: RoadGraph | null = null;
  private navigator: RoadNavigator | null = null;
  private navigationPlan: CityPlan | null = null;
  private citizenIndexState: readonly Citizen[] | null = null;
  private citizenIndexPlan: CityPlan | null = null;
  private citizenIndex = new Map<string,Citizen>();
  private buildingOccupancies = new Map<string,BuildingOccupancy>();

  constructor(initialState: WorldState) {
    validateWorld(initialState);
    this.state = freeze(cloneWorld(initialState));
  }

  getState(): WorldState {
    return this.state;
  }

  enablePopulation(options: PopulationOptions = {}): SimulationResult {
    const change = initializePopulation(this.state, options);
    if(change.state!==this.state) { validateWorld(change.state); this.state = freeze(cloneWorld(change.state)); }
    return freeze({ state: this.state, events: change.events, steps: 0, alpha: this.state.clock.accumulatedMs / this.state.clock.fixedStepMs });
  }

  getPlayer(): PlayerCharacter | undefined { return this.state.player; }

  /** Phase 4 Life Mode commands apply immediately (like city commands); movement then progresses on ticks. */
  executeLife(command: LifeCommand): LifeCommandResult {
    const change = applyLifeCommand(this.state, command, this.getNavigator());
    if (change.reason === null && change.state !== this.state) {
      validateWorld(change.state);
      this.state = freeze(cloneWorld(change.state));
    }
    return freeze({ state: this.state, events: change.events, steps: 0, applied: change.reason === null, reason: change.reason,
      alpha: this.state.clock.accumulatedMs / this.state.clock.fixedStepMs });
  }
  private ensureCitizenIndexes(): void {
    if(this.citizenIndexState===this.state.citizens && this.citizenIndexPlan===this.state.plan) return;
    this.citizenIndex=new Map(this.state.citizens.map(c=>[c.id,c]));
    const occupancies=new Map(this.state.plan.buildings.map(b=>[b.id,{buildingId:b.id,residentIds:[] as string[],workerIds:[] as string[],visitorIds:[] as string[]}]));
    for(const c of this.state.citizens) {
      occupancies.get(c.homeBuildingId)?.residentIds.push(c.id);
      if(c.workBuildingId!==null)occupancies.get(c.workBuildingId)?.workerIds.push(c.id);
      if(c.activity==='leisure'&&c.movement?.status==='inside'&&c.movement.currentBuildingId!==null)occupancies.get(c.movement.currentBuildingId)?.visitorIds.push(c.id);
    }
    this.buildingOccupancies=new Map([...occupancies].map(([id,o])=>[id,freeze(o)]));
    this.citizenIndexState=this.state.citizens;this.citizenIndexPlan=this.state.plan;
  }
  getCitizen(id: string): Citizen | undefined { this.ensureCitizenIndexes();return this.citizenIndex.get(id); }
  getPopulationCount(): number { return this.state.citizens.length; }
  getBuildingOccupancy(buildingId: string): BuildingOccupancy {
    this.ensureCitizenIndexes();
    return this.buildingOccupancies.get(buildingId)??freeze({buildingId,residentIds:[],workerIds:[],visitorIds:[]});
  }
  getNavigator(): RoadNavigator {
    if (this.navigationPlan !== this.state.plan) { this.navigator = new RoadNavigator(this.state.plan); this.navigationPlan = this.state.plan; }
    return this.navigator!;
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
    return freeze({ plan: this.state.plan, budget: this.state.budget, nextBuildingId: this.state.nextBuildingId,
      ...(this.state.population === undefined ? {} : { citizens: this.state.citizens }) });
  }

  /** Undo/redo restores city data while time, RNG, and command queues keep progressing. */
  restoreCity(snapshot: CitySnapshot): SimulationResult {
    if (!Number.isSafeInteger(snapshot.nextBuildingId) || snapshot.nextBuildingId <= 0) throw new RangeError('invalid snapshot building ID cursor');
    if (this.state.revision === Number.MAX_SAFE_INTEGER) throw new RangeError('revision limit reached');
    let next = { ...this.state, plan: snapshot.plan, budget: snapshot.budget,
      nextBuildingId: Math.max(this.state.nextBuildingId, snapshot.nextBuildingId), revision: this.state.revision + 1 };
    if (this.state.population) {
      // Validate city data before attempting to reconcile references into it.
      validateWorld({ ...withoutPlayer(next), citizens: [] });
      const buildings = new Map(snapshot.plan.buildings.map(b => [b.id,b]));
      if (snapshot.citizens) {
        const restored = snapshot.citizens.map(c => {
          const home = buildings.get(c.homeBuildingId);
          return home ? { ...c, position: buildingCenter(home), activity: 'home' as const, targetBuildingId: home.id,
            movement: insideMovement(home.id,next.revision) } : c;
        });
        validateWorld({ ...withoutPlayer(next), citizens: restored });
        const current = new Map(this.state.citizens.map(c => [c.id,c]));
        next = { ...next, citizens: restored.map(c => {
          const live=current.get(c.id);
          return live?.movement ? { ...c, position: live.position, movement: live.movement,
            activity: live.activity, targetBuildingId: live.targetBuildingId } : c;
        }) };
      }
      const population = reconcilePopulation(next, this.state);
      next = population.state;
      const life = reconcilePlayer(next, this.state);
      next = life.state;
      validateWorld(next);
      this.state = freeze(cloneWorld(next));
      return freeze({ state: this.state, events: [{ type: 'city.restored', tick: this.state.clock.tick, revision: this.state.revision }, ...population.events, ...life.events],
        steps: 0, alpha: this.state.clock.accumulatedMs / this.state.clock.fixedStepMs });
    }
    // Validate the city before reconciling the player's references into it.
    validateWorld(withoutPlayer(next));
    const life = reconcilePlayer(next, this.state);
    next = life.state;
    validateWorld(next);
    this.state = freeze(cloneWorld(next));
    return freeze({ state: this.state, events: [{ type: 'city.restored', tick: this.state.clock.tick, revision: this.state.revision }, ...life.events],
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
          const cell = this.state.population ? this.getNavigator().grid.get({ x: Math.floor(command.position.x), y: Math.floor(command.position.y) }) : null;
          if (!isPositionInPlan(command.position, this.state.plan) || this.state.population &&
            !(cell?.type === 'road' || cell?.type === 'building' && [citizen.homeBuildingId,citizen.workBuildingId,citizen.targetBuildingId].includes(cell.buildingId))) {
            events.push({ type: 'command.rejected', ...details, reason: 'invalid-position' });
            continue;
          }
          citizens[index] = { ...citizen, position: command.position, ...(citizen.movement ? { movement: {
            ...citizen.movement, status: 'waiting', currentBuildingId: cell?.type === 'building' ? cell.buildingId : null,
            route: [], nextWaypoint: 0, plannedRevision: -1, heading: { x: 0, y: 0 },
          } } : {}) };
          break;
        case 'citizen.set-schedule':
          try {
            validateSchedule(command.schedule, this.state.plan);
            if(this.state.population && command.schedule.entries.some(e =>
              e.activity==='work' && e.targetBuildingId!==null && e.targetBuildingId!==citizen.workBuildingId ||
              (e.activity==='sleep'||e.activity==='home') && e.targetBuildingId!==null && e.targetBuildingId!==citizen.homeBuildingId ||
              e.activity==='leisure' && e.targetBuildingId!==null && !providesLeisure(this.getNavigator().getBuilding(e.targetBuildingId)!))) throw new RangeError('invalid schedule assignment');
          } catch {
            events.push({ type: 'command.rejected', ...details, reason: 'invalid-schedule' });
            continue;
          }
          citizens[index] = { ...citizen, schedule: command.schedule, ...(this.state.population ? { scheduleMode: 'custom' } : {}) };
          break;
      }
      events.push({ type: 'command.applied', ...details });
      this.state = freeze({ ...this.state, citizens });
    }
    this.commands = [];
    const citizens = this.state.population ? (() => {
      const life=advanceDailyLife(this.state,this.getNavigator(),time.minuteOfDay);
      events.push(...life.events); return life.state.citizens;
    })() : this.state.citizens.map((citizen) => {
      const entry = scheduledEntry(citizen, time.minuteOfDay);
      if (citizen.activity === entry.activity && citizen.targetBuildingId === entry.targetBuildingId) return citizen;
      events.push({ type: 'citizen.activity-changed', tick, citizenId: citizen.id,
        activity: entry.activity, targetBuildingId: entry.targetBuildingId });
      return { ...citizen, activity: entry.activity, targetBuildingId: entry.targetBuildingId };
    });
    if (this.state.player) {
      // The player shares the one fixed step and reads the residents' positions for this tick.
      const life = advancePlayer({ ...this.state, clock, citizens }, this.getNavigator());
      events.push(...life.events);
      this.state = freeze({ ...this.state, player: life.state.player! });
    }
    for (let day = previousDay + 1; day <= time.day; day += 1) {
      events.push({ type: 'clock.day-started', tick, day });
    }
    events.push({ type: 'clock.ticked', tick, ...time });
    this.state = freeze({ ...this.state, clock, citizens });
  }
}
