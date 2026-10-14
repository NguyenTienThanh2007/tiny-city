# Resident economy (Phase 5)

## Accounts

`economy.residents[citizenId] = { balance, income, taxes, spending }`:
- `balance`: savings, a whole number of dollars, never negative.
- `income`, `taxes`, `spending`: the last settled day.

Account lifecycle:
- **Opened** at a resident's first settlement, with `startingSavings` ($120) brought from outside the city
  (`resident.arrival`).
- **Closed** at the first settlement after they leave: their savings leave with them (`resident.departure`).

Until the first settlement, a new resident is shown with the arrival savings (`residentAccount`). Citizen IDs and job
assignments are those of the population system and are never changed by the economy.

## Employment

- Jobs are the existing assignments: malls (100 jobs) and offices (60 jobs) employ residents up to capacity. The
  clubhouse is a leisure venue, not a workplace.
- Assignments stay stable while valid, as before. Demolishing a workplace frees its workers through the normal
  population reconciliation; from the next settlement they receive unemployment support.
- Housing and jobs remain separate capacities.
- "Employed" on the dashboard counts residents with a job assignment; "jobs" is the total capacity of workplaces.

## Income

| Who | Daily income |
|---|---|
| Office worker | $26 wage |
| Mall worker | $18 wage |
| No job | $5 city support, while the treasury can pay |

Residential tax is withheld by the employer on its whole payroll and split over its workers, so each worker's share
differs by at most $1. The extra dollar rotates daily.

## Spending, in this order and never beyond savings

1. **Housing:** rent and utilities by home type, paid to landlords outside the city. Villa $10, duplex and townhouse
   $8, apartment $6.
2. **Venue fees** for the resident's real visits that day: pool $3, clubhouse $4. A visit with no money left is waived.
3. **Shopping:**
   - `max($2, $6 + 50% × disposable + 5% × (savings − $150))`, scaled by consumer confidence.
   - Disposable = income − tax − rent.
   - The savings term is negative below the $150 cushion (residents save up) and positive above it (they spend more).

Because shopping follows savings, savings settle at a level set by income instead of growing or draining without
bound.

| Example (apartment, 10% tax) | Settles near |
|---|---|
| Office worker | about $200 |
| Mall worker | about $120 |
| No job (support < rent) | drains to $0, then spends exactly what comes in |

Shopping is an aggregate daily amount, not a simulated store visit. The share spent in the city's malls becomes mall
revenue (`business.sales`), and the rest is spent outside the city (`resident.shopping-outside`).

## Financial condition

| Condition | Rule |
|---|---|
| Comfortable | Savings ≥ $150 |
| Struggling | Savings under $30 and everything that comes in goes straight out |
| Getting by | Otherwise |

The resident profile shows:
- employment ("Employed at Harbor Office" or "Not employed");
- job category (office services or retail) and daily wage;
- savings and condition;
- the last day's income, taxes and spending.

There is no debt and no eviction. The Life Mode character is not an economic actor in Phase 5.
