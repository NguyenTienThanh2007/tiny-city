import { getGameTime, MINUTES_PER_DAY } from './clock.js';
import { isBusinessVenue, visitorCapacity } from './catalog.js';
import { ECONOMY } from './economyConfig.js';
import { recordEventCost, recordFee, recordPurchase } from './economy.js';
import { buildingCenter, RoadNavigator } from './navigation.js';
import { emptyDay, fillCalendar, hash, isLeisureVenue, pruneEvents, relationshipKey, relationshipLevel, venueLoad } from './society.js';
import { EVENTS, HOME_VISIT, isWeekend, NEED_RATES, SOCIETY, VENUES } from './societyConfig.js';
import type { VenueSpec } from './societyConfig.js';
import { ownsCar } from './transport.js';
import type {
  Building, CityEvent, CityPlan, Citizen, CitizenActivity, EconomyState, Outing, OutingKind, Relationship, ResidentNeeds, ScheduleEntry,
  SimulationEvent, SocialChoice, SocialProfile, SocietyDayStats, SocietyState, WorldState,
} from './types.js';

/**
 * Phase 7 per-tick society. `stepSocietyBefore` runs before Life (calendar, event status, daily fading, decisions),
 * so a new outing takes effect the same tick; Life then walks the resident there (and Phase 6 transport may drive or
 * bus them) through `lifeOverride`; `stepSocietyAfter` runs after transport (arrivals and charges, endings, needs,
 * mingling). Bounded: each resident's needs and decisions run once per `SOCIETY.period` minutes on a slot staggered by
 * a hash of their ID, venue searches look at the nearest few venues of each type, and relationship updates touch only
 * residents who are actually together.
 */

const byString = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const slotOf = (id: string) => hash(`slot|${id}`) % SOCIETY.period;
const addNeeds = (n: ResidentNeeds, d: ResidentNeeds): ResidentNeeds => ({ energy: clamp(n.energy + d.energy), hunger: clamp(n.hunger + d.hunger), social: clamp(n.social + d.social), fun: clamp(n.fun + d.fun) });

// ─── Indexes (cached per immutable plan / navigator) ───────────────────────────────────────────────────────────────
const venueCache = new WeakMap<CityPlan, Map<string, Building[]>>();
/** Leisure venues by building type, sorted by ID. */
function venuesByType(plan: CityPlan): Map<string, Building[]> {
  let map = venueCache.get(plan);
  if (!map) {
    map = new Map();
    for (const b of [...plan.buildings].sort((x, y) => byString(x.id, y.id))) if (isLeisureVenue(b)) map.set(b.type!, [...(map.get(b.type!) ?? []), b]);
    venueCache.set(plan, map);
  }
  return map;
}
const componentCache = new WeakMap<RoadNavigator, Map<string, readonly string[]>>();
function components(nav: RoadNavigator, buildingId: string): readonly string[] {
  let map = componentCache.get(nav);
  if (!map) { map = new Map(); componentCache.set(nav, map); }
  let list = map.get(buildingId);
  if (!list) {
    list = [...new Set(nav.getAccessPoints(buildingId).map((p) => nav.graph.getComponentId(p)).filter((id): id is string => id !== null))].sort(byString);
    map.set(buildingId, list);
  }
  return list;
}
const connected = (nav: RoadNavigator, a: string, b: string) => { const x = components(nav, a), y = components(nav, b); return x.some((id) => y.includes(id)); };
const relationshipIndex = new WeakMap<readonly Relationship[], Map<string, Relationship[]>>();
/** Each resident's relationships, strongest first. */
export function relationshipsOf(list: readonly Relationship[]): Map<string, Relationship[]> {
  let map = relationshipIndex.get(list);
  if (!map) {
    map = new Map();
    for (const r of list) for (const id of [r.a, r.b]) map.set(id, [...(map.get(id) ?? []), r]);
    for (const rs of map.values()) rs.sort((x, y) => y.strength - x.strength || byString(x.a + x.b, y.a + y.b));
    relationshipIndex.set(list, map);
  }
  return map;
}
export const otherOf = (r: Relationship, id: string) => r.a === id ? r.b : r.a;

// ─── Time and obligations ──────────────────────────────────────────────────────────────────────────────────────────
function activeEntry(c: Citizen, minute: number): ScheduleEntry {
  let active = c.schedule.entries[0]!;
  for (const e of c.schedule.entries) { if (e.startMinute > minute) break; active = e; }
  return active;
}
const workStart = (c: Citizen) => c.workBuildingId === null ? null : c.schedule.entries.find((e) => e.activity === 'work')?.startMinute ?? null;
export const isWorkday = (c: Citizen, day: number) => c.workBuildingId !== null && !isWeekend(day) && c.schedule.entries.some((e) => e.activity === 'work');

/** What the schedule asks for once society applies days off and free evenings (no outing). */
export function effectiveActivity(c: Citizen, day: number, minute: number): CitizenActivity {
  const entry = activeEntry(c, minute);
  if (entry.activity === 'work' && !isWorkday(c, day)) return 'home';
  if (entry.activity === 'leisure') return 'home';
  return entry.activity;
}

/**
 * Life's per-resident override while society is on: an outing in progress sends the resident to its venue (for
 * leisure); days off and the old fixed leisure block become free time at home until the resident decides otherwise.
 */
export function lifeOverride(world: WorldState): ((c: Citizen, entry: ScheduleEntry) => { activity: CitizenActivity; destination: string | null } | null) | undefined {
  const s = world.society;
  if (!s) return undefined;
  const tick = world.clock.tick;
  const { day } = getGameTime(world.clock);
  return (c, entry) => {
    const o = s.residents[c.id]?.outing;
    if (o && tick >= o.startTick && tick < o.endTick) return { activity: 'leisure', destination: o.venueId };
    if (entry.activity === 'work' && !isWorkday(c, day)) return { activity: 'home', destination: c.homeBuildingId };
    if (entry.activity === 'leisure') return { activity: 'home', destination: c.homeBuildingId };
    return null;
  };
}

