import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILDING_CATALOG, createWorld, serializeWorld, Simulation, OccupancyGrid, RoadGraph } from '@tiny-city/simulation';
import type { BuildingType } from '@tiny-city/simulation';
import { createProposal, PlanReview, cityFingerprint, decodeIntent } from '../src/index.js';
import type { ArchitectIntent, PlanningConstraints, PlanningResponse } from '../src/index.js';

const intent=(patch:Partial<ArchitectIntent>={}):ArchitectIntent=>({summary:'Build district',language:'en',style:'compact',near:'existing',region:null,budgetLimit:null,
  connectRoads:true,builds:[{buildingType:'villa',quantity:2,preferredPosition:null}],moves:[],demolish:[],roadAdd:[],roadRemove:[],preserveBuildingIds:[],unsupportedRequests:[],ambiguities:[],...patch});
const world=(funds=5000,roads=true)=>createWorld({id:'test',seed:123,startingFunds:funds,clock:{paused:true},
  plan:{id:'test-plan',name:'Test',width:24,height:24,buildings:[],roads:roads?Array.from({length:16},(_,i)=>({x:4+i,y:12})):[],blockedTiles:[{x:23,y:23}]}});

for(const type of Object.keys(BUILDING_CATALOG) as BuildingType[]) it(`plans and applies ${type} using authoritative footprint, budget and road rules`,async()=>{
  const initial=world();const simulation=new Simulation(initial);
  const proposal=await createProposal(initial,0,intent({builds:[{buildingType:type,quantity:1,preferredPosition:{x:23,y:23}}]}),7);
  expect(proposal.validation.valid).toBe(true);expect(proposal.warnings.some(w=>w.code==='RELOCATED')).toBe(true);
  expect(proposal.placements[0]?.footprint).toEqual(BUILDING_CATALOG[type].footprint);
  expect(simulation.getState()).toEqual(initial);
  const review=new PlanReview(simulation,proposal);await review.preview();review.approve(proposal.planId);
  const result=await review.apply();expect(result.applied).toBe(true);
  expect(result.state.plan).toEqual(proposal.projectedPlan);
  const building=result.state.plan.buildings[0]!;
  expect(new OccupancyGrid(result.state.plan).get(building.position)?.type).toBe('building');
  expect(new RoadGraph(result.state.plan.roads).getAdjacentComponents(building).length).toBeGreaterThan(0);
  expect(result.state.budget.balance).toBe(initial.budget.balance-proposal.estimatedCost);
});

describe('deterministic preview and bounded repair',()=>{
  it('repeats identical plans without modifying the input, clock or random state',async()=>{
    const initial=world();const before=serializeWorld(initial);
    const a=await createProposal(initial,0,intent(),7),b=await createProposal(initial,0,intent(),7);
    expect(a).toEqual(b);expect(serializeWorld(initial)).toBe(before);
  });
  it('creates a connected new network on an empty map and warns',async()=>{
    const initial=world(5000,false);const p=await createProposal(initial,0,intent(),5);
    expect(p.validation.valid).toBe(true);expect(p.warnings.some(w=>w.code==='NEW_ROAD_NETWORK')).toBe(true);
    const simulation=new Simulation(initial);simulation.executeBatch(p.commands);
    expect(simulation.getRoadGraph().getComponents()).toHaveLength(1);
  });
  it('rejects unfulfillable exact quantities with no executable partial batch',async()=>{
    const p=await createProposal(world(120),0,intent());expect(p.status).toBe('REJECTED');expect(p.commands).toEqual([]);expect(p.estimatedCost).toBe(0);
  });
  it('only reduces quantities with explicit partial consent and reports it',async()=>{
    const p=await createProposal(world(120),0,intent(),0,{allowPartial:true});expect(p.validation).toMatchObject({valid:true,fulfilled:false});expect(p.placements).toHaveLength(1);
    expect(p.warnings.some(w=>w.code==='QUANTITY_UNFULFILLED')).toBe(true);
  });
  it('caps user budget including new road costs',async()=>{
    const p=await createProposal(world(5000,false),0,intent({budgetLimit:120}));expect(p.status).toBe('REJECTED');
  });
  it('enforces region and operation limits with no partial leakage',async()=>{
    const p=await createProposal(world(),0,intent({region:{x:23,y:23,width:1,height:1}}));expect(p.commands).toEqual([]);
    const q=await createProposal(world(),0,intent(),0,{maxOperations:1});expect(q.status).toBe('REJECTED');expect(q.commands).toEqual([]);
  });
  it('reports unsupported and ambiguous requests instead of inventing substitutions',async()=>{
    const p=await createProposal(world(),0,intent({unsupportedRequests:['airport'],ambiguities:['unclear count']}));expect(p.status).toBe('REJECTED');
    expect(p.warnings.map(w=>w.code)).toContain('UNSUPPORTED_REQUEST');expect(p.warnings.map(w=>w.code)).toContain('AMBIGUOUS_REQUEST');
  });
  it('rejects invalid worlds, revisions, types, unsafe seeds and excessive quantities',async()=>{
    await expect(createProposal({},0,intent())).rejects.toMatchObject({code:'INVALID_WORLD'});
    await expect(createProposal(world(),2,intent())).rejects.toMatchObject({code:'STALE_WORLD'});
    expect(()=>decodeIntent(intent({builds:[{buildingType:'airport' as BuildingType,quantity:1,preferredPosition:null}]}))).toThrow();
    await expect(createProposal(world(),0,intent(),-1)).rejects.toMatchObject({code:'INVALID_REQUEST'});
    await expect(createProposal(world(),0,intent({builds:[{buildingType:'villa',quantity:32,preferredPosition:null},{buildingType:'park',quantity:1,preferredPosition:null}]}))).rejects.toMatchObject({code:'CONTEXT_LIMIT'});
  });
});

