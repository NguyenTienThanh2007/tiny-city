import { getGameTime, validateWorld, VENUES, visitorCapacity } from '../src/index.js';
import type { SimulationEvent, WorldState } from '../src/index.js';

/**
 * Invariants checked by the society tests beyond `validateWorld` (which already checks profiles ↔ residents,
 * relationships ↔ residents, outing references, event capacity and "present ⇒ inside"):
 * - presence at a venue never exceeds its visitor capacity (a friend's home: one visitor);
 * - nobody is at a venue outside its opening hours unless attending an event there;
 * - no resident is in two running events, and every present resident's activity is leisure;
 * - needs, traits and money are bounded integers (no NaN).
 */
export function assertSocietyInvariants(world: WorldState): void {
  validateWorld(world);
  const s = world.society;
  if (!s) return;
  const buildings = new Map(world.plan.buildings.map((b) => [b.id, b]));
  const citizens = new Map(world.citizens.map((c) => [c.id, c]));
  const { minuteOfDay } = getGameTime(world.clock);
  const present = new Map<string, number>();
  for (const [id, p] of Object.entries(s.residents)) {
    for (const v of [...Object.values(p.needs), ...Object.values(p.traits)]) if (!Number.isSafeInteger(v) || v < 0 || v > 100) throw new Error(`${id} has an invalid need or trait`);
    const o = p.outing;
    if (!o || o.status !== 'present') continue;
    const venue = buildings.get(o.venueId)!;
    present.set(venue.id, (present.get(venue.id) ?? 0) + 1);
    if (citizens.get(id)!.activity !== 'leisure') throw new Error(`${id} is present at ${venue.id} but not at leisure`);
    const spec = venue.type ? VENUES[venue.type] : undefined;
    if (spec && !o.eventId && !spec.sessions) {
      const m = minuteOfDay < spec.open && spec.close > 1440 ? minuteOfDay + 1440 : minuteOfDay;
      if (m < spec.open || m > spec.close) throw new Error(`${id} is at ${venue.id} (${venue.type}) at ${minuteOfDay}, outside its hours`);
    }
  }
  for (const [venueId, count] of present) {
    const venue = buildings.get(venueId)!;
    if (count > (venue.kind === 'home' ? 1 : visitorCapacity(venue))) throw new Error(`${venueId} holds ${count} visitors`);
  }
  const running = new Set<string>();
  for (const e of s.events) if (e.status === 'running') for (const a of e.attendees) {
    if (running.has(a)) throw new Error(`${a} attends two events`);
    running.add(a);
  }
  if (world.economy) for (const [id, a] of Object.entries(world.economy.residents)) if (!Number.isSafeInteger(a.balance) || a.balance < 0) throw new Error(`${id} has an invalid balance`);
}

/** Steps a simulation, collecting events and checking invariants every `every` ticks. */
export function runSociety(sim: { step(n?: number): { events: readonly SimulationEvent[]; state: WorldState } }, ticks: number, every = 0): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (let i = 1; i <= ticks; i += 1) {
    const result = sim.step(1);
    events.push(...result.events);
    if (every > 0 && i % every === 0) assertSocietyInvariants(result.state);
  }
  return events;
}
export const ofType = <T extends SimulationEvent['type']>(events: readonly SimulationEvent[], type: T) =>
  events.filter((e): e is Extract<SimulationEvent, { type: T }> => e.type === type);
