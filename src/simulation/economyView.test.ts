import { describe, expect, it } from 'vitest';
import { ECONOMY, Simulation, operatingNet } from '@tiny-city/simulation';
import type { CityCommand } from '@tiny-city/simulation';
import { createCityWorld } from './cityAdapter';
import { alertText, buildingEconomy, citizenEconomy, economyOverview, money, planEconomy, policyPreview, runningCost, signedMoney, treasuryRows } from './economyView';
import type { CityState } from '../types';

const city: CityState = { size: 64, funds: 9000, roads: Array.from({ length: 41 }, (_, i) => ({ x: i + 8, y: 20 })), buildings: [
  { id: 'apt-a', name: 'Harbor Flats', kind: 'apartment', x: 12, y: 16, createdAt: 0 },
  { id: 'apt-b', name: 'Sea Flats', kind: 'apartment', x: 17, y: 16, createdAt: 0 },
  { id: 'office', name: 'Harbor Office', kind: 'office', x: 22, y: 16, createdAt: 0 },
  { id: 'pool', name: 'Lido', kind: 'pool', x: 27, y: 16, createdAt: 0 },
] };

function settled(days = 1) {
  const sim = new Simulation(createCityWorld(city));
  sim.enablePopulation({ maxCitizens: 1000 });
  for (let i = 0; i < days; i += 1) sim.step(1440);
  return sim;
}

describe('economy view (Phase 5 presentation of the authoritative economy)', () => {
  it('formats whole dollars and signs', () => {
    expect(money(24680)).toBe('$24,680');
    expect(money(-12)).toBe('−$12');
    expect(signedMoney(5)).toBe('+$5');
    expect(signedMoney(-1250)).toBe('−$1,250');
    expect(signedMoney(0)).toBe('±$0');
  });

  it('a new city has an economy with no settled day yet, and an estimate for today', () => {
    const world = createCityWorld(city);
    const overview = economyOverview(world)!;
    expect(overview.status).toBe('new');
    expect(overview.last).toBeNull();
    expect(overview.treasury).toBe(9000);
    expect(overview.today.day).toBe(0);
    expect(overview.history).toEqual([]);
  });

  it('the overview shows the settled report, the treasury and real employment', () => {
    const world = settled(2).getState();
    const overview = economyOverview(world)!;
    const last = world.economy!.history.at(-1)!;
    expect(overview.last).toBe(last);
    expect(overview.treasury).toBe(world.budget.balance);
    expect(overview.lastNet).toBe(operatingNet(last).net);
    expect(overview.employment).toEqual({ residents: 48, employed: 48, jobs: 60, rate: 100 });
    expect(overview.businesses.total).toBe(1);
    expect(overview.week).toEqual({ days: 2, ...[0, 1].reduce((sum, i) => { const n = operatingNet(world.economy!.history[i]!); return { income: sum.income + n.income, expenses: sum.expenses + n.expenses, net: sum.net + n.net }; }, { income: 0, expenses: 0, net: 0 }) });
    const rows = treasuryRows(last);
    expect(rows.income.reduce((sum, row) => sum + row.amount, 0)).toBe(operatingNet(last).income);
    expect(rows.expenses.reduce((sum, row) => sum + row.amount, 0)).toBe(operatingNet(last).expenses);
  });

  it('building and resident cards read the settled day; a new building shows today\'s estimate', () => {
    const sim = settled(1);
    const world = sim.getState();
    const office = buildingEconomy(world, 'office')!;
    expect(office.projected).toBe(false);
    expect(office.finance.workers).toBe(48);
    expect(office.finance.payroll).toBe(48 * ECONOMY.wages.office);
    expect(buildingEconomy(world, 'apt-a')).toBeNull();
    sim.execute({ type: 'city.build', buildingType: 'office', position: { x: 32, y: 16 } });
    const fresh = sim.getState().plan.buildings.at(-1)!;
    const estimate = buildingEconomy(sim.getState(), fresh.id)!;
    expect(estimate.projected).toBe(true);
    expect(estimate.finance.status).toBe('unstaffed');

    const resident = world.citizens[0]!;
    const money = citizenEconomy(world, resident.id)!;
    expect(money.employment).toBe('Employed at Harbor Office');
    expect(money.jobCategory).toBe('Office services');
    expect(money.balance).toBe(world.economy!.residents[resident.id]!.balance);
    expect(money.last).toEqual({ income: 26, taxes: world.economy!.residents[resident.id]!.taxes, spending: world.economy!.residents[resident.id]!.spending });
  });

  it('policy previews and plan estimates never change the world', () => {
    const world = settled(1).getState();
    const preview = policyPreview(world, { residentialTaxRate: 15, commercialTaxRate: 6 });
    expect(preview.incomeChange).toBeGreaterThan(0);
    expect(preview.confidenceChange).toBeLessThan(0);
    const commands: CityCommand[] = [{ type: 'city.build', buildingType: 'mall', position: { x: 32, y: 15 } }];
    const impact = planEconomy(world, commands)!;
    expect(impact.confirmed.constructionCost).toBe(900);
    expect(impact.estimated.jobsAdded).toBe(100);
    expect(world.budget.balance).toBe(world.economy!.history.at(-1)!.treasuryClose);
  });

  it('alert texts name the real building and amounts', () => {
    const world = settled(1).getState();
    expect(alertText({ id: 'understaffed:office', kind: 'understaffed', severity: 'warning', day: 0, buildingId: 'office', value: 3 }, world))
      .toBe('Harbor Office has only 3 workers. Homes nearby bring workers.');
    expect(alertText({ id: 'deficit', kind: 'deficit', severity: 'warning', day: 0, buildingId: null, value: 120 }, world)).toBe('The city spent $120 more than it earned yesterday.');
    expect(runningCost('pool')).toBe('$24/day city upkeep · $3 per visit');
    expect(runningCost('villa')).toBe('$3/day city services per resident');
  });
});
