# Acceptance: Phase 5

**Baseline:** `main` at `fe78a9efe985ac3bd2582094946038a0fb258b7c` (Phase 4.6; PR #20 CI 3/3).
**Branch:** `feature/p5-living-economy`. **PR:** #21 (draft until acceptance; never merged automatically).

## Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Meaningful treasury management | Met | Taxes, fees, services, road and amenity upkeep, support, construction. Tax policy with estimates. Runway and status. Treasury floored at zero with unpaid costs recorded and announced. [tax-and-treasury.md](tax-and-treasury.md). Browser E, H. |
| 2 | Income and expenses use real simulation rules | Met | Real residents, job assignments, capacities, roads, amenities and real venue arrivals feed the settlement. [economy-design.md](economy-design.md). Unit tests on payroll, upkeep and fees. |
| 3 | Money accounting is deterministic | Met | Integer dollars, sorted iteration, no clocks or randomness. Byte-identical replays across frame chunking, save/load mid-day, speed changes and the fuzz test. Browser G matches a simulation-package replay exactly. |
| 4 | Transactions cannot be duplicated | Met | `lastSettledDay` guard (idempotent `settleEconomyDay`). Validation keeps the cursor in step with the clock. Ordered unique ledger IDs. One report per day. Fuzz and reload tests. |
| 5 | Taxes and operating expenses affect city finances | Met | Policy tests (future periods only, with trade-offs). Balance scenarios A–F. Browser H (12% applied exactly). |
| 6 | Existing residents have consistent economic state | Met | Accounts open on arrival and close on departure (logged). Balances are never negative. Savings stay bounded. Legacy residents start with the arrival savings at their first settlement. |
| 7 | Employment respects real building capacity | Met | Workers come from existing assignments within job slots (`validateWorld`, fuzz). Demolition frees jobs (test). Offices +60 and malls +100 (browser C). |
| 8 | Wages and spending follow documented rules | Met | [resident-economy.md](resident-economy.md). Payroll withholding test (shares within $1). Spending order and savings bound test. |
| 9 | Businesses have real economic performance | Met | Revenue from staff and demand (an office's clients; a mall's local shopping within staff capacity). Payroll, operating costs, tax, profit/loss, status. An unstaffed business earns nothing. Browser D, J. |
| 10 | Economic conditions influence meaningful decisions | Met (informative consequences) | Jobs vs homes, malls vs shopping outside, amenities vs upkeep, tax trade-offs (confidence, local shopping, office demand, business losses). Business losses do not yet close businesses; see the limitations below and [balancing.md](balancing.md). |
| 11 | Economy dashboard displays authoritative data | Met | Panel values equal the saved world and the engine's projection (browser I, E; App test). Charts use recorded reports only. |
| 12 | Financial history is accurate | Met | Every report reconciles open + income − expenses = close (validated). Budget totals equal lifetime ledger totals (fuzz). History is bounded to 28 days. |
| 13 | AI Architect previews financial implications safely | Met | The plan card separates "Confirmed now" from "Estimated per day · not guaranteed". Previews never change the world (unit tests, browser N with the three required prompts on the offline planner). Approval charges exactly the confirmed cost. |
| 14 | Save/load preserves financial state | Met | `citySave.test.ts` (exact round trip, no repeated settlement). Browser K (reload). |
| 15 | Legacy saves remain valid | Met | Pre-Phase-5 saves load unchanged and start the economy from the next full day, with no retroactive bill (tests). The schema-1 migration is unchanged. |
| 16 | Cloud Save and authentication remain secure | Met | No auth or API code changes except one new test: economy snapshots round-trip unchanged, and negative budgets are still rejected. `guest-session` and `account-cloud-saves` browser tests pass. Guests make no failed requests (all Phase 5 tests fail on console errors). |
| 17 | Life Mode and Camera 4.6 remain functional | Met | Phase 4, 4.5 and 4.6 suites pass in the full run. Browser O (Life View and Follow with the economy). |
| 18 | Architectural Style Selector and graphics remain intact | Met | Visual World 3.0C and 3.1 suites pass. Browser P (`vectorBuildings = 0`). Benchmark: no vector fallbacks. |
| 19 | Large-city performance remains acceptable | Met | Settlement 1.4 ms at 1,000 residents. Tick overhead within noise. 60 fps with the worst frame 16.8 ms around midnight at about 1,000 residents. [performance.md](performance.md). |
| 20 | Automated tests pass | Met locally | See below |
| 21 | Real browser acceptance passes | Met locally | Full Playwright run 60/60 (existing suites) plus 4/4 Phase 5 scenarios |
| 22 | GitHub Actions passes 3/3 | Pending | Recorded in the PR once the run on the final commit finishes |

## Local results

| Suite | Result |
|---|---|
| Typecheck (all packages, app, e2e) | Pass |
| Simulation (Vitest) | 314 passed, including 20 economy, 7 balance and 1 fuzz test (6 × 60 steps; wide sweep 25 × 150 passed in 104 s) |
| Frontend (Vitest) | 233 passed, including 6 economy-view, 2 save/load and 1 App economy test |
| AI Architect | 68 passed (4 new economy prompts) |
| API (pytest `-W error`) | 81 passed (1 new cloud-save economy test) |
| Production build, secret scan | Pass; 0 findings |
| Playwright (CI mode), existing suites | 60 / 60 passed (18.2 min), with the economy active in every city |
| Playwright, `e2e/phase-5-economy.spec.ts` | 4 / 4 passed (A–P) |

## Example budgets and transactions

[balancing.md](balancing.md) has the six reference cities. A settled day in the browser test (two apartments, a villa,
an office, a mall and a pool; the residential tax raised to 12%) recorded, with the engine replay matching to the
dollar:
- residential tax at 12% of the mall's payroll;
- mall sales capped by staff, and commercial tax at 6% of them;
- an unstaffed office losing its $340 operating cost (covered by its owners);
- pool fees for real visits;
- services, road and amenity upkeep.

Each line is a ledger entry with its source, destination and building.

## Known limitations

- Business losses are informative: owners cover them, and nothing closes or relocates. Hiring follows job capacity,
  not demand.
- Population does not respond to taxes or the economy; housing fills as before. Maximum taxes therefore still raise
  net city income, at the visible cost of business losses and lower confidence.
- Shopping is an aggregate daily transaction, not a simulated store visit. Office revenue comes from abstract clients
  outside the city.
- The Life Mode character is not an economic actor.
- Undo of an old building refunds its full construction cost, as undo always has. Operating money is never rewound.
- 1,000-resident saves are near the cloud API's default 1 MB upload limit (configurable).
- No live Gemini verification (no paid calls). The three prompts were verified on the deterministic offline planner.
  With Gemini, the economic card is computed the same way from the validated commands.

## Verdict

**PHASE 5 NOT ACCEPTED — BLOCKERS REMAIN** until GitHub Actions reports 3/3 on the final commit. This document is
updated when it does.
