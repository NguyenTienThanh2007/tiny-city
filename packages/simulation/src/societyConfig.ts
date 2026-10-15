import type { BuildingType, CityEventKind, Interest, OutingKind, ResidentNeeds } from './types.js';

/**
 * Phase 7 living society balance. Every value is an integer (minutes, dollars, 0–100 points or percents), so all
 * authoritative arithmetic is integer arithmetic. Tune society here, never inline.
 */
export const SOCIETY = Object.freeze({
  version: 1 as const,
  /** Needs update and free residents reconsider their time once per this many game minutes, staggered by resident. */
  period: 15,
  interests: Object.freeze(['food', 'shopping', 'film', 'music', 'nightlife', 'outdoors', 'arts', 'thrills', 'fitness'] as const satisfies readonly Interest[]),
  /** Interests per resident. */
  interestsPerResident: 2,
  /** Relationship levels (strength thresholds) and bounds. */
  friendAt: 40,
  closeAt: 75,
  relationshipsPerResident: 10,
  /** The most a pair's strength can grow on one game day, so close friendships take several days of real contact. */
  dailyGainCap: 15,
  /** Strength gained per interaction. */
  gains: Object.freeze({ together: 4, sharedInterest: 2, sociable: 1, outing: 8, event: 3, coworkers: 5, household: 3, visit: 8 }),
  /** Daily fading without contact: acquaintances after `acquaintanceDays`, friends after `friendDays`. */
  decay: Object.freeze({ acquaintanceDays: 2, acquaintance: 2, friendDays: 6, friend: 1 }),
  /** Residents at a venue together interact once per this many minutes (staggered by venue), at most this many pairs each. */
  mingleMinutes: 30,
  /** Coworkers bond over lunch at work once a day with one colleague (the same lunch partner all week). */
  lunchMinute: 720,
  /** Residents sharing a home spend the evening together once a day. */
  householdMinute: 1260,
  /** Outings: per day, cool-down after one ends, how long a decision to stay in lasts, and the furthest anyone goes. */
  maxOutings: Object.freeze({ workday: 2, weekend: 3 }),
  cooldownMinutes: 45,
  stayInMinutes: 60,
  maxTravelMinutes: 90,
  /** Utility lost per minute of travel each way (percent of a point): nearby places win, the district stays worth a trip. */
  travelPenaltyPercent: 45,
  /** Utility lost per dollar: price × (base + frugality) / divisor (a $10 ticket costs 10–30 points). */
  price: Object.freeze({ base: 30, divisor: 40 }),
  /** Outings may run past midnight up to this many minutes on work nights (vitality ≥ `nightOwlVitality`) and before days off. */
  lateMinutes: Object.freeze({ workNight: 0, nightOwl: 60, dayOff: 150 }),
  nightOwlVitality: 60,
  /** Outings end at least this long before work starts (travel home and back). */
  workBufferMinutes: 60,
  /** Money: a resident keeps `reserveBase + frugality × reservePerTrait / 100` dollars untouched by leisure. */
  reserveBase: 15,
  reservePerTrait: 40,
  /** Group outings: at most this many companions; friends join only with at least this strength. */
  maxCompanions: 3,
  companionStrength: 25,
  /** A friend's home takes one visitor at a time; visits last this long. */
  visitMinutes: Object.freeze([60, 120] as const),
  /** Options within this many utility points of the best are "similarly good"; a seeded hash picks among them. */
  tieMargin: 6,
  /** Travel estimates for decisions (the actual mode is chosen by Phase 6 transport when the resident leaves). */
  travel: Object.freeze({ detourPercent: 130, carTilesPerMinute: 60, carOverhead: 4, busWait: 10, busTilesPerMinute: 45, stopReach: 6 }),
  /** Bounded state. */
  historyDays: 7,
  recentVenues: 4,
  eventsKept: 40,
  playerEvents: 4,
  /** The calendar is filled this many days ahead (never for days that have passed). */
  lookaheadDays: 3,
  /** A resident chatting with the Life Mode player gains this much company per period. */
  playerChatSocial: 6,
  /** Venue options weighed per activity: the nearest few of each venue type. */
  venuesPerType: 3,
});

