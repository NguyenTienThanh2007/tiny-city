import { createClock, validateClock } from './clock.js';
import type { ClockOptions } from './clock.js';
import { createRandomState, validateRandomState } from './random.js';
import { createBudget, validateBudget } from './budget.js';
import { BUILDING_CATALOG, isBuildingType } from './catalog.js';
import { OccupancyGrid } from './grid.js';
import type { CityPlan, CityPlanInput, Citizen, DailySchedule, Position, WorldState } from './types.js';

const ACTIVITIES = new Set(['sleep', 'home', 'work', 'leisure', 'idle']);
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
  new OccupancyGrid(plan);
  const citizens = new Set<string>();
  for (const citizen of world.citizens) {
    identifier(citizen.id, 'citizen id');
    identifier(citizen.name, 'citizen name');
    assert(!citizens.has(citizen.id), 'duplicate citizen id');
    citizens.add(citizen.id);
    assert(buildings.has(citizen.homeBuildingId), 'citizen references an unknown home');
    assert(citizen.workBuildingId === null || buildings.has(citizen.workBuildingId), 'citizen references an unknown workplace');
    assert(citizen.targetBuildingId === null || buildings.has(citizen.targetBuildingId), 'citizen references an unknown target');
    assert(isPositionInPlan(citizen.position, plan), 'citizen position must be inside the plan');
    assert(ACTIVITIES.has(citizen.activity), 'unknown citizen activity');
    validateSchedule(citizen.schedule, plan);
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
  return freeze(cloneWorld(world));
}
