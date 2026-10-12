import { describe, expect, it } from 'vitest';
import { applyCityCommandBatch, buildingCenter, cloneWorld, createWorld, deserializeWorld, NPC_LIMITS, RoadNavigator, serializeWorld, Simulation, validateWorld } from '../src/index.js';
import { createDemoWorldFixture } from '../src/fixtures.js';
import { npcBuilding, npcFixture, populationFixture } from './npcFixture.js';
import type { SimulationEvent, WorldState } from '../src/index.js';

function workNow(sim:Simulation) {
  for(const c of sim.getState().citizens) sim.enqueue({type:'citizen.set-schedule',citizenId:c.id,schedule:{entries:[{startMinute:0,activity:'work',targetBuildingId:c.workBuildingId}]}});
}
const valid=(w:WorldState)=>expect(()=>validateWorld(w)).not.toThrow();

describe('managed population and capacity',()=>{
  it('fills housing deterministically with stable seeded names and attributes',()=>{
    const a=npcFixture(),b=npcFixture();expect(a).toEqual(b);expect(a.citizens).toHaveLength(2);
    expect(new Set(a.citizens.map(c=>c.id)).size).toBe(2);
    expect(a.citizens.map(c=>c.id)).toEqual(['npc-1','npc-2']);
    expect(npcFixture({seed:456}).citizens.map(c=>c.attributes)).not.toEqual(a.citizens.map(c=>c.attributes));valid(a);
  });
  it('respects caps, resident slots and job slots independently',()=>{
    const sim=new Simulation(populationFixture(100));expect(sim.getPopulationCount()).toBe(100);
    for(const b of sim.getState().plan.buildings){const o=sim.getBuildingOccupancy(b.id);expect(o.residentIds.length).toBeLessThanOrEqual(b.capacity);expect(o.workerIds.length).toBeLessThanOrEqual(b.capacity);}
    expect(sim.getState().citizens.every(c=>c.workBuildingId!==null)).toBe(true);
  });
  it('uses offices and malls for jobs and clubhouse/pool/park for leisure',()=>{
    const world=npcFixture({buildings:[npcBuilding('home','apartment',2,6),npcBuilding('club','clubhouse',8,6),npcBuilding('mall','mall',20,6),npcBuilding('pool','pool',14,6)]});
    expect(world.citizens).toHaveLength(24);expect(world.citizens.every(c=>c.workBuildingId==='mall')).toBe(true);valid(world);
  });
  it('is idempotent when enabled or updated repeatedly',()=>{
    const sim=new Simulation(npcFixture());const before=serializeWorld(sim.getState());
    expect(sim.enablePopulation().events).toEqual([]);expect(serializeWorld(sim.getState())).toBe(before);
    sim.step(20);expect(sim.getPopulationCount()).toBe(2);expect(sim.getState().randomState).toBe(npcFixture().randomState);
  });
  it('migrates authored residents only on explicit opt-in',()=>{
    const old=createDemoWorldFixture();const sim=new Simulation(old);expect(sim.getState()).toEqual(old);
    sim.enablePopulation({maxCitizens:10});expect(sim.getCitizen('citizen-1')?.name).toBe('Linh');valid(sim.getState());
  });
  it.each([-1,1.5,10001,NaN])('rejects invalid population cap %s atomically',maxCitizens=>{
    const sim=new Simulation(createDemoWorldFixture()),before=sim.getState();expect(()=>sim.enablePopulation({maxCitizens})).toThrow();expect(sim.getState()).toBe(before);
  });
  it('supports zero capacity without orphaned residents',()=>{expect(npcFixture({population:{maxCitizens:0}}).citizens).toEqual([]);});
  it('adds residents when a home is built and exposes typed events',()=>{
    const sim=new Simulation(npcFixture());const r=sim.execute({type:'city.build',buildingType:'duplex',position:{x:6,y:6}});
    expect(r.applied).toBe(true);expect(r.state.citizens).toHaveLength(6);expect(r.events.filter(e=>e.type==='citizen.created')).toHaveLength(4);
    expect(r.events).toContainEqual({type:'population.changed',tick:0,count:6});valid(r.state);
  });
  it('assigns newly available employment without regenerating identities',()=>{
    const sim=new Simulation(npcFixture({buildings:[npcBuilding('home','villa',2,6)]}));const names=sim.getState().citizens.map(c=>c.name);
    expect(sim.getState().citizens.every(c=>c.workBuildingId===null)).toBe(true);
    sim.execute({type:'city.build',buildingType:'office',position:{x:20,y:6}});
    expect(sim.getState().citizens.map(c=>c.name)).toEqual(names);expect(sim.getState().citizens.every(c=>c.workBuildingId==='building-1')).toBe(true);valid(sim.getState());
  });
});