/** Day 0 is a Monday; days 5 and 6 are the weekend. The game clock has no real-world calendar. */
export const WEEKDAYS = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const);
export const weekday = (day: number): number => ((day % 7) + 7) % 7;
export const isWeekend = (day: number): boolean => weekday(day) >= 5;

/** Need change per `SOCIETY.period` minutes by what the resident is doing (before venue effects). */
export const NEED_RATES: Readonly<Record<'sleep' | 'home' | 'work' | 'travel' | 'outing', ResidentNeeds>> = Object.freeze({
  sleep: Object.freeze({ energy: 7, hunger: -1, social: 0, fun: 0 }),
  // Meals at home restore hunger and an evening in is restful, but time alone slowly drains company.
  home: Object.freeze({ energy: 1, hunger: 4, social: -2, fun: 0 }),
  // Colleagues keep some company; a working day is tiring, unfun and leaves people hungry by the evening.
  work: Object.freeze({ energy: -1, hunger: -1, social: 1, fun: -1 }),
  travel: Object.freeze({ energy: -1, hunger: -1, social: 0, fun: 0 }),
  outing: Object.freeze({ energy: -1, hunger: -1, social: 0, fun: 0 }),
});
export const INITIAL_NEEDS: ResidentNeeds = Object.freeze({ energy: 80, hunger: 70, social: 60, fun: 60 });

export interface VenueSpec {
  readonly kind: OutingKind;
  readonly label: string;
  /** Price per visit in dollars (pool and clubhouse fees are the Phase 5 venue fees). */
  readonly price: number;
  /** Opening hours in minutes after midnight; `close` may pass 1440 (open after midnight). */
  readonly open: number;
  readonly close: number;
  /** Outing length in minutes (a stable per-resident value in this range). */
  readonly minutes: readonly [number, number];
  /** Cinema: screenings start at these minutes and last `minutes[0]`. */
  readonly sessions?: readonly number[];
  readonly interests: readonly Interest[];
  /** Good with company (groups, meeting friends) or better alone/in pairs (quiet). */
  readonly social: boolean;
  /** Only open for events. */
  readonly eventsOnly?: boolean;
  /** Need change per `SOCIETY.period` minutes while there (added to the outing base rate). */
  readonly effect: ResidentNeeds;
  /** Business venues: daily wage per worker and daily operating costs paid outside the city; public venues: city upkeep. */
  readonly wage: number;
  readonly upkeep: number;
  /** How special an outing it is (utility points before needs, interests and costs). */
  readonly appeal: number;
}

const venue = (kind: OutingKind, label: string, price: number, open: number, close: number, minutes: readonly [number, number], interests: Interest[], social: boolean,
  effect: ResidentNeeds, wage: number, upkeep: number, appeal: number, extra: Partial<VenueSpec> = {}): VenueSpec =>
  Object.freeze({ kind, label, price, open, close, minutes, interests, social, effect: Object.freeze(effect), wage, upkeep, appeal, ...extra });

