import { applyOperating } from './budget.js';
import { getGameTime } from './clock.js';
import { ECONOMY, percentOf } from './economyConfig.js';
import { providesJobs, providesLeisure } from './population.js';
import type {
  Building, BuildingFinance, BusinessStatus, CityBudget, EconomyAccountKind, EconomyAlert, EconomyDayReport, EconomyOptions,
  EconomyPolicy, EconomyState, EconomyToday, LedgerCategory, LedgerEntry, ResidentAccount, SimulationEvent, WorldState,
} from './types.js';

/**
 * Phase 5 economy: one deterministic daily settlement at the first tick of each game day.
 *
 * Actors: the city treasury (`budget.balance`), residents (one account each), businesses (offices and malls; pass-through
 * accounts closed every day: profit goes to, and losses are covered by, owners outside the city) and the external
 * economy (the only source or sink of money). Every movement is a ledger entry whose direction is fixed by its
 * category, so `treasury + Σ resident savings` changes only through entries that touch `external`.
 */

/** Direction of every ledger category. Internal transfers never touch `external`; created/destroyed money always does. */
export const LEDGER_FLOWS: Readonly<Record<LedgerCategory, readonly [EconomyAccountKind, EconomyAccountKind]>> = Object.freeze({
  'resident.arrival': ['external', 'residents'],
  'resident.departure': ['residents', 'external'],
  'business.services': ['external', 'business'],
  'business.sales': ['residents', 'business'],
  'business.wages': ['business', 'residents'],
  'tax.residential': ['residents', 'treasury'],
  'tax.commercial': ['business', 'treasury'],
  'city.support': ['treasury', 'residents'],
  'resident.housing': ['residents', 'external'],
  'resident.shopping-outside': ['residents', 'external'],
  'resident.venue-fees': ['residents', 'treasury'],
  'business.upkeep': ['business', 'external'],
  'business.profit': ['business', 'external'],
  'business.loss-cover': ['external', 'business'],
  'city.public-services': ['treasury', 'external'],
  'city.road-upkeep': ['treasury', 'external'],
  'city.amenity-upkeep': ['treasury', 'external'],
  'city.construction': ['treasury', 'external'],
  'city.construction-refund': ['external', 'treasury'],
});
export const LEDGER_CATEGORIES = Object.freeze(Object.keys(LEDGER_FLOWS) as LedgerCategory[]);

type BusinessRole = 'office' | 'mall';
type AmenityRole = 'park' | 'pool' | 'clubhouse';
const byId = <T extends { readonly id: string }>(a: T, b: T) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** Jobs are offered by malls and offices (and legacy authored workplaces, treated as offices). */
export const businessRole = (b: Building): BusinessRole | null => providesJobs(b) ? b.type === 'mall' ? 'mall' : 'office' : null;
export const amenityRole = (b: Building): AmenityRole | null =>
  !providesLeisure(b) ? null : b.type === 'pool' ? 'pool' : b.type === 'clubhouse' ? 'clubhouse' : 'park';
export const venueFee = (b: Building): number => { const role = amenityRole(b); return role === 'pool' || role === 'clubhouse' ? ECONOMY.venueFees[role] : 0; };
/** Road upkeep: $1 per started block of `roadTilesPerDollar` tiles. */
export const roadUpkeep = (tiles: number) => Math.ceil(tiles / ECONOMY.cityUpkeep.roadTilesPerDollar);
const housingCost = (b: Building | undefined) => ECONOMY.housingCost[b?.type === 'villa' || b?.type === 'duplex' || b?.type === 'townhouse' || b?.type === 'apartment' ? b.type : 'other'];

export const DEFAULT_POLICY: EconomyPolicy = Object.freeze({ residentialTaxRate: ECONOMY.taxes.residential.default, commercialTaxRate: ECONOMY.taxes.commercial.default });

export function isValidPolicy(policy: unknown): policy is EconomyPolicy {
  if (policy === null || typeof policy !== 'object') return false;
  const p = policy as Record<string, unknown>;
  const rate = (value: unknown, limits: { readonly min: number; readonly max: number }) => Number.isSafeInteger(value) && Number(value) >= limits.min && Number(value) <= limits.max;
  return rate(p.residentialTaxRate, ECONOMY.taxes.residential) && rate(p.commercialTaxRate, ECONOMY.taxes.commercial);
}

