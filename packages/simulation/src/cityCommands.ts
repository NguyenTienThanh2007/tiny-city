import { spendBudget } from './budget.js';
import { BUILDING_CATALOG, CONSTRUCTION_COSTS, isBuildingType } from './catalog.js';
import { footprintPerimeter, footprintTiles, isGridPosition, OccupancyGrid, tileKey } from './grid.js';
import { RoadGraph } from './roads.js';
import type { Building, BuildingType, CityCommand, CityCommandResult, CityRejectionReason, PlacementValidation, Position, SimulationEvent, WorldState } from './types.js';
import { cloneWorld, freeze, validateWorld } from './world.js';

function validatePlacement(
  world: WorldState,
  type: BuildingType,
  position: Position,
  options: { readonly ignoreBuildingId?: string; readonly ignoreBudget?: boolean } = {},
): PlacementValidation {
  if (!isBuildingType(type)) return { valid: false, reason: 'invalid-building-type' };
  if (!isGridPosition(position)) return { valid: false, reason: 'invalid-position' };
  const definition = BUILDING_CATALOG[type];
  const plan = options.ignoreBuildingId === undefined ? world.plan : {
    ...world.plan,
    buildings: world.plan.buildings.filter((building) => building.id !== options.ignoreBuildingId),
  };
  const grid = new OccupancyGrid(plan);
  if (position.x < 0 || position.y < 0 || position.x + definition.footprint.width > world.plan.width ||
      position.y + definition.footprint.height > world.plan.height) return { valid: false, reason: 'out-of-bounds' };
  const candidate = { position, footprint: definition.footprint };
  for (const tile of footprintTiles(candidate)) {
    const occupant = grid.get(tile);
    if (occupant) return { valid: false, reason: occupant.type === 'blocked' ? 'blocked-tile' : 'occupied-tile' };
  }
  if (definition.requiresRoad && !footprintPerimeter(candidate).some((tile) => grid.get(tile)?.type === 'road')) {
    return { valid: false, reason: 'road-required' };
  }
  if (!options.ignoreBudget && world.budget.balance < definition.cost) return { valid: false, reason: 'insufficient-funds' };
  return { valid: true, cost: options.ignoreBudget ? 0 : definition.cost };
}

export function validateBuildingPlacement(world: WorldState, type: BuildingType, position: Position): PlacementValidation {
  return validatePlacement(world, type, position);
}

export function validateBuildingMove(world: WorldState, buildingId: string, position: Position): PlacementValidation {
  const building = world.plan.buildings.find((entry) => entry.id === buildingId);
  if (!building) return { valid: false, reason: 'building-not-found' };
  if (!isGridPosition(position)) return { valid: false, reason: 'invalid-position' };
  if (position.x === building.position.x && position.y === building.position.y) {
    return { valid: false, reason: 'unchanged-position' };
  }
  if (building.type !== undefined) {
    return validatePlacement(world, building.type, position, { ignoreBuildingId: buildingId, ignoreBudget: true });
  }

  // Legacy authored buildings have explicit dimensions, so preserve those when moving them.
  const grid = new OccupancyGrid({ ...world.plan, buildings: world.plan.buildings.filter((entry) => entry.id !== buildingId) });
  if (position.x < 0 || position.y < 0 || position.x + building.footprint.width > world.plan.width ||
      position.y + building.footprint.height > world.plan.height) return { valid: false, reason: 'out-of-bounds' };
  const candidate = { position, footprint: building.footprint };
  for (const tile of footprintTiles(candidate)) {
    const occupant = grid.get(tile);
    if (occupant) return { valid: false, reason: occupant.type === 'blocked' ? 'blocked-tile' : 'occupied-tile' };
  }
  if (building.kind !== 'park' && !footprintPerimeter(candidate).some((tile) => grid.get(tile)?.type === 'road')) {
    return { valid: false, reason: 'road-required' };
  }
  return { valid: true, cost: 0 };
}

