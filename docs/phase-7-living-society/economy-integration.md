# Economy integration

Every paid activity goes through the Phase 5 daily settlement. Nothing is billed by rendering, and nothing is billed twice.

## Recording (during the day)

| What happens | Recorded as | Where the money goes |
|---|---|---|
| A resident arrives at a business venue (café, shops, market, cinema, club, amusement park) | `today.purchases[resident][venue] += price`, and a visit is counted | That business, as sales |
| A resident arrives at a festival at the night market | the festival ticket (free) + the market price, as a purchase | The market, as sales |
| A resident arrives at a city event with a ticket (a concert at the stage) | `today.fees[resident] += ticket` | The treasury (venue fees) |
| A resident arrives at the pool or clubhouse | the Phase 5 venue fee, as before | The treasury |
| An event starts | `today.eventCosts[event] = cost` | The outside economy, paid by the treasury |

The charge is stored on the outing (`spent`), so one outing is charged exactly once. Attendance of an event is unique per resident.

## Settlement (first tick of each day)

For each resident, in ID order, payments are made in this order, never beyond their savings:

1. housing;
2. venue fees and tickets;
3. bus fares;
4. car costs;
5. **leisure purchases** (per venue, in venue order);
6. everyday shopping.

A purchase that cannot be paid is waived and counted as `leisureWaived`. A business demolished before settlement collects nothing. Decisions keep this rare: a resident only chooses what fits their *spendable* money, which is savings − rent − today's commitments − a personal cushion of 15 + 0.4 × frugality. Every measured run had **0** waived.

Business venues close their day like the mall:

- revenue = exactly what residents paid them;
- wages per worker ($14–18 a day);
- operating costs paid outside the city ($25–90 a day);
- commercial tax;
- the profit, or the loss covered by owners outside the city.

They employ residents (the Hospitality & entertainment job category). The concert stage and the plaza are city amenities with city upkeep ($30 and $12 a day).

## Ledger and reports

- Venue sales use the existing `business.sales` category (residents → business) with the venue's building ID.
- Tickets use `resident.venue-fees` (residents → treasury).
- One new category, `city.events` (treasury → external), records event costs. It is paid only while the treasury can, and anything unpaid is recorded like other upkeep.
- Reports gain optional `expenses.events`, `leisureSpending` and `leisureWaived`. The treasury reconciliation, `operatingNet` and `validateEconomy` include them, and older reports read 0.
- The economy dashboard shows **City events** among expenses. Business cards show sales and paying visitors.

## Checked invariants

The tests check that:

- ledger directions match `LEDGER_FLOWS`;
- each outing appears once in arrivals;
- the society's recorded spending equals the sum charged on arrivals;
- each day's venue `business.sales` total equals that day's `leisureSpending`;
- no leisure purchase is waived, and no balance goes negative.

The fuzz test demolishes venues mid-visit, undoes, reloads and books events while checking the same rules.

## Balance notes

- In small towns, venue businesses often run at a loss: their daily costs exceed what a few dozen residents spend. The owners outside the city cover it, the status reads "Weak demand", and the city still gains jobs, wages and commercial tax.
- Larger neighbourhoods around a district fill the venues. In Coral Bay Nights, the cafés made a profit while the cinema and amusement park did not.