/**
 * The economy starts counting at the current day only when it is enabled exactly at midnight (a new city); otherwise
 * the rest of the current day is free and the first settlement covers the next full day (no retroactive billing).
 */
export function createEconomy(world: WorldState, options: EconomyOptions = {}): EconomyState {
  const policy = { ...DEFAULT_POLICY, ...options.policy };
  if (!isValidPolicy(policy)) throw new RangeError('invalid economy policy');
  const { day, minuteOfDay } = getGameTime(world.clock);
  return { version: 1, policy, lastSettledDay: minuteOfDay === 0 ? day - 1 : day, nextTransactionId: 1,
    constructionSpentAtSettlement: world.budget.totalSpent, today: { day, visits: {}, fees: {} },
    residents: {}, buildings: {}, history: [], ledger: [], totals: {}, alerts: [] };
}

export function validateEconomy(world: WorldState, assert: (condition: boolean, message: string) => asserts condition): void {
  const e = world.economy;
  if (e === undefined) return;
  const money = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  const { day } = getGameTime(world.clock);
  assert(e.version === 1 && isValidPolicy(e.policy), 'invalid economy version or policy');
  assert(world.clock.minutesPerTick <= 1440, 'economy ticks must not skip a day');
  assert(Number.isSafeInteger(e.lastSettledDay) && e.lastSettledDay >= day - 1 && e.lastSettledDay <= day, 'economy settlement is out of step with the clock');
  assert(Number.isSafeInteger(e.nextTransactionId) && e.nextTransactionId >= 1, 'invalid transaction cursor');
  assert(money(e.constructionSpentAtSettlement), 'invalid construction cursor');
  assert(e.today.day === day, 'economy day accumulators belong to another day');
  for (const map of [e.today.visits, e.today.fees]) for (const value of Object.values(map)) assert(money(value), 'invalid daily economy counter');
  const accounts = Object.entries(e.residents);
  assert(accounts.length <= 20_000, 'too many resident accounts');
  for (const [, a] of accounts) assert(money(a.balance) && money(a.income) && money(a.taxes) && money(a.spending), 'invalid resident account');
  for (const [id, f] of Object.entries(e.buildings)) {
    assert(f.buildingId === id && ['office', 'mall', 'park', 'pool', 'clubhouse'].includes(f.role), 'invalid building finance');
    assert([f.workers, f.jobs, f.revenue, f.payroll, f.upkeep, f.tax, f.visits, f.fees, f.demand, f.lossStreak].every(money) && Number.isSafeInteger(f.profit), 'invalid building finance amounts');
  }
  assert(e.history.length <= ECONOMY.historyDays && e.ledger.length <= ECONOMY.ledgerEntries, 'economy history exceeds its bounds');
  let previousDay = -Infinity;
  for (const r of e.history) {
    assert(Number.isSafeInteger(r.day) && r.day > previousDay && r.day <= e.lastSettledDay, 'economy reports must be unique and in order');
    previousDay = r.day;
    assert(money(r.treasuryOpen) && money(r.treasuryClose), 'invalid report treasury');
    const inflow = r.income.residentialTax + r.income.commercialTax + r.income.venueFees + r.income.constructionRefunds;
    const outflow = r.expenses.publicServices + r.expenses.roads + r.expenses.amenities + r.expenses.unemploymentSupport + r.expenses.construction;
    assert(r.treasuryOpen + inflow - outflow === r.treasuryClose, 'report does not reconcile the treasury');
  }
  let previousTx = 0;
  for (const t of e.ledger) {
    const id = /^tx-([1-9]\d*)$/.exec(t.id);
    assert(id !== null && Number(id[1]) > previousTx && Number(id[1]) < e.nextTransactionId, 'ledger IDs must be unique and ordered');
    previousTx = Number(id![1]);
    const flow = LEDGER_FLOWS[t.category];
    assert(flow !== undefined && flow[0] === t.from && flow[1] === t.to, 'ledger entry has an invalid direction');
    assert(Number.isSafeInteger(t.amount) && t.amount > 0 && money(t.count) && money(t.tick) && Number.isSafeInteger(t.day), 'invalid ledger amount');
  }
  for (const [category, total] of Object.entries(e.totals)) assert(category in LEDGER_FLOWS && money(total), 'invalid ledger total');
  const ids = new Set<string>();
  for (const a of e.alerts) { assert(!ids.has(a.id) && ['info', 'warning'].includes(a.severity), 'invalid economy alert'); ids.add(a.id); }
}

