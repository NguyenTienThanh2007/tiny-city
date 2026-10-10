import { applyCityCommandBatch, BUILDING_CATALOG, CONSTRUCTION_COSTS, deserializeWorld, footprintPerimeter,
  footprintTiles, isBuildingType, OccupancyGrid, RoadGraph, tileKey, validateBuildingMove, validateBuildingPlacement } from '@tiny-city/simulation';
import type { Building, BuildingType, CityCommand, Position, WorldState } from '@tiny-city/simulation';
import { DEFAULT_CONSTRAINTS, LIMITS, PlanError } from './contracts.js';
import type { ArchitectIntent, PlanProposal, PlanningConstraints, PlanWarning } from './contracts.js';
import { cityFingerprint, digestPayload, hash } from './integrity.js';

const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const ids = (v: unknown) => Array.isArray(v) && v.length <= 128 && v.every(x => typeof x === 'string' && x.trim().length > 0 && x.length <= 128);
const point = (v: unknown) => record(v) && typeof v.x === 'number' && typeof v.y === 'number' && Number.isSafeInteger(v.x) && Number.isSafeInteger(v.y);
const points = (v: unknown) => Array.isArray(v) && v.length <= LIMITS.operations && v.every(point);

export function decodeIntent(value: unknown): ArchitectIntent {
  if (!record(value) || Object.keys(value).some(k => !['summary','language','style','near','region','budgetLimit','connectRoads','builds','moves','demolish','roadAdd','roadRemove','preserveBuildingIds','unsupportedRequests','ambiguities'].includes(k)) ||
    typeof value.summary !== 'string' || value.summary.length > 512 || !['en','vi'].includes(String(value.language)) ||
    !['compact','coastal','mixed'].includes(String(value.style)) || !['existing','park','road','center'].includes(String(value.near)) ||
    typeof value.connectRoads !== 'boolean' || !(value.budgetLimit === null || integer(value.budgetLimit)) ||
    !(value.region === null || (point(value.region) && record(value.region) && integer(value.region.width) && Number(value.region.width) > 0 && integer(value.region.height) && Number(value.region.height) > 0)) ||
    !Array.isArray(value.builds) || value.builds.length > 32 || !value.builds.every(b => record(b) && isBuildingType(b.buildingType) && integer(b.quantity) && Number(b.quantity) > 0 && Number(b.quantity) <= 32 && (b.preferredPosition === null || point(b.preferredPosition))) ||
    !Array.isArray(value.moves) || value.moves.length > 32 || !value.moves.every(m => record(m) && ids([m.buildingId]) && point(m.position)) ||
    !ids(value.demolish) || !ids(value.preserveBuildingIds) || !points(value.roadAdd) || !points(value.roadRemove) ||
    !Array.isArray(value.unsupportedRequests) || !value.unsupportedRequests.every(s => typeof s === 'string' && s.length <= 256) || value.unsupportedRequests.length > 32 ||
    !Array.isArray(value.ambiguities) || !value.ambiguities.every(s => typeof s === 'string' && s.length <= 256) || value.ambiguities.length > 32) {
    throw new PlanError('INVALID_REQUEST', 'Invalid structured planning intent.');
  }
  const intent = JSON.parse(JSON.stringify(value)) as ArchitectIntent;
  if (intent.builds.reduce((sum,b) => sum + b.quantity,0) > LIMITS.buildings) throw new PlanError('CONTEXT_LIMIT', 'At most 32 buildings may be requested.');
  return intent;
}
export function decodeConstraints(value: Partial<PlanningConstraints> = {}): PlanningConstraints {
  if (!record(value) || Object.keys(value).some(k => !Object.hasOwn(DEFAULT_CONSTRAINTS,k))) throw new PlanError('INVALID_REQUEST','Invalid planning constraints.');
  const c = { ...DEFAULT_CONSTRAINTS, ...value };
  if (typeof c.allowPartial !== 'boolean' || typeof c.allowDestructive !== 'boolean' || !ids(c.allowedDemolitions) ||
      !ids(c.preserveBuildingIds) || !points(c.allowedRoadRemovals) || !(c.budgetLimit === null || integer(c.budgetLimit)) ||
      !integer(c.maxOperations) || c.maxOperations < 1 || c.maxOperations > LIMITS.operations) throw new PlanError('INVALID_REQUEST','Invalid planning constraints.');
  return JSON.parse(JSON.stringify(c)) as PlanningConstraints;
}
export function readWorld(value: unknown, sourceRevision: number): WorldState {
  let world: WorldState;
  try {
    if (!record(value) || value.schemaVersion !== 2) throw new Error();
    // Reject oversized maps before simulation validation constructs an occupancy grid.
    if (record(value.plan) && integer(value.plan.width) && integer(value.plan.height) &&
        Number(value.plan.width) * Number(value.plan.height) > LIMITS.mapTiles) {
      throw new PlanError('CONTEXT_LIMIT','Planning supports at most 4096 map tiles.');
    }
    world = deserializeWorld(JSON.stringify(value));
  } catch (error) {
    if (error instanceof PlanError) throw error;
    throw new PlanError('INVALID_WORLD','A valid schema-2 world snapshot is required.');
  }
  if (world.plan.width * world.plan.height > LIMITS.mapTiles) throw new PlanError('CONTEXT_LIMIT','Planning supports at most 4096 map tiles.');
  if (!integer(sourceRevision) || sourceRevision !== world.revision) throw new PlanError('STALE_WORLD','The source revision must match the supplied world.');
  return world;
}
export const operationCount = (commands: readonly CityCommand[]) => commands.reduce((n,c) => n + (c.type === 'city.edit-roads' ? c.add.length+c.remove.length : 1),0);