describe('preview, approval and atomic application',()=>{
  it('requires a real preview and exact approval, supports rejection with no mutation',async()=>{
    const s=new Simulation(world());const p=await createProposal(s.getState(),0,intent());const before=serializeWorld(s.getState());const r=new PlanReview(s,p);
    expect(()=>r.approve(p.planId)).toThrow();await expect(r.apply()).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
    await r.preview();expect(()=>r.approve('wrong-plan')).toThrow();r.reject();await expect(r.apply()).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});expect(serializeWorld(s.getState())).toBe(before);
  });
  it('blocks stale revisions and same-revision different city fingerprints',async()=>{
    const s=new Simulation(world());const p=await createProposal(s.getState(),0,intent());const r=new PlanReview(s,p);await r.preview();r.approve(p.planId);
    s.execute({type:'city.edit-roads',add:[{x:0,y:0}],remove:[]});const before=serializeWorld(s.getState());await expect(r.apply()).rejects.toMatchObject({code:'STALE_WORLD'});expect(serializeWorld(s.getState())).toBe(before);
    const altered={...world(),plan:{...world().plan,name:'Another city'}};await expect(new PlanReview(new Simulation(altered),p).preview()).rejects.toMatchObject({code:'STALE_WORLD'});
  });
  it('allows clock progression, prevents duplicate/concurrent applications, including after undo',async()=>{
    const s=new Simulation(world());const snapshot=s.getCitySnapshot();const p=await createProposal(s.getState(),0,intent());const r=new PlanReview(s,p);await r.preview();r.approve(p.planId);s.step(5);
    const results=await Promise.allSettled([r.apply(),r.apply()]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(s.getState().clock.tick).toBe(5);
    const after=serializeWorld(s.getState());await expect(r.apply()).rejects.toMatchObject({code:'ALREADY_APPLIED'});expect(serializeWorld(s.getState())).toBe(after);s.restoreCity(snapshot);await expect(r.apply()).rejects.toMatchObject({code:'ALREADY_APPLIED'});
  });
  it('checks proposal corruption and source mutation during async validation',async()=>{
    const s=new Simulation(world());const p=await createProposal(s.getState(),0,intent());
    const bad={...p,estimatedCost:0};await expect(new PlanReview(s,bad).preview()).rejects.toMatchObject({code:'INVALID_PROPOSAL'});
    const other=new Simulation(world());const r=new PlanReview(other,p);const pending=r.preview();other.execute({type:'city.edit-roads',add:[{x:0,y:0}],remove:[]});await expect(pending).rejects.toMatchObject({code:'STALE_WORLD'});
  });
  it('handles requested moves and explicitly authorized demolition with preservation and citizen safety',async()=>{
    const s=new Simulation(world());s.execute({type:'city.build',buildingType:'villa',position:{x:5,y:13}});
    const initial=s.getState();const move=await createProposal(initial,initial.revision,intent({builds:[],moves:[{buildingId:'building-1',position:{x:10,y:13}}]}));expect(move.commands.some(c=>c.type==='city.move-building')).toBe(true);
    const req=intent({builds:[],demolish:['building-1']});expect((await createProposal(initial,initial.revision,req)).status).toBe('REJECTED');
    const constraints:Partial<PlanningConstraints>={allowDestructive:true,allowedDemolitions:['building-1']};
    expect((await createProposal(initial,initial.revision,req,0,{...constraints,preserveBuildingIds:['building-1']})).status).toBe('REJECTED');
    const p=await createProposal(initial,initial.revision,req,0,constraints);const r=new PlanReview(s,p);await r.preview();expect(()=>r.approve(p.planId)).toThrow();r.approve(p.planId,{allowDestructive:true});await r.apply();expect(s.getState().plan.buildings).toEqual([]);
  });
  it('roundtrips the documented backend fixture and applies it without a second world model',async()=>{
    const response=JSON.parse(readFileSync(new URL('../../../docs/ai-architect/examples/mock-plan-response.json',import.meta.url),'utf8')) as PlanningResponse;
    const request=JSON.parse(readFileSync(new URL('../../../docs/ai-architect/examples/plan-request.json',import.meta.url),'utf8'));
    const s=new Simulation(request.world);expect(await cityFingerprint(s.getState())).toBe(response.proposal.sourceFingerprint);
    const r=new PlanReview(s,response.proposal);await r.preview();r.approve(response.proposal.planId);const applied=await r.apply();expect(applied.state.plan.buildings).toHaveLength(3);
  });
});

