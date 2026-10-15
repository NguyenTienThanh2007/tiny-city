import { getGameTime, MINUTES_PER_DAY } from './clock.js';
import { visitorCapacity } from './catalog.js';
import { CITY_CALENDAR, EVENTS, INITIAL_NEEDS, SOCIETY, VENUES, weekday } from './societyConfig.js';
import type {
  Building, Citizen, CityEvent, CityEventKind, Interest, Outing, Personality, Relationship, SimulationEvent, SocialProfile, SocietyCommand,
  SocietyDayStats, SocietyRejectionReason, SocietyState, WorldState,
} from './types.js';

/**
 * Phase 7 living society: state, identity-derived personalities, validation, reconciliation after city edits, the
 * event calendar and the player's event commands. The per-tick behaviour lives in `societyStep.ts`.
 * Deterministic and RNG-free: every choice is a function of saved state and stable hashes, so enabling society never
 * shifts the world's random sequence (Phase 3–6 replays are unchanged).
 */

/** FNV-1a: a stable, platform-independent 32-bit hash. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
const byString = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const TRAITS = ['sociability', 'curiosity', 'vitality', 'frugality', 'community'] as const;

/**
 * Traits from the resident's identity (ID and name, both fixed for life): each is the mean of two hashes, so values
 * cluster around the middle (10–90) and extremes are rarer. No demographic attribute (age etc.) is ever used. Stored
 * once in the profile, so later formula changes never alter an existing resident.
 */
export function personalityFor(citizen: Pick<Citizen, 'id' | 'name'>): Personality {
  const trait = (name: string) => 10 + Math.floor((hash(`${citizen.id}|${citizen.name}|${name}|a`) % 81 + hash(`${citizen.id}|${citizen.name}|${name}|b`) % 81) / 2);
  return Object.fromEntries(TRAITS.map((t) => [t, trait(t)])) as unknown as Personality;
}
/** Two interests: the resident's top-ranked by a per-resident hash (rendezvous ranking). */
export function interestsFor(citizen: Pick<Citizen, 'id' | 'name'>): Interest[] {
  return [...SOCIETY.interests].map((interest) => ({ interest, rank: hash(`${citizen.id}|${citizen.name}|likes|${interest}`) }))
    .sort((a, b) => b.rank - a.rank || byString(a.interest, b.interest)).slice(0, SOCIETY.interestsPerResident).map((x) => x.interest)
    .sort((a, b) => SOCIETY.interests.indexOf(a) - SOCIETY.interests.indexOf(b));
}

export function newProfile(citizen: Pick<Citizen, 'id' | 'name'>, day: number, tick: number): SocialProfile {
  const vary = (key: string) => (hash(`${citizen.id}|need|${key}`) % 21) - 10;
  return {
    traits: personalityFor(citizen), interests: interestsFor(citizen),
    needs: { energy: INITIAL_NEEDS.energy + vary('energy'), hunger: INITIAL_NEEDS.hunger + vary('hunger'), social: INITIAL_NEEDS.social + vary('social'), fun: INITIAL_NEEDS.fun + vary('fun') },
    outing: null, hostingUntil: 0, nextDecisionTick: tick, outingsToday: 0, day, recent: [], lastChoice: null,
  };
}

export const emptyDay = (day: number): SocietyDayStats => ({ day, outings: 0, groupOutings: 0, visitsByKind: {}, eventAttendance: 0, newFriendships: 0, cancelled: 0, turnedAway: 0, spending: 0 });

/** Older worlds start with personalities for everyone, no relationships and an empty calendar from today on. */
export function createSociety(world: WorldState): SocietyState {
  const { day } = getGameTime(world.clock);
  const residents: Record<string, SocialProfile> = {};
  for (const c of [...world.citizens].sort((a, b) => byString(a.id, b.id))) residents[c.id] = newProfile(c, day, world.clock.tick);
  return { version: 1, nextOutingId: 1, nextEventId: 1, scheduledThrough: day - 1, residents, relationships: [], events: [], today: emptyDay(day), history: [] };
}

