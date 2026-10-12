import type { ClockOptions } from './clock.js';
import { createRandomState, nextRandom } from './random.js';
import type { CityPlan, Citizen, DailySchedule, WorldState } from './types.js';
import { createWorld, freeze } from './world.js';
import { BUILDING_CATALOG } from './catalog.js';

export const EXAMPLE_CITY_PLAN: CityPlan = freeze({
  id: 'phase-0-plan', name: 'Tiny Meadow', width: 24, height: 18,
  roads: [], blockedTiles: [],
  buildings: [
    { id: 'home-maple', name: 'Maple House', kind: 'home', position: { x: 2, y: 2 }, footprint: { width: 2, height: 2 }, capacity: 2 },
    { id: 'home-willow', name: 'Willow House', kind: 'home', position: { x: 6, y: 2 }, footprint: { width: 2, height: 2 }, capacity: 2 },
    { id: 'home-cedar', name: 'Cedar House', kind: 'home', position: { x: 10, y: 2 }, footprint: { width: 2, height: 2 }, capacity: 2 },
    { id: 'workshop', name: 'Workshop', kind: 'workplace', position: { x: 3, y: 9 }, footprint: { width: 3, height: 3 }, capacity: 4 },
    { id: 'market', name: 'Market', kind: 'workplace', position: { x: 10, y: 9 }, footprint: { width: 3, height: 2 }, capacity: 4 },
    { id: 'park', name: 'Meadow Park', kind: 'park', position: { x: 17, y: 5 }, footprint: { width: 4, height: 5 }, capacity: 20 },
  ],
});

function schedule(home: string, work: string | null): DailySchedule {
  return { entries: [
    { startMinute: 0, activity: 'sleep', targetBuildingId: home },
    { startMinute: 360, activity: 'home', targetBuildingId: home },
    { startMinute: 480, activity: work ? 'work' : 'home', targetBuildingId: work ?? home },
    { startMinute: 720, activity: 'leisure', targetBuildingId: 'park' },
    { startMinute: 780, activity: work ? 'work' : 'home', targetBuildingId: work ?? home },
    { startMinute: 1020, activity: 'leisure', targetBuildingId: 'park' },
    { startMinute: 1200, activity: 'home', targetBuildingId: home },
    { startMinute: 1320, activity: 'sleep', targetBuildingId: home },
  ] };
}

export function createEmptyWorldFixture(options: { readonly clock?: ClockOptions } = {}): WorldState {
  return createWorld({
    id: 'empty-world', seed: 'tiny-city-empty',
    plan: { id: 'empty-plan', name: 'Empty City', width: 24, height: 18, buildings: [] },
    ...options,
  });
}

/** Fresh snapshot per call, stable IDs, seed-dependent citizen spawn offsets. */
export function createDemoWorldFixture(options: {
  readonly seed?: number | string;
  readonly clock?: ClockOptions;
} = {}): WorldState {
  const seed = options.seed ?? 'tiny-city-phase-0';
  let randomState = createRandomState(seed);
  const residents = [
    { name: 'Linh', home: 'home-maple', work: 'workshop' },
    { name: 'Minh', home: 'home-maple', work: 'market' },
    { name: 'An', home: 'home-willow', work: 'workshop' },
    { name: 'Mai', home: 'home-cedar', work: null },
  ];
  const citizens: Citizen[] = residents.map((resident, index) => {
    const home = EXAMPLE_CITY_PLAN.buildings.find((building) => building.id === resident.home)!;
    const x = nextRandom(randomState);
    const y = nextRandom(x.state);
    randomState = y.state;
    return {
      id: `citizen-${index + 1}`, name: resident.name,
      homeBuildingId: resident.home, workBuildingId: resident.work,
      position: { x: home.position.x + 0.2 + x.value * 0.6, y: home.position.y + 0.2 + y.value * 0.6 },
      activity: 'sleep', targetBuildingId: resident.home,
      schedule: schedule(resident.home, resident.work),
    };
  });
  const world = createWorld({ id: 'demo-world', plan: EXAMPLE_CITY_PLAN, citizens, seed,
    ...(options.clock === undefined ? {} : { clock: options.clock }) });
  return freeze({ ...world, randomState });
}

/** Connected Phase 3A integration fixture; no visuals or wall-clock fields. */
export function createLivingWorldFixture(options: {
  readonly seed?: number | string; readonly clock?: ClockOptions; readonly maxCitizens?: number;
} = {}): WorldState {
  const sites = [['home-villa','villa',12,21],['home-duplex','duplex',16,21],
    ['home-apartment','apartment',20,21],['park','park',26,21],['office','office',35,21]] as const;
  return createWorld({id:'living-world',seed:options.seed??'living-city',population:{maxCitizens:options.maxCitizens??1000},
    clock:options.clock??{paused:true},startingFunds:5000,plan:{id:'living-plan',name:'Living City',width:64,height:64,
      roads:Array.from({length:41},(_,i)=>({x:i+8,y:20})),blockedTiles:[],
      buildings:sites.map(([id,type,x,y])=>{const b=BUILDING_CATALOG[type];return {id,name:b.label,type,kind:b.kind,capacity:b.capacity,footprint:b.footprint,position:{x,y}};})}});
}