export function cloneEconomy(e: EconomyState): EconomyState {
  return {
    version: e.version, policy: { residentialTaxRate: e.policy.residentialTaxRate, commercialTaxRate: e.policy.commercialTaxRate },
    lastSettledDay: e.lastSettledDay, nextTransactionId: e.nextTransactionId, constructionSpentAtSettlement: e.constructionSpentAtSettlement,
    today: { day: e.today.day, visits: { ...e.today.visits }, fees: { ...e.today.fees } },
    residents: Object.fromEntries(Object.entries(e.residents).map(([id, a]) => [id, { balance: a.balance, income: a.income, taxes: a.taxes, spending: a.spending }])),
    buildings: Object.fromEntries(Object.entries(e.buildings).map(([id, f]) => [id, { ...f }])),
    history: e.history.map((r) => ({ ...r, income: { ...r.income }, expenses: { ...r.expenses }, unpaid: { ...r.unpaid } })),
    ledger: e.ledger.map((t) => ({ ...t })), totals: { ...e.totals }, alerts: e.alerts.map((a) => ({ ...a })),
  };
}

/** Records a resident's real arrival at a leisure venue on the current day (fees are collected at settlement). */
export function recordVisit(e: EconomyState, citizenId: string, venue: Building): EconomyState {
  const fee = venueFee(venue);
  return { ...e, today: { day: e.today.day,
    visits: { ...e.today.visits, [venue.id]: (e.today.visits[venue.id] ?? 0) + 1 },
    fees: fee > 0 ? { ...e.today.fees, [citizenId]: (e.today.fees[citizenId] ?? 0) + fee } : e.today.fees } };
}

/** Largest-remainder split of `total` by integer weights; deterministic (ties go to the earlier index). */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor(total * w / sum));
  let left = total - shares.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => ({ i, r: (total * w) % sum })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; shares[i]! += 1; left -= 1; }
  return shares;
}

/** Consumer confidence percent for the coming settlement. */
export function consumerConfidence(policy: EconomyPolicy, amenityCoverage: number, strained: boolean): number {
  const c = ECONOMY.confidence;
  const tax = policy.residentialTaxRate - c.neutralResidentialTax;
  return clamp(100 + Math.floor(c.amenityBonus * amenityCoverage / 100) + (tax < 0 ? -tax : -c.taxPenalty * tax) - (strained ? c.strainPenalty : 0), c.min, c.max);
}
/** Percent of full client demand offices keep at this commercial tax rate. */
export function officeDemandRate(policy: EconomyPolicy): number {
  const d = ECONOMY.officeDemand;
  return Math.max(d.min, 100 - d.perTaxPoint * Math.max(0, policy.commercialTaxRate - d.neutralCommercialTax));
}
/** Percent of shopping demand that stays in the city's malls (while they have capacity). */
export function localShoppingRate(policy: EconomyPolicy): number {
  const s = ECONOMY.localShopping;
  return Math.max(s.min, s.base - s.perTaxPoint * Math.max(0, policy.commercialTaxRate - s.neutralCommercialTax));
}

interface DayOutcome {
  readonly residents: Record<string, ResidentAccount>;
  readonly buildings: Record<string, BuildingFinance>;
  readonly report: EconomyDayReport;
  readonly entries: readonly Omit<LedgerEntry, 'id' | 'day' | 'tick'>[];
  readonly treasuryIncome: number;
  readonly treasuryExpenses: number;
}

/**
 * The pure core of a daily settlement: who earned, paid and spent what, given the world as it stands and the day's
 * real visits. Used both by settlement (committed) and by projections (never committed).
 */