export function validateRoadPlacement(world: WorldState, position: Position): PlacementValidation {
  if (!isGridPosition(position)) return { valid: false, reason: 'invalid-position' };
  const grid = new OccupancyGrid(world.plan);
  if (!grid.isInBounds(position)) return { valid: false, reason: 'out-of-bounds' };
  const occupant = grid.get(position);
  if (occupant) return { valid: false, reason: occupant.type === 'road' ? 'road-already-exists' :
    occupant.type === 'blocked' ? 'blocked-tile' : 'occupied-tile' };
  return world.budget.balance < CONSTRUCTION_COSTS.road ? { valid: false, reason: 'insufficient-funds' } :
    { valid: true, cost: CONSTRUCTION_COSTS.road };
}

function networkEvent(world: WorldState): SimulationEvent {
  const graph = new RoadGraph(world.plan.roads);
  return { type: 'city.road-network-changed', tick: world.clock.tick, revision: world.revision,
    componentCount: graph.getComponents().length,
    isolatedBuildingIds: world.plan.buildings.filter((building) =>
      (building.type ? BUILDING_CATALOG[building.type].requiresRoad : building.kind !== 'park') &&
      graph.getAdjacentComponents(building).length === 0).map((building) => building.id) };
}

function result(state: WorldState, events: readonly SimulationEvent[], applied: boolean): CityCommandResult {
  if (!Object.isFrozen(state)) state = freeze(cloneWorld(state));
  return freeze({ state, events, applied, steps: 0, alpha: state.clock.accumulatedMs / state.clock.fixedStepMs });
}

function reject(world: WorldState, command: CityCommand, reason: CityRejectionReason, commandIndex = 0): CityCommandResult {
  return result(world, [{ type: 'city.command-rejected', tick: world.clock.tick, commandType: command.type, reason, commandIndex }], false);
}

