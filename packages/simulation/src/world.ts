import { createClock, validateClock } from './clock.js';
import type { ClockOptions } from './clock.js';
import { createRandomState, validateRandomState } from './random.js';
import { createBudget, validateBudget } from './budget.js';
import { BUILDING_CATALOG, isBuildingType } from './catalog.js';
import { OccupancyGrid } from './grid.js';
import { containsPosition, NPC_LIMITS } from './navigation.js';
import { initializePopulation, providesJobs, providesLeisure } from './population.js';
import type { CityPlan, CityPlanInput, Citizen, DailySchedule, PopulationOptions, Position, WorldState } from './types.js';

const ACTIVITIES = new Set(['sleep', 'home', 'work', 'leisure', 'idle', 'travel']);
const BUILDING_KINDS = new Set(['home', 'workplace', 'park']);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RangeError(message);
}

function identifier(value: string, label: string): void {
  assert(typeof value === 'string' && value.trim().length > 0, `${label} must be nonempty`);
}

export function isPositionInPlan(position: Position, plan: CityPlan): boolean {
  return Number.isFinite(position.x) && Number.isFinite(position.y) &&
    position.x >= 0 && position.x < plan.width && position.y >= 0 && position.y < plan.height;
}

export function validateSchedule(schedule: DailySchedule, plan: CityPlan): void {
  assert(schedule.entries.length > 0, 'schedule must have at least one entry');
  assert(schedule.entries[0]?.startMinute === 0, 'schedule must begin at minute 0');
  const buildingIds = new Set(plan.buildings.map((building) => building.id));
  let previous = -1;
  for (const entry of schedule.entries) {
    assert(Number.isInteger(entry.startMinute) && entry.startMinute > previous &&
      entry.startMinute < 1440, 'schedule minutes must strictly increase in [0, 1440)');
    assert(ACTIVITIES.has(entry.activity), 'unknown schedule activity');
    assert(entry.targetBuildingId === null || buildingIds.has(entry.targetBuildingId),
      'schedule references an unknown building');
    previous = entry.startMinute;
  }
}