export function computeEconomyDay(world: WorldState, economy: EconomyState, day: number): DayOutcome {
  const policy = economy.policy;
  const entries: Omit<LedgerEntry, 'id' | 'day' | 'tick'>[] = [];
  const add = (category: LedgerCategory, amount: number, buildingId: string | null = null, count = 0) => {
    if (amount > 0) entries.push({ category, amount, from: LEDGER_FLOWS[category][0], to: LEDGER_FLOWS[category][1], buildingId, count });
  };
  const buildings = [...world.plan.buildings].sort(byId);
  const buildingMap = new Map(buildings.map((b) => [b.id, b]));
  const citizens = [...world.citizens].sort(byId);
  const treasuryOpen = economy.history.at(-1)?.treasuryClose ?? null;
  let treasury = world.budget.balance;
  let treasuryIncome = 0, treasuryExpenses = 0;

  // Construction (already charged by city commands) is recorded once, as the change since the last settlement.
  const construction = world.budget.totalSpent - economy.constructionSpentAtSettlement;
  add(construction > 0 ? 'city.construction' : 'city.construction-refund', Math.abs(construction));

  // Accounts open when a resident first appears (with the savings they bring) and close when they leave.
  const live = new Set(citizens.map((c) => c.id));
  let arrivals = 0, arrivalCount = 0, departures = 0, departureCount = 0;
  const balances = new Map<string, number>();
  for (const c of citizens) {
    const account = economy.residents[c.id];
    if (account) balances.set(c.id, account.balance);
    else { balances.set(c.id, ECONOMY.startingSavings); arrivals += ECONOMY.startingSavings; arrivalCount += 1; }
  }
  for (const [id, account] of Object.entries(economy.residents).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!live.has(id)) { departures += account.balance; departureCount += 1; }
  }
  add('resident.arrival', arrivals, null, arrivalCount);
  add('resident.departure', departures, null, departureCount);

  // Employment comes from the simulation's job assignments (already within each workplace's capacity).
  const businesses = buildings.filter((b) => businessRole(b) !== null);
  const workers = new Map<string, number>(businesses.map((b) => [b.id, 0]));
  for (const c of citizens) if (c.workBuildingId !== null && workers.has(c.workBuildingId)) workers.set(c.workBuildingId, workers.get(c.workBuildingId)! + 1);
  const payroll = new Map<string, number>(businesses.map((b) => [b.id, 0]));

  // Wages, with residential tax withheld on each employer's whole payroll (so every tax point counts) and split over
  // its workers; the leftover whole dollars rotate daily, so over time everyone pays the same rate.
  const income = new Map<string, number>(), taxes = new Map<string, number>(), spending = new Map<string, number>();
  let wagesTotal = 0, residentialTax = 0, employed = 0;
  const unemployed: string[] = [];
  const staff = new Map<string, string[]>(businesses.map((b) => [b.id, []]));
  for (const c of citizens) {
    const job = c.workBuildingId === null ? undefined : buildingMap.get(c.workBuildingId);
    if (!job || !businessRole(job)) { unemployed.push(c.id); income.set(c.id, 0); taxes.set(c.id, 0); continue; }
    staff.get(job.id)!.push(c.id);
  }
  for (const b of businesses) {
    const team = staff.get(b.id)!, wage = ECONOMY.wages[businessRole(b)!];
    if (team.length === 0) continue;
    const total = wage * team.length, tax = percentOf(total, policy.residentialTaxRate);
    const shift = day % team.length, rotated = [...team.slice(shift), ...team.slice(0, shift)];
    const split = allocate(tax, rotated.map(() => 1));
    rotated.forEach((id, i) => { balances.set(id, balances.get(id)! + wage - split[i]!); income.set(id, wage); taxes.set(id, split[i]!); });
    payroll.set(b.id, total);
    wagesTotal += total; residentialTax += tax; employed += team.length;
    add('business.wages', total, b.id, team.length);
  }
  add('tax.residential', residentialTax, null, employed);
  treasury += residentialTax; treasuryIncome += residentialTax;

  // City support for residents without a job, while the treasury can pay it.
  let supportPaid = 0, supportUnpaid = 0;
  for (const id of unemployed) {
    const paid = Math.min(ECONOMY.unemploymentSupport, treasury);
    treasury -= paid; supportPaid += paid; supportUnpaid += ECONOMY.unemploymentSupport - paid;
    balances.set(id, balances.get(id)! + paid); income.set(id, paid);
  }
  add('city.support', supportPaid, null, unemployed.length);
  treasuryExpenses += supportPaid;

  // Spending: housing first, then the venue fees for real visits, then shopping, never beyond savings.
  const amenities = buildings.filter((b) => amenityRole(b) !== null);
  const leisureCapacity = amenities.reduce((sum, b) => sum + b.capacity, 0);
  const needed = Math.ceil(citizens.length * ECONOMY.amenityCapacityPercentOfResidents / 100);
  const amenityCoverage = needed === 0 ? 100 : Math.min(100, Math.floor(leisureCapacity * 100 / needed));
  const strained = (economy.history.at(-1)?.unpaid.upkeep ?? 0) > 0;
  const confidence = consumerConfidence(policy, amenityCoverage, strained);
  let housingTotal = 0, fees = 0, feesWaived = 0, demand = 0;
  const shopping = new Map<string, number>();
  for (const c of citizens) {
    let balance = balances.get(c.id)!;
    const rent = housingCost(buildingMap.get(c.homeBuildingId));
    const housing = Math.min(rent, balance);
    balance -= housing; housingTotal += housing;
    const owed = economy.today.fees[c.id] ?? 0, fee = Math.min(owed, balance);
    balance -= fee; fees += fee; feesWaived += owed - fee;
    const disposable = Math.max(0, income.get(c.id)! - taxes.get(c.id)! - rent);
    const k = ECONOMY.consumption;
    const wanted = percentOf(Math.max(k.minimum, k.base + percentOf(disposable, k.ofDisposable) + percentOf(balance - k.comfortSavings, k.ofSavingsGap)), confidence);
    const spent = Math.min(wanted, balance);
    balance -= spent; demand += spent;
    shopping.set(c.id, spent); spending.set(c.id, housing + fee + spent); balances.set(c.id, balance);
  }
  add('resident.housing', housingTotal, null, citizens.length);
  add('resident.venue-fees', fees, null, Object.keys(economy.today.fees).filter((id) => live.has(id)).length);
  treasury += fees; treasuryIncome += fees;

  // Shopping stays in the city's malls up to what their staff can sell; the rest is spent outside the city.
  const malls = businesses.filter((b) => businessRole(b) === 'mall');
  const capacities = malls.map((b) => workers.get(b.id)! * ECONOMY.mallSalesPerWorker);
  const capacity = capacities.reduce((a, b) => a + b, 0);
  const rate = localShoppingRate(policy);
  const local = Math.min(capacity, percentOf(demand, rate));
  const sales = allocate(local, capacities);
  const mallDemand = allocate(percentOf(demand, rate), malls.map((b) => b.capacity));
  add('resident.shopping-outside', demand - local, null, citizens.length);

  // Each business closes its day: revenue, wages, upkeep and commercial tax; the result goes to (or comes from) its owners.
  const finance: Record<string, BuildingFinance> = {};
  let commercialTax = 0, businessRevenue = 0, businessProfit = 0, profitable = 0;
  for (const b of businesses) {
    const role = businessRole(b)!, staffCount = workers.get(b.id)!;
    const mallIndex = malls.indexOf(b);
    const revenue = role === 'office' ? percentOf(staffCount * ECONOMY.officeRevenuePerWorker, officeDemandRate(policy)) : sales[mallIndex]!;
    const tax = percentOf(revenue, policy.commercialTaxRate), upkeep = ECONOMY.businessUpkeep[role], wages = payroll.get(b.id)!;
    const profit = revenue - wages - upkeep - tax;
    add(role === 'office' ? 'business.services' : 'business.sales', revenue, b.id, staffCount);
    add('tax.commercial', tax, b.id);
    add('business.upkeep', upkeep, b.id);
    add(profit >= 0 ? 'business.profit' : 'business.loss-cover', Math.abs(profit), b.id);
    const lossStreak = profit < 0 ? (economy.buildings[b.id]?.lossStreak ?? 0) + 1 : 0;
    const status: BusinessStatus = staffCount === 0 ? 'unstaffed' : staffCount * 100 < b.capacity * ECONOMY.understaffedPercent ? 'understaffed' :
      profit >= 0 ? 'profitable' : role === 'mall' && sales[mallIndex]! < capacities[mallIndex]! ? 'weak-demand' : 'loss';
    finance[b.id] = { buildingId: b.id, role, workers: staffCount, jobs: b.capacity, revenue, payroll: wages, upkeep, tax, profit,
      visits: 0, fees: 0, demand: role === 'mall' ? mallDemand[mallIndex]! : 0, status, lossStreak };
    commercialTax += tax; businessRevenue += revenue; businessProfit += profit; if (profit >= 0) profitable += 1;
  }
  treasury += commercialTax; treasuryIncome += commercialTax;

  // City upkeep, paid in order while the treasury can; anything left is unpaid (and strains confidence tomorrow).
  let upkeepUnpaid = 0;
  const pay = (category: LedgerCategory, cost: number, buildingId: string | null = null, count = 0) => {
    const paid = Math.min(cost, treasury);
    treasury -= paid; treasuryExpenses += paid; upkeepUnpaid += cost - paid;
    add(category, paid, buildingId, count);
    return paid;
  };
  const publicServices = pay('city.public-services', citizens.length * ECONOMY.publicServicesPerResident, null, citizens.length);
  const roads = pay('city.road-upkeep', roadUpkeep(world.plan.roads.length), null, world.plan.roads.length);
  let amenityUpkeep = 0;
  for (const b of amenities) {
    const role = amenityRole(b)!, cost = ECONOMY.cityUpkeep[role];
    const paid = pay('city.amenity-upkeep', cost, b.id, 1);
    amenityUpkeep += paid;
    const visits = economy.today.visits[b.id] ?? 0;
    finance[b.id] = { buildingId: b.id, role, workers: 0, jobs: 0, revenue: 0, payroll: 0, upkeep: cost, tax: 0, profit: -cost,
      visits, fees: visits * venueFee(b), demand: 0, status: 'public', lossStreak: 0 };
  }

  const residents: Record<string, ResidentAccount> = {};
  let savings = 0;
  for (const c of citizens) {
    const balance = balances.get(c.id)!;
    residents[c.id] = { balance, income: income.get(c.id)!, taxes: taxes.get(c.id)!, spending: spending.get(c.id)! };
    savings += balance;
  }
  const constructionSpent = Math.max(0, construction), refunds = Math.max(0, -construction);
  const open = treasuryOpen ?? world.budget.balance + constructionSpent - refunds;
  const report: EconomyDayReport = {
    day, treasuryOpen: open, treasuryClose: treasury,
    income: { residentialTax, commercialTax, venueFees: fees, constructionRefunds: refunds },
    expenses: { publicServices, roads, amenities: amenityUpkeep, unemploymentSupport: supportPaid, construction: constructionSpent },
    unpaid: { upkeep: upkeepUnpaid, support: supportUnpaid },
    population: citizens.length, employed, jobs: businesses.reduce((sum, b) => sum + b.capacity, 0), wages: wagesTotal,
    housing: housingTotal, shoppingDemand: demand, shoppingLocal: local, shoppingOutside: demand - local, feesWaived,
    residentSavings: savings, arrivals: arrivalCount, departures: departureCount,
    businesses: businesses.length, profitableBusinesses: profitable, businessRevenue, businessProfit,
    confidence, amenityCoverage, localShoppingRate: rate,
  };
  return { residents, buildings: finance, report, entries, treasuryIncome, treasuryExpenses };
}

