#!/usr/bin/env node
// Phase 5 balance table: node scripts/p5_balance.mjs (build the packages first). Ten days of the real simulation for the
// reference cities in docs/phase-5-economy/balancing.md (the same layouts as packages/simulation/tests/economyFixture.ts).
import { BUILDING_CATALOG, Simulation, createWorld, operatingNet } from '../packages/simulation/dist/index.js';
const ORDER = ['apartment','townhouse','duplex','villa','office','mall','park','pool','clubhouse'], STREETS=[7,20,33,46,59];
function city(spec, policy) {
  const roads=[]; for (const y of STREETS) for (let x=2;x<=62;x++) roads.push({x,y});
  for (let y=7;y<=59;y++) if(!STREETS.includes(y)) roads.push({x:1,y});
  const buildings=[], queue=ORDER.flatMap(t=>Array.from({length:spec[t]??0},()=>t)); const sides=STREETS.flatMap(y=>[{y,north:true},{y,north:false}]);
  let slot=0,cursor=3;
  for (const type of queue){const def=BUILDING_CATALOG[type]; if(cursor+def.footprint.width>62){slot++;cursor=3;} const s=sides[slot];
    buildings.push({id:`b-${String(buildings.length).padStart(3,'0')}`,name:`${def.label} ${buildings.length}`,type,kind:def.kind,capacity:def.capacity,footprint:def.footprint,position:{x:cursor,y:s.north?s.y-def.footprint.height:s.y+1}}); cursor+=def.footprint.width+1;}
  return createWorld({id:'economy-world',seed:'economy',startingFunds:20000,clock:{paused:true},population:{maxCitizens:1000},economy:policy?{policy}:{},plan:{id:'p',name:'E',width:64,height:64,blockedTiles:[],roads,buildings}});
}
const S={ 'A small residential':{villa:10,park:1}, 'B growing balanced':{apartment:3,villa:6,office:1,mall:1,park:1}, 'C commercial heavy':{apartment:2,mall:3,office:2},
 'D high maintenance':{apartment:2,office:1,pool:4,clubhouse:3,park:4}, 'E unemployed residential':{apartment:6,villa:4,park:1}, 'F mature mixed':{apartment:10,villa:8,office:4,mall:2,park:3,pool:1,clubhouse:1}};
const runs = [...Object.entries(S).map(([k,v])=>[k,v,null]), ['F at 20%/20% taxes', S['F mature mixed'], {residentialTaxRate:20,commercialTaxRate:20}], ['F at 14% commercial', S['F mature mixed'], {residentialTaxRate:10,commercialTaxRate:14}]];
console.log('| City | Residents | Employed / jobs | Income | Expenses | Net per day | Treasury after 10 days | Businesses profitable | Notes |');
for (const [name,spec,policy] of runs){ const sim=new Simulation(city(spec,policy)); for(let i=0;i<10;i++) sim.step(1440);
  const e=sim.getState().economy, r=e.history.at(-1), n=operatingNet(r);
  console.log(`| ${name} | ${r.population} | ${r.employed} / ${r.jobs} | $${n.income} (res ${r.income.residentialTax}, com ${r.income.commercialTax}, fees ${r.income.venueFees}) | $${n.expenses} (services ${r.expenses.publicServices}, roads ${r.expenses.roads}, amenities ${r.expenses.amenities}, support ${r.expenses.unemploymentSupport}) | ${n.net>=0?'+':'−'}$${Math.abs(n.net)} | $${r.treasuryClose} | ${r.profitableBusinesses}/${r.businesses} | confidence ${r.confidence}%, local shopping ${r.shoppingLocal}/${r.shoppingDemand}, savings/resident $${Math.round(r.residentSavings/Math.max(1,r.population))} |`);
}