describe('road-aware navigation',()=>{
  it('uses footprint entrances and orthogonal road centers with no vacant shortcuts',()=>{
    const w=npcFixture(),n=new RoadNavigator(w.plan),r=n.findRoute('home','office');if(!r.route)throw Error('expected route');
    expect(r.route[0]).toEqual(buildingCenter(w.plan.buildings[0]!));expect(r.route.at(-1)).toEqual(buildingCenter(w.plan.buildings[1]!));
    for(let i=1;i<r.route.length;i++){const a=r.route[i-1]!,b=r.route[i]!;expect(a.x===b.x||a.y===b.y).toBe(true);}
    expect(r.route).toContainEqual({x:15.5,y:5.5});expect(n.getAccessPoints('home')).toEqual([{x:2,y:5},{x:3,y:5}]);
    expect(Object.isFrozen(r.route)).toBe(true);
  });
  it('breaks ties independently of input road order and reuses cached searches',()=>{
    const w=npcFixture(),a=new RoadNavigator(w.plan),b=new RoadNavigator({...w.plan,roads:[...w.plan.roads].reverse()});
    expect(a.findRoute('home','office')).toEqual(b.findRoute('home','office'));a.findRoute('home','office');expect(a.getStats()).toMatchObject({searches:1,cacheHits:1});
  });
  it('detaches navigation geometry from mutable constructor inputs',()=>{
    const w=npcFixture(),plan={...w.plan,buildings:w.plan.buildings.map(b=>({...b,position:{...b.position}}))},n=new RoadNavigator(plan);
    const before=n.findRoute('home','office');plan.buildings[0]!.position.x=28;
    expect(n.findRoute('home','office')).toEqual(before);expect(Object.isFrozen(plan.buildings[0]!.position)).toBe(false);
  });
  it('does not connect disconnected roads through empty terrain',()=>{
    expect(new RoadNavigator(npcFixture({disconnected:true}).plan).findRoute('home','office')).toEqual({route:null,reason:'unreachable'});
  });
  it('cannot enter another footprint from an arbitrary point',()=>{
    const w=npcFixture(),n=new RoadNavigator(w.plan);expect(n.routeFrom({x:10.5,y:6.5},null,'office').route).toBeNull();expect(n.findRoute('missing','office').route).toBeNull();
  });
  it('bounds large searches rather than performing unbounded work',()=>{
    const w=createWorld({id:'large',plan:{id:'large',name:'Large',width:5000,height:4,buildings:[
      {id:'a',name:'a',kind:'home',capacity:1,position:{x:0,y:1},footprint:{width:1,height:1}},
      {id:'b',name:'b',kind:'workplace',capacity:1,position:{x:4999,y:1},footprint:{width:1,height:1}}],roads:Array.from({length:5000},(_,x)=>({x,y:0}))}});
    const n=new RoadNavigator(w.plan);expect(n.findRoute('a','b').reason).toBe('search-limit');expect(n.getStats().visitedNodes).toBe(NPC_LIMITS.searchNodes);
  });
});

