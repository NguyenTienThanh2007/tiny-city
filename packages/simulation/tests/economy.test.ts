import { describe, expect, it } from 'vitest';
import {
  ECONOMY, LEDGER_CATEGORIES, LEDGER_FLOWS, Simulation, allocate, createWorld, deserializeWorld, estimateEconomyImpact, financialCondition,
  operatingNet, percentOf, projectEconomyDay, residentAccount, serializeWorld, settleEconomyDay, validateWorld,
} from '../src/index.js';
import type { CityCommand, EconomyState, LedgerEntry, WorldState } from '../src/index.js';
import { economyCity } from './economyFixture.js';

const DAY = 1440;
const BALANCED = { apartment: 3, villa: 6, office: 1, mall: 1, park: 1, pool: 1 } as const;
/** Open land on the southernmost street (y 60–63), far from the fixture's packed lots. */
const OFFICE_LOT: CityCommand = { type: 'city.build', buildingType: 'office', position: { x: 40, y: 60 } };

const residentsTotal = (e: EconomyState) => Object.values(e.residents).reduce((sum, a) => sum + a.balance, 0);
const dayEntries = (e: EconomyState, day: number) => e.ledger.filter((t) => t.day === day);
const flow = (entries: readonly LedgerEntry[], account: string) =>
  entries.reduce((sum, t) => sum + (t.to === account ? t.amount : 0) - (t.from === account ? t.amount : 0), 0);
const isConstruction = (t: LedgerEntry) => t.category === 'city.construction' || t.category === 'city.construction-refund';

function run(world: WorldState, days: number) {
  const sim = new Simulation(world);
  for (let i = 0; i < days; i += 1) sim.step(DAY);
  return sim;
}

describe('Phase 5 economy: state and settlement cadence', () => {
  it('a new city at midnight settles its first day; enabling mid-day never bills the hours already gone', () => {
    const fresh = new Simulation(economyCity(BALANCED));
    expect(fresh.getState().economy!.lastSettledDay).toBe(-1);
    fresh.step(DAY);
    expect(fresh.getState().economy!.history.map((r) => r.day)).toEqual([0]);

    const legacy = new Simulation(economyCity(BALANCED, { economy: null }));
    legacy.step(600);
    const before = legacy.getState().budget;
    const enabled = legacy.enableEconomy();
    expect(enabled.events).toEqual([{ type: 'economy.enabled', tick: 600, firstDay: 1 }]);
    expect(legacy.enableEconomy().events).toEqual([]);
    legacy.step(DAY - 600);
    // Midnight of day 0: the partial day is not billed.
    expect(legacy.getState().economy!.history).toEqual([]);
    expect(legacy.getState().budget).toEqual(before);
    legacy.step(DAY);
    expect(legacy.getState().economy!.history.map((r) => r.day)).toEqual([1]);
  });

  it('settles exactly once per day: repeated settlement, pause and speed never duplicate or skip a day', () => {
    const sim = run(economyCity(BALANCED), 2);
    const state = sim.getState();
    const again = settleEconomyDay(state, 1, state.clock.tick);
    expect(again.events).toEqual([]);
    expect(again.economy).toBe(state.economy);
    expect(again.budget).toBe(state.budget);

    // Paused: real time never advances the clock, so no money moves.
    sim.pause();
    const paused = serializeWorld(sim.getState());
    for (let i = 0; i < 50; i += 1) sim.advance(10_000);
    expect(serializeWorld(sim.getState())).toBe(paused);

    // Speed: the same game time fed in different chunk sizes settles identically.
    const a = new Simulation(economyCity(BALANCED)), b = new Simulation(economyCity(BALANCED));
    a.resume(); b.resume();
    const total = DAY * 2 * 100 + 5_000; // two days and a bit, at 100 ms per tick
    for (let t = 0; t < total; t += 250) a.advance(250);
    for (let t = 0; t < total; t += 1000) b.advance(1000);
    expect(a.getState().economy!.history.map((r) => r.day)).toEqual([0, 1]);
    expect(serializeWorld(a.getState())).toBe(serializeWorld(b.getState()));
  });

  it('replays deterministically and survives save/load mid-day without double settlement', () => {
    const commands: CityCommand[] = [OFFICE_LOT];
    const straight = new Simulation(economyCity(BALANCED));
    straight.executeBatch(commands);
    straight.step(DAY + 700);
    const saved = serializeWorld(straight.getState());
    straight.step(DAY * 2);

    const restored = new Simulation(deserializeWorld(saved));
    restored.step(DAY * 2);
    expect(serializeWorld(restored.getState())).toBe(serializeWorld(straight.getState()));
    expect(restored.getState().economy!.history.map((r) => r.day)).toEqual([0, 1, 2]);

    const replay = new Simulation(economyCity(BALANCED));
    replay.executeBatch(commands);
    replay.step(DAY * 3 + 700);
    expect(serializeWorld(replay.getState())).toBe(serializeWorld(straight.getState()));
  });
});

