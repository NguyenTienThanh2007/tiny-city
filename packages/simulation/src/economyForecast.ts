import { applyCityCommandBatch } from './cityCommands.js';
import { operatingNet, projectEconomyDay } from './economy.js';
import type { CityCommand, EconomyDayReport, WorldState } from './types.js';

/**
 * The economic consequences of a set of city commands (an AI plan, a placement), separated into what is certain now
 * (the construction cost, charged once on approval) and what is an estimate (one day at today's activity, before and
 * after). Pure: the live world, its treasury and its economy are never changed.
 */
export interface EconomyImpactEstimate {
  readonly applied: boolean;
  readonly confirmed: { readonly constructionCost: number; readonly treasuryAfter: number };
  readonly estimated: {
    readonly jobsAdded: number;
    readonly roomsAdded: number;
    readonly residentsAdded: number;
    readonly employedChange: number;
    /** City operating income per day (taxes, fees). */
    readonly incomeChange: number;
    /** City operating expenses per day (services, upkeep, support). */
    readonly expensesChange: number;
    readonly upkeepChange: number;
    readonly netChange: number;
    readonly businessProfitChange: number;
  };
  readonly before: EconomyDayReport;
  readonly after: EconomyDayReport;
}

const upkeep = (r: EconomyDayReport) => r.expenses.roads + r.expenses.amenities + r.expenses.publicServices;
const rooms = (world: WorldState) => world.plan.buildings.reduce((sum, b) => sum + (b.kind === 'home' ? b.capacity : 0), 0);

export function estimateEconomyImpact(world: WorldState, commands: readonly CityCommand[]): EconomyImpactEstimate | null {
  if (commands.length === 0) return null;
  const result = applyCityCommandBatch(world, commands);
  const after = result.state;
  const beforeDay = projectEconomyDay(world), afterDay = projectEconomyDay(after);
  const a = operatingNet(beforeDay), b = operatingNet(afterDay);
  return {
    applied: result.applied,
    confirmed: { constructionCost: after.budget.totalSpent - world.budget.totalSpent, treasuryAfter: after.budget.balance },
    estimated: {
      jobsAdded: afterDay.jobs - beforeDay.jobs, roomsAdded: rooms(after) - rooms(world),
      residentsAdded: afterDay.population - beforeDay.population, employedChange: afterDay.employed - beforeDay.employed,
      incomeChange: b.income - a.income, expensesChange: b.expenses - a.expenses, upkeepChange: upkeep(afterDay) - upkeep(beforeDay),
      netChange: b.net - a.net, businessProfitChange: afterDay.businessProfit - beforeDay.businessProfit,
    },
    before: beforeDay, after: afterDay,
  };
}
