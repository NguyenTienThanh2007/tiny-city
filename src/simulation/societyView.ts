import { EVENTS, getGameTime, HOME_VISIT, isBusinessVenue, otherOf, relationshipLevel, relationshipsOf, VENUES, visitorCapacity, WEEKDAYS, weekday } from '@tiny-city/simulation';
import type { Building, CityEvent, CityEventKind, Interest, OutingKind, Personality, ResidentNeeds, WorldState } from '@tiny-city/simulation';
import { formatMinute } from './citizenView';

/** Read-only presentation of the Phase 7 society. Every figure comes from the authoritative world; nothing is invented. */

export const INTEREST_LABELS: Record<Interest, string> = {
  food: 'Food', shopping: 'Shopping', film: 'Films', music: 'Live music', nightlife: 'Nightlife', outdoors: 'The outdoors',
  arts: 'Arts & shows', thrills: 'Thrill rides', fitness: 'Fitness',
};
export const OUTING_LABELS: Record<OutingKind, string> = {
  dine: 'Eating out', shop: 'Shopping', market: 'At the night market', movie: 'At the cinema', club: 'Night out', event: 'At an event',
  rides: 'At the amusement park', park: 'Walk in the park', plaza: 'At the plaza', swim: 'Swimming', lounge: 'At the clubhouse', visit: 'Visiting a friend',
};
const OUTING_VERBS: Record<OutingKind, string> = {
  dine: 'eat out', shop: 'go shopping', market: 'visit the night market', movie: 'see a film', club: 'go out dancing', event: 'go to an event',
  rides: 'go on the rides', park: 'walk in the park', plaza: 'hang out at the plaza', swim: 'go swimming', lounge: 'spend the evening at the clubhouse', visit: 'visit a friend',
};

const TRAITS: readonly { key: keyof Personality; high: string; low: string; label: string }[] = [
  { key: 'sociability', high: 'Outgoing', low: 'Reserved', label: 'Sociable' },
  { key: 'curiosity', high: 'Curious', low: 'Creature of habit', label: 'Curious' },
  { key: 'vitality', high: 'Night owl', low: 'Early to bed', label: 'Energy' },
  { key: 'frugality', high: 'Thrifty', low: 'Free-spending', label: 'Careful with money' },
  { key: 'community', high: 'Community-minded', low: 'Private', label: 'Community' },
];
/** Up to three words for the traits that stand out (≥ 65 or ≤ 35); "Easy-going" when none does. */
export function personalitySummary(traits: Personality): string[] {
  const words = TRAITS.map((t) => ({ word: traits[t.key] >= 65 ? t.high : traits[t.key] <= 35 ? t.low : null, strength: Math.abs(traits[t.key] - 50) }))
    .filter((x): x is { word: string; strength: number } => x.word !== null).sort((a, b) => b.strength - a.strength).slice(0, 3).map((x) => x.word);
  return words.length ? words : ['Easy-going'];
}
export function traitRows(traits: Personality): { label: string; value: number; low: string; high: string }[] {
  return TRAITS.map((t) => ({ label: t.label, value: traits[t.key], low: t.low, high: t.high }));
}

/** Overall wellbeing (the mean of the four needs) and its word. */
export function wellbeing(needs: ResidentNeeds): { value: number; label: string } {
  const value = Math.round((needs.energy + needs.hunger + needs.social + needs.fun) / 4);
  return { value, label: value >= 75 ? 'Thriving' : value >= 55 ? 'Content' : value >= 35 ? 'Unsettled' : 'Struggling' };
}

const nameOf = (world: WorldState, id: string) => world.citizens.find((c) => c.id === id)?.name ?? id;
const buildingName = (world: WorldState, id: string | null) => id === null ? null : world.plan.buildings.find((b) => b.id === id)?.name ?? null;
const minuteOfTick = (world: WorldState, tick: number) => formatMinute(tick * world.clock.minutesPerTick);
export function dayLabel(day: number, today: number): string {
  return day === today ? 'Today' : day === today + 1 ? 'Tomorrow' : WEEKDAYS[weekday(day)]!;
}
export const weekdayName = (day: number) => WEEKDAYS[weekday(day)]!;

/** A decision factor code (from the simulation) as a short phrase. */
export function reasonText(world: WorldState, code: string): string {
  const [kind, value] = code.split(':') as [string, string | undefined];
  switch (kind) {
    case 'hungry': return 'Hungry';
    case 'bored': return 'Wants some fun';
    case 'lonely': return 'Wants company';
    case 'interest': return `Loves ${(INTEREST_LABELS[value as Interest] ?? value ?? '').toLowerCase()}`;
    case 'sociable': return 'Enjoys a crowd';
    case 'quiet': return 'Likes it quiet';
    case 'event': return world.society?.events.find((e) => e.id === value)?.name ?? 'A city event';
    case 'community': return 'Likes community events';
    case 'night-owl': return 'Night owl';
    case 'new-place': return 'Wants to try somewhere new';
    case 'favourite': return 'A favourite spot';
    case 'free': return 'Free to enjoy';
    case 'nearby': return 'Close by';
    case 'friend': return `With ${nameOf(world, value ?? '')}`;
    case 'tired': return 'Too tired to go out';
    case 'been-out': return 'Already been out today';
    case 'saving': return 'Saving money';
    case 'homebody': return 'Happy at home';
    case 'nothing-open': return 'Nothing open or reachable now';
    default: return code;
  }
}