/** Minutes from now until the resident must be heading home (work tomorrow morning, or the latest night out). */
function freeWindow(c: Citizen, p: SocialProfile, day: number, minute: number): number {
  const start = workStart(c);
  let nextWork = Infinity;
  if (start !== null && isWorkday(c, day) && minute < start) nextWork = start - minute;
  else if (start !== null && isWorkday(c, day + 1)) nextWork = MINUTES_PER_DAY - minute + start;
  const late = !isWorkday(c, day + 1) ? SOCIETY.lateMinutes.dayOff : p.traits.vitality >= SOCIETY.nightOwlVitality ? SOCIETY.lateMinutes.nightOwl : SOCIETY.lateMinutes.workNight;
  return Math.min(nextWork - SOCIETY.workBufferMinutes, MINUTES_PER_DAY + late - minute);
}

/**
 * A business venue serves in proportion to its staff (the owner alone keeps a few tables open):
 * ceil(visitors × (workers + 1) / (jobs + 1)). Public venues and friends' homes are not staffed.
 */
export function servingCapacity(venue: Building, workers: number): number {
  const full = visitorCapacity(venue);
  return isBusinessVenue(venue.type) ? Math.ceil(full * (workers + 1) / (venue.capacity + 1)) : full;
}
const staffCache = new WeakMap<readonly Citizen[], Map<string, number>>();
export function staffing(citizens: readonly Citizen[]): Map<string, number> {
  let map = staffCache.get(citizens);
  if (!map) {
    map = new Map();
    for (const c of citizens) if (c.workBuildingId !== null) map.set(c.workBuildingId, (map.get(c.workBuildingId) ?? 0) + 1);
    staffCache.set(citizens, map);
  }
  return map;
}

// ─── Money ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const housingCost = (b: Building | undefined) => ECONOMY.housingCost[b?.type === 'villa' || b?.type === 'duplex' || b?.type === 'townhouse' || b?.type === 'apartment' ? b.type : 'other'];
/** What a resident can spend on leisure today without touching rent, today's other commitments or their cushion. */
function spendable(c: Citizen, p: SocialProfile, home: Building | undefined, economy: EconomyState | undefined): number {
  if (!economy) return Infinity;
  const balance = economy.residents[c.id]?.balance ?? ECONOMY.startingSavings;
  const t = economy.today;
  const purchases = Object.values(t.purchases?.[c.id] ?? {}).reduce((sum, v) => sum + v, 0);
  const committed = (t.fees[c.id] ?? 0) + (t.fares?.[c.id] ?? 0) + (t.carCosts?.[c.id] ?? 0) + purchases;
  const reserve = SOCIETY.reserveBase + Math.floor(p.traits.frugality * SOCIETY.reservePerTrait / 100);
  return balance - housingCost(home) - committed - reserve;
}

// ─── Travel estimate ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Door-to-door minutes by the quickest of walking, the resident's own car (if parked here) and the bus (stops near
 * both ends on one line), with Phase 6's remembered slowdowns; null when no road connects the two buildings.
 * An estimate for choosing; the actual mode is picked by transport when the resident leaves.
 */
