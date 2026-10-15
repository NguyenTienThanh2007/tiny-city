import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOG, createWorld, Simulation, VENUES } from '@tiny-city/simulation';
import type { Building, BuildingType, WorldState } from '@tiny-city/simulation';
import {
  choiceView, eventSlots, eventViews, friendsOf, outingView, personalitySummary, reasonText, societyOverview, venueView, wellbeing,
} from './societyView';
import { emptyLifeFeed, reduceLifeFeed } from './lifeFeed';
import { crowdLayout } from '../game/venueCrowd';
import { windowsOn } from '../game/lighting';

/** A small street town with homes, an office and venues, society on (the real simulation, no mocks). */
function town(): Simulation {
  const roads = Array.from({ length: 50 }, (_, i) => ({ x: i + 4, y: 20 }));
  const sites: [BuildingType, number, number][] = [['townhouse', 6, 21], ['townhouse', 9, 21], ['villa', 12, 21], ['villa', 15, 21], ['office', 18, 21],
    ['cafe', 24, 21], ['market', 27, 21], ['plaza', 32, 21], ['cinema', 36, 21], ['park', 40, 21]];
  const buildings: Building[] = sites.map(([type, x, y], i) => ({ id: `b${i}`, name: `${BUILDING_CATALOG[type].label} ${i}`, type, kind: BUILDING_CATALOG[type].kind,
    capacity: BUILDING_CATALOG[type].capacity, footprint: BUILDING_CATALOG[type].footprint, position: { x, y } }));
  const sim = new Simulation(createWorld({ id: 't', seed: 'society-view', clock: { paused: true }, startingFunds: 10_000, economy: {}, transport: true, society: true,
    plan: { id: 'p', name: 'P', width: 64, height: 64, roads, blockedTiles: [], buildings } }));
  sim.enablePopulation({ maxCitizens: 100 });
  return sim;
}
const day = (() => { const sim = town(); const events = sim.step(2 * 1440 + 19 * 60).events; return { world: sim.getState(), events }; })();

describe('society view models', () => {
  it('summarises personalities and wellbeing in words', () => {
    expect(personalitySummary({ sociability: 85, curiosity: 50, vitality: 20, frugality: 55, community: 50 })).toEqual(['Outgoing', 'Early to bed']);
    expect(personalitySummary({ sociability: 50, curiosity: 50, vitality: 50, frugality: 50, community: 50 })).toEqual(['Easy-going']);
    expect(wellbeing({ energy: 80, hunger: 80, social: 80, fun: 80 })).toEqual({ value: 80, label: 'Thriving' });
    expect(wellbeing({ energy: 10, hunger: 20, social: 30, fun: 20 }).label).toBe('Struggling');
  });

  it('turns decision factor codes into phrases that name real people and events', () => {
    const friend = day.world.citizens[1]!;
    expect(reasonText(day.world, 'hungry')).toBe('Hungry');
    expect(reasonText(day.world, 'interest:music')).toBe('Loves live music');
    expect(reasonText(day.world, `friend:${friend.id}`)).toBe(`With ${friend.name}`);
    const event = day.world.society!.events[0];
    if (event) expect(reasonText(day.world, `event:${event.id}`)).toBe(event.name);
  });

  it('reads the overview, outings, choices and friends from the authoritative world', () => {
    const w = day.world;
    const overview = societyOverview(w)!;
    const present = Object.values(w.society!.residents).filter((p) => p.outing?.status === 'present').length;
    expect(overview.outNow).toBe(present);
    expect(overview.outingsToday).toBe(w.society!.today.outings);
    expect(overview.residents).toBe(w.citizens.length);
    const out = Object.entries(w.society!.residents).find(([, p]) => p.outing);
    if (out) {
      const view = outingView(w, out[0])!;
      expect(view.venueId).toBe(out[1].outing!.venueId);
      expect(view.companions.map((c) => c.id)).toEqual(out[1].outing!.companions);
    }
    const chose = Object.entries(w.society!.residents).find(([, p]) => p.lastChoice)!;
    expect(choiceView(w, chose[0])!.reasons.length).toBe(chose[1].lastChoice!.reasons.length);
    const someone = w.society!.relationships[0];
    if (someone) expect(friendsOf(w, someone.a).some((f) => f.id === someone.b)).toBe(true);
  });

  it('shows venue hours, open state and only the real visitors; event slots skip booked times', () => {
    const w = day.world;
    const cafe = w.plan.buildings.find((b) => b.type === 'cafe')!;
    const view = venueView(w, cafe)!;
    expect(view.hours).toBe('07:00–23:00');
    expect(view.openNow).toBe(true);
    expect(view.visitors).toBe(Object.values(w.society!.residents).filter((p) => p.outing?.venueId === cafe.id && p.outing.status === 'present').length);
    expect(view.price).toBe(`$${VENUES.cafe!.price} per visit`);
    expect(venueView(w, w.plan.buildings.find((b) => b.type === 'office')!)).toBeNull();
    const plaza = w.plan.buildings.find((b) => b.type === 'plaza')!;
    const slots = eventSlots(w, plaza, 'performance');
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const sim = new Simulation(w);
      expect(sim.executeSociety({ type: 'society.schedule-event', venueId: plaza.id, kind: 'performance', day: slot.day, startMinute: slot.startMinute }).applied).toBe(true);
    }
    expect(eventViews(w).every((e) => e.status === 'scheduled' || e.status === 'running')).toBe(true);
  });
});