function alertsFor(report: EconomyDayReport, previous: readonly EconomyDayReport[], finance: Readonly<Record<string, BuildingFinance>>): EconomyAlert[] {
  const alerts: EconomyAlert[] = [];
  const add = (kind: EconomyAlert['kind'], severity: EconomyAlert['severity'], value: number, buildingId: string | null = null) =>
    alerts.push({ id: buildingId ? `${kind}:${buildingId}` : kind, kind, severity, day: report.day, buildingId, value });
  const inflow = report.income.residentialTax + report.income.commercialTax + report.income.venueFees;
  const operating = report.expenses.publicServices + report.expenses.roads + report.expenses.amenities + report.expenses.unemploymentSupport;
  const net = inflow - operating;
  if (report.unpaid.upkeep + report.unpaid.support > 0) add('upkeep-unpaid', 'warning', report.unpaid.upkeep + report.unpaid.support);
  else if (operating > 0 && report.treasuryClose < operating * 3) add('treasury-low', 'warning', report.treasuryClose);
  if (net < 0) add('deficit', 'warning', -net);
  if (report.population >= 10 && (report.population - report.employed) * 100 >= report.population * 15) {
    add('unemployment', 'warning', Math.round((report.population - report.employed) * 100 / report.population));
  }
  for (const f of Object.values(finance).sort((a, b) => a.buildingId < b.buildingId ? -1 : 1)) {
    if (f.status === 'understaffed' || f.status === 'unstaffed') add('understaffed', 'warning', f.workers, f.buildingId);
    else if (f.status !== 'public' && f.lossStreak >= 2) add('business-loss', 'warning', -f.profit, f.buildingId);
  }
  if (report.population >= 20 && report.shoppingDemand > 0 && (report.shoppingDemand - report.shoppingLocal) * 100 > report.shoppingDemand * (100 - report.localShoppingRate + 25)) {
    add('shopping-demand', 'info', report.shoppingDemand - report.shoppingLocal);
  }
  const nets = [...previous.slice(-2), report].map((r) => r.income.residentialTax + r.income.commercialTax + r.income.venueFees -
    r.expenses.publicServices - r.expenses.roads - r.expenses.amenities - r.expenses.unemploymentSupport);
  if (nets.length === 3 && net > 0 && nets[0]! < nets[1]! && nets[1]! < nets[2]!) add('improving', 'info', net);
  return alerts;
}

