import type { Building, Citizen, CitizenActivity, WorldState } from '@tiny-city/simulation';
import { tripText } from './transportView';

/** Read-only presentation of authoritative resident data. Never invents attributes. */

export const activityLabels: Record<CitizenActivity, string> = {
  sleep: 'Sleeping', home: 'At home', work: 'Working', leisure: 'Enjoying leisure', idle: 'Idle', travel: 'Travelling',
};

export const activityVerbs: Record<CitizenActivity, string> = {
  sleep: 'Sleep', home: 'Home', work: 'Work', leisure: 'Leisure', idle: 'Idle', travel: 'Travel',
};

export type ActivitySummary = Record<CitizenActivity, number>;

export function summarizeActivities(citizens: readonly Citizen[]): ActivitySummary {
  const summary: ActivitySummary = { sleep: 0, home: 0, work: 0, leisure: 0, idle: 0, travel: 0 };
  for (const citizen of citizens) summary[citizen.activity] += 1;
  return summary;
}

export function formatMinute(minute: number): string {
  const value = ((Math.floor(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export interface ScheduleRow {
  readonly startMinute: number;
  readonly endMinute: number;
  readonly time: string;
  readonly activity: CitizenActivity;
  readonly label: string;
  readonly place: string | null;
  readonly current: boolean;
}

function buildingName(buildings: ReadonlyMap<string, Building>, id: string | null): string | null {
  if (id === null) return null;
  return buildings.get(id)?.name ?? null;
}

export function scheduleRows(citizen: Citizen, world: WorldState, minuteOfDay: number): ScheduleRow[] {
  const buildings = new Map(world.plan.buildings.map((building) => [building.id, building]));
  const entries = citizen.schedule.entries;
  let currentIndex = 0;
  entries.forEach((entry, index) => { if (entry.startMinute <= minuteOfDay) currentIndex = index; });
  return entries.map((entry, index) => ({
    startMinute: entry.startMinute,
    endMinute: entries[index + 1]?.startMinute ?? 1440,
    time: formatMinute(entry.startMinute),
    activity: entry.activity,
    label: activityVerbs[entry.activity],
    place: entry.activity === 'leisure' && entry.targetBuildingId === null ? 'Nearest open park or clubhouse'
      : buildingName(buildings, entry.targetBuildingId),
    current: index === currentIndex,
  }));
}

export interface CitizenDetails {
  readonly home: string;
  readonly workplace: string | null;
  readonly destination: string | null;
  readonly location: string;
  readonly travelStatus: string;
  readonly remainingTiles: number | null;
}

export function describeCitizen(citizen: Citizen, world: WorldState): CitizenDetails {
  const buildings = new Map(world.plan.buildings.map((building) => [building.id, building]));
  const movement = citizen.movement;
  const home = buildingName(buildings, citizen.homeBuildingId) ?? citizen.homeBuildingId;
  const workplace = buildingName(buildings, citizen.workBuildingId);
  const destination = buildingName(buildings, movement?.destinationBuildingId ?? citizen.targetBuildingId);
  let location = 'On the street';
  let travelStatus = 'Not moving';
  let remainingTiles: number | null = null;
  if (movement?.status === 'inside') {
    location = `Inside ${buildingName(buildings, movement.currentBuildingId) ?? 'a building'}`;
    travelStatus = 'Arrived';
  } else if (movement?.status === 'travelling') {
    location = movement.currentBuildingId ? `Leaving ${buildingName(buildings, movement.currentBuildingId) ?? 'a building'}` : 'Walking along the road';
    let tiles = 0;
    let previous = citizen.position;
    for (let index = movement.nextWaypoint; index < movement.route.length; index += 1) {
      const point = movement.route[index]!;
      tiles += Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
      previous = point;
    }
    remainingTiles = Math.round(tiles * 10) / 10;
    travelStatus = destination ? `Heading to ${destination}` : 'Travelling';
  } else if (movement?.status === 'vehicle') {
    // Phase 6: in a car, on a bus or at a stop (the trip says which).
    const text = tripText(world, citizen.id);
    location = text?.startsWith('Waiting at') ? text.split(' for ')[0]!.replace('Waiting at', 'At') : text?.startsWith('On ') ? 'On a bus' : 'In their car';
    travelStatus = text ?? (destination ? `Heading to ${destination}` : 'Travelling');
  } else if (movement?.status === 'waiting') {
    travelStatus = movement.destinationBuildingId && movement.plannedRevision === world.revision
      ? 'Waiting · no connected road to the destination'
      : movement.destinationBuildingId ? 'Waiting for a route' : 'Waiting';
  }
  return { home, workplace, destination, location, travelStatus, remainingTiles };
}

export function residentsWithoutJobs(citizens: readonly Citizen[]): number {
  return citizens.filter((citizen) => citizen.workBuildingId === null).length;
}
