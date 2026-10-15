# Persistence and migration

`WorldState.transport` is optional (schema 2 unchanged) and versioned. Saved: stops, lines (including dispatch
timing and suspension), vehicles (compact routes, integer positions, speeds, junction grants, riders, dwell), trips,
parked cars, congestion and the frozen routing snapshot, van rounds, day statistics, history (7 days) and the
remembered slowdown. Derived and rebuilt: the lane network, route caches, decoded routes, rendering state.

- **Older saves**: loading enables transport with no vehicles; vehicles appear as residents start trips. Nothing is
  created retroactively and citizen IDs, building IDs and money are untouched.
- **Validation** (`validateTransport`): every reference resolves, every route tile is a road, positions are in range,
  no two bodies overlap on a lane, bus riders are on exactly one bus within capacity, every resident in transport has
  exactly one trip. A save with a route through a missing road is rejected (the app then keeps the map and reports
  that the simulation could not be restored, as before).
- **Replays**: a save mid-journey reloads and continues byte-identically (unit and browser tests).
- **Cloud saves and accounts**: the cloud stores the same save JSON; no API changes. Route encoding keeps saves small
  (a 188-resident rush-hour save is about 210 KB).
- **Planner requests** omit transport state; residents in transport are sent as waiting walkers.