/**
 * Settles `day` once: applies the computed day to the treasury, the resident accounts and the bounded history/ledger.
 * A day at or before `lastSettledDay` is never settled again.
 */
export function settleEconomyDay(world: WorldState, day: number, tick: number): { economy: EconomyState; budget: CityBudget; events: SimulationEvent[] } {
  const economy = world.economy!;
  if (day <= economy.lastSettledDay) return { economy, budget: world.budget, events: [] };
  const outcome = computeEconomyDay(world, economy, day);
  const budget = applyOperating(world.budget, outcome.treasuryIncome, outcome.treasuryExpenses);
  if (budget.balance !== outcome.report.treasuryClose) throw new RangeError('settlement does not reconcile the treasury');
  let cursor = economy.nextTransactionId;
  const entries: LedgerEntry[] = outcome.entries.map((entry) => ({ id: `tx-${cursor++}`, day, tick, ...entry }));
  const totals: Partial<Record<LedgerCategory, number>> = { ...economy.totals };
  for (const entry of entries) totals[entry.category] = (totals[entry.category] ?? 0) + entry.amount;
  const history = [...economy.history, outcome.report].slice(-ECONOMY.historyDays);
  const alerts = alertsFor(outcome.report, economy.history, outcome.buildings);
  const active = new Set(economy.alerts.map((a) => a.id));
  const events: SimulationEvent[] = [{ type: 'economy.day-settled', tick, day, report: outcome.report },
    ...alerts.filter((a) => !active.has(a.id)).map((alert) => ({ type: 'economy.alert' as const, tick, alert }))];
  const today: EconomyToday = { day: day + 1, visits: {}, fees: {} };
  return { budget, events, economy: { ...economy, lastSettledDay: day, nextTransactionId: cursor, constructionSpentAtSettlement: world.budget.totalSpent,
    today, residents: outcome.residents, buildings: outcome.buildings, history, ledger: [...economy.ledger, ...entries].slice(-ECONOMY.ledgerEntries),
    totals, alerts } };
}

