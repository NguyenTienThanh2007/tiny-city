# Social architecture

## What already existed (the audit)

| System | Before Phase 7 | Authoritative or visual |
|---|---|---|
| Residents | Stable IDs (`npc-N`) and names drawn from the world RNG. Attributes: age, walking speed, schedule offset. One home, at most one job. | Authoritative |
| Routine | A generated daily schedule: sleep, home, work 07:00–17:00 (± offset), *leisure* 17:00–19:00, home, sleep. The same every day. | Authoritative |
| Leisure | Evening leisure went to a park, pool or clubhouse ranked by a per-resident hash (`preferredVenue`). | Authoritative |
| Movement | Life (`life.ts`) routes walkers on the road graph. Phase 6 `TripPlanner` picks walk, car or bus when a resident leaves a building. | Authoritative |
| Economy | Daily settlement from real recorded visits (pool and clubhouse fees), bus fares and car costs. | Authoritative |
| Life Mode | One player with needs (energy, hunger, social, mood), greet and socialize, venue visits. Acquaintances list. | Authoritative |
| Venue crowds | `venueCrowd.ts` drew real leisure visitors at parks, pools and the clubhouse. | Visual, from real state |
| Needs, traits, relationships for residents | None | — |

Phase 7 extends these systems. It does not replace them, and there is no second NPC engine.

## State

`WorldState.society?: SocietyState` (all integers, see `types.ts`):

- **`residents`**: one `SocialProfile` per resident. Each holds:
  - traits and two interests;
  - needs (energy, hunger, social, fun);
  - the current `outing` (or null);
  - `hostingUntil`, the decision cool-down, today's outing count, recently visited venues;
  - the last decision with its reasons.
- **`relationships`**: sorted undirected edges `{a, b, strength, since, lastDay, gainedToday}` with `a < b`.
- **`events`**: the calendar (scheduled, running, recently finished or cancelled), bounded to 40.
- **`today`, `history`**: daily statistics (7 days kept).
- Cursors: `nextOutingId`, `nextEventId`, `scheduledThrough`.

## Tick order (`Simulation.runTick`)

1. Economy settlement at the first tick of a day (Phase 5).
2. Queued commands.
3. **`stepSocietyBefore`**:
   - a new day: statistics roll over and relationships fade;
   - the calendar fills ahead;
   - events start or end (event costs are recorded);
   - residents on their decision slot decide.
4. Life (`advanceDailyLife`) with **`lifeOverride`**:
   - an outing in progress sends the resident to its venue for `leisure`;
   - days off and the old fixed leisure block become free time at home;
   - otherwise the schedule applies (sleep, work).
5. Transport (`advanceTransport`) moves drivers and bus riders.
6. Player (Life Mode).
7. Economy visit recording (pool and clubhouse fees, as in Phase 5).
8. **`stepSocietyAfter`**:
   - arrivals (charged once);
   - endings and cancellations;
   - needs on each resident's slot;
   - time together at venues, coworker lunches, household evenings.

## Bounded work

- **Decision slots:** a resident's needs update and decisions run once every 15 game minutes, on a slot staggered by a hash of their ID, so about 1/15 of residents per tick.
- **Venue search:** decisions consider the nearest 3 venues of each type, the running and upcoming events, and up to 3 friends' homes.
- **Mingling:** pairs are formed only among residents actually present at the same venue, once per 30 minutes per venue. There is no all-pairs scan.
- **Cached indexes:**
  - venue lists per plan, road components per navigator;
  - relationships per resident per relationships array, staffing per citizens array;
  - all held in `WeakMap`s keyed by immutable state.

## Reconciliation

`reconcileSociety` runs after every city command and batch, undo/redo (`restoreCity`), `enablePopulation`, and on load. It:

- adds profiles for new residents and drops profiles and relationships of residents who left;
- ends outings to venues that no longer exist (or no longer host that activity);
- cancels events at removed venues and stops hosts whose visitor has gone.

It never invents relationships.

`validateSociety` (called from `validateWorld`) checks:

- profiles match residents exactly;
- traits, needs and counters are bounded integers;
- outings reference real venues, events and companions;
- present visitors are inside their venue and within its capacity;
- relationships join two existing residents, are unique, sorted, and at most 10 per resident;
- events are unique, attendees are unique and within capacity, and nobody attends two running events.
