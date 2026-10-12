import { getGameTime, RoadGraph } from '@tiny-city/simulation';
import type { CityPlan, SimulationEvent, WorldState } from '@tiny-city/simulation';
import { formatMinute } from './citizenView';

/**
 * Folds authoritative simulation events into a short, de-duplicated "city life" feed.
 * Repeated departures inside the same game hour merge into one counted entry instead of flooding the UI.
 */

export type LifeFeedKind = 'commute' | 'return' | 'leisure' | 'arrived-home' | 'population' | 'blocked' | 'jobs';

export interface LifeFeedEntry {
  readonly id: number;
  readonly kind: LifeFeedKind;
  readonly bucket: string;
  readonly time: string;
  readonly count: number;
  readonly text: string;
}

export interface LifeFeedState {
  readonly entries: readonly LifeFeedEntry[];
  readonly nextId: number;
  /** Destination building IDs already reported as unreachable at a city revision. */
  readonly blockedKeys: readonly string[];
  readonly lastJoblessCount: number | null;
}

const graphs = new WeakMap<CityPlan, RoadGraph>();
function roadAccess(plan: CityPlan, buildingId: string | null): boolean {
  const building = buildingId === null ? undefined : plan.buildings.find((entry) => entry.id === buildingId);
  if (!building) return false;
  let graph = graphs.get(plan);
  if (!graph) { graph = new RoadGraph(plan.roads); graphs.set(plan, graph); }
  return graph.getAdjacentComponents(building).length > 0;
}

export const emptyLifeFeed: LifeFeedState = { entries: [], nextId: 1, blockedKeys: [], lastJoblessCount: null };
const MAX_ENTRIES = 8;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function describe(kind: LifeFeedKind, count: number, detail: string): string {
  switch (kind) {
    case 'commute': return `${plural(count, 'resident', 'residents')} headed to work`;
    case 'return': return `${plural(count, 'resident', 'residents')} walking home`;
    case 'leisure': return `${plural(count, 'resident', 'residents')} out for leisure`;
    case 'arrived-home': return `${plural(count, 'resident', 'residents')} arrived home`;
    case 'population': return detail;
    case 'blocked': return detail;
    case 'jobs': return detail;
  }
}

export function reduceLifeFeed(state: LifeFeedState, events: readonly SimulationEvent[], world: WorldState): LifeFeedState {
  if (!world.population || events.length === 0) return state;
  const time = getGameTime(world.clock);
  const hourBucket = `${time.day}:${Math.floor(time.minuteOfDay / 60)}`;
  const clock = formatMinute(time.minuteOfDay);
  const citizens = new Map(world.citizens.map((citizen) => [citizen.id, citizen]));
  const buildings = new Map(world.plan.buildings.map((building) => [building.id, building]));
  const counts = new Map<LifeFeedKind, number>();
  const unique: { kind: LifeFeedKind; text: string; key?: string }[] = [];
  let blockedKeys = state.blockedKeys;
  let lastJoblessCount = state.lastJoblessCount;
  let populationChanged = false;

  for (const event of events) {
    if (event.type === 'citizen.activity-changed' && event.activity === 'travel') {
      const arrival = citizens.get(event.citizenId)?.movement?.arrivalActivity;
      const kind: LifeFeedKind | null = arrival === 'work' ? 'commute' : arrival === 'leisure' ? 'leisure'
        : arrival === 'home' || arrival === 'sleep' ? 'return' : null;
      if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    } else if (event.type === 'citizen.arrived') {
      const citizen = citizens.get(event.citizenId);
      if (citizen?.homeBuildingId === event.buildingId) counts.set('arrived-home', (counts.get('arrived-home') ?? 0) + 1);
    } else if (event.type === 'population.changed') {
      populationChanged = true;
      unique.push({ kind: 'population', text: `Population is now ${plural(event.count, 'resident', 'residents')}` });
    } else if (event.type === 'citizen.route-blocked') {
      // Name the side that is actually cut off: the destination, or where the resident is now.
      const citizen = citizens.get(event.citizenId);
      const originId = citizen?.movement?.currentBuildingId ?? null;
      const destinationLinked = roadAccess(world.plan, event.destinationBuildingId);
      const key = destinationLinked ? `${originId ?? 'street'}>${event.destinationBuildingId}@${world.revision}` : `${event.destinationBuildingId}@${world.revision}`;
      if (!blockedKeys.includes(key)) {
        blockedKeys = [...blockedKeys.slice(-31), key];
        const name = buildings.get(event.destinationBuildingId)?.name ?? 'a destination';
        const origin = originId === null ? null : buildings.get(originId)?.name ?? null;
        const text = !destinationLinked ? `${name} has no road connection. Residents heading there are waiting.`
          : origin ? `${origin} isn't linked to ${name} by road. Its residents are waiting.`
          : `A resident can't find a road to ${name} and is waiting.`;
        unique.push({ kind: 'blocked', text, key });
      }
    }
  }
  if (populationChanged || lastJoblessCount === null) {
    const jobless = world.citizens.filter((citizen) => citizen.workBuildingId === null).length;
    if (jobless !== lastJoblessCount && jobless > 0) {
      unique.push({ kind: 'jobs', text: `${plural(jobless, 'resident is', 'residents are')} looking for work. Build an office or mall.` });
    }
    lastJoblessCount = jobless;
  }

  if (counts.size === 0 && unique.length === 0) {
    return blockedKeys === state.blockedKeys && lastJoblessCount === state.lastJoblessCount ? state
      : { ...state, blockedKeys, lastJoblessCount };
  }

  let entries = [...state.entries];
  let nextId = state.nextId;
  for (const [kind, count] of counts) {
    const index = entries.findIndex((entry) => entry.kind === kind && entry.bucket === hourBucket);
    if (index >= 0) {
      const existing = entries[index]!;
      const merged = existing.count + count;
      entries.splice(index, 1);
      entries.unshift({ ...existing, count: merged, time: existing.time, text: describe(kind, merged, '') });
    } else {
      entries.unshift({ id: nextId++, kind, bucket: hourBucket, time: clock, count, text: describe(kind, count, '') });
    }
  }
  for (const item of unique) {
    entries = entries.filter((entry) => !(item.kind === 'population' && entry.kind === 'population') && !(item.kind === 'jobs' && entry.kind === 'jobs'));
    entries.unshift({ id: nextId++, kind: item.kind, bucket: item.key ?? hourBucket, time: clock, count: 1, text: item.text });
  }
  return { entries: entries.slice(0, MAX_ENTRIES), nextId, blockedKeys, lastJoblessCount };
}
