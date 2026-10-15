import { describe, expect, it } from 'vitest';
import {
  BUILDING_CATALOG, deserializeWorld, EVENTS, getGameTime, interestsFor, LEDGER_FLOWS, personalityFor, serializeWorld, Simulation, SOCIETY, VENUES,
  validateWorld, visitorCapacity,
} from '../src/index.js';
import type { SimulationEvent, SocialProfile, WorldState } from '../src/index.js';
import { LIVELY, societyTown } from './societyFixture.js';
import { assertSocietyInvariants, ofType, runSociety } from './societyHelpers.js';

const DAY = 1440;
/** Runs to `minute` of `day` (from a fresh simulation's clock). */
function runTo(sim: Simulation, day: number, minute: number, every = 0) {
  const target = day * DAY + minute;
  return runSociety(sim, Math.max(0, target - sim.getState().clock.tick), every);
}
function patch(world: WorldState, id: string, change: (p: SocialProfile) => SocialProfile): WorldState {
  const s = world.society!;
  return { ...world, society: { ...s, residents: { ...s.residents, [id]: change(s.residents[id]!) } } };
}
const week = (() => {
  const sim = new Simulation(societyTown(LIVELY));
  const events = runSociety(sim, 7 * DAY, 30);
  return { sim, events, state: sim.getState() };
})();

describe('personality', () => {
  it('derives stable traits and two interests from identity alone, and stores them', () => {
    const a = personalityFor({ id: 'npc-7', name: 'Mai 7' });
    expect(personalityFor({ id: 'npc-7', name: 'Mai 7' })).toEqual(a);
    expect(personalityFor({ id: 'npc-8', name: 'Mai 8' })).not.toEqual(a);
    for (const v of Object.values(a)) expect(v).toBeGreaterThanOrEqual(10), expect(v).toBeLessThanOrEqual(90);
    const interests = interestsFor({ id: 'npc-7', name: 'Mai 7' });
    expect(interests).toHaveLength(2);
    expect(new Set(interests).size).toBe(2);
    // Stored once: a week of living never changes anyone's traits or interests.
    const start = new Simulation(societyTown(LIVELY)).getState().society!;
    for (const [id, p] of Object.entries(week.state.society!.residents)) {
      expect(p.traits).toEqual(start.residents[id]!.traits);
      expect(p.interests).toEqual(start.residents[id]!.interests);
    }
  });

  it('spreads personalities across the population (no two traits identical for everyone)', () => {
    const profiles = Object.values(week.state.society!.residents);
    for (const trait of ['sociability', 'curiosity', 'vitality', 'frugality', 'community'] as const) {
      const values = profiles.map((p) => p.traits[trait]);
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(25);
    }
    expect(new Set(profiles.map((p) => p.interests.join('+'))).size).toBeGreaterThan(8);
  });
});

