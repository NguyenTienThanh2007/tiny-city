import { createClock, validateClock } from './clock.js';
import type { ClockOptions } from './clock.js';
import { createRandomState, validateRandomState } from './random.js';
import type { CityPlan, Citizen, DailySchedule, Position, WorldState } from './types.js';

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
  assert(world.schemaVersion === 1, 'unsupported world schema version');
  identifier(world.id, 'world id');
  identifier(world.plan.id, 'plan id');
  identifier(world.plan.name, 'plan name');
  const { plan } = world;
  assert(Number.isSafeInteger(plan.width) && plan.width > 0 &&
    Number.isSafeInteger(plan.height) && plan.height > 0, 'plan dimensions must be positive safe integers');
  validateClock(world.clock);
  validateRandomState(world.randomState);
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
  }
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
    ...world,
    clock: { ...world.clock },
    plan: { ...world.plan, buildings: world.plan.buildings.map((building) => ({
      ...building, position: { ...building.position }, footprint: { ...building.footprint },
    })) },
    citizens: world.citizens.map((citizen) => ({
      ...citizen, position: { ...citizen.position },
      schedule: { entries: citizen.schedule.entries.map((entry) => ({ ...entry })) },
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
  readonly plan: CityPlan;
  readonly citizens?: readonly Citizen[];
  readonly seed?: number | string;
  readonly clock?: ClockOptions;
}): WorldState {
  const world: WorldState = {
    schemaVersion: 1,
    id: options.id,
    plan: options.plan,
    citizens: options.citizens ?? [],
    clock: createClock(options.clock),
    randomState: createRandomState(options.seed ?? 0),
  };
  validateWorld(world);
  return freeze(cloneWorld(world));
}