export const isLeisureVenue = (b: Building | undefined): boolean => !!b && b.type !== undefined && VENUES[b.type] !== undefined;
/**
 * Whether a venue is open at the world's current minute: within its hours, during a screening window for the cinema,
 * and only while an event runs for events-only venues (the concert stage).
 */
export function isVenueOpen(world: WorldState, b: Building): boolean {
  const spec = b.type !== undefined ? VENUES[b.type] : undefined;
  if (!spec) return false;
  if (spec.eventsOnly) return (world.society?.events ?? []).some((e) => e.venueId === b.id && e.status === 'running');
  const { minuteOfDay } = getGameTime(world.clock);
  if (spec.sessions) return minuteOfDay >= spec.sessions[0]! && minuteOfDay < spec.sessions.at(-1)! + spec.minutes[0];
  const m = minuteOfDay < spec.open && spec.close > MINUTES_PER_DAY ? minuteOfDay + MINUTES_PER_DAY : minuteOfDay;
  return m >= spec.open && m < spec.close;
}
export const relationshipKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
export const relationshipLevel = (strength: number): 'acquaintance' | 'friend' | 'close-friend' =>
  strength >= SOCIETY.closeAt ? 'close-friend' : strength >= SOCIETY.friendAt ? 'friend' : 'acquaintance';

