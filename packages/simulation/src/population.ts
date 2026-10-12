import { randomInteger } from './random.js';
import { buildingCenter, containsPosition, NPC_LIMITS } from './navigation.js';
import type { Building, Citizen, CitizenAttributes, CitizenMovement, DailySchedule, PopulationOptions, SimulationEvent, WorldState } from './types.js';

export const providesJobs = (b: Building): boolean => b.kind === 'workplace' && b.type !== 'clubhouse';
export const providesLeisure = (b: Building): boolean => b.kind === 'park' || b.type === 'clubhouse';
const byId = (a: Building, b: Building) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const names = ['Linh', 'Minh', 'An', 'Mai', 'Hoa', 'Nam', 'Alex', 'Sam', 'Kim', 'Robin'];
export const insideMovement = (id: string, revision: number, activity: Citizen['activity'] = 'home'): CitizenMovement => ({
  status: 'inside', heading: { x: 0, y: 0 }, currentBuildingId: id, destinationBuildingId: id,
  arrivalActivity: activity, route: [], nextWaypoint: 0, plannedRevision: revision,
});
export function createDailyRoutine(home: string, work: string | null, offset: number): DailySchedule {
  return { entries: [
    { startMinute: 0, activity: 'sleep', targetBuildingId: home },
    { startMinute: 360 + offset, activity: 'home', targetBuildingId: home },
    { startMinute: 420 + offset, activity: work ? 'work' : 'home', targetBuildingId: work ?? home },
    { startMinute: 1020 + offset, activity: 'leisure', targetBuildingId: null },
    { startMinute: 1140 + offset, activity: 'home', targetBuildingId: home },
    { startMinute: 1380 + offset, activity: 'sleep', targetBuildingId: home },
  ] };
}

