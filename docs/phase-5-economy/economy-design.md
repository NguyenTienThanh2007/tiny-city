# Economy design (Phase 5)

## Where it lives

| Layer | Files | Role |
|---|---|---|
| Rules and state | `packages/simulation/src/economyConfig.ts` | Every balance constant, typed and frozen; `percentOf` |
| | `packages/simulation/src/economy.ts` | State, validation, cloning, the daily computation, settlement, projection, alerts |
| | `packages/simulation/src/economyForecast.ts` | `estimateEconomyImpact`: plan/placement estimates (pure) |
| | `packages/simulation/src/budget.ts` | The treasury: construction spending, operating money, undo/redo rule |
| | `packages/simulation/src/simulation.ts` | `enableEconomy`, `executeEconomy`, settlement at the day boundary, visit recording, `canRestoreCity` |
| Presentation | `src/simulation/economyView.ts` | Overview, rows, alert texts, building/resident cards, policy preview, plan estimate (all derived) |
| | `src/ui/EconomyPanel.tsx`, `src/ui/EconomyCards.tsx` | The City economy panel and the inspector/plan cards |

The economy is part of the authoritative `WorldState` (`world.economy`), owned by the simulation package like the
population and the player. The frontend never computes money; it shows settled reports or labelled projections made by
the same engine code.

## Actors and flows

```
                 wages                         residential tax
  ┌──────────┐ ───────────▶ ┌───────────┐ ─────────────────────▶ ┌──────────┐
  │ business │              │ residents │      venue fees         │ treasury │
  │ (office, │ ◀─────────── │ (accounts)│ ─────────────────────▶  │ (budget) │
  │  mall)   │  mall sales  └───────────┘ ◀──────────────────────  └──────────┘
  └──────────┘                   │      unemployment support            │
       │  commercial tax ───────────────────────────────────────────▶   │
       │                         │                                      │
       ▼                         ▼                                      ▼
  external economy: office clients (in), owners (profit out / loss cover in), suppliers (business upkeep out),
  landlords and utilities (rent out), shops outside the city (shopping out), arrivals and departures (savings),
  city contractors (public services, road and amenity upkeep, construction)
```

- **Internal transfers** move money between city actors (wages, mall sales, taxes, fees, support).
- **External flows** create or remove money: office revenue, loss cover, profit distribution, business upkeep, rent,
  shopping outside, arrivals and departures, city upkeep, construction.
- Only external flows change `treasury + Σ resident savings`. Businesses close every day at zero (see
  [business-economy.md](business-economy.md)).

## Cadence

| What | When |
|---|---|
| Wages, taxes, support, spending, business accounts, city upkeep | Once per game day, at the first tick of the next day (midnight) |
| Venue visits | Recorded during the day when a resident arrives at a park, pool or clubhouse for leisure; fees are collected at settlement |
| Construction | Charged by the city command, immediately (as before); recorded in the next settlement's ledger |
| Reports and history | One report per settled day, last 28 kept |
| Alerts | Evaluated at settlement; an alert is announced once when it becomes active |
| Policy | Changes apply immediately to the policy; they affect the next settlement and later ones |

Settlement is driven by the simulation clock only (one game day = 1,440 ticks). It never uses a wall clock or timers:

- **Paused:** no ticks, so no settlement.
- **Speed (1×, 2×, 4×):** scales real time fed to the same clock, so the same ticks and settlements happen.
- **Step while paused:** runs exact ticks, so a step across midnight settles.
- **Rendering:** never involved.

## The daily computation

`computeEconomyDay(world, economy, day)` is pure and runs in this order (all integer arithmetic):

1. **Construction since the last settlement:** `budget.totalSpent − constructionSpentAtSettlement`, recorded as
   construction or as a refund.
2. **Accounts:** open for new residents (with `startingSavings` from outside); close for residents who left (their
   savings leave with them).
3. **Employment:** the simulation's own job assignments (already within each workplace's capacity).
4. **Wages:** per employer, with residential tax withheld on the employer's payroll and split over its workers.
5. **Unemployment support:** paid to each resident without a job while the treasury can pay it.
6. **Spending, per resident, never beyond savings:**
   - housing first;
   - then fees for that resident's real visits today;
   - then shopping, from the consumption rule.
7. **Shopping:** the local share stays in the city's malls up to what their staff can sell. The rest goes outside the
   city.
8. **Businesses:**
   - Revenue: office services, or mall sales.
   - Then payroll, operating costs and commercial tax.
   - Profit goes to the owners; a loss is covered by them.
9. **City upkeep:**
   - Paid in order: public services, roads, then each amenity.
   - Each is paid only while the treasury has money. Anything left is recorded as unpaid.
10. **Report and per-building finance.**

`settleEconomyDay` applies that outcome: it updates the treasury through `applyOperating`, replaces accounts and
building finance, appends the report, numbers and appends ledger entries, updates lifetime totals, evaluates alerts,
and moves `lastSettledDay` forward. A day at or before `lastSettledDay` is never settled again.

## What is simulated directly and what is aggregated

| Directly from the simulation | Aggregated (documented abstractions) |
|---|---|
| Who lives where and who works where (real assignments, capacities) | Office revenue: clients outside the city, per worker |
| Real leisure visits (arrivals at venues) and their fees | Shopping: a daily amount per resident, not a store visit; malls receive the local share |
| Population, jobs, roads and amenities for upkeep | Rent and utilities paid to landlords outside the city |
| Construction charges and refunds | Business owners outside the city (profit out, losses covered) |

Residents never "walk to a store" in Phase 5. Shopping is an aggregate daily transaction, and the dashboard says so.
Venue fees are only charged for visits the simulation actually produced.

## Feedback loops (bounded)

- **More homes:** more residents. That brings more public-services cost and more support if they have no job, and more
  taxes and shopping if they do.
- **More offices:** more jobs, so more wages, residential tax and commercial tax on office revenue. Each office also
  carries a fixed operating cost, which its owners carry, and it loses money while understaffed.
- **More malls:** more local shopping capacity, so more mall sales and commercial tax. A mall needs about 200 residents
  shopping there to cover its staff, otherwise it reports weak demand.
- **More amenities:** more upkeep and more fee income from real visits. Amenity coverage raises consumer confidence by
  up to 8%, so residents spend more.
- **Taxes:** higher residential tax lowers confidence (less shopping). Higher commercial tax sends shoppers outside the
  city and office clients elsewhere.

Every effect is clamped: confidence is 80–110%, local shopping 40–85%, office demand 30–100%. Spending depends on
savings, so savings settle instead of compounding. There are no runaway loops: no rule multiplies itself without a
bound.

## Not in Phase 5

These are explicitly not in Phase 5:
- business closure or relocation;
- debt or loans (personal or city);
- demand-driven population growth (housing still fills as before);
- the player character as an economic actor;
- trade, banking, disasters, random crises.

[balancing.md](balancing.md) explains how far the current consequences go.
