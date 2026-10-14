# Persistence, migration, undo/redo and AI previews (Phase 5)

## What is saved

The economy is part of the simulation snapshot inside the existing save envelope:
- the browser save `tiny-city-imagine-save-v1` (`saveVersion: 3`);
- the account cloud save (`/v1/users/me/cities`).

Two things are added:
- `world.economy`: version 1, policy, settlement cursor, transaction cursor, construction cursor, today's visits and
  fees, resident accounts, building finance, history, ledger, totals, active alerts.
- The budget's optional `operatingIncome` and `operatingExpenses`.

Schema 2, the save envelope and the cloud API are unchanged. The cloud API still validates the budget exactly as before
(nonnegative `balance`, `openingBalance`, `totalSpent`); an API test stores an economy-bearing snapshot and reads it
back unchanged.

## Older saves

| Save | On load |
|---|---|
| Phase 0–4.6 browser or cloud save (no `economy`) | Loads unchanged (`deserializeWorld` does not require it). The game then calls `enableEconomy()`. |
| A save at midnight (minute 0) | The economy bills from that day |
| A save in the middle of a day | The economy bills from the next full day; the rest of the current day is free |
| Schema 1 (Phase 0) | Migrated exactly as before; the economy starts on load like any older save |

Time already played is never billed retroactively (tested in `citySave.test.ts` and `economy.test.ts`). Defaults are
deterministic: the default policy, empty history, accounts opened at the first settlement.

## No double settlement after restore

- `lastSettledDay` is saved, and `settleEconomyDay` refuses a day at or before it. Validation requires it to be the
  current day or the day before, so a restored world is always exactly one step from its next settlement.
- Today's visit and fee accumulators are saved with their day, so a reload mid-day keeps the visits already made.
- A reload never repeats a settlement or skips one (browser test K, `citySave.test.ts`).

## Guest and account sessions

The economy runs in the guest's browser like the rest of the simulation. Nothing about authentication or sessions
changed:
- Guests make no new requests (the `guest-session` and Phase 5 browser tests fail on any console error).
- Account cloud saves carry the economy inside the snapshot.

## Undo/redo

Command history (`restoreCity`) restores the city as it was:
- buildings, roads and the building ID cursor;
- residents' identities, with their homes and jobs reconciled.

Time is never rewound, so money that came from time is never rewound either:

| Restored | Not restored |
|---|---|
| Construction spending (`budget.totalSpent` of the snapshot) | Taxes, fees, support and upkeep since then (operating totals) |
| | Resident accounts, history, ledger, policy |

The balance therefore moves only by the difference in construction spending:
- **Undoing a build** refunds its cost.
- **Redoing it** charges it again.
- The next settlement records the net as `city.construction` or `city.construction-refund`, once.

A redo the treasury can no longer afford is refused: `canRestoreCity(snapshot)` is false, and `restoreCity` throws
without changing anything. The UI says "Not enough funds to redo that construction now."

No inverse transactions are synthesized. Replaying the same commands and ticks still gives identical worlds (the fuzz
test undoes to random history points between settlements). Undoing a building after it has run for days refunds its
full construction cost, as undo always has. Its operating history stays in the ledger. This is the established undo
semantics, documented here.

## AI Architect

- Plans are planned on the city without its economy. The request omits `world.economy`; the fingerprint covers the plan
  and budget, which are sent unchanged, and stays identical.
- Previews never mutate the world. The plan's economic card uses `estimateEconomyImpact(world, commands)`, a pure
  function that applies the commands to a copy and projects one day before and after. It shows two sections:
  - **Confirmed now:** the construction cost and the treasury after approval. Both are certain, charged once by the
    atomic batch on approval.
  - **Estimated per day · not guaranteed:** jobs, homes (rooms), residents employed, city income, city running costs
    and the daily budget change.
- Gemini never touches money. It produces intent, the deterministic planner produces validated commands, and the
  simulation charges construction and settles everything else at midnight.
- A plan costed against an older treasury becomes stale. If a midnight settlement changes the treasury while a plan is
  previewed, the panel marks it stale ("The treasury changed at the end of the day…"). The plan's integrity check would
  refuse it anyway.
- The offline interpreter (`local` provider) understands "Xây một khu dân cư có đủ việc làm" / "a residential area with
  enough jobs": one apartment building plus enough office towers to employ its residents. Plans are still validated by
  the planner.