describe('Phase 5 economy: accounting invariants', () => {
  it('every entry has its category\'s fixed direction; money is created or destroyed only through the external economy', () => {
    for (const category of LEDGER_CATEGORIES) {
      const [from, to] = LEDGER_FLOWS[category];
      expect(from).not.toBe(to);
    }
    const sim = new Simulation(economyCity(BALANCED));
    for (let day = 0; day < 6; day += 1) {
      if (day === 2) sim.executeBatch([OFFICE_LOT]);
      const before = sim.getState();
      const treasury = before.budget.balance, savings = residentsTotal(before.economy!);
      sim.step(DAY);
      const after = sim.getState(), e = after.economy!;
      const entries = dayEntries(e, day);
      expect(entries.length).toBeGreaterThan(0);
      // The treasury moved exactly by its settlement entries (construction was charged earlier by the command).
      expect(after.budget.balance - treasury).toBe(flow(entries.filter((t) => !isConstruction(t)), 'treasury'));
      // Resident savings moved exactly by their entries (arrivals bring savings; departures take them).
      expect(residentsTotal(e) - savings).toBe(flow(entries, 'residents'));
      // Each business is a pass-through account closed every day.
      for (const id of new Set(entries.filter((t) => t.buildingId && (t.from === 'business' || t.to === 'business')).map((t) => t.buildingId))) {
        expect(flow(entries.filter((t) => t.buildingId === id), 'business'), String(id)).toBe(0);
      }
      // The daily report reconciles the treasury, and the budget's running totals match the ledger's lifetime totals.
      const report = e.history.at(-1)!;
      expect(report.treasuryClose).toBe(after.budget.balance);
      const totals = e.totals;
      expect(after.budget.operatingIncome).toBe((totals['tax.residential'] ?? 0) + (totals['tax.commercial'] ?? 0) + (totals['resident.venue-fees'] ?? 0));
      expect(after.budget.operatingExpenses).toBe((totals['city.support'] ?? 0) + (totals['city.public-services'] ?? 0) +
        (totals['city.road-upkeep'] ?? 0) + (totals['city.amenity-upkeep'] ?? 0));
      for (const t of entries) { expect(Number.isSafeInteger(t.amount)).toBe(true); expect(t.amount).toBeGreaterThan(0); }
      for (const a of Object.values(e.residents)) { expect(Number.isSafeInteger(a.balance)).toBe(true); expect(a.balance).toBeGreaterThanOrEqual(0); }
    }
  });

  it('construction is charged exactly once, recorded once, and undo refunds construction without rewinding operating money', () => {
    const sim = run(economyCity(BALANCED), 1);
    const beforeBuild = sim.getCitySnapshot();
    const funds = sim.getState().budget.balance;
    expect(sim.executeBatch([OFFICE_LOT]).applied).toBe(true);
    expect(sim.getState().budget.balance).toBe(funds - 640);
    sim.step(DAY);
    let e = sim.getState().economy!;
    expect(dayEntries(e, 1).filter((t) => t.category === 'city.construction').map((t) => t.amount)).toEqual([640]);
    expect(e.history.at(-1)!.expenses.construction).toBe(640);
    sim.step(DAY);
    e = sim.getState().economy!;
    expect(dayEntries(e, 2).some(isConstruction)).toBe(false);

    // Undo after two settlements: the building and its cost come back; taxes and upkeep since then stay.
    const operating = sim.getState().budget;
    const afterBuild = sim.getCitySnapshot();
    sim.restoreCity(beforeBuild);
    const undone = sim.getState().budget;
    expect(undone.balance).toBe(operating.balance + 640);
    expect(undone.operatingIncome).toBe(operating.operatingIncome);
    expect(undone.operatingExpenses).toBe(operating.operatingExpenses);
    sim.step(DAY);
    e = sim.getState().economy!;
    expect(dayEntries(e, 3).filter((t) => t.category === 'city.construction-refund').map((t) => t.amount)).toEqual([640]);
    // Redo charges it again, once.
    expect(sim.canRestoreCity(afterBuild)).toBe(true);
    sim.restoreCity(afterBuild);
    expect(sim.getState().budget.balance).toBe(e.history.at(-1)!.treasuryClose - 640);
    expect(() => validateWorld(sim.getState())).not.toThrow();
  });

  it('redo that the treasury can no longer afford is refused without changing anything', () => {
    const sim = new Simulation(economyCity({ villa: 4 }, { funds: 700 }));
    const before = sim.getCitySnapshot();
    sim.executeBatch([OFFICE_LOT]);
    const built = sim.getCitySnapshot();
    sim.restoreCity(before);
    // Days of upkeep with no income drain the treasury below the office's cost.
    for (let i = 0; i < 3; i += 1) sim.step(DAY);
    expect(sim.getState().budget.balance).toBeLessThan(640);
    const state = sim.getState();
    expect(sim.canRestoreCity(built)).toBe(false);
    expect(() => sim.restoreCity(built)).toThrow(/insufficient funds/);
    expect(sim.getState()).toBe(state);
  });

  it('allocate and percentOf are exact integer arithmetic', () => {
    expect(percentOf(1560, 10)).toBe(156);
    expect(percentOf(26, 10)).toBe(3);
    expect(percentOf(25, 10)).toBe(3); // 2.5 rounds half up
    expect(percentOf(-30, 5)).toBe(-1); // -1.5 rounds toward +∞
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
    expect(allocate(100, [3, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('Phase 5 economy: residents, employment and businesses', () => {
  it('workers never exceed real job slots; wages, residential tax and payroll follow the documented rules', () => {
    const sim = run(economyCity(BALANCED), 1);
    const state = sim.getState(), e = state.economy!, report = e.history.at(-1)!;
    const office = state.plan.buildings.find((b) => b.type === 'office')!, mall = state.plan.buildings.find((b) => b.type === 'mall')!;
    const fo = e.buildings[office.id]!, fm = e.buildings[mall.id]!;
    expect(fo.workers).toBeLessThanOrEqual(office.capacity);
    expect(fm.workers).toBeLessThanOrEqual(mall.capacity);
    expect(fo.workers + fm.workers).toBe(report.employed);
    expect(state.citizens.filter((c) => c.workBuildingId !== null).length).toBe(report.employed);
    expect(fo.payroll).toBe(fo.workers * ECONOMY.wages.office);
    expect(fm.payroll).toBe(fm.workers * ECONOMY.wages.mall);
    expect(report.wages).toBe(fo.payroll + fm.payroll);
    expect(report.income.residentialTax).toBe(percentOf(fo.payroll, 10) + percentOf(fm.payroll, 10));
    // Each worker's share of the withheld tax differs by at most a dollar.
    const officeTaxes = state.citizens.filter((c) => c.workBuildingId === office.id).map((c) => e.residents[c.id]!.taxes);
    expect(Math.max(...officeTaxes) - Math.min(...officeTaxes)).toBeLessThanOrEqual(1);
    expect(officeTaxes.reduce((a, b) => a + b, 0)).toBe(percentOf(fo.payroll, 10));
  });

  it('demolishing a workplace removes its jobs: former workers get city support and its business stops', () => {
    const sim = run(economyCity(BALANCED), 1);
    const office = sim.getState().plan.buildings.find((b) => b.type === 'office')!;
    const workers = sim.getState().citizens.filter((c) => c.workBuildingId === office.id).length;
    expect(workers).toBeGreaterThan(0);
    sim.execute({ type: 'city.demolish', buildingId: office.id });
    sim.step(DAY);
    const e = sim.getState().economy!, report = e.history.at(-1)!;
    expect(e.buildings[office.id]).toBeUndefined();
    expect(report.expenses.unemploymentSupport).toBe((report.population - report.employed) * ECONOMY.unemploymentSupport);
    expect(report.population - report.employed).toBeGreaterThanOrEqual(workers - 76); // the mall can absorb some
  });

  it('spending never exceeds savings: housing first, then fees for real visits, then shopping', () => {
    // Residents with no jobs drain their savings to zero and stay there; they never go negative.
    const sim = run(economyCity({ villa: 10, park: 1 }), 25);
    const e = sim.getState().economy!;
    for (const a of Object.values(e.residents)) expect(a.balance).toBeGreaterThanOrEqual(0);
    expect(Math.min(...Object.values(e.residents).map((a) => a.balance))).toBe(0);
    const poor = Object.values(e.residents).find((a) => a.balance === 0)!;
    expect(financialCondition(poor)).toBe('struggling');
    // Support (5) cannot cover villa housing (10): they spend what they receive and nothing more.
    expect(poor.spending).toBe(poor.income);
  });

  it('venue fees are charged only for real visits and go to the city; parks are free', () => {
    const sim = run(economyCity({ apartment: 2, office: 1, pool: 1, clubhouse: 1, park: 1 }), 2);
    const e = sim.getState().economy!, report = e.history.at(-1)!;
    const amenities = Object.values(e.buildings).filter((f) => f.status === 'public');
    expect(amenities.reduce((sum, f) => sum + f.visits, 0)).toBeGreaterThan(0);
    for (const f of amenities) expect(f.fees).toBe(f.role === 'park' ? 0 : f.visits * ECONOMY.venueFees[f.role as 'pool' | 'clubhouse']);
    expect(report.income.venueFees + report.feesWaived).toBe(amenities.reduce((sum, f) => sum + f.fees, 0));
    // A city without visits has no fee income.
    const quiet = run(economyCity({ apartment: 1, office: 1 }), 1).getState().economy!.history.at(-1)!;
    expect(quiet.income.venueFees).toBe(0);
  });

  it('business revenue comes from real activity: an unstaffed business earns nothing, a mall sells at most what staff and demand allow', () => {
    const sim = run(economyCity({ apartment: 1, office: 2, mall: 1 }), 1);
    const e = sim.getState().economy!;
    const finances = Object.values(e.buildings);
    const unstaffed = finances.filter((f) => f.workers === 0);
    expect(unstaffed.length).toBeGreaterThan(0);
    for (const f of unstaffed) { expect(f.revenue).toBe(0); expect(f.status).toBe('unstaffed'); expect(f.profit).toBe(-f.upkeep); }
    const report = e.history.at(-1)!;
    for (const f of finances.filter((f) => f.role === 'mall')) expect(f.revenue).toBeLessThanOrEqual(f.workers * ECONOMY.mallSalesPerWorker);
    expect(report.shoppingLocal).toBeLessThanOrEqual(report.shoppingDemand);
    expect(report.shoppingLocal + report.shoppingOutside).toBe(report.shoppingDemand);
    for (const f of finances.filter((f) => f.role === 'office')) expect(f.revenue).toBe(f.workers * ECONOMY.officeRevenuePerWorker);
  });
});

describe('Phase 5 economy: policy, alerts and bankruptcy', () => {
  it('tax policy affects only future settlements and has real trade-offs', () => {
    const base = run(economyCity(BALANCED), 2);
    const high = run(economyCity(BALANCED), 1);
    const settled = serializeWorld(high.getState());
    const result = high.executeEconomy({ type: 'economy.set-policy', policy: { residentialTaxRate: 18, commercialTaxRate: 16 } });
    expect(result.applied).toBe(true);
    expect(result.events).toEqual([{ type: 'economy.policy-changed', tick: DAY, policy: { residentialTaxRate: 18, commercialTaxRate: 16 } }]);
    // History and balances are untouched by the change itself.
    const changed = JSON.parse(serializeWorld(high.getState())) as WorldState;
    expect({ ...changed, economy: { ...changed.economy!, policy: null } }).toEqual({ ...JSON.parse(settled), economy: { ...JSON.parse(settled).economy, policy: null } });
    high.step(DAY);
    const a = base.getState().economy!.history.at(-1)!, b = high.getState().economy!.history.at(-1)!;
    expect(b.income.residentialTax).toBeGreaterThan(a.income.residentialTax);
    // Higher taxes cost confidence (less shopping) and office clients (less revenue).
    expect(b.confidence).toBeLessThan(a.confidence);
    expect(b.localShoppingRate).toBeLessThan(a.localShoppingRate);
    expect(b.businessProfit).toBeLessThan(a.businessProfit);
    expect(high.executeEconomy({ type: 'economy.set-policy', policy: { residentialTaxRate: 18, commercialTaxRate: 16 } }).reason).toBe('unchanged-policy');
    expect(high.executeEconomy({ type: 'economy.set-policy', policy: { residentialTaxRate: 21, commercialTaxRate: 6 } }).reason).toBe('invalid-policy');
    expect(high.executeEconomy({ type: 'economy.set-policy', policy: { residentialTaxRate: 1.5, commercialTaxRate: 6 } }).reason).toBe('invalid-policy');
    expect(new Simulation(economyCity(BALANCED, { economy: null })).executeEconomy({ type: 'economy.set-policy', policy: { residentialTaxRate: 5, commercialTaxRate: 6 } }).reason).toBe('economy-disabled');
  });

  it('the treasury never goes below zero: costs it cannot pay are recorded unpaid, strain confidence, and block construction', () => {
    const sim = new Simulation(economyCity({ apartment: 4, park: 2 }, { funds: 1500 }));
    let alerts: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const result = sim.step(DAY);
      alerts = alerts.concat(result.events.flatMap((ev) => ev.type === 'economy.alert' ? [ev.alert.kind] : []));
      expect(sim.getState().budget.balance).toBeGreaterThanOrEqual(0);
    }
    const e = sim.getState().economy!, last = e.history.at(-1)!;
    expect(sim.getState().budget.balance).toBe(0);
    expect(last.unpaid.upkeep + last.unpaid.support).toBeGreaterThan(0);
    expect(last.confidence).toBeLessThan(e.history[0]!.confidence);
    expect(alerts).toContain('upkeep-unpaid');
    expect(alerts).toContain('deficit');
    // Announced once while the condition lasts (no spam).
    expect(alerts.filter((kind) => kind === 'upkeep-unpaid')).toHaveLength(1);
    expect(sim.execute({ type: 'city.build', buildingType: 'villa', position: { x: 40, y: 60 } }).applied).toBe(false);
  });

  it('alerts come from real conditions: unemployment, understaffing and missing shops', () => {
    const sim = new Simulation(economyCity({ apartment: 6, office: 1, mall: 1 }));
    const kinds = sim.step(DAY).events.flatMap((ev) => ev.type === 'economy.alert' ? [ev.alert.id] : []);
    const state = sim.getState(), report = state.economy!.history.at(-1)!;
    // 144 residents, 160 jobs: everyone works, so no unemployment alert.
    expect(report.population - report.employed).toBe(0);
    expect(kinds).not.toContain('unemployment');
    const unemployedCity = new Simulation(economyCity({ apartment: 4, office: 1 }));
    expect(unemployedCity.step(DAY).events.some((ev) => ev.type === 'economy.alert' && ev.alert.kind === 'unemployment')).toBe(true);
    const understaffed = new Simulation(economyCity({ villa: 4, office: 1 }));
    const ids = understaffed.step(DAY).events.flatMap((ev) => ev.type === 'economy.alert' ? [ev.alert.id] : []);
    const office = understaffed.getState().plan.buildings.find((b) => b.type === 'office')!;
    expect(ids).toContain(`understaffed:${office.id}`);
  });
});

describe('Phase 5 economy: projections and AI plan estimates', () => {
  it('estimates never mutate the world; confirmed construction cost is separate from estimated daily effects', () => {
    const sim = run(economyCity({ apartment: 4, villa: 4, park: 1 }), 1);
    const world = sim.getState();
    const snapshot = serializeWorld(world);
    const impact = estimateEconomyImpact(world, [OFFICE_LOT])!;
    expect(serializeWorld(world)).toBe(snapshot);
    expect(sim.getState()).toBe(world);
    expect(impact.applied).toBe(true);
    expect(impact.confirmed.constructionCost).toBe(640);
    expect(impact.confirmed.treasuryAfter).toBe(world.budget.balance - 640);
    expect(impact.estimated.jobsAdded).toBe(60);
    expect(impact.estimated.employedChange).toBe(60);
    expect(impact.estimated.incomeChange).toBeGreaterThan(0);
    expect(impact.estimated.expensesChange).toBeLessThan(0); // less unemployment support
    // A plan the simulation rejects is reported as not applicable, with no cost.
    const rejected = estimateEconomyImpact(world, [{ type: 'city.build', buildingType: 'office', position: { x: 0, y: 0 } }])!;
    expect(rejected.applied).toBe(false);
    expect(rejected.confirmed.constructionCost).toBe(0);
    // The projection of today matches what midnight then settles (nothing else changes in between).
    const projected = projectEconomyDay(sim.getState());
    sim.step(DAY);
    const settled = sim.getState().economy!.history.at(-1)!;
    expect(operatingNet(settled).net).toBe(operatingNet(projected).net);
  });

  it('a resident account defaults to the arrival savings until their first settlement', () => {
    const world = economyCity({ villa: 2 });
    const id = world.citizens[0]!.id;
    expect(residentAccount(world, id)).toEqual({ balance: ECONOMY.startingSavings, income: 0, taxes: 0, spending: 0 });
    expect(residentAccount(world, 'nobody')).toBeNull();
    expect(residentAccount(economyCity({ villa: 2 }, { economy: null }), id)).toBeNull();
  });
});

describe('Phase 5 economy: persistence and validation', () => {
  it('older saves without an economy load unchanged and keep the original budget shape', () => {
    const legacy = createWorld({ id: 'legacy', startingFunds: 900, plan: { id: 'p', name: 'Old', width: 8, height: 8, buildings: [] } });
    const restored = deserializeWorld(serializeWorld(legacy));
    expect(restored.economy).toBeUndefined();
    expect(restored.budget).toEqual({ openingBalance: 900, balance: 900, totalSpent: 0 });
    expect(JSON.parse(serializeWorld(restored)).budget).toEqual({ balance: 900, openingBalance: 900, totalSpent: 0 });
  });

  it('rejects corrupted economy data', () => {
    const world = run(economyCity(BALANCED), 1).getState();
    type Loose = { budget: { balance: number }; economy: { lastSettledDay: number; policy: { residentialTaxRate: number };
      residents: Record<string, { balance: number }>; history: { treasuryClose: number }[];
      ledger: { amount: number; from: string; to: string; category: string; id: string }[] } };
    const raw = JSON.parse(serializeWorld(world)) as Loose;
    const broken = (mutate: (copy: Loose) => void) => { const copy = JSON.parse(JSON.stringify(raw)) as Loose; mutate(copy); return () => deserializeWorld(JSON.stringify(copy)); };
    expect(broken(() => undefined)).not.toThrow();
    expect(broken((c) => { c.budget.balance += 1; })).toThrow(/budget ledger/);
    expect(broken((c) => { c.economy.lastSettledDay = 5; })).toThrow(/out of step/);
    expect(broken((c) => { c.economy.policy.residentialTaxRate = 99; })).toThrow(/policy/);
    expect(broken((c) => { c.economy.residents[Object.keys(c.economy.residents)[0]!]!.balance = -1; })).toThrow(/resident account/);
    expect(broken((c) => { c.economy.ledger[0]!.amount = 0.5; })).toThrow(/ledger amount/);
    expect(broken((c) => { Object.assign(c.economy.ledger[0]!, { from: 'external', to: 'treasury', category: 'tax.residential' }); })).toThrow(/direction/);
    expect(broken((c) => { c.economy.history[0]!.treasuryClose += 1; })).toThrow(/reconcile/);
    expect(broken((c) => { c.economy.ledger[1]!.id = c.economy.ledger[0]!.id; })).toThrow(/ledger IDs/);
  });

  it('history and ledger stay bounded over a long session', () => {
    const sim = run(economyCity({ apartment: 2, office: 1, mall: 1, park: 1 }), ECONOMY.historyDays + 4);
    const e = sim.getState().economy!;
    expect(e.history).toHaveLength(ECONOMY.historyDays);
    expect(e.history[0]!.day).toBe(4);
    expect(e.ledger.length).toBeLessThanOrEqual(ECONOMY.ledgerEntries);
    expect(e.nextTransactionId - 1).toBeGreaterThan(e.ledger.length);
    expect(serializeWorld(sim.getState()).length).toBeLessThan(400_000);
  });
});
