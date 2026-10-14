# Business economy (Phase 5)

## Which buildings are businesses

| Building | Economic role |
|---|---|
| Office (60 jobs) | Business: sells services to clients outside the city |
| Mall (100 jobs) | Business: sells to residents |
| Park, pool, clubhouse | Public amenities: city upkeep, fees for real visits (parks are free) |
| Homes | No business: residents pay rent to landlords outside the city; the city pays public services per resident |

A legacy authored workplace without a type is treated as an office. A business's identity is its building ID; its last
settled day is `economy.buildings[buildingId]` (a `BuildingFinance`).

## A business's day

| Line | Office | Mall |
|---|---|---|
| Revenue | workers × $42 × office demand (100% at commercial tax ≤ 6%, −4% per point above, floor 30%) | its share of local shopping, at most workers × $40 (what its staff can sell) |
| Payroll | workers × $26 | workers × $18 |
| Operating costs | $340 | $240 |
| Commercial tax | percent of revenue | percent of revenue |
| Result | profit to the owners (`business.profit`) or a loss covered by them (`business.loss-cover`) | same |

Businesses are pass-through accounts. Every day closes at zero, so a business never accumulates cash and money never
appears from a business. The owners are outside the city (an explicit external account).

Malls and local shopping:
- The city's shopping demand is what residents chose to spend.
- The local share is 85% at commercial tax ≤ 6%, falling 3% per point above, floor 40%.
- That share stays in the malls up to their staff capacity. It is allocated over malls by capacity, with whole dollars
  by largest remainder.
- The rest is spent outside the city. A city without a staffed mall spends everything outside.

## Status shown to the player

| Status | Rule |
|---|---|
| No workers | 0 staff: no revenue, the full operating cost is a loss |
| Understaffed | Fewer workers than 50% of the jobs |
| Profitable | Result ≥ 0 |
| Weak customer demand | A mall losing money while selling less than its staff could |
| Losing money | Any other loss |

`lossStreak` counts consecutive days with a loss; from 2 days a `business-loss` alert appears.

## Profitability in practice

| Business | Result |
|---|---|
| Full office at default tax | +$469 a day |
| Office, breakeven | about 25 workers (42%) |
| Full mall | needs about 200 residents shopping locally |
| Mall in a small town | understaffed or "weak demand" |
| Commercial tax 14% | offices lose money (owners cover it); city commercial income peaks |
| Commercial tax 20% | demand loss outweighs the rate, so city commercial income falls again |

## Not in Phase 5

- Business losses are informative. Owners always cover them, and nothing closes or relocates.
- Hiring follows the existing job assignment (capacity), not demand. A mall in a small town therefore employs more
  people than its customers need and reports weak demand.
- Demand-based hiring, closures and relocation are documented future work, not part of this phase.
