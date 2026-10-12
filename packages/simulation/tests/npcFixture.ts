import { BUILDING_CATALOG, createWorld } from '../src/index.js';
import type { Building, BuildingType, ClockOptions, PopulationOptions, WorldState } from '../src/index.js';

export function npcBuilding(id: string, type: BuildingType, x: number, y: number): Building {
  const b=BUILDING_CATALOG[type];
  return {id,name:id,type,kind:b.kind,capacity:b.capacity,position:{x,y},footprint:b.footprint};
}
export function npcFixture(options: {clock?:ClockOptions; population?:PopulationOptions; buildings?:readonly Building[]; disconnected?:boolean; seed?:number|string}={}):WorldState {
  return createWorld({id:'npc-world', seed:options.seed??'residents',startingFunds:10000,
    population:options.population??{maxCitizens:1000},clock:options.clock??{paused:true},
    plan:{id:'npc-plan',name:'Living neighborhood',width:32,height:20,blockedTiles:[],
      roads:Array.from({length:25},(_,i)=>({x:i+2,y:5})).filter(p=>!options.disconnected||p.x!==15),
      buildings:options.buildings??[npcBuilding('home','villa',2,6),npcBuilding('office','office',20,6),npcBuilding('park','park',10,6)]}});
}
export function populationFixture(count:number):WorldState {
  const houses=Math.ceil(count/24),offices=Math.ceil(count/60),width=Math.max(houses,offices)*6+6;
  const roads=[...Array.from({length:width-2},(_,i)=>({x:i+1,y:4})),
    ...Array.from({length:width-2},(_,i)=>({x:i+1,y:14})),
    ...Array.from({length:9},(_,i)=>({x:1,y:i+5}))];
  return createWorld({id:'benchmark',seed:123,startingFunds:100000,population:{maxCitizens:count},clock:{paused:true},
    plan:{id:'benchmark-plan',name:'Population benchmark',width,height:22,roads,blockedTiles:[],buildings:[
      ...Array.from({length:houses},(_,i)=>npcBuilding(`home-${i.toString().padStart(3,'0')}`,'apartment',i*6+2,5)),
      ...Array.from({length:offices},(_,i)=>npcBuilding(`office-${i.toString().padStart(3,'0')}`,'office',i*6+2,15))]}});
}