/**
 * What the current day would settle to if it ended now (no state changes). Used for the dashboard's estimate,
 * policy previews and AI plan estimates; never authoritative.
 */
export function projectEconomyDay(world: WorldState, policy?: EconomyPolicy): EconomyDayReport {
  const economy = world.economy ?? createEconomy(world);
  const scenario = policy ? { ...economy, policy } : economy;
  return computeEconomyDay(world, scenario, getGameTime(world.clock).day).report;
}

export function residentAccount(world: WorldState, citizenId: string): ResidentAccount | null {
  if (!world.economy || !world.citizens.some((c) => c.id === citizenId)) return null;
  return world.economy.residents[citizenId] ?? { balance: ECONOMY.startingSavings, income: 0, taxes: 0, spending: 0 };
}

export type FinancialCondition = 'comfortable' | 'getting-by' | 'struggling';
export function financialCondition(account: ResidentAccount): FinancialCondition {
  if (account.balance >= ECONOMY.consumption.comfortSavings) return 'comfortable';
  // Little left, and everything that comes in goes straight out (or more).
  return account.balance < 30 && account.income - account.taxes <= account.spending ? 'struggling' : 'getting-by';
}

/** Operating income and expenses of a report (construction excluded). */
export function operatingNet(report: EconomyDayReport): { income: number; expenses: number; net: number } {
  const income = report.income.residentialTax + report.income.commercialTax + report.income.venueFees;
  const expenses = report.expenses.publicServices + report.expenses.roads + report.expenses.amenities + report.expenses.unemploymentSupport;
  return { income, expenses, net: income - expenses };
}
