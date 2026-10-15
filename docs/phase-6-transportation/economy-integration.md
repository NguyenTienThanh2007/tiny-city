# Economy integration

Three ledger categories, all settled by the Phase 5 daily settlement (no money moves outside it):

| Category | Direction | Amount | Recorded when |
|---|---|---|---|
| `transit.fares` | residents → treasury | $2 per boarding (never beyond savings) | boarding (`economy.today.fares`) |
| `resident.car-costs` | residents → outside | $2 per completed car trip (never beyond savings) | arrival (`economy.today.carCosts`) |
| `city.transit-operations` | treasury → outside | $40 per bus on each active line | settlement, paid like other upkeep (unpaid if the treasury is empty) |

- Day reports gain `income.transitFares`, `expenses.transit`, `transitRides`, `carTrips`, `carCosts`. Older reports
  lack them (treated as 0); worlds without transport produce byte-identical reports to Phase 5.
- Resident spending order: housing, venue fees, fares, car costs, shopping.
- Settlement stays idempotent (`lastSettledDay`); a reload before midnight never bills twice (tested).
- Stops cost nothing: construction spending is what undo/redo rewinds, and transit is not city history.
- The renderer never touches money; the dashboard rows (Bus fares, Bus operations) read the settled reports.

Not modelled (would be speculative): commute-delay productivity losses, accessibility effects on business revenue.
