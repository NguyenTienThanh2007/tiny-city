import type { CityBudget } from './types.js';

export function validateBudget(budget: CityBudget): void {
  for (const value of [budget.openingBalance, budget.balance, budget.totalSpent]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('budget amounts must be nonnegative safe integer dollars');
  }
  if (budget.balance + budget.totalSpent !== budget.openingBalance) throw new RangeError('budget ledger does not balance');
}

export function createBudget(openingBalance = 0): CityBudget {
  const budget = { openingBalance, balance: openingBalance, totalSpent: 0 };
  validateBudget(budget);
  return Object.freeze(budget);
}

export function spendBudget(budget: CityBudget, amount: number): CityBudget {
  validateBudget(budget);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('cost must be a nonnegative safe integer');
  if (amount > budget.balance) throw new RangeError('insufficient funds');
  return Object.freeze({ ...budget, balance: budget.balance - amount, totalSpent: budget.totalSpent + amount });
}