/** Validates package-local snapshots; this is not a network JSON decoder. */
export function validateWorld(world: WorldState): void {
  assert(world.schemaVersion === 2, 'unsupported world schema version');
  identifier(world.id, 'world id');
  identifier(world.plan.id, 'plan id');
  identifier(world.plan.name, 'plan name');
  const { plan } = world;
  assert(Number.isSafeInteger(plan.width) && plan.width > 0 &&
    Number.isSafeInteger(plan.height) && plan.height > 0 && plan.width * plan.height <= 1_000_000,
    'plan dimensions must be positive safe integers with at most 1000000 tiles');
  assert([plan.roads, plan.blockedTiles, plan.buildings].every(Array.isArray), 'plan tile collections must be arrays');
  assert(plan.roads.length <= plan.width * plan.height && plan.blockedTiles.length <= plan.width * plan.height &&
    plan.buildings.length <= plan.width * plan.height, 'plan collections exceed map capacity');
  validateClock(world.clock);
  validateRandomState(world.randomState);
  validateBudget(world.budget);
  assert(Number.isSafeInteger(world.revision) && world.revision >= 0, 'revision must be a nonnegative safe integer');
  assert(Number.isSafeInteger(world.nextBuildingId) && world.nextBuildingId > 0, 'nextBuildingId must be a positive safe integer');
  const buildings = new Set<string>();
  for (const building of plan.buildings) {
    identifier(building.id, 'building id');
    identifier(building.name, 'building name');
    assert(!buildings.has(building.id), 'duplicate building id');
    buildings.add(building.id);
    assert(BUILDING_KINDS.has(building.kind), 'unknown building kind');
    assert(Number.isSafeInteger(building.position.x) && Number.isSafeInteger(building.position.y) &&
      isPositionInPlan(building.position, plan), 'building position must be a tile inside the plan');
    assert(Number.isSafeInteger(building.footprint.width) && building.footprint.width > 0 &&
      Number.isSafeInteger(building.footprint.height) && building.footprint.height > 0 &&
      building.position.x + building.footprint.width <= plan.width &&
      building.position.y + building.footprint.height <= plan.height, 'building footprint must fit the plan');
    assert(Number.isSafeInteger(building.capacity) && building.capacity >= 0, 'capacity must be nonnegative');
    if (building.type !== undefined) {
      assert(isBuildingType(building.type), 'unknown building type');
      const definition = BUILDING_CATALOG[building.type];
      assert(building.kind === definition.kind && building.capacity === definition.capacity &&
        building.footprint.width === definition.footprint.width && building.footprint.height === definition.footprint.height,
        'catalog building does not match its definition');
    }
  }
  const grid = new OccupancyGrid(plan);
  const byId = new Map(plan.buildings.map(b => [b.id, b]));
  const homeCounts = new Map<string, number>(), workCounts = new Map<string, number>(), visitorCounts = new Map<string,number>();
  if (world.population !== undefined) {
    assert(world.population.version === 1 && Number.isSafeInteger(world.population.maxCitizens) && world.population.maxCitizens >= 0 && world.population.maxCitizens <= NPC_LIMITS.population, 'invalid population configuration');
    assert(Number.isSafeInteger(world.population.nextCitizenId) && world.population.nextCitizenId > 0, 'invalid citizen ID cursor');
    assert(world.citizens.length <= world.population.maxCitizens, 'population exceeds configured limit');
    assert(world.clock.minutesPerTick <= 1440, 'managed game-minute increments must not exceed one day per tick');
  }
  const citizens = new Set<string>();
  for (const citizen of world.citizens) {
    identifier(citizen.id, 'citizen id');
    identifier(citizen.name, 'citizen name');
    assert(!citizens.has(citizen.id), 'duplicate citizen id');
    citizens.add(citizen.id);
    if (world.population) {
      const managedId=/^npc-([1-9]\d*)$/.exec(citizen.id);
      assert(managedId === null || Number(managedId[1]) < world.population.nextCitizenId, 'citizen ID cursor must exceed existing IDs');
    }
    assert(buildings.has(citizen.homeBuildingId), 'citizen references an unknown home');
    assert(citizen.workBuildingId === null || buildings.has(citizen.workBuildingId), 'citizen references an unknown workplace');
    assert(citizen.targetBuildingId === null || buildings.has(citizen.targetBuildingId), 'citizen references an unknown target');
    assert(isPositionInPlan(citizen.position, plan), 'citizen position must be inside the plan');
    assert(ACTIVITIES.has(citizen.activity), 'unknown citizen activity');
    validateSchedule(citizen.schedule, plan);
    if (world.population !== undefined) {
      const home = byId.get(citizen.homeBuildingId)!;
      const job = citizen.workBuildingId === null ? undefined : byId.get(citizen.workBuildingId);
      homeCounts.set(home.id, (homeCounts.get(home.id) ?? 0) + 1);
      assert(home.kind === 'home' && homeCounts.get(home.id)! <= home.capacity, 'housing capacity exceeded or invalid role');
      if (job) { workCounts.set(job.id, (workCounts.get(job.id) ?? 0) + 1); assert(providesJobs(job) && workCounts.get(job.id)! <= job.capacity, 'employment capacity exceeded or invalid role'); }
      const a = citizen.attributes, m = citizen.movement;
      assert(a !== undefined && Number.isInteger(a.age) && a.age >= 18 && a.age <= 100 && Number.isFinite(a.walkingSpeed) && a.walkingSpeed > 0 && a.walkingSpeed <= 1 && Number.isInteger(a.scheduleOffset) && Math.abs(a.scheduleOffset) <= 20, 'invalid citizen attributes');
      assert(citizen.scheduleMode === 'generated' || citizen.scheduleMode === 'custom', 'invalid schedule mode');
      for(const e of citizen.schedule.entries) {
        assert(e.activity !== 'work' || e.targetBuildingId === null || e.targetBuildingId === citizen.workBuildingId, 'schedule work target must match assignment');
        assert(!['home','sleep'].includes(e.activity) || e.targetBuildingId === null || e.targetBuildingId === citizen.homeBuildingId, 'schedule home target must match assignment');
        assert(e.activity !== 'leisure' || e.targetBuildingId === null || providesLeisure(byId.get(e.targetBuildingId)!), 'schedule leisure target has invalid role');
      }
      assert(m !== undefined && ['inside', 'travelling', 'waiting'].includes(m.status), 'invalid citizen movement');
      assert(m.currentBuildingId === null || buildings.has(m.currentBuildingId), 'movement references unknown current building');
      assert(m.destinationBuildingId === null || buildings.has(m.destinationBuildingId), 'movement references unknown destination');
      assert(ACTIVITIES.has(m.arrivalActivity), 'invalid arrival activity');
      assert(Number.isSafeInteger(m.plannedRevision) && m.plannedRevision >= -1 && m.plannedRevision <= world.revision, 'invalid route revision');
      assert(Array.isArray(m.route) && m.route.length <= NPC_LIMITS.searchNodes + 8 && m.route.every(p => isPositionInPlan(p, plan)), 'invalid route points');
      assert(Number.isSafeInteger(m.nextWaypoint) && m.nextWaypoint >= 0 && m.nextWaypoint <= m.route.length, 'invalid route cursor');
      assert([m.heading.x,m.heading.y].every(v => v === 0 || v === 1 || v === -1) && Math.abs(m.heading.x) + Math.abs(m.heading.y) <= 1, 'invalid heading');
      assert(m.status !== 'inside' || m.currentBuildingId !== null && containsPosition(byId.get(m.currentBuildingId)!, citizen.position), 'invalid interior position');
      assert(m.status !== 'travelling' || m.destinationBuildingId !== null && m.route.length > 0 && m.nextWaypoint > 0 && m.nextWaypoint < m.route.length && m.plannedRevision === world.revision, 'invalid active route');
      assert(m.status === 'travelling' || m.route.length === 0 && m.nextWaypoint === 0, 'stationary citizen cannot retain a route');
      if (citizen.activity === 'leisure' && m.status === 'inside' && m.currentBuildingId !== null) {
        const id=m.currentBuildingId; visitorCounts.set(id,(visitorCounts.get(id)??0)+1);
        assert(visitorCounts.get(id)! <= byId.get(id)!.capacity,'leisure capacity exceeded');
        assert(providesLeisure(byId.get(id)!), 'invalid leisure destination role');
      }
      if (m.status === 'travelling') {
        let from = citizen.position;
        for (const to of m.route.slice(m.nextWaypoint)) {
          assert(from.x === to.x || from.y === to.y, 'route contains diagonal shortcut');
          const length = Math.abs(to.x-from.x)+Math.abs(to.y-from.y);
          for (let i=0;i<=Math.ceil(length*2);i++) {
            const t=length===0?0:Math.min(1,i/(Math.ceil(length*2)));
            const cell=grid.get({x:Math.floor(from.x+(to.x-from.x)*t),y:Math.floor(from.y+(to.y-from.y)*t)});
            assert(cell?.type==='road' || cell?.type==='building' && (cell.buildingId===m.currentBuildingId || cell.buildingId===m.destinationBuildingId), 'route crosses non-traversable tile');
          }
          from=to;
        }
      }
    }
  }
}

