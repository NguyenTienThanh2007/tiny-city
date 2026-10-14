import type { CityBudget } from './types.js';

const amount = (value: number | undefined) => value ?? 0;

export function validateBudget(budget: CityBudget): void {
  for (const value of [budget.openingBalance, budget.balance, budget.totalSpent, amount(budget.operatingIncome), amount(budget.operatingExpenses)]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('budget amounts must be nonnegative safe integer dollars');
  }
  if (budget.balance + budget.totalSpent + amount(budget.operatingExpenses) !== budget.openingBalance + amount(budget.operatingIncome)) {
    throw new RangeError('budget ledger does not balance');
  }
}

export function createBudget(openingBalance = 0): CityBudget {
  const budget = { openingBalance, balance: openingBalance, totalSpent: 0 };
  validateBudget(budget);
  return Object.freeze(budget);
}

/** Construction spending (rewound by undo/redo). */
export function spendBudget(budget: CityBudget, amount: number): CityBudget {
  validateBudget(budget);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('cost must be a nonnegative safe integer');
  if (amount > budget.balance) throw new RangeError('insufficient funds');
  return Object.freeze({ ...budget, balance: budget.balance - amount, totalSpent: budget.totalSpent + amount });
}

/** Phase 5 operating money in (taxes, fees) or out (upkeep, services, support). Never construction. */
export function applyOperating(budget: CityBudget, income: number, expenses: number): CityBudget {
  validateBudget(budget);
  for (const value of [income, expenses]) if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('operating amounts must be nonnegative safe integers');
  if (budget.balance + income - expenses < 0) throw new RangeError('the treasury cannot go below zero');
  if (income === 0 && expenses === 0) return budget;
  const next = Object.freeze({ ...budget, balance: budget.balance + income - expenses,
    operatingIncome: amount(budget.operatingIncome) + income, operatingExpenses: amount(budget.operatingExpenses) + expenses });
  validateBudget(next);
  return next;
}

/**
 * Undo/redo restores the construction spending of a history snapshot. Time-based money (operating income and
 * expenses since then) is never rewound, so the balance moves only by the difference in construction spending.
 * Returns null when the city cannot afford to redo that construction now.
 */
export function restoreConstruction(current: CityBudget, snapshot: CityBudget): CityBudget | null {
  validateBudget(current);
  validateBudget(snapshot);
  const balance = current.balance + current.totalSpent - snapshot.totalSpent;
  if (balance < 0) return null;
  const next = Object.freeze({ ...current, balance, totalSpent: snapshot.totalSpent });
  validateBudget(next);
  return next;
}