/** Every leisure venue type and what it offers. Phase 3–6 venues (park, pool, clubhouse) keep their Phase 5 economics. */
export const VENUES: Readonly<Partial<Record<BuildingType, VenueSpec>>> = Object.freeze({
  park: venue('park', 'Walk in the park', 0, 360, 1380, [45, 90], ['outdoors', 'fitness'], false, { energy: 0, hunger: 0, social: 1, fun: 5 }, 0, 10, 2),
  pool: venue('swim', 'Swim', 3, 480, 1260, [60, 90], ['fitness', 'outdoors'], true, { energy: -1, hunger: -1, social: 2, fun: 6 }, 0, 24, 4),
  clubhouse: venue('lounge', 'Clubhouse evening', 4, 600, 1440, [60, 120], ['nightlife', 'food'], true, { energy: 0, hunger: 2, social: 5, fun: 4 }, 0, 18, 4),
  cafe: venue('dine', 'Eat out', 8, 420, 1380, [50, 90], ['food'], true, { energy: 1, hunger: 22, social: 4, fun: 3 }, 16, 30, 6),
  shops: venue('shop', 'Shopping', 8, 540, 1260, [60, 120], ['shopping'], true, { energy: -1, hunger: -1, social: 2, fun: 6 }, 16, 40, 12),
  market: venue('market', 'Night market', 6, 1020, 1500, [60, 120], ['food', 'shopping'], true, { energy: 0, hunger: 14, social: 5, fun: 5 }, 14, 25, 8),
  cinema: venue('movie', 'Film', 9, 780, 1410, [120, 120], ['film'], false, { energy: 0, hunger: 0, social: 2, fun: 8 }, 16, 50, 18, { sessions: Object.freeze([780, 960, 1140, 1290]) }),
  nightclub: venue('club', 'Night out', 9, 1200, 1560, [120, 180], ['music', 'nightlife'], true, { energy: -3, hunger: -1, social: 7, fun: 8 }, 16, 35, 14),
  stage: venue('event', 'Concert', 0, 0, 0, [0, 0], ['music'], true, { energy: -1, hunger: -1, social: 6, fun: 9 }, 0, 30, 0, { eventsOnly: true }),
  plaza: venue('plaza', 'Hang out at the plaza', 0, 480, 1380, [45, 90], ['arts', 'outdoors'], true, { energy: 0, hunger: 0, social: 4, fun: 4 }, 0, 12, 2),
  amusement: venue('rides', 'Amusement park', 14, 600, 1320, [150, 240], ['thrills'], true, { energy: -3, hunger: -2, social: 5, fun: 10 }, 18, 90, 22),
});

/** A friend's home: free, social, quiet. */
export const HOME_VISIT: VenueSpec = venue('visit', 'Visit a friend', 0, 540, 1350, [60, 120], [], true, { energy: 0, hunger: 3, social: 9, fun: 4 }, 0, 0, 4);

export interface EventSpec {
  readonly label: string;
  /** Venue types that can host it. */
  readonly venues: readonly BuildingType[];
  readonly minutes: number;
  readonly price: number;
  /** What the city pays to host it. */
  readonly cost: number;
  readonly interests: readonly Interest[];
  /** Appeal on top of the venue's own (events are special). */
  readonly appeal: number;
}
export const EVENTS: Readonly<Record<CityEventKind, EventSpec>> = Object.freeze({
  concert: Object.freeze({ label: 'Concert', venues: Object.freeze(['stage'] as BuildingType[]), minutes: 150, price: 8, cost: 60, interests: Object.freeze(['music', 'nightlife'] as Interest[]), appeal: 30 }),
  performance: Object.freeze({ label: 'Street performance', venues: Object.freeze(['plaza', 'stage'] as BuildingType[]), minutes: 120, price: 0, cost: 15, interests: Object.freeze(['arts'] as Interest[]), appeal: 14 }),
  'movie-night': Object.freeze({ label: 'Outdoor movie night', venues: Object.freeze(['plaza'] as BuildingType[]), minutes: 120, price: 0, cost: 20, interests: Object.freeze(['film', 'outdoors'] as Interest[]), appeal: 16 }),
  festival: Object.freeze({ label: 'Neighbourhood festival', venues: Object.freeze(['plaza', 'market'] as BuildingType[]), minutes: 300, price: 0, cost: 40, interests: Object.freeze(['food', 'music', 'arts'] as Interest[]), appeal: 18 }),
});

/** The city's standing calendar: per venue type, the weekday (0 = Monday), event and start minute. */
export const CITY_CALENDAR: readonly { readonly venue: BuildingType; readonly weekday: number; readonly kind: CityEventKind; readonly start: number }[] = Object.freeze([
  { venue: 'stage', weekday: 4, kind: 'concert', start: 1200 },
  { venue: 'stage', weekday: 5, kind: 'concert', start: 1200 },
  { venue: 'stage', weekday: 2, kind: 'performance', start: 1110 },
  { venue: 'plaza', weekday: 2, kind: 'performance', start: 1110 },
  { venue: 'plaza', weekday: 3, kind: 'movie-night', start: 1200 },
  { venue: 'plaza', weekday: 6, kind: 'festival', start: 900 },
  { venue: 'market', weekday: 5, kind: 'festival', start: 1080 },
]);