export interface OutingView {
  readonly kind: OutingKind;
  readonly title: string;
  readonly place: string;
  readonly venueId: string;
  readonly companions: readonly { id: string; name: string }[];
  readonly status: 'leaving-later' | 'on-the-way' | 'there';
  readonly timeText: string;
}
export function outingView(world: WorldState, citizenId: string): OutingView | null {
  const o = world.society?.residents[citizenId]?.outing;
  if (!o) return null;
  const event = o.eventId ? world.society!.events.find((e) => e.id === o.eventId) : undefined;
  const place = o.kind === 'visit' ? `${nameOf(world, o.hostId ?? '')}'s home` : buildingName(world, o.venueId) ?? 'a venue';
  const tick = world.clock.tick;
  const status = o.status === 'present' ? 'there' : tick < o.startTick ? 'leaving-later' : 'on-the-way';
  const timeText = status === 'leaving-later' ? `Leaving at ${minuteOfTick(world, o.startTick)}` : status === 'on-the-way' ? `On the way · until ${minuteOfTick(world, o.endTick)}` : `Until ${minuteOfTick(world, o.endTick)}`;
  return { kind: o.kind, title: event ? event.name : OUTING_LABELS[o.kind], place, venueId: o.venueId, status, timeText,
    companions: o.companions.map((id) => ({ id, name: nameOf(world, id) })) };
}

/** Why the resident is doing what they do (the last decision's top factors), as phrases. */
export function choiceView(world: WorldState, citizenId: string): { headline: string; reasons: string[]; options: number } | null {
  const choice = world.society?.residents[citizenId]?.lastChoice;
  if (!choice) return null;
  const reasons = choice.reasons.map((code) => reasonText(world, code));
  if (choice.kind === 'stay-home') return { headline: 'Decided to stay in', reasons, options: choice.options };
  const place = choice.kind === 'visit' ? 'a friend' : buildingName(world, choice.venueId) ?? 'somewhere';
  return { headline: `Chose to ${OUTING_VERBS[choice.kind]}${choice.kind === 'visit' ? '' : ` at ${place}`}`, reasons, options: choice.options };
}

export interface FriendView { readonly id: string; readonly name: string; readonly level: string; readonly strength: number }
export function friendsOf(world: WorldState, citizenId: string): FriendView[] {
  const list = relationshipsOf(world.society?.relationships ?? []).get(citizenId) ?? [];
  const levels = { 'close-friend': 'Close friend', friend: 'Friend', acquaintance: 'Acquaintance' } as const;
  return list.map((r) => ({ id: otherOf(r, citizenId), name: nameOf(world, otherOf(r, citizenId)), level: levels[relationshipLevel(r.strength)], strength: r.strength }));
}

export interface EventView {
  readonly id: string;
  readonly name: string;
  readonly kind: CityEventKind;
  readonly venueId: string;
  readonly venue: string;
  readonly day: string;
  readonly time: string;
  readonly status: CityEvent['status'];
  readonly capacity: number;
  readonly going: number;
  readonly attended: number;
  readonly price: number;
  readonly organizer: CityEvent['organizer'];
}
export function eventViews(world: WorldState, filter: (e: CityEvent) => boolean = (e) => e.status === 'scheduled' || e.status === 'running'): EventView[] {
  const s = world.society;
  if (!s) return [];
  const today = getGameTime(world.clock).day;
  const going = new Map<string, number>();
  for (const p of Object.values(s.residents)) if (p.outing?.eventId) going.set(p.outing.eventId, (going.get(p.outing.eventId) ?? 0) + 1);
  const mpt = world.clock.minutesPerTick;
  return s.events.filter(filter).map((e) => ({
    id: e.id, name: e.name, kind: e.kind, venueId: e.venueId, venue: buildingName(world, e.venueId) ?? 'Removed venue',
    day: dayLabel(Math.floor(e.startTick * mpt / 1440), today), time: `${minuteOfTick(world, e.startTick)}–${minuteOfTick(world, e.endTick)}`,
    status: e.status, capacity: e.capacity, going: going.get(e.id) ?? 0, attended: e.attendees.length, price: e.price, organizer: e.organizer,
  }));
}

