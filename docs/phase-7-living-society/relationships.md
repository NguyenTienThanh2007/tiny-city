# Relationships

## Model

- Each relationship is an undirected edge `{a, b, strength, since, lastDay, gainedToday}` between two existing residents.
- The key is `a|b` with `a < b` (citizen IDs), so each pair has exactly one edge, and both residents see the same strength (it is symmetric by design).
- Edges live in `society.relationships`, sorted by key.

| Strength | Level |
|---|---|
| 1–39 | Acquaintance |
| 40–74 | Friend |
| 75–100 | Close friend |

## How strength grows

Only real time together counts:

| Interaction | Gain |
|---|---|
| At the same venue together (once per 30 minutes per venue) | +4, +2 with a shared interest, +1 if both are sociable (60+), +3 more at a running event |
| Lunch with a coworker (12:00 on workdays, one colleague, the same pairing all week) | +5 |
| An evening at home with a housemate (21:00) | +3 |
| Completing an outing together (each pair of companions who were there) | +8 |
| A friend's home visit, host and visitor | +8 |

At a venue, each resident pairs with the companion they came with, else the present person they know best, else the next newcomer. Familiar faces therefore reinforce, while newcomers still meet.

A pair can gain at most **15 points per game day**, so friendship takes several days of real contact and close friendship weeks. Crossing 40 or 75 emits `society.relationship-changed`, which the City Life feed announces ("Linh 4 and Mai 7 became friends").

## Fading and bounds

- Each new day, acquaintances who have not met for 2 days lose 2 points, and friends who have not met for 6 days lose 1 point. Edges at 0 are removed.
- Each resident has at most **10 relationships**. A new contact can displace only the resident's weakest acquaintance, and only if that acquaintance is weaker than the new gain. Friends are never displaced by newcomers.
- There are no all-pairs scans. Work is proportional to residents who are actually together.
- Saves stay small: at most 5 edges per resident on average (10 per resident, 2 residents per edge).

## Effects on behaviour

- **Joining:** friends with strength ≥ 25 can be invited along on social outings, and join if it suits them (see personality-and-decisions.md).
- **Visiting:** friends with strength ≥ 40 can host a visit at home, one visitor at a time.
- **Company:** company is a utility factor, and companions take neighbouring spots on screen (one café table, one conversation).

## Persistence and cleanup

- Relationships are saved with the world and survive reload exactly (browser test L).
- When a resident leaves (their home is demolished, or undo removes them), their edges go in the same reconciliation, so no edge ever references a missing resident (`validateSociety` asserts it).
- Migrated worlds start with **no** relationships; they grow from play.