export function validateSociety(world: WorldState, assert: (condition: boolean, message: string) => asserts condition): void {
  const s = world.society;
  if (s === undefined) return;
  const int = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
  const citizens = new Map(world.citizens.map((c) => [c.id, c]));
  const buildings = new Map(world.plan.buildings.map((b) => [b.id, b]));
  const tick = world.clock.tick;
  assert(s.version === 1 && int(s.nextOutingId, 1, Number.MAX_SAFE_INTEGER) && int(s.nextEventId, 1, Number.MAX_SAFE_INTEGER), 'invalid society version or cursors');
  assert(Number.isSafeInteger(s.scheduledThrough), 'invalid calendar cursor');
  const ids = Object.keys(s.residents);
  assert(ids.length === citizens.size && ids.every((id) => citizens.has(id)), 'social profiles must match the residents exactly');
  const outings = new Map<string, Outing>();
  const visitors = new Map<string, number>();
  for (const [id, p] of Object.entries(s.residents)) {
    assert(TRAITS.every((t) => int(p.traits[t], 0, 100)), 'invalid personality');
    assert(p.interests.length === SOCIETY.interestsPerResident && new Set(p.interests).size === p.interests.length && p.interests.every((i) => (SOCIETY.interests as readonly string[]).includes(i)), 'invalid interests');
    assert(int(p.needs.energy, 0, 100) && int(p.needs.hunger, 0, 100) && int(p.needs.social, 0, 100) && int(p.needs.fun, 0, 100), 'invalid resident needs');
    assert(int(p.hostingUntil, 0, Number.MAX_SAFE_INTEGER) && int(p.nextDecisionTick, 0, Number.MAX_SAFE_INTEGER) && int(p.outingsToday, 0, 24) && Number.isSafeInteger(p.day), 'invalid social counters');
    assert(p.recent.length <= SOCIETY.recentVenues && p.recent.every((v) => typeof v === 'string'), 'invalid recent venues');
    const o = p.outing;
    if (o) {
      assert(/^outing-[1-9]\d*$/.test(o.id) && Number(o.id.slice(7)) < s.nextOutingId, 'invalid outing id');
      const venue = buildings.get(o.venueId);
      assert(venue !== undefined, 'outing references an unknown venue');
      assert(o.kind === 'visit' ? venue!.kind === 'home' && o.hostId !== null && citizens.has(o.hostId) && citizens.get(o.hostId)!.homeBuildingId === venue!.id && o.hostId !== id
        : isLeisureVenue(venue) && o.hostId === null, 'outing venue does not offer that activity');
      assert(o.companions.length <= SOCIETY.maxCompanions && o.companions.every((c) => citizens.has(c) && c !== id), 'outing companions must be other residents');
      assert(o.eventId === null || s.events.some((e) => e.id === o.eventId && e.venueId === o.venueId), 'outing references an unknown event');
      assert(int(o.decidedTick, 0, tick) && o.decidedTick <= o.startTick && o.startTick < o.endTick && int(o.arriveByTick, 0, Number.MAX_SAFE_INTEGER), 'invalid outing timing');
      assert(o.status === 'travelling' || o.status === 'present', 'invalid outing status');
      assert(int(o.spent, 0, 10_000), 'invalid outing spending');
      if (o.status === 'present') {
        const c = citizens.get(id)!;
        assert(c.movement?.status === 'inside' && c.movement.currentBuildingId === o.venueId, 'a present resident must be inside the venue');
        visitors.set(o.venueId, (visitors.get(o.venueId) ?? 0) + 1);
      }
      outings.set(id, o);
    }
  }
  // Capacity: residents present at a venue never exceed its visitor capacity (a friend's home takes one visitor).
  for (const [venueId, count] of visitors) {
    const venue = buildings.get(venueId)!;
    assert(count <= (venue.kind === 'home' ? 1 : visitorCapacity(venue)), 'venue visitor capacity exceeded');
  }
  let previous = '';
  const perResident = new Map<string, number>();
  for (const r of s.relationships) {
    const key = `${r.a}|${r.b}`;
    assert(r.a < r.b && citizens.has(r.a) && citizens.has(r.b), 'relationships must join two existing residents (a < b)');
    assert(key > previous, 'relationships must be unique and sorted');
    previous = key;
    assert(int(r.strength, 1, 100) && Number.isSafeInteger(r.since) && Number.isSafeInteger(r.lastDay) && int(r.gainedToday, 0, SOCIETY.dailyGainCap), 'invalid relationship values');
    for (const id of [r.a, r.b]) perResident.set(id, (perResident.get(id) ?? 0) + 1);
  }
  for (const count of perResident.values()) assert(count <= SOCIETY.relationshipsPerResident, 'too many relationships for one resident');
  assert(s.events.length <= SOCIETY.eventsKept, 'too many events');
  const eventIds = new Set<string>();
  const attending = new Map<string, string>();
  for (const e of s.events) {
    assert(/^event-[1-9]\d*$/.test(e.id) && Number(e.id.slice(6)) < s.nextEventId && !eventIds.has(e.id), 'invalid event id');
    eventIds.add(e.id);
    assert(e.kind in EVENTS && e.startTick < e.endTick && int(e.capacity, 1, 10_000) && int(e.price, 0, 1000) && int(e.cost, 0, 100_000), 'invalid event');
    assert(['scheduled', 'running', 'finished', 'cancelled'].includes(e.status) && (e.organizer === 'city' || e.organizer === 'player'), 'invalid event status');
    const live = e.status === 'scheduled' || e.status === 'running';
    assert(!live || buildings.has(e.venueId), 'a live event must be at an existing venue');
    assert(e.attendees.length <= e.capacity && new Set(e.attendees).size === e.attendees.length, 'event attendance must be unique and within capacity');
    if (e.status === 'running') for (const a of e.attendees) {
      assert(!attending.has(a), 'a resident cannot attend two events at once');
      attending.set(a, e.id);
    }
  }
  assert(s.history.length <= SOCIETY.historyDays, 'society history exceeds its bound');
}

export function cloneSociety(s: SocietyState): SocietyState {
  const day = (d: SocietyDayStats): SocietyDayStats => ({ ...d, visitsByKind: { ...d.visitsByKind } });
  return {
    version: s.version, nextOutingId: s.nextOutingId, nextEventId: s.nextEventId, scheduledThrough: s.scheduledThrough,
    residents: Object.fromEntries(Object.entries(s.residents).map(([id, p]) => [id, { ...p, traits: { ...p.traits }, interests: [...p.interests], needs: { ...p.needs },
      outing: p.outing ? { ...p.outing, companions: [...p.outing.companions] } : null, recent: [...p.recent],
      lastChoice: p.lastChoice ? { ...p.lastChoice, reasons: [...p.lastChoice.reasons] } : null }])),
    relationships: s.relationships.map((r) => ({ ...r })),
    events: s.events.map((e) => ({ ...e, attendees: [...e.attendees] })),
    today: day(s.today), history: s.history.map(day),
  };
}

