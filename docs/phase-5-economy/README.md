# Phase 5: Living economy simulation

**Baseline:** `main` at `fe78a9efe985ac3bd2582094946038a0fb258b7c` (Phase 4.6, PR #20, GitHub Actions 3/3).
**Branch:** `feature/p5-living-economy`.

TINY CITY now has a deterministic, auditable economy inside the authoritative simulation:
- a city treasury with taxes and running costs;
- residents who earn, pay tax and spend;
- offices and malls with real staff, revenue, payroll and profit or loss;
- a daily settlement at midnight that the player can follow in a City economy panel.

It is built on the existing world:
- the same clock, residents, job assignments and building capacities;
- the same construction costs, saves and Life Mode;
- no separate fake economy.

| Document | Contents |
|---|---|
| [economy-design.md](economy-design.md) | Actors, flows, cadence, the daily computation, simulated vs aggregated, feedback loops |
| [monetary-model.md](monetary-model.md) | Integer dollars, rounding, allocation, bounds, determinism |
| [accounting-invariants.md](accounting-invariants.md) | The ledger, its categories and directions, the invariants and their tests |
| [tax-and-treasury.md](tax-and-treasury.md) | Treasury, income, expenses, bankruptcy boundary, tax policy, budget health |
| [resident-economy.md](resident-economy.md) | Accounts, employment, wages, spending, financial condition |
| [business-economy.md](business-economy.md) | Offices, malls, amenities, business accounts, status, profitability |
| [balancing.md](balancing.md) | Constants, six reference cities, trade-offs, balance limitations |
| [persistence-and-migration.md](persistence-and-migration.md) | Saves, cloud saves, older saves, no double settlement, undo/redo, AI previews |
| [performance.md](performance.md) | Settlement cost, tick overhead, save size, browser frame pacing before/after |
| [acceptance.md](acceptance.md) | The 22 criteria, evidence and verdict |
| [screenshots/](screenshots/) | Real browser captures |

## How money flows, in one paragraph

Every midnight the simulation settles the finished day, in this order:
1. Each employer pays its workers. Residential tax is withheld for the city.
2. Residents without a job get city support.
3. Residents pay rent to landlords outside the city, and fees for their real pool and clubhouse visits.
4. Residents shop. The share their savings and mood allow goes to the city's malls, up to what the staff can sell; the
   rest is spent outside.
5. Offices bill clients outside the city.
6. Every business pays wages, operating costs and commercial tax. Its profit goes to, or its loss is covered by,
   owners outside the city.
7. The city pays public services, road upkeep and amenity upkeep, but never more than it has.

Each movement is a ledger entry with a fixed source and destination. Integer dollars only. A day is never settled twice.

## Try it

| Task | Command or action |
|---|---|
| Open the economy panel | Click the treasury in the top bar (on phones: the treasury chip in the Build panel). Settlements happen at 00:00 game time; at 4× a day takes 36 s. |
| Simulation tests | `npm run test:simulation`: `economy.test.ts`, `economyBalance.test.ts`, `economyFuzz.test.ts` (`ECONOMY_SEEDS=25 ECONOMY_STEPS=150` for a wide sweep) |
| Browser tests | `npx playwright test e2e/phase-5-economy.spec.ts` |
| Balance table | `node scripts/p5_balance.mjs` |
| Headless benchmark | `node scripts/p5_economy_benchmark.mjs --out=f.json` |
| Browser benchmark | `node scripts/p5_benchmark.mjs <url> --label=after --out=f.json` |
| Screenshots | `node scripts/capture_p5.mjs <url>` |

## Screenshots

These are real captures. Coral Bay 3.1 welcomed its residents and ran through real midnights at 4×.

| # | View | File |
|---|---|---|
| 1 | City economy panel after three settled days | `01-economy-dashboard.jpg` |
| 2 | Daily income and expenses chart, recent days and where the money went | `02-history-and-money-flows.jpg` |
| 3 | Business inspector (mall) with its last day | `03-business-inspector.jpg` |
| 4 | Resident profile with employment, wage and savings | `04-resident-money.jpg` |
| 5 | Tax policy estimate with the large-change confirmation | `05-tax-policy-estimate.jpg` |
| 6 | AI plan preview: confirmed cost vs estimated daily effects | `06-ai-plan-economic-impact.jpg` |
| 7 | A residential street without jobs: empty treasury, unpaid costs, alerts | `07-treasury-empty-alerts.jpg` |
| 8 | Phone: the economy sheet | `08-mobile-economy.jpg` |
| 9 | Build tool card with the running cost | `09-build-tool-running-cost.jpg` |
