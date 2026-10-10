import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOG, CONSTRUCTION_COSTS, createBudget, spendBudget, validateBudget } from '../src/index.js';

describe('construction catalog and city budget', () => {
  it('keeps prices/footprints/rules in one immutable catalog', () => {
    expect(CONSTRUCTION_COSTS).toEqual({ villa: 120, duplex: 180, townhouse: 160, apartment: 480, park: 80, clubhouse: 220, pool: 180, mall: 900, office: 640, road: 8 });
    expect(BUILDING_CATALOG.villa.cost).toBe(CONSTRUCTION_COSTS.villa);
    expect(BUILDING_CATALOG.clubhouse.requiresRoad).toBe(true);
    expect(BUILDING_CATALOG.park.requiresRoad).toBe(false);
    expect(Object.isFrozen(BUILDING_CATALOG)).toBe(true);
    expect(Object.isFrozen(BUILDING_CATALOG.villa.footprint)).toBe(true);
  });

  it('spends integer dollars without mutating the opening ledger', () => {
    const budget = createBudget(200);
    expect(spendBudget(budget, 120)).toEqual({ openingBalance: 200, balance: 80, totalSpent: 120 });
    expect(budget.balance).toBe(200);
    expect(spendBudget(budget, 200).balance).toBe(0);
    expect(() => spendBudget(budget, 201)).toThrow(/insufficient/);
    expect(() => validateBudget({ ...budget, totalSpent: 1 })).toThrow(/ledger/);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid amounts %s', (amount) => {
    expect(() => createBudget(amount)).toThrow(RangeError);
    expect(() => spendBudget(createBudget(100), amount)).toThrow(RangeError);
  });
});
