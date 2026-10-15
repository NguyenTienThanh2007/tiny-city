# City events

## Kinds

| Event | Venues | Length | Ticket | City cost | Interests | Appeal |
|---|---|---|---|---|---|---|
| Concert | concert stage | 2 h 30 | $8 (to the city) | $60 | music, nightlife | 30 |
| Street performance | plaza, stage | 2 h | free | $15 | arts | 14 |
| Outdoor movie night | plaza | 2 h | free | $20 | film, outdoors | 16 |
| Neighbourhood festival | plaza, night market | 5 h | free entry (market food at market prices) | $40 | food, music, arts | 18 |

## The city calendar

The calendar is deterministic and weekly; day 0 is a Monday:

| Venue | Event |
|---|---|
| Stage | Wednesday 18:30 performance; Friday and Saturday 20:00 concerts |
| Plaza | Wednesday 18:30 performance, Thursday 20:00 movie night, Sunday 15:00 festival |
| Night market | Saturday 18:00 festival |

- Each venue gets at most one city event a day.
- The calendar is filled 3 days ahead at day start, so the Live panel's event calendar always shows what is coming.
- Events are never created for times that have passed. An older save gets only future events.
- The list is bounded to 40 events: live ones plus the last two days' finished or cancelled.

## Player-organized events

From a venue that can host events, the venue inspector offers **Organize an event**: choose the kind, then one of the next free evening slots. `Simulation.executeSociety({type: 'society.schedule-event', …})` validates the request:

- the venue exists and supports the kind;
- the start is at least an hour away and within the coming week;
- there is no overlap at that venue;
- at most 4 of the player's events are pending;
- the treasury can afford the event's cost.

Rejections come back with a reason that the UI explains. The player's own scheduled events can be cancelled (`society.cancel-event`); residents who planned to go choose something else.

## Lifecycle and attendance

- Status follows the clock: `scheduled` → `running` at the start (the city's cost is recorded for that day's settlement) → `finished` at the end. Each change emits an event that the City Life feed shows ("Concert at Bayside Stage has started · 12 residents coming", "… ended · 14 residents attended").
- Residents choose events like any other option. The event's appeal, interests and the community trait count. They plan to arrive by the start, or join a running event with at least 45 minutes left.
- The capacity is the venue's visitor capacity. Reservations count every resident heading there, and attendance is recorded only for residents who actually **arrive**, once each.
- Nobody can be in two running events.
- Tickets are charged once on arrival: to the treasury at city venues, and at the market as market sales.
- People at the same event bond a little more (+3 per mingling).
- Audiences are drawn cheering at their venue.

## Cancellation

- An event whose venue is demolished (or no longer supports that kind) is cancelled immediately in reconciliation (`society.event-cancelled`, reason `venue-removed`). Every outing to it ends, and nobody keeps a reservation at a demolished venue.
- An event cancelled by the player ends its planned outings the same way.
