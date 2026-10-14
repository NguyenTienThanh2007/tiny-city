# Monetary model (Phase 5)

## Units

- Every amount is a **whole dollar**, stored as a JavaScript safe integer. That covers the treasury, accounts, wages,
  fees, upkeep, ledger amounts and report fields. The unit is the same as the existing funds and construction costs, so
  nothing was converted or migrated.
- Every rate is an **integer percent** (taxes, confidence, local shopping, office demand).
- No authoritative value is ever a floating-point sum.

## Rounding

| Operation | Rule |
|---|---|
| `percentOf(amount, percent)` | `floor((amount × percent + 50) / 100)`: round half up (toward +∞ at exactly .5), exact for safe integers, including negative amounts (the savings gap in spending) |
| Residential tax | `percentOf(employer payroll, rate)` once per employer; then split over its workers |
| Splitting a total | `allocate(total, weights)`: largest remainder, ties to the earlier index; the parts always sum to the total |
| Leftover tax dollars | The worker order rotates by day, so over time every worker pays the same rate |
| Mall sales | The local total is allocated over malls by staff capacity with `allocate` |
| Road upkeep | `ceil(tiles / 4)` dollars |

Withholding on the whole payroll means every tax point changes revenue. Per-person rounding would hide small rate changes
(26 × 9% = 2.34 → 2, same as 8%), so it is not used.

## Bounds and validity

- The treasury and accounts are never negative. The city pays costs only while it has money (see
  [tax-and-treasury.md](tax-and-treasury.md)). Residents spend only what they have.
- `validateEconomy` (run by `validateWorld` on every load, command and restore) rejects all of these:
  - non-integer, negative, NaN or infinite amounts;
  - a policy outside its bounds;
  - a settlement cursor out of step with the clock;
  - out-of-order or duplicate reports or ledger IDs;
  - a ledger entry whose direction differs from its category;
  - a report that does not reconcile the treasury.
- `validateBudget` checks
  `balance + totalSpent + operatingExpenses === openingBalance + operatingIncome` with nonnegative safe integers.

## Determinism

Settlement uses only these inputs:
- the world (sorted by ID: buildings, citizens, accounts);
- the day's recorded visits;
- the policy;
- integer constants.

It reads no clock, random numbers or iteration order of unsorted maps. The tests replay a world with different frame
chunking, across save/load and across speed changes, and get byte-identical snapshots (`economy.test.ts`,
`economyFuzz.test.ts`, browser test G).