describe('city life feed (Phase 7)', () => {
  it('announces friendships, events and group outings once each', () => {
    const w = day.world;
    const [a, b] = w.citizens;
    const event = w.society!.events[0] ?? { id: 'event-1', name: 'Show' };
    const feed = reduceLifeFeed(emptyLifeFeed, [
      { type: 'society.relationship-changed', tick: w.clock.tick, a: a!.id, b: b!.id, level: 'friend', strength: 41 },
      { type: 'society.event-ended', tick: w.clock.tick, eventId: event.id, venueId: 'x', attendance: 7 },
      { type: 'society.outing-planned', tick: w.clock.tick, citizenId: a!.id, outingId: 'outing-9', kind: 'dine', venueId: 'x', companions: [b!.id > a!.id ? b!.id : 'zz'], reasons: [] },
    ], w);
    const texts = feed.entries.map((e) => e.text);
    expect(texts).toContain(`${a!.name} and ${b!.name} became friends`);
    expect(texts.some((t) => t.endsWith('ended · 7 residents attended'))).toBe(true);
    expect(texts).toContain('1 group of friends went out together');
    const again = reduceLifeFeed(feed, [{ type: 'society.relationship-changed', tick: w.clock.tick, a: a!.id, b: b!.id, level: 'friend', strength: 42 }], w);
    expect(again.entries.filter((e) => e.kind === 'friendship')).toHaveLength(1);
  });
});

describe('venue crowds and lights (Phase 7)', () => {
  it('draws only real visitors, keeps companions side by side and cheers during a running event', () => {
    const w = day.world;
    const layout = crowdLayout(w);
    for (const [id, placement] of layout) {
      const c = w.citizens.find((x) => x.id === id)!;
      expect(c.activity).toBe('leisure');
      expect(c.movement!.currentBuildingId).toBe(placement.venueId);
    }
    // A plaza event with two friends attending: they stand next to each other and cheer.
    const plaza = w.plan.buildings.find((b) => b.type === 'plaza')!;
    const [x, y] = w.citizens;
    const s = w.society!;
    const atPlaza = (id: string, partner: string) => ({ ...s.residents[id]!, outing: { id: 'outing-99', kind: 'event' as const, venueId: plaza.id, eventId: 'event-99', companions: [partner], hostId: null,
      decidedTick: 0, startTick: 0, endTick: w.clock.tick + 60, arriveByTick: 0, status: 'present' as const, spent: 0 } });
    const inside = (c: typeof x) => ({ ...c!, activity: 'leisure' as const, position: { x: plaza.position.x + 1.5, y: plaza.position.y + 1.5 },
      movement: { ...c!.movement!, status: 'inside' as const, currentBuildingId: plaza.id, destinationBuildingId: plaza.id, arrivalActivity: 'leisure' as const, route: [], nextWaypoint: 0 } });
    const staged: WorldState = { ...w, citizens: w.citizens.map((c) => c.id === x!.id || c.id === y!.id ? inside(c) : c),
      society: { ...s, residents: { ...s.residents, [x!.id]: atPlaza(x!.id, y!.id), [y!.id]: atPlaza(y!.id, x!.id) },
        events: [...s.events, { id: 'event-99', kind: 'performance', name: 'Show', venueId: plaza.id, startTick: 0, endTick: w.clock.tick + 60, capacity: 40, price: 0, cost: 0,
          organizer: 'player', status: 'running', cancelReason: null, attendees: [x!.id, y!.id] }] } };
    const crowd = crowdLayout(staged);
    const px = crowd.get(x!.id)!, py = crowd.get(y!.id)!;
    expect(px.venueId).toBe(plaza.id);
    expect(Math.hypot(px.position.x - py.position.x, px.position.y - py.position.y)).toBeLessThan(1);
    expect([px.action, py.action]).toContain('cheer');
  });

  it('lights venues for their opening hours: the night market after dark, never at noon', () => {
    expect(windowsOn('market', 'm', 12 * 60)).toBeCloseTo(0.12);
    expect(windowsOn('market', 'm', 21 * 60)).toBe(1);
    expect(windowsOn('market', 'm', 30)).toBe(1);
    expect(windowsOn('market', 'm', 3 * 60)).toBeCloseTo(0.12);
    expect(windowsOn('cafe', 'c', 9 * 60)).toBe(1);
  });
});
