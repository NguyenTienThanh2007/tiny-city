# Taxes and treasury (Phase 5)

## The treasury

The treasury is the existing `budget.balance`. It is shown as Funds and spent by construction. Phase 5 adds two running
totals to the budget:
- `operatingIncome`: taxes and fees.
- `operatingExpenses`: support, services and upkeep.

Both are absent in older saves (absent means 0). Construction keeps its meaning in `totalSpent`.

```
balance + totalSpent + operatingExpenses === openingBalance + operatingIncome
```

Construction rules are unchanged:
- A building or road is charged once, when its command applies.
- A command is refused when the treasury cannot pay.
- Batches stay atomic.

## Income (per day)

| Source | Rule |
|---|---|
| Residential tax | `percentOf(payroll, rate)` per employer; default 10%, 0–20% |
| Commercial tax | `percentOf(revenue, rate)` per business; default 6%, 0–20% |
| Venue fees | Pool $3 and clubhouse $4 per real leisure visit; parks are free. Unpaid fees (a resident with no money) are waived and reported. |

## Expenses (per day)

| Cost | Rule |
|---|---|
| Public services | $3 per resident |
| Road upkeep | $1 per 4 road tiles (rounded up) |
| Amenities | Park $10, pool $24, clubhouse $18 |
| Unemployment support | $5 per resident without a job |

Businesses pay their own operating costs, so those are not city expenses.

## When the treasury cannot pay

The treasury never goes below zero.
- Support is paid resident by resident while money remains.
- City upkeep is paid in order (services, roads, then each amenity) while money remains.

Anything left is recorded in the report as unpaid. It is never carried as debt.

Consequences of unpaid costs:
- An `upkeep-unpaid` warning.
- The next day's consumer confidence drops 10%, so residents shop less.
- Construction is refused for lack of funds.

The dashboard status reads "Treasury empty". The city recovers as income returns: raise taxes, add jobs or demolish
costly amenities.

## Tax policy

| Policy | Default | Range | Effect |
|---|---|---|---|
| Residential tax | 10% | 0–20% | More city income from wages. Confidence: +1% per point below 10, −2% per point above, so shopping changes too. Residents keep less. |
| Commercial tax | 6% | 0–20% | More city income from business revenue. Local shopping falls 3% per point above 6 (from 85%, floor 40%). Office client demand falls 4% per point above 6 (floor 30%), so profits fall. |

Changing the policy:
- `Simulation.executeEconomy({ type: 'economy.set-policy', policy })` applies immediately and affects the next
  settlement and later ones.
- Changes are not city history (undo does not revert them), like time.
- A change is rejected if it is invalid (out of range or not an integer), unchanged, or the economy is disabled.

The panel shows an estimate before applying ("at today's activity"):
- city income;
- confidence;
- local shopping and office demand;
- business profits.

A change of 5 points or more asks for confirmation.

## Budget health on the dashboard

- **Treasury.**
- **Last day:** the operating result (taxes and fees minus support, services and upkeep) and the income and expense
  breakdown.
- **Seven-day totals and a 14-day chart:** treasury, or income and expenses with net.
- **Runway:** days of money left at the last day's loss.
- **Status:** healthy, tight (losing money), deficit (under seven days of runway) or treasury empty.

All of these are derived from the stored reports; no total is stored twice. Today's figures are an estimate: the same
computation applied to the city as it is now, labelled as not final until midnight.