describe('daily life and progressive movement',()=>{
  it('departs, moves progressively, arrives and switches activity',()=>{
    const sim=new Simulation(npcFixture());workNow(sim);const before=sim.getCitizen('npc-1')!;
    const first=sim.step();const c=sim.getCitizen('npc-1')!;expect(c.activity).toBe('travel');expect(c.position).not.toEqual(before.position);
    expect(Math.abs(c.position.x-before.position.x)+Math.abs(c.position.y-before.position.y)).toBeCloseTo(c.attributes!.walkingSpeed);
    expect(first.events.some(e=>e.type==='citizen.moved')).toBe(true);valid(first.state);
    const result=sim.step(150);expect(sim.getCitizen('npc-1')?.activity).toBe('work');expect(sim.getCitizen('npc-1')?.movement?.currentBuildingId).toBe('office');
    expect(result.events.some(e=>e.type==='citizen.arrived')).toBe(true);valid(result.state);
  });
  it('varies seeded departure times and returns home for sleep',()=>{
    const sim=new Simulation(npcFixture());const c=sim.getCitizen('npc-1')!,departure=420+c.attributes!.scheduleOffset;
    sim.step(departure-1);expect(sim.getCitizen(c.id)?.activity).toBe('home');sim.step();expect(sim.getCitizen(c.id)?.activity).toBe('travel');
    sim.step(1380+c.attributes!.scheduleOffset-departure);expect(sim.getCitizen(c.id)?.activity).toBe('sleep');expect(sim.getCitizen(c.id)?.movement?.currentBuildingId).toBe('home');valid(sim.getState());
  });
  it('honors pause/resume, remainder and accelerated game time',()=>{
    const sim=new Simulation(npcFixture({clock:{paused:true,minutesPerTick:5}}));workNow(sim);const before=sim.getState();
    expect(sim.advance(5000).steps).toBe(0);expect(sim.getState().citizens).toEqual(before.citizens);sim.resume();
    expect(sim.advance(40).steps).toBe(0);const r=sim.advance(60);expect(r.steps).toBe(1);expect(r.state.citizens[0]?.activity).toBe('travel');valid(r.state);
  });
  it('idles on unreachable routes without recomputing them every tick',()=>{
    const sim=new Simulation(npcFixture({disconnected:true}));workNow(sim);const first=sim.step();expect(first.events.filter(e=>e.type==='citizen.route-blocked')).toHaveLength(2);
    expect(sim.getCitizen('npc-1')?.activity).toBe('idle');const searches=sim.getNavigator().getStats().searches;sim.step(20);
    expect(sim.getNavigator().getStats().searches).toBe(searches);valid(sim.getState());
  });
  it('recovers when a missing road reconnects the network',()=>{
    const sim=new Simulation(npcFixture({disconnected:true}));workNow(sim);sim.step();
    sim.execute({type:'city.edit-roads',add:[{x:15,y:5}],remove:[]});sim.step();expect(sim.getCitizen('npc-1')?.activity).toBe('travel');valid(sim.getState());
  });
  it('steps to the adjacent road without teleporting when a road is deleted under its feet, then resumes',()=>{
    const sim=new Simulation(npcFixture());workNow(sim);sim.step(15);
    const p=sim.getCitizen('npc-1')!.position,tile={x:Math.floor(p.x),y:Math.floor(p.y)};
    expect(sim.getOccupancyGrid().get(tile)?.type).toBe('road');
    // Phase 4.5: waiting on grass could never route again unless the exact tile came back, so the resident steps to the
    // nearest road (as the player does) instead: at most one tile, and still on the street.
    sim.execute({type:'city.edit-roads',add:[],remove:[tile]});sim.step();
    const q=sim.getCitizen('npc-1')!.position;
    expect(Math.abs(q.x-p.x)+Math.abs(q.y-p.y)).toBeLessThanOrEqual(1.5);
    expect(sim.getOccupancyGrid().get({x:Math.floor(q.x),y:Math.floor(q.y)})?.type).toBe('road');valid(sim.getState());
    sim.execute({type:'city.edit-roads',add:[tile],remove:[]});sim.step(5);expect(sim.getCitizen('npc-1')?.position).not.toEqual(q);valid(sim.getState());
  });
  it('stops an active route when a road ahead is deleted',()=>{
    const sim=new Simulation(npcFixture());workNow(sim);sim.step(10);const p=sim.getCitizen('npc-1')!.position;
    sim.execute({type:'city.edit-roads',add:[],remove:[{x:15,y:5}]});sim.step();expect(sim.getCitizen('npc-1')?.position).toEqual(p);
    expect(sim.getCitizen('npc-1')?.activity).toBe('idle');valid(sim.getState());
  });
  it('falls back to home without jobs or leisure and bounds leisure occupancy',()=>{
    const park={...npcBuilding('park','park',10,6),type:undefined,capacity:1};
    // Omit type instead of violating exact optional contract.
    const {type:_,...smallPark}=park;
    const sim=new Simulation(npcFixture({buildings:[npcBuilding('home','villa',2,6),smallPark]}));
    for(const c of sim.getState().citizens)sim.enqueue({type:'citizen.set-schedule',citizenId:c.id,schedule:{entries:[{startMinute:0,activity:'leisure',targetBuildingId:null}]}});
    sim.step(150);expect(sim.getBuildingOccupancy('park').visitorIds).toHaveLength(1);expect(sim.getState().citizens.filter(c=>c.activity==='home')).toHaveLength(1);valid(sim.getState());
  });
  it('rejects relocation onto blocked/foreign/empty tiles for managed residents',()=>{
    const sim=new Simulation(npcFixture());sim.enqueue({type:'citizen.relocate',citizenId:'npc-1',position:{x:15,y:15}});
    expect(sim.step().events.some(e=>e.type==='command.rejected')).toBe(true);valid(sim.getState());
  });
  it.each(['work','sleep','leisure'] as const)('rejects an incompatible custom %s destination',activity=>{
    const sim=new Simulation(npcFixture());const target=activity==='work'?'park':'office';
    sim.enqueue({type:'citizen.set-schedule',citizenId:'npc-1',schedule:{entries:[{startMinute:0,activity,targetBuildingId:target}]}});
    expect(sim.step().events).toContainEqual({type:'command.rejected',tick:1,commandType:'citizen.set-schedule',citizenId:'npc-1',reason:'invalid-schedule'});valid(sim.getState());
  });
  it('replays across frame chunking with identical states and events',()=>{
    const a=new Simulation(npcFixture({clock:{paused:false}})),b=new Simulation(npcFixture({clock:{paused:false}}));workNow(a);workNow(b);
    const r=a.advance(12000),events:SimulationEvent[]=[];for(const ms of [17,83,2000,4000,5900])events.push(...b.advance(ms).events);
    expect(b.getState()).toEqual(r.state);expect(events).toEqual(r.events);
  });
});

