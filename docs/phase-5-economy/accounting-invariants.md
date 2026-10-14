# Accounting invariants (Phase 5)

## Ledger

Every money movement in a settlement is a `LedgerEntry`:

| Field | Meaning |
|---|---|
| `id` | `tx-N`, from `economy.nextTransactionId`, strictly increasing |
| `day`, `tick` | The settled day and the tick that settled it |
| `category` | One of 19 categories |
| `from`, `to` | Fixed per category in `LEDGER_FLOWS`: `treasury`, `residents`, `business` or `external` |
| `amount` | A positive safe integer |
| `buildingId` | The business or amenity, where one applies |
| `count` | How many residents or buildings the entry aggregates |

Entries are per business for business lines, and aggregated over residents for resident lines. Each resident's own day
is in their account (`income`, `taxes`, `spending`). The ledger keeps the most recent 200 entries, and
`economy.totals` keeps the lifetime total of every category.

| Category | From → to | Kind |
|---|---|---|
| `resident.arrival` | external → residents | money enters (savings brought in) |
| `resident.departure` | residents → external | money leaves (savings taken away) |
| `business.services` | external → business | office clients |
| `business.sales` | residents → business | internal (local shopping) |
| `business.wages` | business → residents | internal |
| `tax.residential` | residents → treasury | internal |
| `tax.commercial` | business → treasury | internal |
| `city.support` | treasury → residents | internal |
| `resident.housing` | residents → external | rent and utilities |
| `resident.shopping-outside` | residents → external | shopping outside the city |
| `resident.venue-fees` | residents → treasury | internal |
| `business.upkeep` | business → external | suppliers |
| `business.profit` / `business.loss-cover` | business ↔ external | owners |
| `city.public-services`, `city.road-upkeep`, `city.amenity-upkeep` | treasury → external | city costs |
| `city.construction` / `city.construction-refund` | treasury ↔ external | recorded once (charged by the command) |

Internal transfers are never counted as new wealth. The dashboard's income and expense totals are the treasury's own
flows.

## Invariants and where they are tested

| # | Invariant | Tests |
|---|---|---|
| 1 | A day is settled at most once: `settleEconomyDay` returns the same objects for a day at or before `lastSettledDay`; `lastSettledDay` is always the current day or the day before | `economy.test.ts` (idempotence), `economyFuzz.test.ts` |
| 2 | Exactly one report per finished day since the economy began, unique and ordered | fuzz, validation |
| 3 | Over the day, the treasury changes by exactly the settlement's treasury entries; construction was already charged by its command | `economy.test.ts` (accounting) |
| 4 | Resident savings change by exactly the resident entries (arrivals and departures included) | accounting test, fuzz (lifetime) |
| 5 | Every business account nets to zero each day | accounting test |
| 6 | `budget.operatingIncome` = lifetime residential + commercial tax + fees; `operatingExpenses` = support + services + road + amenity upkeep | accounting test, fuzz |
| 7 | Net construction in the ledger = construction spending since the economy began (refunds subtracted); a build is charged once and recorded once | construction test, fuzz |
| 8 | Each report reconciles: open + income − expenses = close, and close = the treasury after settlement | validation, accounting test |
| 9 | No negative, fractional, NaN or infinite money anywhere; the treasury never below zero | fuzz, bankruptcy test, validation |
| 10 | Workers never exceed a workplace's job slots | fuzz, employment test, `validateWorld` |
| 11 | Paused worlds do not accrue charges; speed changes neither create nor skip settlements | cadence test, browser F and G |
| 12 | The same world and commands produce byte-identical results (replay, save/load mid-day, frame chunking) | determinism tests, fuzz replay, browser G |
| 13 | Previews (dashboard estimate, policy preview, AI estimates) never change the world | projection tests, browser N |
| 14 | Undo/redo restores construction spending only; an unaffordable redo is refused without changes | undo test, redo test, fuzz |

`economyFuzz.test.ts` plays random sequences of builds, demolitions, undo to random history points, policy changes,
save/load round trips and time steps. Each sequence runs from 1 tick to 2 days. It checks all invariants after every
step and replays each seed for identical results.
- CI default: 6 seeds × 60 steps.
- Wider local sweep: `ECONOMY_SEEDS=25 ECONOMY_STEPS=150`, passed in 104 s.