export interface SocietyOverview {
  readonly outingsToday: number;
  readonly groupOutingsToday: number;
  readonly outNow: number;
  readonly eventAttendanceToday: number;
  readonly wellbeing: number;
  readonly withFriends: number;
  readonly residents: number;
  readonly friendships: number;
  readonly popular: readonly { id: string; name: string; visitors: number }[];
  readonly turnedAwayToday: number;
}
export function societyOverview(world: WorldState): SocietyOverview | null {
  const s = world.society;
  if (!s) return null;
  const profiles = Object.values(s.residents);
  const present = new Map<string, number>();
  for (const p of profiles) if (p.outing?.status === 'present' && p.outing.kind !== 'visit') present.set(p.outing.venueId, (present.get(p.outing.venueId) ?? 0) + 1);
  const friends = new Set<string>();
  let friendships = 0;
  for (const r of s.relationships) if (relationshipLevel(r.strength) !== 'acquaintance') { friends.add(r.a); friends.add(r.b); friendships += 1; }
  const popular = [...present].map(([id, visitors]) => ({ id, name: buildingName(world, id) ?? id, visitors }))
    .sort((a, b) => b.visitors - a.visitors || (a.name < b.name ? -1 : 1)).slice(0, 4);
  return {
    outingsToday: s.today.outings, groupOutingsToday: s.today.groupOutings, outNow: profiles.filter((p) => p.outing?.status === 'present').length,
    eventAttendanceToday: s.today.eventAttendance, turnedAwayToday: s.today.turnedAway,
    wellbeing: profiles.length ? Math.round(profiles.reduce((sum, p) => sum + wellbeing(p.needs).value, 0) / profiles.length) : 0,
    withFriends: friends.size, residents: profiles.length, friendships, popular,
  };
}

export interface VenueView {
  readonly label: string;
  readonly activity: string;
  readonly openNow: boolean;
  readonly hours: string;
  readonly price: string;
  readonly visitors: number;
  readonly capacity: number;
  readonly serving: number;
  readonly staffed: boolean;
  readonly visitsToday: number;
  readonly events: readonly EventView[];
  readonly hosts: readonly CityEventKind[];
}
/** A leisure venue's live state; null for buildings that are not venues. */
export function venueView(world: WorldState, building: Building): VenueView | null {
  const spec = building.type ? VENUES[building.type] : undefined;
  if (!spec || !world.society) return null;
  const { minuteOfDay } = getGameTime(world.clock);
  const visitors = Object.values(world.society.residents).filter((p) => p.outing?.venueId === building.id && p.outing.status === 'present').length;
  const workers = world.citizens.filter((c) => c.workBuildingId === building.id).length;
  const capacity = visitorCapacity(building);
  const serving = isBusinessVenue(building.type) ? Math.ceil(capacity * (workers + 1) / (building.capacity + 1)) : capacity;
  const m = minuteOfDay < spec.open && spec.close > 1440 ? minuteOfDay + 1440 : minuteOfDay;
  const hours = spec.eventsOnly ? 'Open for events' : spec.sessions ? `Screenings ${spec.sessions.map((s) => formatMinute(s)).join(' · ')}` : `${formatMinute(spec.open)}–${formatMinute(spec.close)}`;
  const openNow = spec.eventsOnly ? world.society.events.some((e) => e.venueId === building.id && e.status === 'running')
    : spec.sessions ? minuteOfDay >= spec.sessions[0]! && minuteOfDay < spec.sessions.at(-1)! + spec.minutes[0] : m >= spec.open && m < spec.close;
  return {
    label: spec.label, activity: OUTING_LABELS[spec.kind], openNow, hours, price: spec.price > 0 ? `$${spec.price} per visit` : 'Free',
    visitors, capacity, serving, staffed: !isBusinessVenue(building.type) || workers > 0, visitsToday: world.economy?.today.visits[building.id] ?? visitors,
    events: eventViews(world, (e) => e.venueId === building.id && (e.status === 'scheduled' || e.status === 'running')),
    hosts: (Object.keys(EVENTS) as CityEventKind[]).filter((k) => building.type !== undefined && EVENTS[k].venues.includes(building.type)),
  };
}

/** Choices the player can organize at a venue: the next free evening slots (validated by the simulation on submit). */
export function eventSlots(world: WorldState, building: Building, kind: CityEventKind): { day: number; startMinute: number; label: string }[] {
  const s = world.society;
  if (!s || building.type === undefined || !EVENTS[kind].venues.includes(building.type)) return [];
  const { day, minuteOfDay } = getGameTime(world.clock);
  const out: { day: number; startMinute: number; label: string }[] = [];
  const mpt = world.clock.minutesPerTick;
  for (let d = day; d <= day + 6 && out.length < 3; d += 1) {
    for (const start of [18 * 60, 20 * 60]) {
      if (d === day && start < minuteOfDay + 60) continue;
      const startTick = Math.ceil((d * 1440 + start) / mpt), endTick = startTick + Math.ceil(EVENTS[kind].minutes / mpt);
      if (s.events.some((e) => e.venueId === building.id && (e.status === 'scheduled' || e.status === 'running') && e.startTick < endTick && startTick < e.endTick)) continue;
      out.push({ day: d, startMinute: start, label: `${dayLabel(d, day)} ${formatMinute(start)}` });
      break;
    }
  }
  return out;
}

export const eventLabel = (kind: CityEventKind) => EVENTS[kind].label;
export const visitSpec = HOME_VISIT;