describe('needs and decisions', () => {
  it('keeps needs bounded and responsive: work drains fun, time out restores it', () => {
    const sim = new Simulation(societyTown(LIVELY));
    runTo(sim, 0, 16 * 60 + 50);
    const workers = sim.getState().citizens.filter((c) => c.activity === 'work').map((c) => c.id);
    expect(workers.length).toBeGreaterThan(10);
    const before = sim.getState().society!.residents;
    const startFun = new Simulation(societyTown(LIVELY)).getState().society!.residents;
    expect(workers.filter((id) => before[id]!.needs.fun < startFun[id]!.needs.fun).length).toBe(workers.length);
    const events = runTo(sim, 0, 22 * 60);
    const outed = new Set(ofType(events, 'society.outing-arrived').map((e) => e.citizenId));
    const after = sim.getState().society!.residents;
    const gained = [...outed].filter((id) => after[id]!.needs.fun > before[id]!.needs.fun);
    expect(gained.length).toBeGreaterThan(outed.size * 0.8);
  });

  it('a hungry food lover eats out after work; a frugal resident short of money picks something free', () => {
    const sim = new Simulation(societyTown({ villa: 2, cafe: 1, park: 1, office: 1, plaza: 1 }));
    runTo(sim, 0, 16 * 60 + 40);
    const [a, b] = sim.getState().citizens.filter((c) => c.workBuildingId !== null).map((c) => c.id);
    let world = patch(sim.getState(), a!, (p) => ({ ...p, interests: ['food', 'arts'], needs: { ...p.needs, hunger: 8, energy: 70 }, traits: { ...p.traits, frugality: 30 } }));
    world = patch(world, b!, (p) => ({ ...p, interests: ['outdoors', 'arts'], needs: { ...p.needs, hunger: 80, energy: 70, fun: 20 }, traits: { ...p.traits, frugality: 95 } }));
    world = { ...world, economy: { ...world.economy!, residents: { ...world.economy!.residents, [b!]: { balance: 30, income: 0, taxes: 0, spending: 0 } } } };
    const next = new Simulation(world);
    runTo(next, 0, 19 * 60);
    const choices = next.getState().society!.residents;
    const first = (id: string) => ofType(runSociety(new Simulation(world), 140), 'society.outing-planned').find((e) => e.citizenId === id);
    const ate = first(a!);
    expect(ate?.kind).toBe('dine');
    expect(ate?.reasons).toContain('hungry');
    const thrifty = first(b!);
    // Free choices only: a walk, the plaza, a friend's home, or staying in to save.
    if (thrifty) expect(['park', 'plaza', 'visit']).toContain(thrifty.kind);
    else expect(choices[b!]!.lastChoice?.reasons).toContain('saving');
  });

  it('tired residents stay in, and every decision explains itself', () => {
    const sim = new Simulation(societyTown({ villa: 1, cafe: 1, office: 1 }));
    runTo(sim, 0, 16 * 60 + 40);
    const ids = sim.getState().citizens.map((c) => c.id);
    let world = sim.getState();
    for (const id of ids) world = patch(world, id, (p) => ({ ...p, needs: { ...p.needs, energy: 10 } }));
    const tired = new Simulation(world);
    const events = runTo(tired, 0, 18 * 60);
    expect(ofType(events, 'society.outing-planned')).toHaveLength(0);
    for (const id of ids) {
      const choice = tired.getState().society!.residents[id]!.lastChoice;
      expect(choice?.kind).toBe('stay-home');
      expect(choice!.reasons.length).toBeGreaterThan(0);
    }
    for (const e of ofType(week.events, 'society.outing-planned')) expect(e.reasons.length).toBeGreaterThan(0);
  });

  it('different personalities choose different activities, following their interests', () => {
    const planned = ofType(week.events, 'society.outing-planned');
    expect(new Set(planned.map((e) => e.kind)).size).toBeGreaterThanOrEqual(8);
    const profiles = week.state.society!.residents;
    const ids = Object.keys(profiles);
    // Chosen on their own (not invited by a friend): how often does the activity match one of the chooser's interests,
    // against how often it would if the same activities had been chosen by residents picked at random?
    const own = planned.filter((e) => !e.reasons.some((r) => r.startsWith('friend:')));
    const interestsOf = (e: (typeof own)[number]) => {
      const event = week.state.society!.events.find((x) => x.venueId === e.venueId && e.kind === 'event');
      const type = week.state.plan.buildings.find((b) => b.id === e.venueId)?.type;
      return event ? EVENTS[event.kind].interests : type && VENUES[type] ? VENUES[type]!.interests : [];
    };
    const matches = own.filter((e) => profiles[e.citizenId]!.interests.some((i) => interestsOf(e).includes(i))).length;
    const chance = own.reduce((sum, e) => sum + ids.filter((id) => profiles[id]!.interests.some((i) => interestsOf(e).includes(i))).length / ids.length, 0);
    expect(matches).toBeGreaterThan(chance * 1.3);
    // Outdoors and fitness lovers are over-represented in parks and pools; film lovers at the cinema.
    const share = (kinds: string[], interests: string[]) => {
      const chosen = own.filter((e) => kinds.includes(e.kind));
      return chosen.filter((e) => profiles[e.citizenId]!.interests.some((i) => interests.includes(i))).length / Math.max(1, chosen.length);
    };
    const base = (interests: string[]) => ids.filter((id) => profiles[id]!.interests.some((i) => interests.includes(i))).length / ids.length;
    expect(share(['park', 'swim'], ['outdoors', 'fitness'])).toBeGreaterThan(base(['outdoors', 'fitness']));
  });
});