it('repairs disconnected explicit road requests and rechecks connection cost and operation limits',async()=>{
  const initial=world();const requested=intent({builds:[],roadAdd:[{x:1,y:1},{x:2,y:1}]});
  const p=await createProposal(initial,0,requested);expect(p.validation.valid).toBe(true);
  expect(p.warnings.some(w=>w.code==='ROAD_LINK_REPAIRED')).toBe(true);
  const s=new Simulation(initial);s.executeBatch(p.commands);expect(s.getRoadGraph().getComponents()).toHaveLength(1);
  const q=await createProposal(initial,0,requested,0,{budgetLimit:16});expect(q.status).toBe('REJECTED');expect(q.commands).toEqual([]);
});
it('handles the complete 21-building Vietnamese coastal district example within a real budget',async()=>{
  const request=JSON.parse(readFileSync(new URL('../../../docs/ai-architect/examples/plan-request.json',import.meta.url),'utf8'));
  const initial={...request.world,budget:{openingBalance:25000,balance:25000,totalSpent:0}};
  const p=await createProposal(initial,0,intent({language:'vi',style:'coastal',builds:[
    {buildingType:'villa',quantity:15,preferredPosition:null},{buildingType:'apartment',quantity:3,preferredPosition:null},
    {buildingType:'mall',quantity:1,preferredPosition:null},{buildingType:'park',quantity:2,preferredPosition:null}]}),7);
  expect(p.validation.valid).toBe(true);expect(p.placements).toHaveLength(21);expect(p.estimatedCost).toBeLessThanOrEqual(25000);
});

it('revalidates changed citizen references even when only simulation time has advanced',async()=>{
  const s=new Simulation(world());s.executeBatch([
    {type:'city.build',buildingType:'villa',position:{x:5,y:13}},
    {type:'city.build',buildingType:'villa',position:{x:10,y:13}},
  ]);
  const initial={...s.getState(),citizens:[{id:'citizen',name:'Citizen',homeBuildingId:'building-2',workBuildingId:null,
    position:{x:10,y:13},activity:'home' as const,targetBuildingId:null,
    schedule:{entries:[{startMinute:0,activity:'home' as const,targetBuildingId:null}]}}]};
  const live=new Simulation(initial);
  const p=await createProposal(initial,initial.revision,intent({builds:[],demolish:['building-1']}),0,
    {allowDestructive:true,allowedDemolitions:['building-1']});
  const r=new PlanReview(live,p);await r.preview();r.approve(p.planId,{allowDestructive:true});
  live.enqueue({type:'citizen.set-schedule',citizenId:'citizen',schedule:{entries:[{startMinute:0,activity:'home',targetBuildingId:'building-1'}]}});
  live.step();const before=serializeWorld(live.getState());
  await expect(r.apply()).rejects.toMatchObject({code:'PLAN_REJECTED'});expect(serializeWorld(live.getState())).toBe(before);
});

it('never recreates explicitly removed roads during repair and rejects conflicting road intent',async()=>{
  const initial=world();const removed=[{x:10,y:12},{x:11,y:12}];
  const constraints={allowDestructive:true,allowedRoadRemovals:removed};
  const req=intent({roadRemove:removed,builds:[{buildingType:'villa',quantity:1,preferredPosition:{x:10,y:13}}]});
  const p=await createProposal(initial,0,req,0,constraints);expect(p.validation.valid).toBe(true);
  for(const tile of removed) expect(p.projectedPlan.roads).not.toContainEqual(tile);
  expect(p.warnings.some(w=>w.code==='ROAD_NETWORK_SPLIT')).toBe(true);
  const conflicting=await createProposal(initial,0,{...req,roadAdd:removed},0,constraints);
  expect(conflicting.status).toBe('REJECTED');expect(conflicting.commands).toEqual([]);
});