/** Copies plain contract data so callers retain ownership of their input objects. */
export function cloneWorld(world: WorldState): WorldState {
  return {
    schemaVersion: 2, id: world.id, revision: world.revision, nextBuildingId: world.nextBuildingId,
    budget: { openingBalance: world.budget.openingBalance, balance: world.budget.balance, totalSpent: world.budget.totalSpent },
    clock: { tick: world.clock.tick, fixedStepMs: world.clock.fixedStepMs, minutesPerTick: world.clock.minutesPerTick,
      accumulatedMs: world.clock.accumulatedMs, paused: world.clock.paused },
    randomState: world.randomState,
    ...(world.population === undefined ? {} : { population: { version: world.population.version, maxCitizens: world.population.maxCitizens, nextCitizenId: world.population.nextCitizenId } }),
    plan: { id: world.plan.id, name: world.plan.name, width: world.plan.width, height: world.plan.height,
      roads: world.plan.roads.map((tile) => ({ x: tile.x, y: tile.y })),
      blockedTiles: world.plan.blockedTiles.map((tile) => ({ x: tile.x, y: tile.y })),
      buildings: world.plan.buildings.map((building) => ({
        id: building.id, name: building.name, kind: building.kind, capacity: building.capacity,
        ...(building.type === undefined ? {} : { type: building.type }),
        position: { x: building.position.x, y: building.position.y },
        footprint: { width: building.footprint.width, height: building.footprint.height },
      })) },
    citizens: world.citizens.map((citizen) => ({
      id: citizen.id, name: citizen.name, homeBuildingId: citizen.homeBuildingId, workBuildingId: citizen.workBuildingId,
      activity: citizen.activity, targetBuildingId: citizen.targetBuildingId,
      position: { x: citizen.position.x, y: citizen.position.y },
      schedule: { entries: citizen.schedule.entries.map((entry) => ({ startMinute: entry.startMinute,
        activity: entry.activity, targetBuildingId: entry.targetBuildingId })) },
      ...(citizen.attributes === undefined ? {} : { attributes: { age: citizen.attributes.age, walkingSpeed: citizen.attributes.walkingSpeed, scheduleOffset: citizen.attributes.scheduleOffset } }),
      ...(citizen.scheduleMode === undefined ? {} : { scheduleMode: citizen.scheduleMode }),
      ...(citizen.movement === undefined ? {} : { movement: { status: citizen.movement.status, currentBuildingId: citizen.movement.currentBuildingId,
        destinationBuildingId: citizen.movement.destinationBuildingId, arrivalActivity: citizen.movement.arrivalActivity,
        nextWaypoint: citizen.movement.nextWaypoint, plannedRevision: citizen.movement.plannedRevision,
        heading: { x: citizen.movement.heading.x, y: citizen.movement.heading.y }, route: citizen.movement.route.map(p => ({ x:p.x,y:p.y })) } }),
    })),
  };
}

/** Runtime immutability mirrors the readonly public interfaces. */
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createWorld(options: {
  readonly id: string;
  readonly plan: CityPlanInput;
  readonly citizens?: readonly Citizen[];
  readonly seed?: number | string;
  readonly clock?: ClockOptions;
  readonly startingFunds?: number;
  readonly population?: PopulationOptions;
}): WorldState {
  const world: WorldState = {
    schemaVersion: 2,
    id: options.id,
    plan: { ...options.plan, roads: options.plan.roads ?? [], blockedTiles: options.plan.blockedTiles ?? [] },
    citizens: options.citizens ?? [],
    clock: createClock(options.clock),
    randomState: createRandomState(options.seed ?? 0),
    budget: createBudget(options.startingFunds ?? 0), revision: 0, nextBuildingId: 1,
  };
  validateWorld(world);
  const initialized = options.population === undefined ? world : initializePopulation(world, options.population).state;
  validateWorld(initialized);
  return freeze(cloneWorld(initialized));
}