/**
 * After every city command, undo/redo and load: profiles follow the resident list (new residents get theirs, departed
 * residents' profiles and relationships go), outings to venues that no longer exist end, and events at removed
 * venues are cancelled. Never invents relationships.
 */
export function reconcileSociety(world: WorldState, previous?: WorldState): { state: WorldState; events: SimulationEvent[] } {
  const s = world.society;
  if (!s) return { state: world, events: [] };
  const events: SimulationEvent[] = [];
  const tick = world.clock.tick;
  const { day } = getGameTime(world.clock);
  const citizens = new Map(world.citizens.map((c) => [c.id, c]));
  const buildings = new Map(world.plan.buildings.map((b) => [b.id, b]));
  const plansChanged = previous === undefined || previous.plan !== world.plan || previous.citizens !== world.citizens || previous.revision !== world.revision;
  if (!plansChanged && Object.keys(s.residents).length === citizens.size) return { state: world, events };
  let changed = false;
  // Events at venues that are gone (or no longer host that kind) are cancelled; their attendees' outings end below.
  const eventsOut = s.events.map((e) => {
    if (e.status !== 'scheduled' && e.status !== 'running') return e;
    const venue = buildings.get(e.venueId);
    if (venue?.type !== undefined && EVENTS[e.kind].venues.includes(venue.type)) return e;
    changed = true;
    events.push({ type: 'society.event-cancelled', tick, eventId: e.id, venueId: e.venueId, reason: 'venue-removed' });
    return { ...e, status: 'cancelled' as const, cancelReason: 'venue-removed' as const };
  });
  const live = new Map(eventsOut.map((e) => [e.id, e]));
  const residents: Record<string, SocialProfile> = {};
  let today = s.today;
  for (const c of [...world.citizens].sort((a, b) => byString(a.id, b.id))) {
    let p = s.residents[c.id];
    if (!p) { residents[c.id] = newProfile(c, day, tick); changed = true; continue; }
    const o = p.outing;
    if (o) {
      const venue = buildings.get(o.venueId);
      const event = o.eventId === null ? undefined : live.get(o.eventId);
      const host = o.hostId === null ? undefined : citizens.get(o.hostId);
      const valid = o.kind === 'visit' ? venue?.kind === 'home' && host?.homeBuildingId === venue.id : isLeisureVenue(venue);
      const eventOk = o.eventId === null || event?.status === 'scheduled' || event?.status === 'running';
      // A resident who is no longer inside the venue (moved, relocated by the edit) is travelling again.
      const presentOk = o.status !== 'present' || c.movement?.status === 'inside' && c.movement.currentBuildingId === o.venueId;
      const companions = o.companions.filter((id) => citizens.has(id));
      if (!valid || !eventOk) {
        changed = true;
        events.push({ type: 'society.outing-ended', tick, citizenId: c.id, outingId: o.id, venueId: o.venueId, result: 'cancelled', reason: !valid ? 'venue-removed' : 'event-cancelled' });
        today = { ...today, cancelled: today.cancelled + 1 };
        p = { ...p, outing: null, nextDecisionTick: tick + SOCIETY.cooldownMinutes };
      } else if (!presentOk || companions.length !== o.companions.length) {
        changed = true;
        p = { ...p, outing: { ...o, companions, status: presentOk ? o.status : 'travelling' } };
      }
    }
    if (p.hostingUntil > tick && !Object.values(s.residents).some((q) => q.outing?.hostId === c.id)) { p = { ...p, hostingUntil: 0 }; changed = true; }
    residents[c.id] = p;
  }
  if (Object.keys(s.residents).some((id) => !citizens.has(id))) changed = true;
  // Hosts whose visitor's outing ended above stop hosting.
  for (const [id, p] of Object.entries(residents)) {
    if (p.hostingUntil > tick && !Object.values(residents).some((q) => q.outing?.hostId === id)) { residents[id] = { ...p, hostingUntil: 0 }; changed = true; }
  }
  // Running events keep only attendees who are still residents.
  const eventsFinal = eventsOut.map((e) => e.attendees.every((a) => citizens.has(a)) ? e : (changed = true, { ...e, attendees: e.attendees.filter((a) => citizens.has(a)) }));
  const relationships = s.relationships.filter((r) => citizens.has(r.a) && citizens.has(r.b));
  if (relationships.length !== s.relationships.length) changed = true;
  if (!changed) return { state: world, events };
  return { state: { ...world, society: { ...s, residents, relationships, events: eventsFinal, today } }, events };
}

