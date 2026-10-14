import { describe, expect, it } from 'vitest';
import { Simulation, operatingNet } from '../src/index.js';
import type { EconomyDayReport } from '../src/index.js';
import { economyCity, type CitySpec } from './economyFixture.js';

/**
 * The documented balance targets (docs/phase-5-economy/balancing.md) for six reference cities, checked over ten days
 * of the real simulation: residents commute, visit venues and shop; nothing is scripted.
 */
function tenDays(spec: CitySpec, policy?: { residentialTaxRate: number; commercialTaxRate: number }) {
  const sim = new Simulation(economyCity(spec));
  if (policy) sim.executeEconomy({ type: 'economy.set-policy', policy });
  for (let i = 0; i < 10; i += 1) sim.step(1440);
  const history = sim.getState().economy!.history;
  return { sim, history, last: history.at(-1)!, net: (r: EconomyDayReport) => operatingNet(r).net };
}

describe('Phase 5 balance: reference cities', { timeout: 30_000 }, () => {
  it('A. a small residential town with no jobs slowly loses money and its residents run down their savings', () => {
    const { last, net, history } = tenDays({ villa: 10, park: 1 });
    expect(last.employed).toBe(0);
    expect(net(last)).toBeLessThan(0);
    expect(net(last)).toBeGreaterThan(-400); // affordable for weeks from the starting funds, not instant ruin
    expect(last.residentSavings).toBeLessThan(history[0]!.residentSavings);
  });

  it('B. a growing balanced town (homes, an office, a mall, a park) roughly pays its way', () => {
    const { last, net } = tenDays({ apartment: 3, villa: 6, office: 1, mall: 1, park: 1 });
    expect(last.employed).toBe(last.population);
    expect(net(last)).toBeGreaterThanOrEqual(0);
    expect(net(last)).toBeLessThan(300);
  });

  it('C. a commercial-heavy town has empty businesses that earn nothing and lose their owners money', () => {
    const { sim, last } = tenDays({ apartment: 2, mall: 3, office: 2 });
    const finances = Object.values(sim.getState().economy!.buildings);
    expect(last.jobs).toBeGreaterThan(last.population * 4);
    expect(finances.filter((f) => f.status === 'unstaffed').length).toBeGreaterThanOrEqual(3);
    for (const f of finances.filter((f) => f.status === 'unstaffed')) { expect(f.revenue).toBe(0); expect(f.profit).toBeLessThan(0); }
    expect(last.profitableBusinesses).toBeLessThan(last.businesses);
  });

  it('D. a high-maintenance town (many pools, clubhouses, parks) runs a deficit despite fee income', () => {
    const { last, net } = tenDays({ apartment: 2, office: 1, pool: 4, clubhouse: 3, park: 4 });
    expect(last.income.venueFees).toBeGreaterThan(0);
    expect(last.expenses.amenities).toBeGreaterThan(last.income.venueFees);
    expect(net(last)).toBeLessThan(0);
    expect(last.amenityCoverage).toBe(100);
  });

  it('E. a residential town with no work bleeds money on support and services, and residents struggle', () => {
    const { last, net, history } = tenDays({ apartment: 6, villa: 4, park: 1 });
    expect(last.employed).toBe(0);
    expect(net(last)).toBeLessThan(-1000);
    expect(last.expenses.unemploymentSupport).toBe(last.population * 5);
    expect(last.residentSavings).toBeLessThan(history[0]!.residentSavings);
  });

  it('F. a mature mixed-use town earns a modest surplus, not runaway wealth, and asks for more shops', () => {
    const { last, net, sim } = tenDays({ apartment: 10, villa: 8, office: 4, mall: 2, park: 3, pool: 1, clubhouse: 1 });
    expect(net(last)).toBeGreaterThan(100);
    expect(net(last)).toBeLessThan(800);
    expect(last.shoppingDemand).toBeGreaterThan(last.shoppingLocal * 2);
    expect(sim.getState().economy!.alerts.map((a) => a.kind)).toContain('shopping-demand');
  });

  it('maximum taxes are not free money: confidence, local shopping and business profits all fall', () => {
    const spec = { apartment: 10, villa: 8, office: 4, mall: 2, park: 3, pool: 1, clubhouse: 1 };
    const normal = tenDays(spec).last, heavy = tenDays(spec, { residentialTaxRate: 20, commercialTaxRate: 20 }).last;
    expect(heavy.confidence).toBeLessThan(normal.confidence);
    expect(heavy.localShoppingRate).toBeLessThan(normal.localShoppingRate);
    expect(heavy.businessProfit).toBeLessThan(0);
    expect(heavy.profitableBusinesses).toBeLessThan(normal.profitableBusinesses);
    // Commercial tax revenue peaks below the maximum rate: office clients leave as rates rise.
    const mid = tenDays(spec, { residentialTaxRate: 10, commercialTaxRate: 14 }).last;
    expect(mid.income.commercialTax).toBeGreaterThan(heavy.income.commercialTax);
  }, 60_000);
});
