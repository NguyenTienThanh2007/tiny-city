import { describe, expect, it } from 'vitest';
import { deserializeWorld, EVENTS, serializeWorld, Simulation, validateRoadPlacement } from '../src/index.js';
import type { BuildingType, CityEventKind, CitySnapshot, Position } from '../src/index.js';
import { societyTown } from './societyFixture.js';
import { assertSocietyInvariants } from './societyHelpers.js';

/** Small deterministic PRNG for the fuzz schedule (not the simulation's own RNG). */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SEEDS = Number(process.env.SOCIETY_FUZZ_SEEDS ?? 4);
const STEPS = Number(process.env.SOCIETY_FUZZ_STEPS ?? 60);
const VENUE_TYPES: readonly BuildingType[] = ['cafe', 'shops', 'market', 'cinema', 'nightclub', 'stage', 'plaza', 'amusement', 'park', 'villa', 'townhouse', 'office'];

/** One fuzz run; returns the final saved world so a second run can prove it replays identically. */
function fuzz(seed: number): string {
  const random = prng(seed * 104_729);
  const pick = <T>(list: readonly T[]): T | undefined => list.length ? list[Math.floor(random() * list.length)] : undefined;
  let sim = new Simulation(societyTown({ apartment: 1, townhouse: 4, villa: 8, duplex: 2, cafe: 2, shops: 1, market: 1, cinema: 1, nightclub: 1, stage: 1, plaza: 1, office: 2, park: 1, pool: 1 },
    { seed: `society-fuzz-${seed}`, funds: 80_000 }));
  sim.executeTransport({ type: 'transport.create-line', stops: [{ x: 10, y: 8 }, { x: 45, y: 8 }, { x: 45, y: 22 }, { x: 10, y: 22 }], buses: 2 });
  sim.step(900 + Math.floor(random() * 600));
  const history: CitySnapshot[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    const state = sim.getState();
    const roll = random();
    if (roll < 0.14) {
      const start = pick(state.plan.roads)!;
      const remove = state.plan.roads.filter((t) => Math.abs(t.x - start.x) + Math.abs(t.y - start.y) <= Math.floor(random() * 2));
      history.push(sim.getCitySnapshot());
      sim.execute({ type: 'city.edit-roads', add: [], remove });
    } else if (roll < 0.22) {
      const x = 3 + Math.floor(random() * 56), y = 9 + Math.floor(random() * 40);
      const add: Position[] = [];
      for (let i = 0; i < 5; i += 1) { const tile = random() < 0.5 ? { x: x + i, y } : { x, y: y + i }; if (validateRoadPlacement(state, tile).valid && !add.some((t) => t.x === tile.x && t.y === tile.y)) add.push(tile); }
      if (add.length) { history.push(sim.getCitySnapshot()); sim.execute({ type: 'city.edit-roads', add, remove: [] }); }
    } else if (roll < 0.34) {
      // Demolish, preferring venues with visitors or events (the interesting reconciliation cases).
      const busy = Object.values(state.society!.residents).map((p) => p.outing?.venueId).filter((id): id is string => !!id);
      const target = random() < 0.6 ? pick(busy) : pick(state.plan.buildings)?.id;
      if (target) { history.push(sim.getCitySnapshot()); sim.execute({ type: 'city.demolish', buildingId: target }); }
    } else if (roll < 0.44) {
      const road = pick(state.plan.roads)!;
      history.push(sim.getCitySnapshot());
      sim.execute({ type: 'city.build', buildingType: pick(VENUE_TYPES)!, position: { x: road.x + 1, y: road.y + 1 } });
    } else if (roll < 0.54 && history.length) {
      const snapshot = history.pop()!;
      if (sim.canRestoreCity(snapshot)) sim.restoreCity(snapshot);
    } else if (roll < 0.64) {
      const venue = pick(state.plan.buildings.filter((b) => b.type === 'plaza' || b.type === 'stage' || b.type === 'market'));
      if (venue) {
        const kinds = (Object.keys(EVENTS) as CityEventKind[]).filter((k) => EVENTS[k].venues.includes(venue.type!));
        const day = Math.floor(state.clock.tick / 1440) + Math.floor(random() * 2);
        sim.executeSociety({ type: 'society.schedule-event', venueId: venue.id, kind: pick(kinds)!, day, startMinute: Math.floor(random() * 1440) });
      }
    } else if (roll < 0.68) {
      const event = pick(state.society!.events.filter((e) => e.status === 'scheduled'));
      if (event) sim.executeSociety({ type: 'society.cancel-event', eventId: event.id });
    } else if (roll < 0.76) {
      const saved = serializeWorld(sim.getState());
      const reloaded = new Simulation(deserializeWorld(saved));
      expect(serializeWorld(reloaded.getState())).toBe(saved);
      sim = reloaded;
    }
    assertSocietyInvariants(sim.getState());
    const ticks = 1 + Math.floor(random() * 90);
    for (let i = 0; i < ticks; i += 1) {
      sim.step(1);
      if (i % 5 === 0) assertSocietyInvariants(sim.getState());
    }
  }
  assertSocietyInvariants(sim.getState());
  return serializeWorld(sim.getState());
}

describe('society fuzz: edits, demolitions, undo, events, save/load and ticks keep every invariant', () => {
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    it(`seed ${seed}`, () => {
      const first = fuzz(seed);
      if (seed === 1) expect(fuzz(seed)).toBe(first);
    }, 180_000);
  }
});