/** Visitors and reservations per venue right now: residents with an outing there, plus the player while visiting. */
export function venueLoad(world: WorldState): Map<string, number> {
  const load = new Map<string, number>();
  for (const p of Object.values(world.society?.residents ?? {})) if (p.outing) load.set(p.outing.venueId, (load.get(p.outing.venueId) ?? 0) + 1);
  const player = world.player;
  if (player?.activity.kind === 'visit' && player.activity.buildingId) load.set(player.activity.buildingId, (load.get(player.activity.buildingId) ?? 0) + 1);
  return load;
}

/** Fills the calendar for days not yet scheduled (up to the lookahead), never for times that have passed. */
export function fillCalendar(world: WorldState): { society: SocietyState; events: SimulationEvent[] } {
  const s = world.society!;
  const { day } = getGameTime(world.clock);
  const through = day + SOCIETY.lookaheadDays;
  if (s.scheduledThrough >= through) return { society: s, events: [] };
  const tick = world.clock.tick, minutesPerTick = world.clock.minutesPerTick;
  const venues = [...world.plan.buildings].filter((b) => b.type !== undefined).sort((a, b) => byString(a.id, b.id));
  const created: CityEvent[] = [];
  const out: SimulationEvent[] = [];
  let next = s.nextEventId;
  const all = [...s.events];
  for (let d = Math.max(s.scheduledThrough + 1, day); d <= through; d += 1) {
    for (const venue of venues) {
      const entry = CITY_CALENDAR.find((e) => e.venue === venue.type && e.weekday === weekday(d));
      if (!entry) continue;
      const startTick = Math.ceil((d * MINUTES_PER_DAY + entry.start) / minutesPerTick);
      const endTick = startTick + Math.ceil(EVENTS[entry.kind].minutes / minutesPerTick);
      if (startTick <= tick) continue;
      if (all.some((e) => e.venueId === venue.id && (e.status === 'scheduled' || e.status === 'running') && e.startTick < endTick && startTick < e.endTick)) continue;
      const spec = EVENTS[entry.kind];
      const event: CityEvent = { id: `event-${next++}`, kind: entry.kind, name: `${spec.label} at ${venue.name}`, venueId: venue.id, startTick, endTick,
        capacity: visitorCapacity(venue), price: spec.price, cost: spec.cost, organizer: 'city', status: 'scheduled', cancelReason: null, attendees: [] };
      created.push(event); all.push(event);
      out.push({ type: 'society.event-scheduled', tick, event });
    }
  }
  return { society: { ...s, nextEventId: next, scheduledThrough: through, events: pruneEvents(all, tick) }, events: out };
}

/** Sorted by start; keeps live events and finished/cancelled ones from the last two days, within the bound. */
export function pruneEvents(events: readonly CityEvent[], tick: number): CityEvent[] {
  const keep = events.filter((e) => e.status === 'scheduled' || e.status === 'running' || e.endTick >= tick - 2 * MINUTES_PER_DAY)
    .sort((a, b) => a.startTick - b.startTick || byString(a.id, b.id));
  while (keep.length > SOCIETY.eventsKept) {
    const index = keep.findIndex((e) => e.status === 'finished' || e.status === 'cancelled');
    keep.splice(index >= 0 ? index : keep.length - 1, 1);
  }
  return keep;
}

