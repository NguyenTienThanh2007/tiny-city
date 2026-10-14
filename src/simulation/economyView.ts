import {
  ECONOMY, computeEconomyDay, estimateEconomyImpact, financialCondition, getGameTime, officeDemandRate, operatingNet, projectEconomyDay, residentAccount,
} from '@tiny-city/simulation';
import type {
  BuildingFinance, CityCommand, EconomyAlert, EconomyDayReport, EconomyImpactEstimate, EconomyPolicy, FinancialCondition, WorldState,
} from '@tiny-city/simulation';

/**
 * Phase 5 presentation of the authoritative economy. Every number shown in the game comes from the world's settled
 * reports, or is a clearly labelled projection (`projectEconomyDay`) of the current, unsettled day.
 */
export const money = (amount: number) => `${amount < 0 ? '−' : ''}$${Math.abs(amount).toLocaleString('en-US')}`;
export const signedMoney = (amount: number) => `${amount > 0 ? '+' : amount < 0 ? '−' : '±'}$${Math.abs(amount).toLocaleString('en-US')}`;
const dayLabel = (day: number) => `Day ${String(day + 1).padStart(2, '0')}`;
export { dayLabel };

/** What a building type costs to run each day, for the build tool card (Phase 5 rules). */
export function runningCost(kind: string): string {
  switch (kind) {
    case 'park': case 'pool': case 'clubhouse': {
      const fee = kind === 'park' ? 'free entry' : `${money(ECONOMY.venueFees[kind])} per visit`;
      return `${money(ECONOMY.cityUpkeep[kind])}/day city upkeep · ${fee}`;
    }
    case 'office': return `Business pays ${money(ECONOMY.businessUpkeep.office)}/day + wages · ${money(ECONOMY.wages.office)}/day jobs`;
    case 'mall': return `Business pays ${money(ECONOMY.businessUpkeep.mall)}/day + wages · ${money(ECONOMY.wages.mall)}/day jobs`;
    default: return `${money(ECONOMY.publicServicesPerResident)}/day city services per resident`;
  }
}

export interface FlowRow { readonly key: string; readonly label: string; readonly amount: number; readonly hint: string }

/** Where the treasury's money came from and went on one day (operating money and construction, separately). */
export function treasuryRows(report: EconomyDayReport): { income: FlowRow[]; expenses: FlowRow[] } {
  const income: FlowRow[] = [
    { key: 'residential', label: 'Residential tax', amount: report.income.residentialTax, hint: `Withheld from ${report.employed} workers' wages` },
    { key: 'commercial', label: 'Commercial tax', amount: report.income.commercialTax, hint: 'On office and mall revenue' },
    { key: 'fees', label: 'Venue fees', amount: report.income.venueFees, hint: 'Real pool and clubhouse visits' },
  ];
  const expenses: FlowRow[] = [
    { key: 'services', label: 'Public services', amount: report.expenses.publicServices, hint: `$${ECONOMY.publicServicesPerResident} per resident` },
    { key: 'roads', label: 'Road upkeep', amount: report.expenses.roads, hint: `$1 per ${ECONOMY.cityUpkeep.roadTilesPerDollar} road tiles` },
    { key: 'amenities', label: 'Parks, pools & clubhouses', amount: report.expenses.amenities, hint: 'Daily upkeep of public amenities' },
    { key: 'support', label: 'Unemployment support', amount: report.expenses.unemploymentSupport, hint: `$${ECONOMY.unemploymentSupport} per resident without a job` },
  ];
  if (report.income.constructionRefunds > 0) income.push({ key: 'refunds', label: 'Construction undone', amount: report.income.constructionRefunds, hint: 'Refunded by undo' });
  if (report.expenses.construction > 0) expenses.push({ key: 'construction', label: 'Construction', amount: report.expenses.construction, hint: 'Charged when built' });
  return { income, expenses };
}

export interface EconomyOverview {
  readonly treasury: number;
  readonly last: EconomyDayReport | null;
  readonly lastNet: number | null;
  readonly week: { readonly days: number; readonly income: number; readonly expenses: number; readonly net: number } | null;
  readonly employment: { readonly residents: number; readonly employed: number; readonly jobs: number; readonly rate: number | null };
  readonly businesses: { readonly total: number; readonly profitable: number; readonly finances: readonly BuildingFinance[] };
  readonly history: readonly EconomyDayReport[];
  readonly alerts: readonly EconomyAlert[];
  readonly today: EconomyDayReport;
  readonly nextSettlementDay: number;
  /** Treasury runway in days at the last day's operating loss (null when not losing money). */
  readonly runway: number | null;
  readonly status: 'healthy' | 'tight' | 'deficit' | 'broke' | 'new';
}

