import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as sim from '../packages/simulation/dist/index.js';
import * as ai from '../packages/ai-architect/dist/index.js';

// Only the backend loads credentials. This separately invoked check uses HTTP
// and isolated simulation worlds; it never touches a user's game or save.
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8000');
if(base.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname!=='/') {
  console.log(JSON.stringify({result:'FAIL',code:'INVALID_LOCAL_BACKEND_URL'}));process.exit(1);
}
const fixture = JSON.parse(await readFile(new URL('../docs/ai-architect/examples/plan-request.json',import.meta.url), 'utf8'));
const setup = new sim.Simulation(fixture.world);
assert.equal(setup.execute({type:'city.build',buildingType:'villa',position:{x:30,y:21}}).applied, true);
const source = setup.getState();
const expected = {villa:2,park:1};
const prompts = {
  vi: 'Xây đúng 2 biệt thự và 1 công viên. Ưu tiên hai biệt thự lần lượt tại ô (10,10) và (14,10), công viên tại ô (10,14). Nối các biệt thự với mạng đường hiện có. Tổng ngân sách xây dựng kể cả đường mới không quá 500. Giữ nguyên mọi công trình và đường hiện có; không phá dỡ, không di chuyển, không giảm số lượng.',
  en: 'Build exactly 2 villas and 1 park. Prefer the villas at tiles (10,10) and (14,10), and the park at tile (10,14). Connect the villas to the existing road network. Limit total construction spending including new roads to 500. Preserve all existing buildings and roads; no demolition, moves, or partial quantities.',
};
async function post(path, body) {
  const started = performance.now();
  const res = await fetch(new URL(path,base), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(75000)});
  const result = await res.json();
  return {httpStatus:res.status,elapsedMs:Math.round(performance.now()-started),result};
}
const report = {model:process.argv[3],executedAt:new Date().toISOString(),results:[]};
try {
for(const language of ['vi','en']) {
  const request = {contractVersion:1,prompt:prompts[language],world:source,sourceRevision:source.revision,seed:7,constraints:{allowPartial:false,allowDestructive:false,preserveBuildingIds:source.plan.buildings.map(b=>b.id),budgetLimit:500}};
  const response = await post('/v1/city/plan',request);
  if(response.httpStatus!==200){const result={language,result:'FAIL',httpStatus:response.httpStatus,elapsedMs:response.elapsedMs,code:response.result.error?.code,requestId:response.result.requestId};report.results.push(result);continue;}
  try {
    const p=response.result.proposal;
    assert.equal(p.intent.language,language);
    assert.equal(p.status,'VALIDATED');assert.equal(p.validation.valid,true);assert.equal(p.validation.fulfilled,true);
    const quantities={};for(const b of p.intent.builds)quantities[b.buildingType]=(quantities[b.buildingType]??0)+b.quantity;
    assert.deepEqual(quantities,expected);assert.equal(p.placements.length,3);
    assert.deepEqual(p.intent.builds.filter(b=>b.buildingType==='villa').map(b=>b.preferredPosition),[{x:10,y:10},{x:14,y:10}]);
    assert.equal(p.intent.budgetLimit,500);assert.equal(p.intent.connectRoads,true);
    assert.equal(p.roads.remove.length,0);assert.ok(p.roads.add.length>0);
    assert.ok(p.commands.some(c=>c.type==='city.edit-roads'));assert.equal(p.commands.filter(c=>c.type==='city.build').length,3);
    assert.ok(p.commands.every(c=>['city.build','city.edit-roads'].includes(c.type)));
    const cost = p.placements.reduce((sum,b)=>sum+sim.BUILDING_CATALOG[b.buildingType].cost,0)+p.roads.add.length*sim.CONSTRUCTION_COSTS.road;
    assert.equal(p.estimatedCost,cost);assert.ok(cost<=500);assert.equal(p.projectedBudget,source.budget.balance-cost);
    const live = new sim.Simulation(source);const before=sim.serializeWorld(live.getState());
    const review=new ai.PlanReview(live,p);await review.preview();assert.equal(sim.serializeWorld(live.getState()),before);
    await assert.rejects(()=>review.apply(),{code:'APPROVAL_REQUIRED'});assert.equal(sim.serializeWorld(live.getState()),before);
    review.approve(p.planId);assert.equal(sim.serializeWorld(live.getState()),before);
    const applied=await review.apply();assert.equal(applied.applied,true);assert.deepEqual(applied.state.plan,p.projectedPlan);
    assert.equal(applied.state.plan.buildings.length,source.plan.buildings.length+3);
    assert.equal(applied.state.budget.balance,p.projectedBudget);
    assert.equal(applied.events.filter(e=>e.type==='city.building-built').length,3);
    const graph = new sim.RoadGraph(applied.state.plan.roads);assert.equal(graph.getComponents().length,1);
    for(const b of applied.state.plan.buildings)if(sim.BUILDING_CATALOG[b.type].requiresRoad)assert.ok(graph.getAdjacentComponents(b).length>0);
    const occupancy=new sim.OccupancyGrid(applied.state.plan);for(const b of applied.state.plan.buildings)assert.equal(occupancy.get(b.position)?.buildingId,b.id);
    assert.deepEqual(applied.state.plan.buildings.find(b=>b.id===source.plan.buildings[0].id),source.plan.buildings[0]);
    for(const tile of source.plan.roads)assert.ok(applied.state.plan.roads.some(r=>r.x===tile.x&&r.y===tile.y));
    const after=sim.serializeWorld(live.getState());await assert.rejects(()=>review.apply(),{code:'ALREADY_APPLIED'});assert.equal(sim.serializeWorld(live.getState()),after);
    const rejected=new sim.Simulation(source);const rejectedBefore=sim.serializeWorld(rejected.getState());
    const batch=rejected.executeBatch([...p.commands,{type:'city.build',buildingType:'villa',position:{x:-1,y:-1}}]);
    assert.equal(batch.applied,false);assert.equal(sim.serializeWorld(rejected.getState()),rejectedBefore);
    const budget=await post('/v1/city/plan/validate',{contractVersion:1,world:source,sourceRevision:source.revision,seed:7,intent:p.intent,constraints:{...request.constraints,budgetLimit:100}});
    assert.equal(budget.httpStatus,200);assert.equal(budget.result.proposal.status,'REJECTED');assert.deepEqual(budget.result.proposal.commands,[]);
    const stale=new sim.Simulation(source);stale.execute({type:'city.edit-roads',add:[{x:0,y:0}],remove:[]});const staleBefore=sim.serializeWorld(stale.getState());
    await assert.rejects(()=>new ai.PlanReview(stale,p).preview(),{code:'STALE_WORLD'});assert.equal(sim.serializeWorld(stale.getState()),staleBefore);
    const result={language,result:'PASS',httpStatus:response.httpStatus,elapsedMs:response.elapsedMs,requestId:response.result.requestId,planId:p.planId,quantities,roadTilesAdded:p.roads.add.length,commands:p.commands.length,estimatedCost:p.estimatedCost,openingBudget:source.budget.balance,projectedBudget:p.projectedBudget,roadComponents:graph.getComponents().length,warnings:p.warnings.map(w=>w.code),previewMutation:false,approvalRequired:true,atomicApplication:true,failedBatchRollback:true,lowBudgetRejected:true,staleRejected:true,replayRejected:true};
    report.results.push(result);
  } catch { report.results.push({language,result:'FAIL',httpStatus:response.httpStatus,code:'ACCEPTANCE_CHECK_FAILED',requestId:response.result.requestId}); }
}
} catch { report.results.push({result:'FAIL',code:'BACKEND_UNAVAILABLE_OR_TIMEOUT'}); }
console.log(JSON.stringify(report));
process.exitCode=report.results.length===2 && report.results.every(r=>r.result==='PASS')?0:1;