/** Pure preview/reducer; Simulation.execute is the authoritative commit boundary. */
export function applyCityCommand(world: WorldState, command: CityCommand): CityCommandResult {
  validateWorld(world);
  if (!Object.isFrozen(world)) world = freeze(cloneWorld(world));
  if (world.revision === Number.MAX_SAFE_INTEGER) return reject(world, command, 'state-limit-reached');
  const revision = world.revision + 1;
  const tick = world.clock.tick;
  let next: WorldState;
  let cost = 0;
  let event: SimulationEvent;
  switch (command.type) {
    case 'city.build': {
      const validation = validateBuildingPlacement(world, command.buildingType, command.position);
      if (!validation.valid) return reject(world, command, validation.reason);
      if (command.name !== undefined && (typeof command.name !== 'string' || command.name.trim().length === 0)) {
        return reject(world, command, 'invalid-name');
      }
      let cursor = world.nextBuildingId;
      const ids = new Set(world.plan.buildings.map((building) => building.id));
      while (ids.has(`building-${cursor}`) && cursor < Number.MAX_SAFE_INTEGER) cursor += 1;
      if (cursor === Number.MAX_SAFE_INTEGER) return reject(world, command, 'state-limit-reached');
      const definition = BUILDING_CATALOG[command.buildingType];
      const count = world.plan.buildings.filter((building) => building.type === command.buildingType ||
        (building.type === undefined && building.kind === definition.kind)).length + 1;
      const building: Building = { id: `building-${cursor}`, type: command.buildingType, kind: definition.kind,
        name: command.name?.trim() ?? `${definition.label} ${String(count).padStart(2, '0')}`,
        position: { ...command.position }, footprint: { ...definition.footprint }, capacity: definition.capacity };
      cost = validation.cost;
      next = freeze({ ...world, revision, nextBuildingId: cursor + 1, budget: spendBudget(world.budget, cost),
        plan: { ...world.plan, buildings: [...world.plan.buildings, building] } });
      event = { type: 'city.building-built', tick, revision, building: next.plan.buildings.at(-1)! };
      break;
    }
    case 'city.demolish': {
      if (!world.plan.buildings.some((building) => building.id === command.buildingId)) return reject(world, command, 'building-not-found');
      if (world.citizens.some((citizen) => citizen.homeBuildingId === command.buildingId || citizen.workBuildingId === command.buildingId ||
        citizen.targetBuildingId === command.buildingId || citizen.schedule.entries.some((entry) => entry.targetBuildingId === command.buildingId))) {
        return reject(world, command, 'building-in-use');
      }
      next = freeze({ ...world, revision, plan: { ...world.plan, buildings: world.plan.buildings.filter((building) => building.id !== command.buildingId) } });
      event = { type: 'city.building-demolished', tick, revision, buildingId: command.buildingId };
      break;
    }
    case 'city.move-building': {
      const building = world.plan.buildings.find((entry) => entry.id === command.buildingId);
      if (!building) return reject(world, command, 'building-not-found');
      const validation = validateBuildingMove(world, command.buildingId, command.position);
      if (!validation.valid) return reject(world, command, validation.reason);
      const from = { ...building.position };
      const to = { ...command.position };
      next = freeze({ ...world, revision, plan: { ...world.plan, buildings: world.plan.buildings.map((entry) =>
        entry.id === command.buildingId ? { ...entry, position: to } : entry) } });
      event = { type: 'city.building-moved', tick, revision, buildingId: command.buildingId, from, to };
      break;
    }
    case 'city.edit-roads': {
      if (command.add.length === 0 && command.remove.length === 0) return reject(world, command, 'empty-road-edit');
      if (![...command.add, ...command.remove].every(isGridPosition)) return reject(world, command, 'invalid-position');
      const add = new Set(command.add.map(tileKey));
      const remove = new Set(command.remove.map(tileKey));
      if (add.size !== command.add.length || remove.size !== command.remove.length) return reject(world, command, 'duplicate-road-edit');
      if ([...add].some((key) => remove.has(key))) return reject(world, command, 'conflicting-road-edit');
      const grid = new OccupancyGrid(world.plan);
      for (const tile of command.remove) {
        if (!grid.isInBounds(tile)) return reject(world, command, 'out-of-bounds');
        if (grid.get(tile)?.type !== 'road') return reject(world, command, 'road-not-found');
      }
      for (const tile of command.add) {
        const validation = validateRoadPlacement(world, tile);
        if (!validation.valid) return reject(world, command, validation.reason);
      }
      cost = command.add.length * CONSTRUCTION_COSTS.road;
      if (!Number.isSafeInteger(cost) || cost > world.budget.balance) return reject(world, command, 'insufficient-funds');
      next = freeze({ ...world, revision, budget: spendBudget(world.budget, cost), plan: { ...world.plan,
        roads: [...world.plan.roads.filter((tile) => !remove.has(tileKey(tile))), ...command.add.map((tile) => ({ ...tile }))] } });
      event = { type: 'city.roads-edited', tick, revision, added: command.add.map((tile) => ({ ...tile })), removed: command.remove.map((tile) => ({ ...tile })) };
      break;
    }
  }
  const events: SimulationEvent[] = [event];
  if (cost > 0) events.push({ type: 'city.budget-changed', tick, revision, spent: cost, balance: next.budget.balance });
  events.push(networkEvent(next));
  return result(next, events, true);
}

/** Commit all commands or none; speculative success events never escape a failed batch. */
export function applyCityCommandBatch(world: WorldState, commands: readonly CityCommand[]): CityCommandResult {
  let current = world;
  const events: SimulationEvent[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    const change = applyCityCommand(current, command);
    if (!change.applied) {
      const rejection = change.events[0];
      if (rejection?.type !== 'city.command-rejected') throw new Error('missing rejection event');
      return reject(world, command, rejection.reason, index);
    }
    current = change.state;
    events.push(...change.events);
  }
  // Empty batches are a no-op, useful for planner scans with no applicable lots.
  return result(current, events, commands.length > 0);
}

export function copyCityCommand(command: CityCommand): CityCommand {
  switch (command.type) {
    case 'city.build': return { type: command.type, buildingType: command.buildingType,
      position: { x: command.position.x, y: command.position.y }, ...(command.name === undefined ? {} : { name: command.name }) };
    case 'city.demolish': return { type: command.type, buildingId: command.buildingId };
    case 'city.move-building': return { type: command.type, buildingId: command.buildingId,
      position: { x: command.position.x, y: command.position.y } };
    case 'city.edit-roads': return { type: command.type, add: command.add.map((tile) => ({ x: tile.x, y: tile.y })),
      remove: command.remove.map((tile) => ({ x: tile.x, y: tile.y })) };
  }
}