export function travelEstimate(world: WorldState, nav: RoadNavigator, c: Citizen, origin: Building, target: Building): number | null {
  if (origin.id === target.id) return 0;
  if (!connected(nav, origin.id, target.id)) return null;
  const a = buildingCenter(origin), b = buildingCenter(target);
  const tiles = Math.ceil((Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * SOCIETY.travel.detourPercent / 100);
  const speed = c.attributes?.walkingSpeed ?? 0.3;
  let best = tiles / speed;
  const t = world.transport;
  if (t) {
    const home = nav.getBuilding(c.homeBuildingId);
    if (ownsCar(c.id, home) && (t.parkedCars[c.id] ?? c.homeBuildingId) === origin.id) {
      best = Math.min(best, (tiles * 100 / SOCIETY.travel.carTilesPerMinute + SOCIETY.travel.carOverhead) * t.experience.car / 100);
    }
    if (t.lines.length) {
      const near = (p: { x: number; y: number }) => t.stops.filter((s) => Math.abs(s.tile.x + 0.5 - p.x) + Math.abs(s.tile.y + 0.5 - p.y) <= SOCIETY.travel.stopReach);
      const from = near(a), to = near(b);
      for (const line of t.lines) {
        if (line.status !== 'active') continue;
        const f = from.find((s) => line.stopIds.includes(s.id)), g = to.find((s) => line.stopIds.includes(s.id) && s.id !== f?.id);
        if (!f || !g) continue;
        const walk = (Math.abs(f.tile.x + 0.5 - a.x) + Math.abs(f.tile.y + 0.5 - a.y) + Math.abs(g.tile.x + 0.5 - b.x) + Math.abs(g.tile.y + 0.5 - b.y)) / speed;
        const ride = (Math.abs(f.tile.x - g.tile.x) + Math.abs(f.tile.y - g.tile.y)) * SOCIETY.travel.detourPercent / SOCIETY.travel.busTilesPerMinute;
        best = Math.min(best, (walk + SOCIETY.travel.busWait + ride) * t.experience.bus / 100);
      }
    }
  }
  return Math.max(1, Math.round(best));
}

// ─── Utility ───────────────────────────────────────────────────────────────────────────────────────────────────────
interface Option {
  readonly kind: OutingKind;
  readonly venue: Building;
  readonly spec: VenueSpec;
  readonly event: CityEvent | null;
  readonly hostId: string | null;
  readonly travel: number;
  /** Leave at, arrive by and end (ticks). */
  readonly startTick: number;
  readonly arriveByTick: number;
  readonly endTick: number;
  readonly price: number;
  readonly full: boolean;
}
interface Scored { readonly option: Option; readonly utility: number; readonly reasons: readonly string[]; readonly factors: readonly (readonly [string, number])[] }

/** Integer utility of an option for a resident, with the factors behind it (largest first). */
function score(p: SocialProfile, o: Option, extras: { friends: readonly string[]; strength: number; money: number }): Scored {
  const n = p.needs, t = p.traits;
  const factors: [string, number][] = [];
  const add = (code: string, value: number) => { if (value !== 0) factors.push([code, Math.trunc(value)]); };
  add('base', 10);
  add('appeal', o.spec.appeal);
  add('bored', (100 - n.fun) * 4 / 10);
  if (o.spec.effect.hunger >= 10) add('hungry', (100 - n.hunger) * 6 / 10);
  if (o.kind === 'visit') add('lonely', (100 - n.social) * 7 / 10);
  else if (o.spec.social) add('lonely', (100 - n.social) * 5 / 10);
  else add('lonely', (100 - n.social) * 2 / 10);
  const interests = o.event ? EVENTS[o.event.kind].interests : o.spec.interests;
  for (const interest of p.interests) if (interests.includes(interest)) add(`interest:${interest}`, 20);
  if (o.spec.social) add('sociable', (t.sociability - 50) * 3 / 10); else add('quiet', (50 - t.sociability) * 2 / 10);
  if (o.event) { add(`event:${o.event.id}`, EVENTS[o.event.kind].appeal); add('community', (t.community - 50) * 3 / 10); }
  if (o.kind === 'club') add('night-owl', (t.vitality - 50) * 3 / 10);
  if (!p.recent.includes(o.venue.id)) add('new-place', t.curiosity * 15 / 100);
  else add('favourite', (50 - t.curiosity) * 2 / 10);
  if (o.price > 0) {
    add('price', -o.price * (SOCIETY.price.base + t.frugality) / SOCIETY.price.divisor);
    if (extras.money < o.price * 3) add('budget', -o.price * 2);
  } else if (t.frugality >= 60 || extras.money < 20) add('free', 6 + (t.frugality - 50) / 10);
  add('travel', -o.travel * SOCIETY.travelPenaltyPercent / 100);
  if (o.travel <= 15) add('nearby', 4);
  if (n.energy < 40 && (o.kind === 'club' || o.kind === 'rides' || o.kind === 'shop')) add('tired', -(40 - n.energy));
  if (p.lastChoice?.kind === o.kind && p.outingsToday > 0) add('again', -15);
  for (const friend of extras.friends.slice(0, 2)) add(`friend:${friend}`, 6);
  if (o.hostId) add(`friend:${o.hostId}`, extras.strength * 3 / 10);
  const utility = factors.reduce((sum, [, v]) => sum + v, 0);
  const reasons = factors.filter(([code, v]) => v >= 5 && code !== 'base' && code !== 'appeal').sort((x, y) => y[1] - x[1] || byString(x[0], y[0])).slice(0, 3).map(([code]) => code);
  return { option: o, utility, reasons, factors };
}
function stayHome(p: SocialProfile, money: number, options: number): { utility: number; reasons: string[] } {
  const t = p.traits, n = p.needs;
  const utility = 30 + Math.trunc((100 - n.energy) * 5 / 10) + p.outingsToday * 15 + Math.trunc((t.frugality - 50) / 10) + (t.sociability < 35 ? 8 : 0);
  const reasons: string[] = [];
  if (options === 0) reasons.push('nothing-open');
  if (n.energy < 40) reasons.push('tired');
  if (p.outingsToday > 0) reasons.push('been-out');
  if (t.frugality >= 65 || money < 20) reasons.push('saving');
  if (t.sociability < 35) reasons.push('homebody');
  return { utility, reasons: reasons.slice(0, 3) };
}

// ─── Relationship updates ──────────────────────────────────────────────────────────────────────────────────────────
class Bonds {
  private map: Map<string, Relationship> | null = null;
  private counts: Map<string, number> | null = null;
  readonly events: SimulationEvent[] = [];
  newFriendships = 0;
  constructor(private readonly list: readonly Relationship[], private readonly tick: number, private readonly day: number) {}
  private ensure() {
    if (this.map) return;
    this.map = new Map(this.list.map((r) => [`${r.a}|${r.b}`, r]));
    this.counts = new Map();
    for (const r of this.list) for (const id of [r.a, r.b]) this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
  }
  /** Adds strength between two residents (capped per day). New pairs need room in both residents' bounded lists. */
  gain(x: string, y: string, amount: number) {
    if (x === y || amount <= 0) return;
    this.ensure();
    const map = this.map!, counts = this.counts!;
    const key = relationshipKey(x, y), [a, b] = x < y ? [x, y] : [y, x];
    const current = map.get(key);
    if (current) {
      const gained = current.lastDay === this.day ? current.gainedToday : 0;
      const add = Math.min(amount, SOCIETY.dailyGainCap - gained);
      if (add <= 0) return;
      const strength = Math.min(100, current.strength + add);
      if (relationshipLevel(strength) !== relationshipLevel(current.strength)) {
        const level = relationshipLevel(strength);
        this.events.push({ type: 'society.relationship-changed', tick: this.tick, a, b, level, strength });
        if (level === 'friend') this.newFriendships += 1;
      }
      map.set(key, { ...current, strength, lastDay: this.day, gainedToday: gained + add });
      return;
    }
    for (const id of [a, b]) if ((counts.get(id) ?? 0) >= SOCIETY.relationshipsPerResident && !this.evictWeakest(id, amount)) return;
    const add = Math.min(amount, SOCIETY.dailyGainCap);
    map.set(key, { a, b, strength: add, since: this.day, lastDay: this.day, gainedToday: add });
    counts.set(a, (counts.get(a) ?? 0) + 1); counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  /** Room for a new acquaintance: drop this resident's weakest acquaintance if it is weaker than the new contact. */
  private evictWeakest(id: string, amount: number): boolean {
    let weakest: [string, Relationship] | null = null;
    for (const [key, r] of this.map!) {
      if (r.a !== id && r.b !== id || r.strength >= SOCIETY.friendAt) continue;
      if (!weakest || r.strength < weakest[1].strength || r.strength === weakest[1].strength && key < weakest[0]) weakest = [key, r];
    }
    if (!weakest || weakest[1].strength >= amount) return false;
    this.map!.delete(weakest[0]);
    for (const other of [weakest[1].a, weakest[1].b]) this.counts!.set(other, this.counts!.get(other)! - 1);
    return true;
  }
  /** Daily fading for pairs who have not met lately; gone at zero. */
  decay() {
    this.ensure();
    for (const [key, r] of [...this.map!]) {
      const since = this.day - r.lastDay;
      const loss = r.strength >= SOCIETY.friendAt ? since >= SOCIETY.decay.friendDays ? SOCIETY.decay.friend : 0
        : since >= SOCIETY.decay.acquaintanceDays ? SOCIETY.decay.acquaintance : 0;
      if (loss === 0) continue;
      if (r.strength - loss <= 0) {
        this.map!.delete(key);
        for (const other of [r.a, r.b]) this.counts!.set(other, this.counts!.get(other)! - 1);
      } else this.map!.set(key, { ...r, strength: r.strength - loss });
    }
  }
  result(): readonly Relationship[] {
    if (!this.map) return this.list;
    return [...this.map.values()].sort((x, y) => byString(`${x.a}|${x.b}`, `${y.a}|${y.b}`));
  }
}

// ─── Before Life: calendar, events, fading, decisions ─────────────────────────────────────────────────────────────
export function stepSocietyBefore(world: WorldState, nav: RoadNavigator): { state: WorldState; events: SimulationEvent[] } {
  let s = world.society!;
  const events: SimulationEvent[] = [];
  const tick = world.clock.tick;
  const { day, minuteOfDay: minute } = getGameTime(world.clock);
  let economy = world.economy;
  // A new day: yesterday's statistics go to the history, relationships fade, the calendar fills ahead.
  if (s.today.day !== day) {
    const bonds = new Bonds(s.relationships, tick, day);
    bonds.decay();
    s = { ...s, history: [...s.history, s.today].slice(-SOCIETY.historyDays), today: emptyDay(day), relationships: bonds.result() };
  }
  if (s.scheduledThrough < day + SOCIETY.lookaheadDays) {
    const filled = fillCalendar({ ...world, society: s });
    s = filled.society; events.push(...filled.events);
  }
  // Event status follows the clock.
  let eventsChanged = false;
  const load = venueLoad({ ...world, society: s });
  const nextEvents = s.events.map((e) => {
    if (e.status === 'scheduled' && tick >= e.startTick) {
      eventsChanged = true;
      events.push({ type: 'society.event-started', tick, eventId: e.id, venueId: e.venueId, expected: Object.values(s.residents).filter((p) => p.outing?.eventId === e.id).length });
      if (economy && e.cost > 0) economy = recordEventCost(economy, e.id, e.cost);
      return { ...e, status: 'running' as const };
    }
    if (e.status === 'running' && tick >= e.endTick) {
      eventsChanged = true;
      events.push({ type: 'society.event-ended', tick, eventId: e.id, venueId: e.venueId, attendance: e.attendees.length });
      return { ...e, status: 'finished' as const };
    }
    return e;
  });
  if (eventsChanged) s = { ...s, events: pruneEvents(nextEvents, tick) };

  // Decisions: residents whose slot is now, who are free, rested enough and not already going somewhere.
  const deciders = world.citizens.filter((c) => (minute + slotOf(c.id)) % SOCIETY.period === 0);
  if (deciders.length) {
    const ctx = new DecisionContext({ ...world, society: s, ...(economy ? { economy } : {}) }, nav, day, minute, load);
    for (const c of deciders) ctx.decide(c);
    if (ctx.changed) {
      s = ctx.society();
      events.push(...ctx.events);
    }
  }
  return { state: { ...world, society: s, ...(economy ? { economy } : {}) }, events };
}

class DecisionContext {
  readonly events: SimulationEvent[] = [];
  changed = false;
  private readonly residents: Record<string, SocialProfile>;
  private readonly citizens: Map<string, Citizen>;
  private readonly tick: number;
  private nextOutingId: number;
  private today: SocietyDayStats;
  private readonly visitors = new Set<string>();
  private readonly staff: Map<string, number>;
  constructor(private readonly world: WorldState, private readonly nav: RoadNavigator, private readonly day: number, private readonly minute: number,
    private readonly load: Map<string, number>) {
    const s = world.society!;
    this.residents = { ...s.residents };
    this.citizens = new Map(world.citizens.map((c) => [c.id, c]));
    this.tick = world.clock.tick;
    this.nextOutingId = s.nextOutingId;
    this.today = s.today;
    this.staff = staffing(world.citizens);
    for (const p of Object.values(s.residents)) if (p.outing?.kind === 'visit') this.visitors.add(p.outing.venueId);
  }
  society(): SocietyState {
    return { ...this.world.society!, residents: this.residents, nextOutingId: this.nextOutingId, today: this.today };
  }
  private profile(id: string): SocialProfile {
    const p = this.residents[id]!;
    return p.day === this.day ? p : { ...p, day: this.day, outingsToday: 0 };
  }
  /** Where the resident could leave from right now (home, or their workplace just after work), if they are free. */
  private origin(c: Citizen, p: SocialProfile): Building | null {
    if (p.outing || p.hostingUntil > this.tick) return null;
    const m = c.movement;
    if (m?.status !== 'inside' || m.currentBuildingId === null) return null;
    const free = effectiveActivity(c, this.day, this.minute) === 'home' && activeEntry(c, this.minute).activity !== 'sleep';
    if (!free) return null;
    if (m.currentBuildingId === c.homeBuildingId || m.currentBuildingId === c.workBuildingId) return this.nav.getBuilding(m.currentBuildingId) ?? null;
    return null;
  }
  private options(c: Citizen, origin: Building, window: number, money: number): Option[] {
    const out: Option[] = [];
    const mpt = this.world.clock.minutesPerTick;
    const ticks = (minutes: number) => Math.ceil(minutes / mpt);
    const consider = (venue: Building, spec: VenueSpec, kind: OutingKind, event: CityEvent | null, hostId: string | null) => {
      const travel = travelEstimate(this.world, this.nav, c, origin, venue);
      if (travel === null || travel > SOCIETY.maxTravelMinutes) return;
      const arrive = this.minute + travel;
      let startTick = this.tick, arriveByTick: number, endTick: number, length: number;
      if (event) {
        // Arrive by the start (or join a running event with at least 45 minutes left).
        const until = event.startTick - this.tick;
        if (event.status === 'running') { if ((event.endTick - this.tick) * mpt - travel < 45) return; arriveByTick = event.endTick - ticks(45); }
        else { if (until > ticks(180) || until < ticks(travel)) return; startTick = Math.max(this.tick, event.startTick - ticks(travel + 5)); arriveByTick = event.startTick + ticks(15); }
        endTick = event.endTick; length = (event.endTick - this.tick) * mpt;
      } else if (spec.sessions) {
        const session = spec.sessions.find((m) => m >= arrive && m - this.minute <= 180);
        if (session === undefined) return;
        startTick = this.tick + ticks(Math.max(0, session - this.minute - travel - 5)); arriveByTick = this.tick + ticks(session - this.minute + 15);
        endTick = this.tick + ticks(session - this.minute + spec.minutes[0]); length = session - this.minute + spec.minutes[0];
      } else {
        const span = spec.minutes[1] - spec.minutes[0];
        const duration = spec.minutes[0] + (span > 0 ? hash(`${c.id}|${venue.id}|${this.day}`) % (span + 1) : 0);
        // Opening within two hours: plan for the opening and leave in time to arrive then.
        const wait = Math.max(0, spec.open - arrive);
        if (wait > 120 || arrive + wait + duration > spec.close) return;
        startTick = this.tick + ticks(wait); arriveByTick = this.tick + ticks(wait + travel * 2 + 30);
        endTick = this.tick + ticks(wait + travel + duration); length = wait + travel + duration;
      }
      if (length + travel > window) return;
      const price = event ? event.price + (isBusinessVenue(venue.type) ? spec.price : 0) : spec.price;
      if (price > money) return;
      const capacity = venue.kind === 'home' ? 1 : event ? event.capacity : servingCapacity(venue, this.staff.get(venue.id) ?? 0);
      const full = (this.load.get(venue.id) ?? 0) >= capacity || venue.kind === 'home' && this.visitors.has(venue.id);
      out.push({ kind, venue, spec, event, hostId, travel, startTick, arriveByTick, endTick, price, full });
    };
    const types = venuesByType(this.world.plan);
    const origins = buildingCenter(origin);
    for (const [type, list] of types) {
      const spec = VENUES[type as Building['type'] & string]!;
      if (spec.eventsOnly) continue;
      const nearest = [...list].sort((x, y) => {
        const dx = Math.abs(buildingCenter(x).x - origins.x) + Math.abs(buildingCenter(x).y - origins.y), dy = Math.abs(buildingCenter(y).x - origins.x) + Math.abs(buildingCenter(y).y - origins.y);
        return dx - dy || byString(x.id, y.id);
      }).slice(0, SOCIETY.venuesPerType);
      for (const venue of nearest) consider(venue, spec, spec.kind, null, null);
    }
    for (const event of this.world.society!.events) {
      if (event.status !== 'scheduled' && event.status !== 'running') continue;
      const venue = this.nav.getBuilding(event.venueId);
      if (venue?.type === undefined || !VENUES[venue.type]) continue;
      consider(venue, VENUES[venue.type]!, 'event', event, null);
    }
    // Friends who are at home and free can host a visit (one visitor at a time).
    const rels = relationshipsOf(this.world.society!.relationships).get(c.id) ?? [];
    for (const r of rels.slice(0, 3)) {
      if (r.strength < SOCIETY.friendAt) break;
      const host = this.citizens.get(otherOf(r, c.id));
      const hp = host && this.residents[host.id];
      if (!host || !hp || hp.outing || hp.hostingUntil > this.tick || host.homeBuildingId === c.homeBuildingId) continue;
      if (host.movement?.status !== 'inside' || host.movement.currentBuildingId !== host.homeBuildingId || effectiveActivity(host, this.day, this.minute) !== 'home') continue;
      if (activeEntry(host, this.minute).activity === 'sleep' || hp.needs.energy < 20) continue;
      if (freeWindow(host, hp, this.day, this.minute) < HOME_VISIT.minutes[1] + 30) continue;
      const home = this.nav.getBuilding(host.homeBuildingId);
      if (home) consider(home, HOME_VISIT, 'visit', null, host.id);
    }
    return out;
  }
  decide(c: Citizen) {
    const p = this.profile(c.id);
    if (this.tick < p.nextDecisionTick) return;
    const origin = this.origin(c, p);
    if (!origin) return;
    const weekend = !isWorkday(c, this.day);
    if (p.outingsToday >= (weekend ? SOCIETY.maxOutings.weekend : SOCIETY.maxOutings.workday)) return;
    const window = freeWindow(c, p, this.day, this.minute);
    const home = this.nav.getBuilding(c.homeBuildingId);
    const money = spendable(c, p, home, this.world.economy);
    const options = window < 45 || p.needs.energy < 15 ? [] : this.options(c, origin, window, money);
    const rels = relationshipsOf(this.world.society!.relationships).get(c.id) ?? [];
    const scored = options.map((o) => {
      const strength = o.hostId ? rels.find((r) => otherOf(r, c.id) === o.hostId)?.strength ?? 0 : 0;
      const friends = o.spec.social && o.kind !== 'visit' ? this.joinable(c, rels, o).slice(0, 2) : [];
      return score(p, o, { friends, strength, money });
    }).sort((x, y) => y.utility - x.utility || byString(x.option.venue.id, y.option.venue.id) || byString(x.option.kind, y.option.kind));
    const stay = stayHome(p, money, scored.length);
    // The best option with room; a full favourite is remembered as unmet demand.
    let chosen: Scored | null = null, turned = false;
    for (const candidate of scored) {
      if (candidate.utility <= stay.utility) break;
      if (candidate.option.full) {
        if (!turned) { turned = true; this.today = { ...this.today, turnedAway: this.today.turnedAway + 1 }; this.events.push({ type: 'society.turned-away', tick: this.tick, citizenId: c.id, venueId: candidate.option.venue.id }); }
        continue;
      }
      // Similarly good options (within the tie margin) are chosen between by a stable hash, for believable variety.
      const close = scored.filter((x) => !x.option.full && x.utility >= candidate.utility - SOCIETY.tieMargin && x.utility > stay.utility);
      chosen = close[hash(`${c.id}|${this.tick}|pick`) % close.length]!;
      break;
    }
    this.changed = true;
    if (!chosen) {
      const choice: SocialChoice = { tick: this.tick, kind: 'stay-home', venueId: null, reasons: stay.reasons, options: scored.length };
      this.residents[c.id] = { ...p, nextDecisionTick: this.tick + Math.ceil(SOCIETY.stayInMinutes / this.world.clock.minutesPerTick), lastChoice: choice };
      return;
    }
    const o = chosen.option;
    const companions = o.spec.social && o.kind !== 'visit' && (p.traits.sociability >= 40 || p.needs.social < 40)
      ? this.joinable(c, rels, o).slice(0, p.traits.sociability >= 70 ? 3 : p.traits.sociability >= 45 ? 2 : 1) : [];
    const capacity = o.venue.kind === 'home' ? 1 : o.event ? o.event.capacity : servingCapacity(o.venue, this.staff.get(o.venue.id) ?? 0);
    const room = Math.max(0, capacity - (this.load.get(o.venue.id) ?? 0) - 1);
    const group = companions.slice(0, Math.min(room, SOCIETY.maxCompanions));
    const id = `outing-${this.nextOutingId++}`;
    const members = [c.id, ...group];
    for (const member of members) {
      const mc = this.citizens.get(member)!, mp = this.profile(member);
      const travel = member === c.id ? o.travel : travelEstimate(this.world, this.nav, mc, this.nav.getBuilding(mc.movement!.currentBuildingId)!, o.venue) ?? o.travel;
      const timed = o.event !== null || o.spec.sessions !== undefined;
      const mpt = this.world.clock.minutesPerTick;
      const startTick = member === c.id ? o.startTick : timed ? Math.max(this.tick, o.arriveByTick - Math.ceil((travel + 20) / mpt)) : this.tick;
      const outing: Outing = { id, kind: o.kind, venueId: o.venue.id, eventId: o.event?.id ?? null, companions: members.filter((m) => m !== member), hostId: o.hostId,
        decidedTick: this.tick, startTick, endTick: o.endTick, arriveByTick: member === c.id ? o.arriveByTick : Math.max(o.arriveByTick, this.tick + Math.ceil((travel * 2 + 30) / mpt)),
        status: 'travelling', spent: 0 };
      const reasons = member === c.id ? chosen.reasons : [`friend:${c.id}`, ...score(mp, o, { friends: [], strength: 0, money: Infinity }).reasons.filter((r) => !r.startsWith('friend:'))].slice(0, 3);
      const choice: SocialChoice = { tick: this.tick, kind: o.kind, venueId: o.venue.id, reasons, options: member === c.id ? scored.length : 1 };
      this.residents[member] = { ...mp, outing, outingsToday: mp.outingsToday + 1, lastChoice: choice };
      this.events.push({ type: 'society.outing-planned', tick: this.tick, citizenId: member, outingId: id, kind: o.kind, venueId: o.venue.id, companions: outing.companions, reasons });
    }
    if (o.hostId) {
      const hp = this.profile(o.hostId);
      this.residents[o.hostId] = { ...hp, hostingUntil: o.endTick };
      this.visitors.add(o.venue.id);
    }
    this.load.set(o.venue.id, (this.load.get(o.venue.id) ?? 0) + members.length);
    this.today = { ...this.today, outings: this.today.outings + members.length, groupOutings: this.today.groupOutings + (group.length > 0 ? 1 : 0) };
  }
  /** Debug: every option this resident would weigh right now, with its full factor breakdown (no state change). */
  explain(c: Citizen): DecisionExplanation {
    const p = this.profile(c.id);
    const origin = this.origin(c, p);
    const home = this.nav.getBuilding(c.homeBuildingId);
    const money = spendable(c, p, home, this.world.economy);
    const window = freeWindow(c, p, this.day, this.minute);
    if (!origin) return { free: false, window, money, stayHome: stayHome(p, money, 0), options: [] };
    const rels = relationshipsOf(this.world.society!.relationships).get(c.id) ?? [];
    const options = (window < 45 || p.needs.energy < 15 ? [] : this.options(c, origin, window, Infinity)).map((o) => {
      const strength = o.hostId ? rels.find((r) => otherOf(r, c.id) === o.hostId)?.strength ?? 0 : 0;
      const friends = o.spec.social && o.kind !== 'visit' ? this.joinable(c, rels, o).slice(0, 2) : [];
      const scored = score(p, o, { friends, strength, money });
      return { kind: o.kind, venueId: o.venue.id, eventId: o.event?.id ?? null, travel: o.travel, price: o.price, affordable: o.price <= money, full: o.full,
        utility: scored.utility, factors: scored.factors };
    }).sort((a, b) => b.utility - a.utility);
    return { free: true, window, money, stayHome: stayHome(p, money, options.length), options };
  }
  /** Friends (strongest first) who are free now and would rather join this outing than stay in. */
  private joinable(c: Citizen, rels: readonly Relationship[], o: Option): string[] {
    const out: string[] = [];
    for (const r of rels) {
      if (r.strength < SOCIETY.companionStrength) break;
      const id = otherOf(r, c.id), fc = this.citizens.get(id);
      if (!fc) continue;
      const fp = this.profile(id);
      const origin = this.origin(fc, fp);
      if (!origin || fp.needs.energy < 25 || fp.outingsToday >= (isWorkday(fc, this.day) ? SOCIETY.maxOutings.workday : SOCIETY.maxOutings.weekend)) continue;
      const travel = travelEstimate(this.world, this.nav, fc, origin, o.venue);
      if (travel === null || travel > SOCIETY.maxTravelMinutes) continue;
      const window = freeWindow(fc, fp, this.day, this.minute);
      if ((o.endTick - this.tick) * this.world.clock.minutesPerTick + travel > window) continue;
      const money = spendable(fc, fp, this.nav.getBuilding(fc.homeBuildingId), this.world.economy);
      if (o.price > money) continue;
      const theirs = score(fp, { ...o, travel }, { friends: [c.id], strength: r.strength, money });
      if (theirs.utility < stayHome(fp, money, 1).utility - 5) continue;
      out.push(id);
    }
    return out;
  }
}

export interface DecisionExplanation {
  /** Whether the resident is free to go out from where they are now. */
  readonly free: boolean;
  /** Minutes until they must head home (work tomorrow, or the latest night out). */
  readonly window: number;
  /** Dollars they can spend on leisure today. */
  readonly money: number;
  readonly stayHome: { readonly utility: number; readonly reasons: readonly string[] };
  readonly options: readonly { readonly kind: OutingKind; readonly venueId: string; readonly eventId: string | null; readonly travel: number; readonly price: number;
    readonly affordable: boolean; readonly full: boolean; readonly utility: number; readonly factors: readonly (readonly [string, number])[] }[];
}
/**
 * Debug explanation of a resident's choice at this moment: every reachable, open option with its utility and factor
 * breakdown (needs, interests, traits, price, travel, friends, events), and the value of staying in. Read-only.
 */
export function explainDecision(world: WorldState, nav: RoadNavigator, citizenId: string): DecisionExplanation | null {
  const c = world.citizens.find((x) => x.id === citizenId);
  if (!world.society || !c) return null;
  const { day, minuteOfDay } = getGameTime(world.clock);
  return new DecisionContext(world, nav, day, minuteOfDay, venueLoad(world)).explain(c);
}

// ─── After transport: arrivals, endings, needs, mingling ──────────────────────────────────────────────────────────
export function stepSocietyAfter(world: WorldState, nav: RoadNavigator): { state: WorldState; events: SimulationEvent[] } {
  const s = world.society!;
  const events: SimulationEvent[] = [];
  const tick = world.clock.tick;
  const { day, minuteOfDay: minute } = getGameTime(world.clock);
  let economy = world.economy;
  const residents: Record<string, SocialProfile> = { ...s.residents };
  let today = s.today;
  let changed = false;
  const citizens = new Map(world.citizens.map((c) => [c.id, c]));
  const eventMap = new Map(s.events.map((e) => [e.id, e]));
  let eventsChanged = false;
  const bonds = new Bonds(s.relationships, tick, day);
  const set = (id: string, p: SocialProfile) => { residents[id] = p; changed = true; };
  const end = (id: string, p: SocialProfile, result: 'completed' | 'cancelled', reason: Extract<SimulationEvent, { type: 'society.outing-ended' }>['reason']) => {
    const o = p.outing!;
    events.push({ type: 'society.outing-ended', tick, citizenId: id, outingId: o.id, venueId: o.venueId, result, reason });
    if (result === 'cancelled') today = { ...today, cancelled: today.cancelled + 1 };
    const recent = result === 'completed' && o.kind !== 'visit' ? [...p.recent.filter((v) => v !== o.venueId), o.venueId].slice(-SOCIETY.recentVenues) : p.recent;
    set(id, { ...residents[id]!, outing: null, recent, nextDecisionTick: tick + Math.ceil(SOCIETY.cooldownMinutes / world.clock.minutesPerTick) });
    if (o.hostId && residents[o.hostId]) set(o.hostId, { ...residents[o.hostId]!, hostingUntil: 0 });
  };
  const ids = Object.keys(s.residents).sort(byString);
  // Arrivals and endings.
  for (const id of ids) {
    const p = residents[id]!, o = p.outing;
    if (!o) continue;
    const c = citizens.get(id)!;
    const m = c.movement!;
    const inside = m.status === 'inside' && m.currentBuildingId === o.venueId && c.activity === 'leisure';
    if (tick >= o.endTick) {
      if (o.status === 'present') {
        // Companions who were there together, and a host and their visitor, grow closer (each pair once).
        for (const other of o.companions) if (id < other && residents[other]?.outing?.id === o.id && residents[other]!.outing!.status === 'present') bonds.gain(id, other, SOCIETY.gains.outing);
        if (o.hostId) bonds.gain(id, o.hostId, SOCIETY.gains.visit);
        end(id, p, 'completed', null);
      } else end(id, p, 'cancelled', 'late');
      continue;
    }
    if (o.status === 'travelling' && tick >= o.startTick) {
      // Arriving before a venue opens means waiting at the door: present (and charged) only once it is open.
      if (inside && opened(nav.getBuilding(o.venueId), o, minute)) {
        let spent = 0;
        const venue = nav.getBuilding(o.venueId);
        if (o.eventId) {
          const event = eventMap.get(o.eventId);
          if (!event || event.attendees.length >= event.capacity) { end(id, p, 'cancelled', 'event-cancelled'); continue; }
          if (!event.attendees.includes(id)) { eventMap.set(event.id, { ...event, attendees: [...event.attendees, id] }); eventsChanged = true; today = { ...today, eventAttendance: today.eventAttendance + 1 }; }
          if (economy && isBusinessVenue(venue?.type)) {
            // An event at a business (a market festival): entry is the event's ticket, if any, and people buy as usual.
            spent = event.price + VENUES[venue!.type!]!.price;
            economy = recordPurchase(economy, id, o.venueId, spent);
          } else if (event.price > 0 && economy) {
            // Tickets for city-run venues (the stage, the plaza) go to the treasury.
            spent = event.price;
            economy = recordFee(economy, id, spent);
          }
        } else if (economy && isBusinessVenue(venue?.type)) {
          spent = VENUES[venue!.type!]!.price;
          economy = recordPurchase(economy, id, o.venueId, spent);
        }
        // Pool and clubhouse fees are the Phase 5 venue fees, recorded by the economy on the same arrival.
        if (!isBusinessVenue(venue?.type) && !o.eventId && venue && VENUES[venue.type!] && VENUES[venue.type!]!.price > 0) spent = VENUES[venue.type!]!.price;
        today = { ...today, visitsByKind: { ...today.visitsByKind, [o.kind]: (today.visitsByKind[o.kind] ?? 0) + 1 }, spending: today.spending + spent };
        set(id, { ...p, outing: { ...o, status: 'present', spent } });
        events.push({ type: 'society.outing-arrived', tick, citizenId: id, outingId: o.id, venueId: o.venueId, spent });
        continue;
      }
      if (tick > o.arriveByTick) { end(id, p, 'cancelled', 'late'); continue; }
      if (m.status === 'waiting' && m.destinationBuildingId === o.venueId && m.plannedRevision === world.revision && m.route.length === 0) { end(id, p, 'cancelled', 'unreachable'); continue; }
    }
    if (o.status === 'present' && !inside) { set(id, { ...p, outing: { ...o, status: 'travelling' } }); continue; }
    if (o.hostId) {
      const host = citizens.get(o.hostId);
      if (!host || host.movement?.status !== 'inside' || host.movement.currentBuildingId !== host.homeBuildingId) end(id, p, 'cancelled', 'host-left');
    }
  }
  // Needs, once per period on each resident's slot.
  const present = new Map<string, string[]>();
  for (const id of ids) { const o = residents[id]!.outing; if (o?.status === 'present') present.set(o.venueId, [...(present.get(o.venueId) ?? []), id]); }
  for (const id of ids) {
    if ((minute + slotOf(id)) % SOCIETY.period !== 0) continue;
    const c = citizens.get(id)!, p = residents[id]!;
    const o = p.outing;
    let delta: ResidentNeeds;
    if (o?.status === 'present') {
      const venue = nav.getBuilding(o.venueId);
      const spec = o.kind === 'visit' ? HOME_VISIT : VENUES[venue!.type!]!;
      const together = (present.get(o.venueId)?.length ?? 1) > 1;
      const interests = o.eventId && eventMap.get(o.eventId) ? EVENTS[eventMap.get(o.eventId)!.kind].interests : spec.interests;
      const liked = p.interests.some((i) => interests.includes(i)) ? 2 : 0;
      delta = addRates(NEED_RATES.outing, { ...spec.effect, social: spec.effect.social + (together ? 2 : 0), fun: spec.effect.fun + liked });
    } else if (c.activity === 'sleep') delta = NEED_RATES.sleep;
    else if (c.activity === 'work' && c.movement?.status === 'inside') delta = NEED_RATES.work;
    else if (c.movement?.status === 'inside' && c.movement.currentBuildingId === c.homeBuildingId) delta = p.hostingUntil > tick ? addRates(NEED_RATES.home, { energy: 0, hunger: 0, social: 8, fun: 3 }) : NEED_RATES.home;
    else delta = NEED_RATES.travel;
    // Life Mode: the player's company counts (greeting or chatting with this resident right now).
    const pa = world.player?.activity;
    if (pa && pa.phase === 'performing' && pa.citizenId === id && (pa.kind === 'greet' || pa.kind === 'socialize')) delta = addRates(delta, { energy: 0, hunger: 0, social: SOCIETY.playerChatSocial, fun: 1 });
    const needs = addNeeds(p.needs, delta);
    if (needs.energy !== p.needs.energy || needs.hunger !== p.needs.hunger || needs.social !== p.needs.social || needs.fun !== p.needs.fun) set(id, { ...residents[id]!, needs });
  }
  // Mingling: residents at a venue together interact (companions side by side first).
  for (const [venueId, list] of present) {
    if (list.length < 2 || (minute + hash(`mingle|${venueId}`) % SOCIETY.mingleMinutes) % SOCIETY.mingleMinutes !== 0) continue;
    // Each resident talks with someone there: their companion or the person they know best, else the next newcomer.
    const ordered = [...list].sort((x, y) => byString(residents[x]!.outing!.id, residents[y]!.outing!.id) || byString(x, y));
    const eventId = residents[ordered[0]!]!.outing!.eventId;
    const known = relationshipsOf(s.relationships);
    const paired = new Set<string>();
    const pairs: [string, string][] = [];
    for (const x of ordered) {
      if (paired.has(x)) continue;
      const companion = residents[x]!.outing!.companions.find((y) => !paired.has(y) && list.includes(y));
      const friend = companion ?? (known.get(x) ?? []).map((r) => otherOf(r, x)).find((y) => !paired.has(y) && y !== x && list.includes(y));
      const y = friend ?? ordered.find((z) => z !== x && !paired.has(z));
      if (!y) break;
      paired.add(x); paired.add(y); pairs.push([x, y]);
    }
    for (const [x, y] of pairs) {
      const px = residents[x]!, py = residents[y]!;
      const shared = px.interests.some((interest) => py.interests.includes(interest)) ? SOCIETY.gains.sharedInterest : 0;
      const sociable = px.traits.sociability >= 60 && py.traits.sociability >= 60 ? SOCIETY.gains.sociable : 0;
      bonds.gain(x, y, SOCIETY.gains.together + shared + sociable + (eventId !== null ? SOCIETY.gains.event : 0));
    }
  }
  // Coworkers bond over lunch on workdays (one colleague each, rotating daily).
  if (minute === SOCIETY.lunchMinute) {
    const teams = new Map<string, string[]>();
    for (const c of world.citizens) if (c.activity === 'work' && c.movement?.status === 'inside' && c.movement.currentBuildingId === c.workBuildingId) teams.set(c.workBuildingId!, [...(teams.get(c.workBuildingId!) ?? []), c.id]);
    const week = Math.floor(day / 7);
    for (const team of teams.values()) {
      const order = [...team].sort((x, y) => hash(`${week}|lunch|${x}`) - hash(`${week}|lunch|${y}`) || byString(x, y));
      for (let i = 0; i + 1 < order.length; i += 2) bonds.gain(order[i]!, order[i + 1]!, SOCIETY.gains.coworkers);
    }
  }
  // Residents sharing a home spend the evening together (each with the next housemate by ID).
  if (minute === SOCIETY.householdMinute) {
    const homes = new Map<string, string[]>();
    for (const c of world.citizens) if (c.movement?.status === 'inside' && c.movement.currentBuildingId === c.homeBuildingId) homes.set(c.homeBuildingId, [...(homes.get(c.homeBuildingId) ?? []), c.id]);
    for (const members of homes.values()) {
      const order = [...members].sort(byString);
      for (let i = 0; i + 1 < order.length; i += 2) bonds.gain(order[i]!, order[i + 1]!, SOCIETY.gains.household);
    }
  }
  const relationships = bonds.result();
  events.push(...bonds.events);
  if (bonds.newFriendships) today = { ...today, newFriendships: today.newFriendships + bonds.newFriendships };
  if (!changed && relationships === s.relationships && !eventsChanged && today === s.today && economy === world.economy) return { state: world, events };
  const society: SocietyState = { ...s, residents: changed ? residents : s.residents, relationships, today,
    events: eventsChanged ? s.events.map((e) => eventMap.get(e.id)!) : s.events };
  return { state: { ...world, society, ...(economy ? { economy } : {}) }, events };
}
/** Whether a resident inside the venue is being served now (events and screenings admit their audience early). */
function opened(venue: Building | undefined, o: Outing, minute: number): boolean {
  if (!venue || o.kind === 'visit' || o.eventId) return true;
  const spec = VENUES[venue.type!];
  if (!spec || spec.sessions) return true;
  const m = minute < spec.open && spec.close > MINUTES_PER_DAY ? minute + MINUTES_PER_DAY : minute;
  return m >= spec.open && m <= spec.close;
}
const addRates = (a: ResidentNeeds, b: ResidentNeeds): ResidentNeeds => ({ energy: a.energy + b.energy, hunger: a.hunger + b.hunger, social: a.social + b.social, fun: a.fun + b.fun });
