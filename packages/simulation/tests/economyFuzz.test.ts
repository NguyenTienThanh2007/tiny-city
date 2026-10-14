import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOG, ECONOMY, Simulation, deserializeWorld, getGameTime, serializeWorld, validateWorld } from '../src/index.js';
import type { BuildingType, CitySnapshot, WorldState } from '../src/index.js';
import { economyCity } from './economyFixture.js';

const TYPES = Object.keys(BUILDING_CATALOG) as BuildingType[];
const SEEDS = Number(process.env.ECONOMY_SEEDS ?? 6);
const STEPS = Number(process.env.ECONOMY_STEPS ?? 60);

function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)), pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]! };
}

/** Economic invariants that must hold after any sequence of edits, undo, policy changes, saves and time. */
function check(world: WorldState, startDay: number, label: string) {
  expect(() => validateWorld(world), label).not.toThrow();
  const e = world.economy!;
  const { day } = getGameTime(world.clock);
  expect(world.budget.balance, label).toBeGreaterThanOrEqual(0);
  for (const value of [world.budget.balance, world.budget.operatingIncome ?? 0, world.budget.operatingExpenses ?? 0]) expect(Number.isSafeInteger(value), label).toBe(true);
  // Exactly one settlement per finished day since the economy began, never two.
  expect(e.lastSettledDay, label).toBe(day - 1);
  const days = e.history.map((r) => r.day);
  expect(days, label).toEqual([...new Set(days)]);
  expect(days.length, label).toBe(Math.min(ECONOMY.historyDays, day - startDay));
  // Ledger lifetime totals match the authoritative treasury totals.
  const t = e.totals;
  expect(world.budget.operatingIncome ?? 0, label).toBe((t['tax.residential'] ?? 0) + (t['tax.commercial'] ?? 0) + (t['resident.venue-fees'] ?? 0));
  expect(world.budget.operatingExpenses ?? 0, label).toBe((t['city.support'] ?? 0) + (t['city.public-services'] ?? 0) + (t['city.road-upkeep'] ?? 0) + (t['city.amenity-upkeep'] ?? 0));
  // Construction recorded in the ledger matches construction spending since the economy began, net of refunds.
  expect((t['city.construction'] ?? 0) - (t['city.construction-refund'] ?? 0), label).toBe(e.constructionSpentAtSettlement - startSpent.get(world.id)!);
  // Resident savings are the lifetime net of every resident flow (accounts open with arrivals and close with departures).
  const residentFlow = Object.entries(t).reduce((sum, [category, amount]) => {
    const flows: Record<string, number> = { 'resident.arrival': 1, 'business.wages': 1, 'city.support': 1, 'resident.departure': -1, 'tax.residential': -1,
      'resident.housing': -1, 'resident.shopping-outside': -1, 'resident.venue-fees': -1, 'business.sales': -1 };
    return sum + (flows[category] ?? 0) * amount!;
  }, 0);
  if (e.history.length === day - startDay) expect(Object.values(e.residents).reduce((sum, a) => sum + a.balance, 0), label).toBe(residentFlow);
  // Workers never exceed real job slots; nothing is NaN.
  const workers = new Map<string, number>();
  for (const c of world.citizens) if (c.workBuildingId) workers.set(c.workBuildingId, (workers.get(c.workBuildingId) ?? 0) + 1);
  for (const b of world.plan.buildings) expect(workers.get(b.id) ?? 0, label).toBeLessThanOrEqual(b.capacity);
  for (const f of Object.values(e.buildings)) expect(f.workers, label).toBeLessThanOrEqual(f.jobs || f.workers);
  expect(serializeWorld(world), label).not.toMatch(/NaN|Infinity|null,"balance"/);
}
const startSpent = new Map<string, number>();

function scenario(seed: number) {
  const rng = prng(seed);
  let sim = new Simulation(economyCity({ apartment: 2, villa: 4, office: 1, mall: 1, park: 1, pool: 1 }, { funds: 6000, seed: `fuzz-${seed}` }));
  startSpent.set(sim.getState().id, sim.getState().budget.totalSpent);
  const history: CitySnapshot[] = [];
  const trace: string[] = [];
  for (let step = 0; step < STEPS; step += 1) {
    const action = rng.int(0, 9);
    const label = `seed ${seed} step ${step} action ${action}`;
    if (action <= 2) {
      const before = sim.getCitySnapshot();
      const type = rng.pick(TYPES), x = rng.int(2, 60), y = rng.pick([1, 8, 14, 21, 27, 34, 40, 47, 53, 60]);
      if (sim.execute({ type: 'city.build', buildingType: type, position: { x, y } }).applied) history.push(before);
    } else if (action === 3 && sim.getState().plan.buildings.length > 0) {
      const before = sim.getCitySnapshot();
      if (sim.execute({ type: 'city.demolish', buildingId: rng.pick(sim.getState().plan.buildings).id }).applied) history.push(before);
    } else if (action === 4 && history.length > 0) {
      const snapshot = history[rng.int(0, history.length - 1)]!;
      if (sim.canRestoreCity(snapshot)) sim.restoreCity(snapshot);
      else expect(() => sim.restoreCity(snapshot), label).toThrow();
    } else if (action === 5) {
      sim.executeEconomy({ type: 'economy.set-policy', policy: { residentialTaxRate: rng.int(0, 20), commercialTaxRate: rng.int(0, 20) } });
    } else if (action === 6) {
      const saved = serializeWorld(sim.getState());
      sim = new Simulation(deserializeWorld(saved));
      expect(serializeWorld(sim.getState()), label).toBe(saved);
    } else {
      sim.step(rng.pick([1, 59, 600, 1440, 1441, 2880]));
    }
    check(sim.getState(), 0, label);
    trace.push(String(sim.getState().budget.balance));
  }
  return { final: serializeWorld(sim.getState()), trace };
}

describe('Phase 5 economy fuzz: invariants under random play', { timeout: 120_000 }, () => {
  it(`holds every accounting invariant for ${SEEDS} seeds × ${STEPS} steps, and replays identically`, () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const a = scenario(seed), b = scenario(seed);
      expect(a.final, `seed ${seed} replay`).toBe(b.final);
      expect(a.trace).toEqual(b.trace);
    }
  });
});