describe('routines', () => {
  it('keeps work meaningful: on workdays everyone with a job is at work mid-morning, and no outing overlaps work', () => {
    const sim = new Simulation(societyTown(LIVELY));
    const events = runTo(sim, 1, 10 * 60, 60);
    const employed = sim.getState().citizens.filter((c) => c.workBuildingId !== null);
    expect(employed.length).toBeGreaterThan(20);
    expect(employed.filter((c) => c.activity === 'work').length).toBe(employed.length);
    for (const e of ofType(events, 'society.outing-planned')) {
      const c = sim.getState().citizens.find((x) => x.id === e.citizenId)!;
      const start = c.schedule.entries.find((x) => x.activity === 'work')?.startMinute;
      if (start === undefined || c.workBuildingId === null) continue;
      const day = Math.floor(e.tick / DAY);
      if ((day % 7) >= 4) continue;
      const nextWork = (day + 1) * DAY + start;
      const outing = Object.values(sim.getState().society!.residents).find((p) => p.outing?.id === e.outingId)?.outing;
      if (outing) expect(outing.endTick).toBeLessThanOrEqual(nextWork - SOCIETY.workBufferMinutes);
    }
  });

  it('makes weekends different: no work on Saturday, more and longer outings', () => {
    const sat = week.state.society!.history.find((d) => d.day === 5)!, mon = week.state.society!.history.find((d) => d.day === 0)!;
    expect(sat.outings).toBeGreaterThan(mon.outings * 1.5);
    const sim = new Simulation(societyTown(LIVELY));
    runTo(sim, 5, 11 * 60);
    expect(sim.getState().citizens.some((c) => c.activity === 'work')).toBe(false);
    const daytime = ofType(week.events, 'society.outing-arrived').filter((e) => Math.floor(e.tick / DAY) === 5 && e.tick % DAY < 17 * 60);
    expect(daytime.length).toBeGreaterThan(5);
  });

  it('staggers decisions: residents do not all leave at the same minute', () => {
    const planned = ofType(week.events, 'society.outing-planned').filter((e) => Math.floor(e.tick / DAY) === 1);
    expect(new Set(planned.map((e) => e.tick)).size).toBeGreaterThan(planned.length / 3);
  });
});