/** The player schedules or cancels events. Validated like any command; nothing happens to time that has passed. */
export function applySocietyCommand(world: WorldState, command: SocietyCommand): { state: WorldState; events: SimulationEvent[]; reason: SocietyRejectionReason | null; eventId: string | null } {
  const tick = world.clock.tick;
  const reject = (reason: SocietyRejectionReason) => ({ state: world, reason, eventId: null,
    events: [{ type: 'society.command-rejected' as const, tick, commandType: command?.type === 'society.cancel-event' ? 'society.cancel-event' as const : 'society.schedule-event' as const, reason }] });
  const s = world.society;
  if (!s) return reject('society-disabled');
  if (command?.type === 'society.cancel-event') {
    const event = s.events.find((e) => e.id === command.eventId);
    if (!event || event.status === 'cancelled' || event.status === 'finished') return reject('event-not-found');
    if (event.status === 'running') return reject('event-started');
    const residents = Object.fromEntries(Object.entries(s.residents).map(([id, p]) => [id, p.outing?.eventId === event.id ? { ...p, outing: null, nextDecisionTick: tick } : p]));
    const ended: SimulationEvent[] = Object.entries(s.residents).filter(([, p]) => p.outing?.eventId === event.id)
      .map(([id, p]) => ({ type: 'society.outing-ended' as const, tick, citizenId: id, outingId: p.outing!.id, venueId: event.venueId, result: 'cancelled' as const, reason: 'event-cancelled' as const }));
    const events = s.events.map((e) => e.id === event.id ? { ...e, status: 'cancelled' as const, cancelReason: 'player' as const } : e);
    return { state: { ...world, society: { ...s, residents, events } }, reason: null, eventId: event.id,
      events: [{ type: 'society.event-cancelled', tick, eventId: event.id, venueId: event.venueId, reason: 'player' }, ...ended] };
  }
  if (command?.type !== 'society.schedule-event' || typeof command.venueId !== 'string' || !(command.kind in EVENTS) ||
    !Number.isSafeInteger(command.day) || !Number.isSafeInteger(command.startMinute) || command.startMinute < 0 || command.startMinute >= MINUTES_PER_DAY) return reject('invalid-command');
  const venue = world.plan.buildings.find((b) => b.id === command.venueId);
  if (!venue) return reject('venue-not-found');
  const spec = EVENTS[command.kind as CityEventKind];
  if (venue.type === undefined || !spec.venues.includes(venue.type)) return reject('unsupported-event');
  const { day } = getGameTime(world.clock);
  const minutesPerTick = world.clock.minutesPerTick;
  const startTick = Math.ceil((command.day * MINUTES_PER_DAY + command.startMinute) / minutesPerTick);
  const endTick = startTick + Math.ceil(spec.minutes / minutesPerTick);
  // At least an hour's notice (residents need time to decide and travel), and within the coming week.
  if (command.day > day + 6 || startTick < tick + Math.ceil(60 / minutesPerTick)) return reject('invalid-time');
  if (s.events.some((e) => e.venueId === venue.id && (e.status === 'scheduled' || e.status === 'running') && e.startTick < endTick && startTick < e.endTick)) return reject('venue-busy');
  if (s.events.filter((e) => e.organizer === 'player' && (e.status === 'scheduled' || e.status === 'running')).length >= SOCIETY.playerEvents) return reject('event-limit');
  if (world.budget.balance < spec.cost) return reject('insufficient-funds');
  const event: CityEvent = { id: `event-${s.nextEventId}`, kind: command.kind, name: `${spec.label} at ${venue.name}`, venueId: venue.id, startTick, endTick,
    capacity: visitorCapacity(venue), price: spec.price, cost: spec.cost, organizer: 'player', status: 'scheduled', cancelReason: null, attendees: [] };
  return { state: { ...world, society: { ...s, nextEventId: s.nextEventId + 1, events: pruneEvents([...s.events, event], tick) } }, reason: null, eventId: event.id,
    events: [{ type: 'society.event-scheduled', tick, event }] };
}

export type { Relationship };
