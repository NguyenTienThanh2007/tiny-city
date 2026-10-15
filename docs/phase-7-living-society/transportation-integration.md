# Transportation integration

Social travel uses the Phase 6 trip model. There is no second navigation system.

## Choosing a place

When weighing a venue, a resident estimates door-to-door minutes (`travelEstimate`). The estimate is the quickest of:

- **walking:** Manhattan distance between the buildings × 1.3 for detours ÷ their walking speed;
- **their own car**, if they own one and it is parked where they are: distance × 1.3 ÷ 0.6 tiles a minute + 4 minutes, × the city's remembered car slowdown (`transport.experience.car`);
- **the bus**, if stops of one active line lie within 6 tiles of both ends: the walks to and from the stops + 10 minutes' wait + the ride at 0.45 tiles a minute, × the remembered bus slowdown.

Places with no road connecting the two buildings (checked by road component) are not options. Places more than 90 minutes away are skipped. Each minute of travel costs 0.45 utility points, and a nearby place (≤ 15 minutes) gains 4.

This is what makes neighbourhoods matter. At this map's scale, the old town of Coral Bay is 1–2 hours from the new entertainment district on foot or by bus, so its residents use their own parks, pool and clubhouse, and the district fills with the people who live near it (see acceptance.md).

## Going there

- An outing tells Life where to go: Life's override sends the resident there for `leisure`.
- When they leave a building, Phase 6's `TripPlanner` chooses walk, car or bus from its own estimates exactly as for commutes.
- Cars are parked at the venue (`transport.parkedCars`) and driven home afterwards. Browser test E checks that cars are parked at venues on a Friday night.
- For events and screenings, residents leave in time to arrive by the start, using their estimate plus a margin, and may arrive up to 15 minutes late.

## When transport fails

- **Road removed under a trip:** Phase 6 re-routes or cancels the trip, the resident walks or waits, and society cancels the outing as `unreachable` if Life reports no route.
- **Too late:** an outing whose resident has not arrived by its arrive-by time is cancelled as `late`.
- **Venue demolished:** the outing is cancelled in reconciliation, and the resident's movement is redirected by Life on the next tick.

Capacity is never held by a resident who will not arrive: reservations end with the outing.