/** Pure city-side population reconciliation. Speculative edits never mutate live RNG/IDs. */
export function reconcilePopulation(world: WorldState, previous?: WorldState): { state: WorldState; events: SimulationEvent[] } {
  if (!world.population) return { state: world, events: [] };
  const buildings = new Map(world.plan.buildings.map(b => [b.id, b]));
  const previousCitizens = new Map((previous?.citizens ?? world.citizens).map(c => [c.id,c]));
  const previousBuildings = new Map(previous?.plan.buildings.map(b => [b.id,b]) ?? []);
  const homes = world.plan.buildings.filter(b => b.kind === 'home').sort(byId);
  const jobs = world.plan.buildings.filter(providesJobs).sort(byId);
  // The Phase 4 player occupies one slot in their home; residents never fill it and are never evicted for it.
  const playerHome = world.player?.homeBuildingId ?? null;
  const housing = (b: Building) => b.capacity - (b.id === playerHome ? 1 : 0);
  const homeCounts = new Map<string, number>(), jobCounts = new Map<string, number>();
  const events: SimulationEvent[] = [], tick = world.clock.tick;
  let randomState = world.randomState, cursor = world.population.nextCitizenId;
  const draw = (min: number, max: number) => { const r = randomInteger(randomState, min, max); randomState = r.state; return r.value; };
  const attributes = (): CitizenAttributes => ({ age: draw(18, 75), walkingSpeed: draw(4, 8) / 20, scheduleOffset: draw(-20, 20) });
  const reserve = (counts: Map<string, number>, id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const validHomes = new Map<string, string>();
  for (const c of world.citizens.slice(0, world.population.maxCitizens)) {
    const home = buildings.get(c.homeBuildingId);
    if (home?.kind === 'home' && (homeCounts.get(home.id) ?? 0) < housing(home)) { reserve(homeCounts, home.id); validHomes.set(c.id, home.id); }
  }
  const housed: Citizen[] = [];
  for (const [index, c] of world.citizens.entries()) {
    let homeId = validHomes.get(c.id);
    if (index < world.population.maxCitizens && !homeId) {
      const available = homes.find(b => (homeCounts.get(b.id) ?? 0) < housing(b));
      if (available) { homeId = available.id; reserve(homeCounts, homeId); }
    }
    if (!homeId) { events.push({ type: 'citizen.removed', tick, citizenId: c.id, reason: index >= world.population.maxCitizens ? 'population-limit' : 'housing-lost' }); continue; }
    housed.push({ ...c, homeBuildingId: homeId });
  }
  // Reserve still-valid jobs before assigning vacancies, so a new resident cannot steal one.
  const validJobs = new Map<string, string>();
  for (const c of housed) {
    const job = c.workBuildingId === null ? undefined : buildings.get(c.workBuildingId);
    if (job && providesJobs(job) && (jobCounts.get(job.id) ?? 0) < job.capacity) { reserve(jobCounts, job.id); validJobs.set(c.id, job.id); }
  }
  const assign = (c: Citizen, isNew = false): Citizen => {
    let work = validJobs.get(c.id) ?? null;
    if (!work) { const job = jobs.find(b => (jobCounts.get(b.id) ?? 0) < b.capacity); if (job) { work = job.id; reserve(jobCounts, work); } }
    const home = buildings.get(c.homeBuildingId)!;
    const old = previousCitizens.get(c.id) ?? c;
    const attrs = c.attributes ?? attributes();
    const mode = c.scheduleMode ?? (isNew ? 'generated' : 'custom');
    const schedule = mode === 'generated' ? createDailyRoutine(home.id, work, attrs.scheduleOffset) : {
      entries: c.schedule.entries.map(e => ({ ...e, targetBuildingId: e.activity === 'sleep' || e.activity === 'home' ? home.id :
        e.activity === 'work' ? work : e.targetBuildingId !== null && buildings.has(e.targetBuildingId) ? e.targetBuildingId : null })),
    };
    let position = c.position, movement = c.movement ?? insideMovement(home.id, world.revision, c.activity);
    const interior = movement.currentBuildingId === null ? undefined : buildings.get(movement.currentBuildingId);
    const oldInterior = movement.currentBuildingId === null ? undefined : previousBuildings.get(movement.currentBuildingId);
    const homeChanged = old.homeBuildingId !== home.id;
    const recoverHome = !c.movement || homeChanged && movement.currentBuildingId === old.homeBuildingId || !interior && movement.status === 'inside';
    if (recoverHome) { position = buildingCenter(home); movement = insideMovement(home.id, world.revision, c.activity === 'sleep' ? 'sleep' : 'home'); }
    else if (interior && oldInterior && containsPosition(oldInterior, position) &&
      (oldInterior.position.x !== interior.position.x || oldInterior.position.y !== interior.position.y)) {
      const activity = c.activity === 'travel' ? interior.id === home.id ? 'home' : interior.id === work ? 'work' : 'leisure' : c.activity;
      position = buildingCenter(interior); movement = insideMovement(interior.id, world.revision, activity);
    } else if (previous && previous.plan !== world.plan) {
      const current = interior && containsPosition(interior, position) ? interior.id : null;
      movement = { ...movement, currentBuildingId: current, destinationBuildingId: movement.destinationBuildingId !== null && buildings.has(movement.destinationBuildingId) ? movement.destinationBuildingId : null,
        route: [], nextWaypoint: 0, plannedRevision: -1, status: current ? 'inside' : 'waiting', heading: { x: 0, y: 0 } };
    }
    const target = c.targetBuildingId !== null && buildings.has(c.targetBuildingId) ? c.targetBuildingId : null;
    const result: Citizen = { ...c, workBuildingId: work, attributes: attrs, scheduleMode: mode, schedule, position, movement,
      targetBuildingId: recoverHome ? home.id : target, activity: recoverHome ? movement.arrivalActivity : movement.status === 'waiting' ? 'idle' : c.activity === 'travel' && movement.status === 'inside' ? movement.arrivalActivity : c.activity };
    if (!isNew && (old.homeBuildingId !== home.id || old.workBuildingId !== work)) events.push({ type: 'citizen.assignment-changed', tick, citizenId: c.id, homeBuildingId: home.id, workBuildingId: work });
    return result;
  };
  const citizens = housed.map(c => assign(c));
  const visitors = new Map<string,number>();
  for (let i=0;i<citizens.length;i++) {
    const c=citizens[i]!,m=c.movement!,b=m.currentBuildingId===null?undefined:buildings.get(m.currentBuildingId);
    if(c.activity==='leisure'&&m.status==='inside'&&b) {
      const count=visitors.get(b.id)??0;
      if(count>=b.capacity) citizens[i]={...c,activity:'idle',movement:{...m,status:'waiting',destinationBuildingId:null,arrivalActivity:'idle',plannedRevision:-1}};
      else visitors.set(b.id,count+1);
    }
  }
  const ids = new Set(world.citizens.map(c => c.id));
  for (const home of homes) {
    while ((homeCounts.get(home.id) ?? 0) < housing(home) && citizens.length < world.population.maxCitizens) {
      while (ids.has(`npc-${cursor}`) && cursor < Number.MAX_SAFE_INTEGER) cursor += 1;
      if (cursor >= Number.MAX_SAFE_INTEGER) throw new RangeError('citizen ID limit reached');
      const id = `npc-${cursor++}`; ids.add(id); reserve(homeCounts, home.id);
      const c = assign({ id, name: `${names[draw(0, names.length - 1)]!} ${id.slice(4)}`, homeBuildingId: home.id,
        workBuildingId: null, position: buildingCenter(home), activity: 'sleep', targetBuildingId: home.id,
        schedule: { entries: [{ startMinute: 0, activity: 'sleep', targetBuildingId: home.id }] } }, true);
      citizens.push(c); events.push({ type: 'citizen.created', tick, citizen: c });
    }
  }
  if (previous) {
    // History can add/remove identities before reconciliation sees the candidate list.
    const remaining = new Set(citizens.map(c => c.id));
    const removed = new Set(events.filter(e => e.type === 'citizen.removed').map(e => e.citizenId));
    const created = new Set(events.filter(e => e.type === 'citizen.created').map(e => e.citizen.id));
    for (const c of previous.citizens) if (!remaining.has(c.id) && !removed.has(c.id))
      events.push({ type: 'citizen.removed', tick, citizenId: c.id, reason: 'housing-lost' });
    for (const c of citizens) if (!previousCitizens.has(c.id) && !created.has(c.id))
      events.push({ type: 'citizen.created', tick, citizen: c });
  }
  if (citizens.length !== (previous?.citizens.length ?? world.citizens.length)) events.push({ type: 'population.changed', tick, count: citizens.length });
  return { state: { ...world, citizens, randomState, population: { ...world.population, nextCitizenId: cursor } }, events };
}

export function initializePopulation(world: WorldState, options: PopulationOptions = {}) {
  if (world.population) return { state: world, events: [] as SimulationEvent[] };
  const maxCitizens = options.maxCitizens ?? 1000;
  if (!Number.isSafeInteger(maxCitizens) || maxCitizens < 0 || maxCitizens > NPC_LIMITS.population) throw new RangeError('invalid population limit');
  const nextCitizenId = world.citizens.reduce((cursor,c) => {
    const match=/^npc-([1-9]\d*)$/.exec(c.id);
    const id=match ? Number(match[1]) : 0;
    if (match && (!Number.isSafeInteger(id) || id >= Number.MAX_SAFE_INTEGER)) throw new RangeError('citizen ID limit reached');
    return Math.max(cursor,id+1);
  },1);
  return reconcilePopulation({ ...world, population: { version: 1, maxCitizens, nextCitizenId } });
}