export function economyOverview(world: WorldState): EconomyOverview | null {
  const e = world.economy;
  if (!e) return null;
  const last = e.history.at(-1) ?? null;
  const recent = e.history.slice(-7);
  const week = recent.length ? recent.reduce((sum, r) => { const n = operatingNet(r); return { days: sum.days + 1, income: sum.income + n.income, expenses: sum.expenses + n.expenses, net: sum.net + n.net }; },
    { days: 0, income: 0, expenses: 0, net: 0 }) : null;
  const jobs = world.plan.buildings.reduce((sum, b) => sum + (b.kind === 'workplace' && b.type !== 'clubhouse' ? b.capacity : 0), 0);
  const employed = world.citizens.filter((c) => c.workBuildingId !== null).length;
  const finances = Object.values(e.buildings).filter((f) => f.status !== 'public').sort((a, b) => a.buildingId < b.buildingId ? -1 : 1);
  const lastNet = last ? operatingNet(last).net : null;
  const runway = lastNet !== null && lastNet < 0 ? Math.floor(world.budget.balance / -lastNet) : null;
  const status = !last ? 'new' : world.budget.balance === 0 && (last.unpaid.upkeep + last.unpaid.support) > 0 ? 'broke'
    : lastNet! < 0 && runway !== null && runway < 7 ? 'deficit' : lastNet! < 0 ? 'tight' : 'healthy';
  return {
    treasury: world.budget.balance, last, lastNet, week,
    employment: { residents: world.citizens.length, employed, jobs, rate: world.citizens.length ? Math.round(employed * 100 / world.citizens.length) : null },
    businesses: { total: finances.length, profitable: finances.filter((f) => f.profit >= 0).length, finances },
    history: e.history, alerts: e.alerts, today: projectEconomyDay(world), nextSettlementDay: getGameTime(world.clock).day, runway, status,
  };
}

export const statusLabels: Record<EconomyOverview['status'], string> = {
  new: 'First day in progress', healthy: 'Balanced budget', tight: 'Spending more than it earns', deficit: 'Running out of money', broke: 'Treasury empty',
};
export const businessStatusLabels: Record<BuildingFinance['status'], string> = {
  profitable: 'Profitable', loss: 'Losing money', understaffed: 'Understaffed', 'weak-demand': 'Weak customer demand', unstaffed: 'No workers', public: 'Public amenity',
};

/** Player-facing text for an economy alert. */
export function alertText(alert: EconomyAlert, world: WorldState): string {
  const name = alert.buildingId ? world.plan.buildings.find((b) => b.id === alert.buildingId)?.name ?? 'A business' : '';
  switch (alert.kind) {
    case 'upkeep-unpaid': return `The treasury could not cover ${money(alert.value)} of city costs. Raise taxes or add jobs.`;
    case 'treasury-low': return `Treasury is low (${money(alert.value)}): less than three days of running costs.`;
    case 'deficit': return `The city spent ${money(alert.value)} more than it earned yesterday.`;
    case 'unemployment': return `${alert.value}% of residents have no job. Offices and malls create jobs.`;
    case 'understaffed': return `${name} has only ${alert.value} worker${alert.value === 1 ? '' : 's'}. Homes nearby bring workers.`;
    case 'business-loss': return `${name} has lost money for days (${money(alert.value)} yesterday).`;
    case 'shopping-demand': return `Residents spent ${money(alert.value)} outside the city yesterday. A staffed mall would keep it here.`;
    case 'improving': return `The budget improved three days in a row (${signedMoney(alert.value)} yesterday).`;
  }
}

/** One building's economic card: its last settled day, or a projection of today before its first settlement. */
export function buildingEconomy(world: WorldState, buildingId: string): { finance: BuildingFinance; projected: boolean } | null {
  const e = world.economy;
  if (!e) return null;
  const settled = e.buildings[buildingId];
  if (settled) return { finance: settled, projected: false };
  // Built since the last midnight: show what today would settle to, clearly marked as an estimate.
  const projected = computeEconomyDay(world, e, getGameTime(world.clock).day).buildings[buildingId];
  return projected ? { finance: projected, projected: true } : null;
}

export const conditionLabels: Record<FinancialCondition, string> = { comfortable: 'Comfortable', 'getting-by': 'Getting by', struggling: 'Struggling' };

export interface CitizenEconomy {
  readonly employment: string;
  readonly jobCategory: string | null;
  readonly wage: number;
  readonly balance: number;
  readonly condition: FinancialCondition;
  readonly last: { readonly income: number; readonly taxes: number; readonly spending: number } | null;
}
export function citizenEconomy(world: WorldState, citizenId: string): CitizenEconomy | null {
  const citizen = world.citizens.find((c) => c.id === citizenId);
  const account = residentAccount(world, citizenId);
  if (!citizen || !account) return null;
  const job = citizen.workBuildingId ? world.plan.buildings.find((b) => b.id === citizen.workBuildingId) : undefined;
  const category = job ? job.type === 'mall' ? 'Retail' : 'Office services' : null;
  const wage = job ? job.type === 'mall' ? ECONOMY.wages.mall : ECONOMY.wages.office : 0;
  const settled = world.economy!.residents[citizenId] !== undefined;
  return { employment: job ? `Employed at ${job.name}` : 'Not employed', jobCategory: category, wage, balance: account.balance,
    condition: financialCondition(account), last: settled ? { income: account.income, taxes: account.taxes, spending: account.spending } : null };
}

/** Estimated daily effect of a tax policy at today's activity, against the current policy. Never applied. */
export function policyPreview(world: WorldState, policy: EconomyPolicy) {
  const now = projectEconomyDay(world), next = projectEconomyDay(world, policy);
  const a = operatingNet(now), b = operatingNet(next);
  return { incomeChange: b.income - a.income, netChange: b.net - a.net, confidence: next.confidence, confidenceChange: next.confidence - now.confidence,
    localShopping: next.localShoppingRate, officeDemand: officeDemandRate(policy), businessProfitChange: next.businessProfit - now.businessProfit };
}

/** Economic consequences of an AI plan or placement: the confirmed construction cost, then estimates. */
export function planEconomy(world: WorldState, commands: readonly CityCommand[]): EconomyImpactEstimate | null {
  return estimateEconomyImpact(world, commands);
}
