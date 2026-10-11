import { performance } from 'node:perf_hooks';
import { BUILDING_CATALOG, createWorld, Simulation, validateWorld } from '../packages/simulation/dist/index.js';

const fixture = count => {
  const houses=Math.ceil(count/24),jobs=Math.ceil(count/60),width=Math.max(houses,jobs)*6+6;
  const building=(id,type,x,y)=>{const b=BUILDING_CATALOG[type];return{id,name:id,type,kind:b.kind,capacity:b.capacity,position:{x,y},footprint:b.footprint};};
  return createWorld({id:'bench',seed:123,startingFunds:100000,population:{maxCitizens:count},clock:{paused:true},
    plan:{id:'bench-plan',name:'Bench',width,height:22,blockedTiles:[],roads:[
      ...Array.from({length:width-2},(_,i)=>({x:i+1,y:4})),...Array.from({length:width-2},(_,i)=>({x:i+1,y:14})),...Array.from({length:9},(_,i)=>({x:1,y:i+5}))],
      buildings:[...Array.from({length:houses},(_,i)=>building(`home-${String(i).padStart(3,'0')}`,'apartment',i*6+2,5)),...Array.from({length:jobs},(_,i)=>building(`job-${String(i).padStart(3,'0')}`,'office',i*6+2,15))]}});
};
const measurements=[];
for(const count of [100,1000,3000]) {
  const initialStart=performance.now(),sim=new Simulation(fixture(count)),initializationMs=performance.now()-initialStart;
  for(const c of sim.getState().citizens)sim.enqueue({type:'citizen.set-schedule',citizenId:c.id,schedule:{entries:[{startMinute:0,activity:'work',targetBuildingId:c.workBuildingId}]}});
  const firstStart=performance.now();sim.step();const firstTickMs=performance.now()-firstStart;
  const times=[];for(let i=0;i<200;i++){const start=performance.now();sim.step();times.push(performance.now()-start);}
  validateWorld(sim.getState());const sorted=[...times].sort((a,b)=>a-b),round=v=>Math.round(v*1000)/1000;
  measurements.push({count,initializationMs:round(initializationMs),firstTickMs:round(firstTickMs),ticks:200,
    meanTickMs:round(times.reduce((a,b)=>a+b,0)/times.length),p95TickMs:round(sorted[Math.floor(sorted.length*.95)]),maxTickMs:round(sorted.at(-1)),
    travellers:sim.getState().citizens.filter(c=>c.activity==='travel').length,navigation:sim.getNavigator().getStats()});
}
console.log(JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,measurements},null,2));