describe('venues', () => {
  it('opens the night market only in the evening and keeps every visit within opening hours', () => {
    const arrivals = ofType(week.events, 'society.outing-arrived');
    const market = week.state.plan.buildings.find((b) => b.type === 'market')!;
    const atMarket = arrivals.filter((e) => e.venueId === market.id && !week.state.society!.events.some((ev) => ev.venueId === market.id && ev.attendees.includes(e.citizenId)));
    expect(atMarket.length).toBeGreaterThan(5);
    for (const e of atMarket) expect(e.tick % DAY).toBeGreaterThanOrEqual(VENUES.market!.open);
  });

  it('never exceeds capacity: a crowd of residents and one café turns the overflow away', () => {
    const sim = new Simulation(societyTown({ apartment: 2, cafe: 1, office: 2 }));
    const cafe = sim.getState().plan.buildings.find((b) => b.type === 'cafe')!;
    let peak = 0;
    const events: SimulationEvent[] = [];
    for (let i = 0; i < 3 * DAY; i += 1) {
      const r = sim.step(1);
      events.push(...r.events);
      const here = Object.values(r.state.society!.residents).filter((p) => p.outing?.venueId === cafe.id && p.outing.status === 'present').length;
      peak = Math.max(peak, here);
      if (i % 60 === 0) assertSocietyInvariants(r.state);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(visitorCapacity(cafe));
    expect(ofType(events, 'society.turned-away').length).toBeGreaterThan(0);
  });

  it('residents travel to venues on the real roads, by car or bus when that is quicker', () => {
    const outingTrips = new Set(ofType(week.events, 'society.outing-planned').map((e) => `${e.citizenId}>${e.venueId}`));
    const trips = ofType(week.events, 'transport.trip-started').filter((e) => outingTrips.has(`${e.citizenId}>${e.destinationBuildingId}`));
    expect(trips.length).toBeGreaterThan(10);
    expect(trips.some((t) => t.mode === 'car')).toBe(true);
  });

  it('a venue demolished mid-visit ends its outings safely and leaves no references', () => {
    const sim = new Simulation(societyTown(LIVELY));
    let venue: string | null = null;
    for (let i = 0; i < 2 * DAY && !venue; i += 1) {
      sim.step(1);
      const present = Object.values(sim.getState().society!.residents).find((p) => p.outing?.status === 'present' && sim.getState().plan.buildings.find((b) => b.id === p.outing!.venueId)?.kind !== 'home');
      venue = present?.outing?.venueId ?? null;
    }
    expect(venue).not.toBeNull();
    const result = sim.execute({ type: 'city.demolish', buildingId: venue! });
    expect(result.applied).toBe(true);
    const ended = ofType(result.events, 'society.outing-ended');
    expect(ended.length).toBeGreaterThan(0);
    expect(ended.every((e) => e.result === 'cancelled' && e.reason === 'venue-removed')).toBe(true);
    assertSocietyInvariants(sim.getState());
    expect(Object.values(sim.getState().society!.residents).some((p) => p.outing?.venueId === venue)).toBe(false);
    runSociety(sim, 600, 30);
  });
});

describe('employment', () => {
  it('staffs every venue: new hires join the least-staffed workplace, and worlds without society keep first-vacancy hiring', () => {
    // Under the original rule the first workplace by ID fills completely before the next one hires anyone.
    const spec = { townhouse: 6, villa: 6, office: 1, cafe: 1, shops: 1, nightclub: 1 } as const;
    const social = new Simulation(societyTown(spec)).getState();
    const staff = (w: WorldState, type: string) => w.citizens.filter((c) => w.plan.buildings.find((b) => b.id === c.workBuildingId)?.type === type).length;
    for (const type of ['cafe', 'shops', 'nightclub']) expect(staff(social, type), type).toBeGreaterThan(0);
    const legacy = new Simulation(societyTown(spec, { society: false })).getState();
    const firstJob = [...legacy.plan.buildings].filter((b) => b.kind === 'workplace').sort((a, b) => a.id < b.id ? -1 : 1)[0]!;
    const employed = legacy.citizens.filter((c) => c.workBuildingId !== null);
    expect(employed.filter((c) => c.workBuildingId === firstJob.id).length).toBe(Math.min(employed.length, firstJob.capacity));
  });
});

describe('relationships', () => {
  it('form from real time together, stay symmetric and bounded, and grow into friendships', () => {
    const s = week.state.society!;
    expect(s.relationships.length).toBeGreaterThan(20);
    const friends = s.relationships.filter((r) => r.strength >= SOCIETY.friendAt);
    expect(friends.length).toBeGreaterThan(3);
    const formed = ofType(week.events, 'society.relationship-changed').filter((e) => e.level === 'friend');
    expect(formed.length).toBeGreaterThan(0);
    for (const e of formed) expect(s.relationships.some((r) => r.a === e.a && r.b === e.b)).toBe(true);
    const counts = new Map<string, number>();
    for (const r of s.relationships) { expect(r.a < r.b).toBe(true); for (const id of [r.a, r.b]) counts.set(id, (counts.get(id) ?? 0) + 1); }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(SOCIETY.relationshipsPerResident);
    // No pair gains more than the daily cap.
    expect(s.relationships.every((r) => r.gainedToday <= SOCIETY.dailyGainCap)).toBe(true);
  });

  it('friends go out together and visit each other', () => {
    const groups = new Map<string, string[]>();
    for (const e of ofType(week.events, 'society.outing-planned')) groups.set(e.outingId, [...(groups.get(e.outingId) ?? []), e.citizenId]);
    expect([...groups.values()].some((m) => m.length > 1)).toBe(true);
    expect(ofType(week.events, 'society.outing-planned').some((e) => e.kind === 'visit')).toBe(true);
  });

  it('removes a departed resident\'s relationships (no dangling references)', () => {
    const sim = new Simulation(week.state);
    const r = sim.getState().society!.relationships[0]!;
    const home = sim.getState().citizens.find((c) => c.id === r.a)!.homeBuildingId;
    sim.execute({ type: 'city.demolish', buildingId: home });
    const ids = new Set(sim.getState().citizens.map((c) => c.id));
    for (const rel of sim.getState().society!.relationships) expect(ids.has(rel.a) && ids.has(rel.b)).toBe(true);
    assertSocietyInvariants(sim.getState());
  });
});

describe('events', () => {
  it('fills the calendar ahead from the city schedule, never in the past, at most one per venue per day', () => {
    const sim = new Simulation(societyTown(LIVELY));
    sim.step(1);
    const events = sim.getState().society!.events;
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.startTick).toBeGreaterThan(0);
    const keys = events.map((e) => `${e.venueId}:${Math.floor(e.startTick / DAY)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('attracts real attendees who arrived, within capacity, and finishes on time', () => {
    const finished = week.state.society!.events.filter((e) => e.status === 'finished');
    expect(finished.length).toBeGreaterThan(2);
    const attended = finished.filter((e) => e.attendees.length > 0);
    expect(attended.length).toBeGreaterThan(1);
    const arrived = ofType(week.events, 'society.outing-arrived');
    for (const e of attended) {
      expect(e.attendees.length).toBeLessThanOrEqual(e.capacity);
      for (const a of e.attendees) expect(arrived.some((x) => x.citizenId === a && x.venueId === e.venueId && x.tick >= e.startTick - 200 && x.tick <= e.endTick)).toBe(true);
    }
    const ends = ofType(week.events, 'society.event-ended');
    for (const e of ends) expect(e.tick).toBe(week.state.society!.events.find((x) => x.id === e.eventId)?.endTick ?? e.tick);
  });

  it('validates the player\'s events and cancels events whose venue is demolished', () => {
    const sim = new Simulation(societyTown(LIVELY));
    const plaza = sim.getState().plan.buildings.find((b) => b.type === 'plaza')!;
    const cafe = sim.getState().plan.buildings.find((b) => b.type === 'cafe')!;
    expect(sim.executeSociety({ type: 'society.schedule-event', venueId: cafe.id, kind: 'concert', day: 0, startMinute: 1200 }).reason).toBe('unsupported-event');
    expect(sim.executeSociety({ type: 'society.schedule-event', venueId: plaza.id, kind: 'performance', day: 0, startMinute: 0 }).reason).toBe('invalid-time');
    expect(sim.executeSociety({ type: 'society.schedule-event', venueId: plaza.id, kind: 'performance', day: 9, startMinute: 600 }).reason).toBe('invalid-time');
    const ok = sim.executeSociety({ type: 'society.schedule-event', venueId: plaza.id, kind: 'performance', day: 0, startMinute: 11 * 60 });
    expect(ok.applied).toBe(true);
    expect(sim.executeSociety({ type: 'society.schedule-event', venueId: plaza.id, kind: 'festival', day: 0, startMinute: 12 * 60 }).reason).toBe('venue-busy');
    const cancelled = sim.executeSociety({ type: 'society.cancel-event', eventId: ok.eventId! });
    expect(cancelled.applied).toBe(true);
    const again = sim.executeSociety({ type: 'society.schedule-event', venueId: plaza.id, kind: 'festival', day: 0, startMinute: 12 * 60 });
    expect(again.applied).toBe(true);
    runTo(sim, 0, 12 * 60 + 30, 30);
    expect(sim.getState().society!.events.find((e) => e.id === again.eventId)?.status).toBe('running');
    const removed = sim.execute({ type: 'city.demolish', buildingId: plaza.id });
    expect(ofType(removed.events, 'society.event-cancelled').some((e) => e.eventId === again.eventId)).toBe(true);
    expect(sim.getState().society!.events.find((e) => e.id === again.eventId)?.status).toBe('cancelled');
    for (const p of Object.values(sim.getState().society!.residents)) expect(p.outing?.eventId).not.toBe(again.eventId);
    assertSocietyInvariants(sim.getState());
  });
});

describe('economy', () => {
  it('charges each outing once, pays businesses exactly what residents paid, and keeps every ledger invariant', () => {
    const e = week.state.economy!;
    for (const t of e.ledger) expect([t.from, t.to]).toEqual(LEDGER_FLOWS[t.category]);
    const arrived = ofType(week.events, 'society.outing-arrived');
    expect(new Set(arrived.map((a) => `${a.citizenId}:${a.outingId}`)).size).toBe(arrived.length);
    const spent = arrived.reduce((sum, a) => sum + a.spent, 0);
    const reports = week.state.society!.history.concat(week.state.society!.today);
    expect(reports.reduce((sum, d) => sum + d.spending, 0)).toBe(spent);
    // The ledger keeps the latest entries only: check the days it still holds completely.
    const firstDay = Math.min(...e.ledger.map((t) => t.day));
    for (const r of e.history.filter((x) => x.day > firstDay)) {
      expect(r.leisureWaived).toBe(0);
      const sales = e.ledger.filter((t) => t.day === r.day && t.category === 'business.sales' && week.state.plan.buildings.find((b) => b.id === t.buildingId)?.type !== 'mall');
      expect(sales.reduce((sum, t) => sum + t.amount, 0)).toBe(r.leisureSpending);
    }
    const venueBusiness = Object.values(e.buildings).filter((f) => ['cafe', 'shops', 'market', 'cinema', 'nightclub', 'amusement'].includes(f.role));
    expect(venueBusiness.length).toBe(7); // two cafés and one of each other business venue
    expect(venueBusiness.some((f) => f.revenue > 0)).toBe(true);
    expect(e.history.some((r) => (r.expenses.events ?? 0) > 0)).toBe(true);
  });

  it('never lets leisure spending go beyond what a resident can afford', () => {
    const e = week.state.economy!;
    for (const r of e.history) expect(r.leisureWaived ?? 0).toBe(0);
    for (const a of Object.values(e.residents)) expect(a.balance).toBeGreaterThanOrEqual(0);
  });
});

describe('life mode', () => {
  const look = { skinTone: 1, hairStyle: 'short', hairColor: 2, outfit: 'tee', outfitColor: 3, accessory: 'none' } as const;
  const town = () => {
    const sim = new Simulation(societyTown({ townhouse: 2, cafe: 1, cinema: 1, plaza: 1, office: 1 }, { maxCitizens: 4 }));
    // The second townhouse has free rooms (four residents fill the first).
    const home = sim.getState().plan.buildings.filter((b) => b.type === 'townhouse').find((b) => !sim.getState().citizens.some((c) => c.homeBuildingId === b.id))!;
    expect(sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look, homeBuildingId: home.id }).applied).toBe(true);
    return sim;
  };
  const id = (sim: Simulation, type: string) => sim.getState().plan.buildings.find((b) => b.type === type)!.id;

  it('visits open venues only, eats out at the café, and refuses closed ones', () => {
    const sim = town();
    sim.step(3 * 60);
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'visit', buildingId: id(sim, 'cafe') }).reason).toBe('venue-closed');
    sim.step(8 * 60);
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'visit', buildingId: id(sim, 'cinema') }).reason).toBe('venue-closed');
    const hungry = sim.getState().player!.needs.hunger;
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'eat', buildingId: id(sim, 'cafe') }).applied).toBe(true);
    const events = runSociety(sim, 240, 20);
    const ended = ofType(events, 'player.activity-ended').find((e) => e.outcome.kind === 'eat');
    expect(ended?.outcome.result).toBe('completed');
    expect(ended?.outcome.buildingId).toBe(id(sim, 'cafe'));
    expect(sim.getState().player!.needs.hunger).toBeGreaterThan(hungry);
    // Any open venue can be visited, and the visit counts towards its capacity.
    expect(sim.executeLife({ type: 'player.start-activity', activity: 'visit', buildingId: id(sim, 'plaza') }).applied).toBe(true);
  });

  it('a running event lifts the player more than a quiet visit', () => {
    const quiet = town(), lively = town();
    const plaza = id(lively, 'plaza');
    expect(lively.executeSociety({ type: 'society.schedule-event', venueId: plaza, kind: 'festival', day: 0, startMinute: 9 * 60 }).applied).toBe(true);
    for (const sim of [quiet, lively]) { sim.step(9 * 60 + 5); sim.executeLife({ type: 'player.start-activity', activity: 'visit', buildingId: plaza }); }
    const done = (sim: Simulation) => ofType(runSociety(sim, 200), 'player.activity-ended').find((e) => e.outcome.kind === 'visit');
    expect(done(quiet)?.outcome.result).toBe('completed');
    expect(done(lively)?.outcome.result).toBe('completed');
    expect(lively.getState().player!.needs.mood).toBeGreaterThan(quiet.getState().player!.needs.mood);
  });
});

describe('determinism and persistence', () => {
  it('pauses exactly: no society progress while paused', () => {
    const sim = new Simulation(societyTown(LIVELY));
    runTo(sim, 0, 18 * 60);
    sim.pause();
    const before = serializeWorld(sim.getState());
    sim.advance(60_000);
    expect(serializeWorld(sim.getState())).toBe(before);
  });

  it('replays identically: frame chunking, speed and save/load mid-outing change nothing', () => {
    const a = new Simulation(societyTown(LIVELY));
    runTo(a, 0, 18 * 60);
    a.resume();
    // 4× speed: one long frame of 400 ms per four ticks vs four separate ticks.
    const b = new Simulation(deserializeWorld(serializeWorld(a.getState())));
    for (let i = 0; i < 120; i += 1) a.advance(100);
    for (let i = 0; i < 30; i += 1) b.advance(400);
    expect(serializeWorld(b.getState())).toBe(serializeWorld(a.getState()));
    // Save while residents are out, load, continue: identical to the uninterrupted run.
    const present = Object.values(a.getState().society!.residents).filter((p) => p.outing?.status === 'present').length;
    expect(present).toBeGreaterThan(0);
    const c = new Simulation(deserializeWorld(serializeWorld(a.getState())));
    a.step(900); c.step(900);
    expect(serializeWorld(c.getState())).toBe(serializeWorld(a.getState()));
    const fresh = new Simulation(societyTown(LIVELY));
    runSociety(fresh, 7 * DAY);
    expect(serializeWorld(fresh.getState())).toBe(serializeWorld(week.state));
  });

  it('migrates a Phase 6 world: personalities for everyone, no relationships, nothing replayed', () => {
    const old = new Simulation(societyTown(LIVELY, { society: false }));
    old.step(2 * DAY + 600);
    const before = old.getState();
    expect(before.society).toBeUndefined();
    const enabled = old.enableSociety();
    expect(ofType(enabled.events, 'society.enabled')).toHaveLength(1);
    const s = old.getState().society!;
    expect(Object.keys(s.residents).sort()).toEqual(before.citizens.map((c) => c.id).sort());
    expect(s.relationships).toHaveLength(0);
    expect(old.getState().citizens).toEqual(before.citizens);
    expect(old.getState().economy).toEqual(before.economy);
    expect(old.getState().randomState).toBe(before.randomState);
    old.step(1);
    for (const e of old.getState().society!.events) expect(e.startTick).toBeGreaterThan(before.clock.tick);
    expect(old.enableSociety().events).toHaveLength(0);
    // Worlds without society keep their Phase 6 behaviour exactly (society never runs).
    const a = new Simulation(societyTown(LIVELY, { society: false })), b = new Simulation(societyTown(LIVELY, { society: false }));
    a.step(DAY); b.step(DAY);
    expect(serializeWorld(a.getState())).toBe(serializeWorld(b.getState()));
    expect(a.getState().society).toBeUndefined();
  });

  it('survives undo/redo: restoring a city without a venue cancels outings there; redo restores the building', () => {
    const sim = new Simulation(societyTown(LIVELY));
    runTo(sim, 0, 18 * 60 + 30);
    const before = sim.getCitySnapshot();
    const venue = Object.values(sim.getState().society!.residents).find((p) => p.outing && p.outing.kind !== 'visit')?.outing?.venueId;
    expect(venue).toBeDefined();
    sim.execute({ type: 'city.demolish', buildingId: venue! });
    const after = sim.getCitySnapshot();
    assertSocietyInvariants(sim.getState());
    sim.restoreCity(before);
    expect(sim.getState().plan.buildings.some((b) => b.id === venue)).toBe(true);
    assertSocietyInvariants(sim.getState());
    sim.restoreCity(after);
    assertSocietyInvariants(sim.getState());
    runSociety(sim, 300, 30);
  });

  it('keeps the saved society bounded', () => {
    const size = serializeWorld(week.state).length;
    const { society: _society, ...rest } = week.state;
    const withoutSociety = serializeWorld(rest as WorldState).length;
    expect((size - withoutSociety) / week.state.citizens.length).toBeLessThan(700);
  });
});

it('catalog: every venue type is buildable with a footprint, cost, capacity and road access', () => {
  for (const type of ['cafe', 'shops', 'market', 'cinema', 'nightclub', 'stage', 'plaza', 'amusement'] as const) {
    const def = BUILDING_CATALOG[type];
    expect(def.cost).toBeGreaterThan(0);
    expect(def.requiresRoad).toBe(true);
    expect(def.footprint.width * def.footprint.height).toBeGreaterThan(0);
    expect(VENUES[type]).toBeDefined();
  }
  for (const kind of Object.keys(EVENTS) as (keyof typeof EVENTS)[]) expect(EVENTS[kind].venues.length).toBeGreaterThan(0);
  expect(getGameTime(week.state.clock).day).toBe(7);
  validateWorld(week.state);
});