describe('edits, persistence and history',()=>{
  it('removes residents safely when occupied housing is demolished',()=>{
    const sim=new Simulation(npcFixture()),r=sim.execute({type:'city.demolish',buildingId:'home'});
    expect(r.applied).toBe(true);expect(r.state.citizens).toEqual([]);expect(r.events.filter(e=>e.type==='citizen.removed')).toHaveLength(2);valid(r.state);
  });
  it('displaces residents into spare housing without changing their identities',()=>{
    const sim=new Simulation(npcFixture({population:{maxCitizens:2},buildings:[npcBuilding('a','villa',2,6),npcBuilding('b','villa',6,6)]}));
    const before=sim.getState().citizens;sim.execute({type:'city.demolish',buildingId:'a'});
    expect(sim.getState().citizens.map(c=>c.id)).toEqual(before.map(c=>c.id));expect(sim.getState().citizens.every(c=>c.homeBuildingId==='b')).toBe(true);valid(sim.getState());
  });
  it('reassigns a demolished home while preserving residents already at work',()=>{
    const sim=new Simulation(npcFixture({population:{maxCitizens:2},buildings:[npcBuilding('a','villa',2,6),npcBuilding('b','villa',6,6),npcBuilding('office','office',20,6)]}));
    workNow(sim);sim.step(150);const before=sim.getCitizen('npc-1')!;expect(before.movement?.currentBuildingId).toBe('office');
    sim.execute({type:'city.demolish',buildingId:'a'});const after=sim.getCitizen('npc-1')!;
    expect(after.homeBuildingId).toBe('b');expect(after.position).toEqual(before.position);expect(after.activity).toBe('work');valid(sim.getState());
  });
  it('clears deleted workplace and custom schedule references',()=>{
    const sim=new Simulation(npcFixture());workNow(sim);sim.step(30);sim.execute({type:'city.demolish',buildingId:'office'});
    expect(sim.getState().citizens.every(c=>c.workBuildingId===null&&c.schedule.entries.every(e=>e.targetBuildingId!=='office'))).toBe(true);sim.step();valid(sim.getState());
  });
  it('moves occupied buildings preserving references and safe interior positions',()=>{
    const sim=new Simulation(npcFixture());const ids=sim.getState().citizens.map(c=>c.id);
    expect(sim.execute({type:'city.move-building',buildingId:'home',position:{x:6,y:6}}).applied).toBe(true);
    expect(sim.getState().citizens.map(c=>c.id)).toEqual(ids);expect(sim.getCitizen('npc-1')?.position).toEqual({x:7.5,y:7.5});valid(sim.getState());
  });
  it('reanchors a resident still departing a moved home and resumes road travel',()=>{
    const sim=new Simulation(npcFixture());workNow(sim);sim.step();expect(sim.getCitizen('npc-1')?.movement?.currentBuildingId).toBe('home');
    sim.execute({type:'city.move-building',buildingId:'home',position:{x:6,y:6}});expect(sim.getCitizen('npc-1')?.activity).toBe('home');
    sim.step();expect(sim.getCitizen('npc-1')?.activity).toBe('travel');valid(sim.getState());
  });
  it('rolls back NPCs, RNG, budget and cursors on a failed atomic city batch',()=>{
    const w=npcFixture(),commands=[{type:'city.build' as const,buildingType:'villa' as const,position:{x:6,y:6}},{type:'city.build' as const,buildingType:'park' as const,position:{x:6,y:6}}];
    const r=applyCityCommandBatch(w,commands);expect(r.applied).toBe(false);expect(r.state).toBe(w);expect(r.events).toHaveLength(1);
  });
  it('reports citizen ID exhaustion as a structured city rejection without partial spending',()=>{
    const w=npcFixture(),exhausted={...w,population:{...w.population!,nextCitizenId:Number.MAX_SAFE_INTEGER}},sim=new Simulation(exhausted),before=sim.getState();
    const result=sim.execute({type:'city.build',buildingType:'villa',position:{x:6,y:6}});
    expect(result.applied).toBe(false);expect(result.events[0]).toMatchObject({type:'city.command-rejected',reason:'state-limit-reached'});expect(result.state).toBe(before);
  });
  it('undo/redo restores identities without rewinding clock, RNG or ID high water',()=>{
    const sim=new Simulation(npcFixture());const before=sim.getCitySnapshot();sim.execute({type:'city.build',buildingType:'villa',position:{x:6,y:6}});
    const after=sim.getCitySnapshot(),ids=sim.getState().citizens.map(c=>c.id);sim.step(20);const progressed=sim.getState();
    sim.restoreCity(before);expect(sim.getPopulationCount()).toBe(2);expect(sim.getState().clock).toEqual(progressed.clock);expect(sim.getState().randomState).toBe(progressed.randomState);
    sim.restoreCity(after);expect(sim.getState().citizens.map(c=>c.id)).toEqual(ids);expect(sim.getState().population?.nextCitizenId).toBe(progressed.population?.nextCitizenId);valid(sim.getState());
  });
  it('restores demolished occupants via undo with original names and attributes',()=>{
    const sim=new Simulation(npcFixture()),snap=sim.getCitySnapshot(),before=sim.getState().citizens;
    sim.execute({type:'city.demolish',buildingId:'home'});sim.restoreCity(snap);
    expect(sim.getState().citizens.map(c=>[c.id,c.name,c.attributes])).toEqual(before.map(c=>[c.id,c.name,c.attributes]));valid(sim.getState());
  });
  it('restores a leisure snapshot after time advances without rewinding live activity',()=>{
    const sim=new Simulation(npcFixture());
    for(const c of sim.getState().citizens)sim.enqueue({type:'citizen.set-schedule',citizenId:c.id,schedule:{entries:[{startMinute:0,activity:'leisure',targetBuildingId:'park'}]}});
    sim.step(150);expect(sim.getCitizen('npc-1')?.activity).toBe('leisure');
    const snapshot=sim.getCitySnapshot();workNow(sim);sim.step(150);
    const current=sim.getCitizen('npc-1')!;expect(current.activity).toBe('work');
    sim.restoreCity(snapshot);expect(sim.getCitizen(current.id)?.activity).toBe('work');
    expect(sim.getCitizen(current.id)?.position).toEqual(current.position);valid(sim.getState());
  });
  it('publishes restored and removed identities through undo/redo events',()=>{
    const sim=new Simulation(npcFixture()),before=sim.getCitySnapshot();
    sim.execute({type:'city.demolish',buildingId:'home'});const after=sim.getCitySnapshot();
    expect(sim.restoreCity(before).events.filter(e=>e.type==='citizen.created').map(e=>e.citizen.id)).toEqual(['npc-1','npc-2']);
    expect(sim.restoreCity(after).events.filter(e=>e.type==='citizen.removed').map(e=>e.citizenId)).toEqual(['npc-1','npc-2']);
    valid(sim.getState());
  });
  it('resumes an in-flight save exactly including routes and fractional clock time',()=>{
    const a=new Simulation(npcFixture({clock:{paused:false}}));workNow(a);a.advance(2334);const saved=serializeWorld(a.getState());
    const b=new Simulation(deserializeWorld(saved));expect(serializeWorld(b.getState())).toBe(saved);expect(b.advance(8766)).toEqual(a.advance(8766));
  });
  it('loading midway through a route-request queue is cache-independent',()=>{
    const a=new Simulation(populationFixture(100));workNow(a);a.step();
    const b=new Simulation(deserializeWorld(serializeWorld(a.getState())));expect(b.step(20)).toEqual(a.step(20));valid(a.getState());
  });
  it('keeps two days of mixed road edits, building moves, history and saves valid',()=>{
    let sim=new Simulation(npcFixture());const original=sim.getCitySnapshot();
    for(let i=0;i<2880;i++) {
      sim.step();
      if(i%300===100)sim.execute({type:'city.edit-roads',add:[],remove:[{x:15,y:5}]});
      if(i%300===200)sim.execute({type:'city.edit-roads',add:[{x:15,y:5}],remove:[]});
      if(i%500===0){const x=sim.getState().plan.buildings.find(b=>b.id==='home')!.position.x;sim.execute({type:'city.move-building',buildingId:'home',position:{x:x===2?6:2,y:6}});}
      if(i%600===0){const current=sim.getCitySnapshot();sim.restoreCity(original);sim.restoreCity(current);}
      if(i%100===0)sim=new Simulation(deserializeWorld(serializeWorld(sim.getState())));
    }
    valid(sim.getState());expect(sim.getPopulationCount()).toBe(2);
  });
  it('keeps schema-1/2 legacy saves compatible and migrates by explicit enabling',()=>{
    const old=createDemoWorldFixture(),raw=JSON.parse(serializeWorld(old));raw.schemaVersion=1;delete raw.budget;delete raw.revision;delete raw.nextBuildingId;
    const restored=deserializeWorld(JSON.stringify(raw));expect(restored.population).toBeUndefined();const sim=new Simulation(restored);sim.enablePopulation({maxCitizens:20});valid(sim.getState());
  });
  it('bounds managed day events while retaining existing legacy large-clock behavior',()=>{
    expect(()=>npcFixture({clock:{minutesPerTick:1441}})).toThrow(/one day/);
    const legacy=createWorld({id:'fast',plan:{id:'p',name:'p',width:1,height:1,buildings:[]},clock:{minutesPerTick:3000}});
    expect(new Simulation(legacy).step().events.filter(e=>e.type==='clock.day-started')).toHaveLength(2);
  });
  it('rejects a saved route that crosses empty tiles or diagonal shortcuts',()=>{
    const sim=new Simulation(npcFixture());workNow(sim);sim.step();const w=sim.getState(),c=w.citizens[0]!;
    for(const route of [[c.position,{x:16.5,y:15.5}],[c.position,{x:c.position.x,y:15.5},{x:20.5,y:15.5}]]) {
      const bad={...w,citizens:[{...c,movement:{...c.movement!,route,nextWaypoint:1}},w.citizens[1]!]};
      expect(()=>deserializeWorld(JSON.stringify(bad))).toThrow();
    }
  });
  it('retains only public contract fields during serialization',()=>{
    const w=npcFixture(),c=w.citizens[0]!;
    const extra={...w,population:{...w.population!,privateData:'omit'},citizens:[{...c,attributes:{...c.attributes!,privateData:'omit'},movement:{...c.movement!,privateData:'omit'}},w.citizens[1]!]};
    expect(serializeWorld(extra)).not.toContain('privateData');
  });
  it.each(['capacity','route','heading','reference','cursor'])('rejects corrupt managed %s snapshots',kind=>{
    const w=cloneWorld(npcFixture()),c=w.citizens[0]!;
    const corrupt:WorldState=kind==='capacity'?{...w,citizens:[...w.citizens,{...c,id:'extra'}]}:
      kind==='cursor'?{...w,population:{...w.population!,nextCitizenId:-1}}:
      {...w,citizens:[{...c,movement:{...c.movement!,...(kind==='heading'?{heading:{x:1,y:1}}:kind==='reference'?{destinationBuildingId:'absent'}:{route:[{x:-1,y:0}]})}},w.citizens[1]!]};
    expect(()=>deserializeWorld(JSON.stringify(corrupt))).toThrow();
  });
  it.each([100,1000])('updates %s citizens with bounded route requests and valid population',count=>{
    const sim=new Simulation(populationFixture(count));workNow(sim);sim.step();
    expect(sim.getNavigator().getStats().searches).toBeLessThanOrEqual(NPC_LIMITS.routesPerTick);sim.step(100);
    expect(sim.getPopulationCount()).toBe(count);valid(sim.getState());
  });
});