/** Shortest deterministic orthogonal link; only free cells and existing roads are traversable. */
function roadLink(world: WorldState, candidate: Pick<Building,'position'|'footprint'>, seed: number, forbidden: Set<string>): Position[] | null {
  const grid = new OccupancyGrid(world.plan);
  const excluded = new Set(footprintTiles(candidate).map(tileKey));
  const starts = footprintPerimeter(candidate).filter(p => grid.isInBounds(p) && !excluded.has(tileKey(p)) && !forbidden.has(tileKey(p)) && (!grid.get(p) || grid.get(p)?.type === 'road'));
  if (starts.some(p => grid.get(p)?.type === 'road')) return [];
  if (!starts.length) return null;
  if (!world.plan.roads.length) return [starts[seed % starts.length]!];
  const queue = [...starts];
  const parent = new Map<string, Position | null>(starts.map(p => [tileKey(p),null]));
  const offsets = [{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
  for (let i=0;i<queue.length;i++) {
    const cell = queue[i]!;
    if (grid.get(cell)?.type === 'road') {
      const path: Position[] = [];
      let previous = parent.get(tileKey(cell));
      while (previous) { path.push(previous); previous = parent.get(tileKey(previous)); }
      return path.reverse();
    }
    for (let j=0;j<4;j++) {
      const delta = offsets[(j+seed%4)%4]!;
      const next = {x:cell.x+delta.x,y:cell.y+delta.y};
      const key = tileKey(next);
      if (!grid.isInBounds(next) || excluded.has(key) || forbidden.has(key) || parent.has(key)) continue;
      const occupant = grid.get(next);
      if (occupant && occupant.type !== 'road') continue;
      parent.set(key,cell); queue.push(next);
    }
  }
  return null;
}
function connectComponent(world: WorldState, starts: readonly Position[], target: readonly Position[], forbidden: Set<string>, seed:number):Position[]|null {
  const grid=new OccupancyGrid(world.plan), goals=new Set(target.map(tileKey));
  const queue=[...starts], parent=new Map<string,Position|null>(starts.map(p=>[tileKey(p),null]));
  const directions=[{x:0,y:-1},{x:1,y:0},{x:0,y:1},{x:-1,y:0}];
  for(let i=0;i<queue.length;i++) {
    const cell=queue[i]!;
    if(goals.has(tileKey(cell))) {
      const result:Position[]=[];let p:Position|null|undefined=cell;
      while(p) {if(!grid.get(p)) result.push(p);p=parent.get(tileKey(p));}
      return result.reverse();
    }
    for(let j=0;j<4;j++) {
      const d=directions[(j+seed%4)%4]!, next={x:cell.x+d.x,y:cell.y+d.y}, key=tileKey(next);
      if(!grid.isInBounds(next) || forbidden.has(key) || parent.has(key)) continue;
      const occupant=grid.get(next);if(occupant && occupant.type!=='road') continue;
      parent.set(key,cell);queue.push(next);
    }
  }
  return null;
}
function candidates(world: WorldState, intent: ArchitectIntent, preferred: Position | null, seed: number): Position[] {
  let anchor = preferred;
  if (!anchor) {
    const refs = intent.near === 'park' ? world.plan.buildings.filter(b=>b.type==='park') : world.plan.buildings;
    const cells = intent.near === 'center' ? [] : refs.length && intent.near !== 'road' ? refs.map(b=>b.position) : world.plan.roads;
    anchor = cells.length ? {x:cells.reduce((n,p)=>n+p.x,0)/cells.length,y:cells.reduce((n,p)=>n+p.y,0)/cells.length} :
      {x:world.plan.width*(intent.style==='coastal'?0.75:0.5),y:world.plan.height*(intent.style==='coastal'?0.75:0.5)};
  }
  const positions: Position[]=[];
  for(let y=0;y<world.plan.height;y++) for(let x=0;x<world.plan.width;x++) positions.push({x,y});
  const tie = (p:Position) => (Math.imul(p.x+seed,73856093)^Math.imul(p.y+seed,19349663))>>>0;
  positions.sort((a,b)=> (Math.abs(a.x-anchor!.x)+Math.abs(a.y-anchor!.y))-(Math.abs(b.x-anchor!.x)+Math.abs(b.y-anchor!.y)) || tie(a)-tie(b) || a.y-b.y || a.x-b.x);
  if (preferred) positions.unshift(preferred);
  return positions;
}

export async function createProposal(rawWorld: unknown, sourceRevision: number, rawIntent: ArchitectIntent, seed=0, rawConstraints: Partial<PlanningConstraints> = {}): Promise<PlanProposal> {
  const world = readWorld(rawWorld,sourceRevision);
  const intent = decodeIntent(rawIntent), constraints = decodeConstraints(rawConstraints);
  if (!integer(seed) || seed > 0xffffffff) throw new PlanError('INVALID_REQUEST','Seed must be an unsigned 32-bit integer.');
  const warnings: PlanWarning[]=[];
  const warn=(code:string,message:string)=>warnings.push({code,message});
  let draft=world, commands:CityCommand[]=[], fulfilled=true, fatal=false, scans=0;
  const budget = Math.min(world.budget.balance,intent.budgetLimit ?? world.budget.balance,constraints.budgetLimit ?? world.budget.balance);
  const preserved = new Set([...intent.preserveBuildingIds,...constraints.preserveBuildingIds]);
  const removedRoads = new Set(intent.roadRemove.map(tileKey));
  if(intent.roadAdd.some(p=>removedRoads.has(tileKey(p)))) {
    fatal=true;fulfilled=false;warn('CONFLICTING_ROAD_EDIT','A road tile cannot be requested for both addition and removal.');
  }
  const commit=(batch:CityCommand[]):boolean=>{
    if (operationCount([...commands,...batch]) > constraints.maxOperations) return false;
    const result=applyCityCommandBatch(draft,batch);
    if (!result.applied || world.budget.balance-result.state.budget.balance > budget) return false;
    draft=result.state; commands.push(...batch); return true;
  };
  const failed=(code:string,message:string)=>{fulfilled=false; warn(code,message); if (!constraints.allowPartial) fatal=true;};
  for(const text of intent.unsupportedRequests) failed('UNSUPPORTED_REQUEST',text);
  for(const text of intent.ambiguities) failed('AMBIGUOUS_REQUEST',text);
  for(const id of intent.demolish) {
    if (!constraints.allowDestructive || !constraints.allowedDemolitions.includes(id) || preserved.has(id)) {
      fatal=true; fulfilled=false; warn('DESTRUCTIVE_NOT_AUTHORIZED',`Demolition of ${id} is not authorized.`); break;
    }
    if (!commit([{type:'city.demolish',buildingId:id}])) failed('DEMOLITION_REJECTED',`Cannot demolish ${id}.`);
  }
  if (intent.roadRemove.length) {
    const allowed = new Set(constraints.allowedRoadRemovals.map(tileKey));
    if (!constraints.allowDestructive || intent.roadRemove.some(p=>!allowed.has(tileKey(p)))) {
      fatal=true; fulfilled=false; warn('DESTRUCTIVE_NOT_AUTHORIZED','Road removal requires explicit tile authorization.');
    } else if (!commit([{type:'city.edit-roads',add:[],remove:intent.roadRemove}])) failed('ROAD_EDIT_REJECTED','Road removal was rejected.');
  }
  if (!fatal && intent.roadAdd.length && !commit([{type:'city.edit-roads',add:intent.roadAdd,remove:[]}])) failed('ROAD_EDIT_REJECTED','Requested road additions conflict with the map, budget or operation limit.');

  const place = (type:BuildingType, preferred:Position|null, moveId?:string):boolean=>{
    if (moveId && preserved.has(moveId)) {fatal=true;warn('PRESERVATION_CONFLICT',`Building ${moveId} must be preserved.`);return false;}
    const definition=BUILDING_CATALOG[type];
    if(definition.footprint.width>draft.plan.width || definition.footprint.height>draft.plan.height) return false;
    if (!moveId && world.budget.balance-draft.budget.balance+definition.cost > budget) return false;
    for(const position of candidates(draft,intent,preferred,seed)) {
      if (++scans > LIMITS.candidates) {warn('SEARCH_LIMIT','The bounded placement search was exhausted.');return false;}
      if (intent.region && (position.x<intent.region.x || position.y<intent.region.y || position.x+definition.footprint.width>intent.region.x+intent.region.width || position.y+definition.footprint.height>intent.region.y+intent.region.height)) continue;
      const validation=moveId ? validateBuildingMove(draft,moveId,position) : validateBuildingPlacement(draft,type,position);
      if (!validation.valid && validation.reason !== 'road-required') continue;
      const candidate={position,footprint:definition.footprint};
      const needsLink=definition.requiresRoad || intent.connectRoads;
      const roads=needsLink ? roadLink(draft,candidate,seed,removedRoads) : [];
      if (roads === null) continue;
      const roadCost=roads.length*CONSTRUCTION_COSTS.road;
      if(world.budget.balance-draft.budget.balance+roadCost+(moveId?0:definition.cost)>budget) continue;
      const batch:CityCommand[]=[];
      if(roads.length) batch.push({type:'city.edit-roads',add:roads,remove:[]});
      batch.push(moveId ? {type:'city.move-building',buildingId:moveId,position} : {type:'city.build',buildingType:type,position});
      if(!commit(batch)) continue;
      if(preferred && (position.x!==preferred.x || position.y!==preferred.y)) warn('RELOCATED','A requested footprint was relocated to the nearest searched legal lot.');
      if(roads.length && !world.plan.roads.length && commands.filter(c=>c.type==='city.edit-roads').length===1) warn('NEW_ROAD_NETWORK','No existing roads were available; the district starts a new connected network.');
      return true;
    }
    return false;
  };
  if (!fatal) for(const move of intent.moves) {
    const building=draft.plan.buildings.find(b=>b.id===move.buildingId);
    if (!building?.type || !place(building.type,move.position,move.buildingId)) failed('MOVE_UNFULFILLED',`Could not move ${move.buildingId}.`);
    if(fatal) break;
  }
  const buildRequests=intent.near==='park' ? [...intent.builds].sort((a,b)=>Number(b.buildingType==='park')-Number(a.buildingType==='park')) : intent.builds;
  if (!fatal) for(const request of buildRequests) {
    let count=0;
    for(;count<request.quantity;count++) if(!place(request.buildingType,request.preferredPosition)) break;
    if(count<request.quantity) failed('QUANTITY_UNFULFILLED',`Requested ${request.quantity} ${request.buildingType}; found ${count} affordable legal placements.`);
    if(fatal) break;
  }
  if(!fatal && intent.connectRoads) {
    const original=new Set(world.plan.roads.map(tileKey));
    const forbidden=new Set(intent.roadRemove.map(tileKey));
    for(let pass=0;pass<LIMITS.operations;pass++) {
      const components=new RoadGraph(draft.plan.roads).getComponents();
      if(components.length<2) break;
      const target=components.find(c=>c.some(p=>original.has(tileKey(p)))) ?? components[0]!;
      const detached=components.find(c=>c!==target && (!original.size || !c.some(p=>original.has(tileKey(p)))));
      if(!detached) break;
      const link=connectComponent(draft,detached,target,forbidden,seed);
      if(!link?.length || !commit([{type:'city.edit-roads',add:link,remove:[]}])) {
        fatal=true;fulfilled=false;warn('CONNECTIVITY_UNFULFILLED','The proposed roads cannot connect within the land, budget and operation limits.');break;
      }
      warn('ROAD_LINK_REPAIRED','Disconnected proposed roads were joined to the existing district.');
    }
  }
  if(!fatal && intent.roadRemove.length) {
    const beforeGraph=new RoadGraph(world.plan.roads), afterGraph=new RoadGraph(draft.plan.roads);
    if(afterGraph.getComponents().length>beforeGraph.getComponents().length) warn('ROAD_NETWORK_SPLIT','Authorized road removals split the existing network.');
    const isolated=world.plan.buildings.filter(b=>draft.plan.buildings.some(next=>next.id===b.id) &&
      beforeGraph.getAdjacentComponents(b).length>0 && afterGraph.getAdjacentComponents(draft.plan.buildings.find(next=>next.id===b.id)!).length===0);
    if(isolated.length) warn('ROAD_ACCESS_LOST',`Road removals disconnect ${isolated.length} existing building(s).`);
  }
  if(!commands.length) {fatal=true;fulfilled=false;warn('EMPTY_PLAN','No executable city edits were produced.');}
  if(fatal) {commands=[];draft=world;}
  const full=applyCityCommandBatch(world,commands);
  if(commands.length && !full.applied) throw new PlanError('PLAN_REJECTED','Final atomic validation failed.');
  const placements:PlanProposal['placements']=[];
  for(const event of full.events) {
    if(event.type==='city.building-built' && event.building.type) placements.push({buildingId:event.building.id,buildingType:event.building.type,position:event.building.position,footprint:event.building.footprint,operation:'build'});
    if(event.type==='city.building-moved') {
      const b=full.state.plan.buildings.find(b=>b.id===event.buildingId)!;
      if(b.type) placements.push({buildingId:b.id,buildingType:b.type,position:b.position,footprint:b.footprint,operation:'move'});
    }
  }
  const edits=commands.filter(c=>c.type==='city.edit-roads');
  const proposal:PlanProposal={contractVersion:1,planId:'',digest:'',sourceWorldId:world.id,sourceRevision:world.revision,
    sourceFingerprint:await cityFingerprint(world),seed,status:fatal?'REJECTED':'VALIDATED',intent,constraints,
    summary:intent.summary,explanation:`Deterministic ${intent.style} district; legal lots and shortest free road links are validated by the Phase 1 simulation.`,
    placements,roads:{add:edits.flatMap(c=>c.add),remove:edits.flatMap(c=>c.remove)},
    projectedPlan:full.state.plan,estimatedCost:world.budget.balance-draft.budget.balance,projectedBudget:draft.budget.balance,
    validation:{valid:!fatal,fulfilled,operationCount:operationCount(commands)},warnings,commands};
  proposal.digest=await hash(digestPayload(proposal));proposal.planId=`plan-${proposal.digest}`;
  return proposal;
}

export function inspectWorld(raw:unknown,revision:number) {
  const world=readWorld(raw,revision);
  return {catalog:BUILDING_CATALOG,limits:LIMITS,context:{worldId:world.id,revision:world.revision,
    budget:world.budget.balance,width:world.plan.width,height:world.plan.height,
    buildings:world.plan.buildings,roadCount:world.plan.roads.length,roadComponents:new RoadGraph(world.plan.roads).getComponents().length,
    blockedTileCount:world.plan.blockedTiles.length}};
}
