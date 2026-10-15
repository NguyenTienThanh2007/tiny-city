# Vehicle model

## Entities

| Kind | ID | Why it exists | Lifetime |
|---|---|---|---|
| Resident car | `car-<citizen>` | a resident chose to drive | from pulling out of the lot to parking at the destination |
| Delivery van | `van-<mall>` | a staffed mall with local sales on its last settled day, 09:00–17:00 | one round trip to the next home on its round |
| City bus | `<line>-bus-<k>` | a bus line the player created (k = 1…buses) | while the line is active |

Vehicle identity is separate from trip identity (`Trip.id = trip-N`, one per resident journey). A car keeps its ID
across trips; between trips it is parked (not a vehicle). **Ownership is modelled**: whether a resident owns a car is
a stable draw against their home type (villa 80%, duplex 70%, townhouse 60%, apartment 40%); the car stays where it
was parked (`parkedCars`, only recorded when not at home). A car left away from home is always driven back.

Models (compact, sedan, SUV for cars; van; bus) and colours are stable per vehicle ID.

## Movement (per tick, integer units)

| | top speed | accel | brake | length |
|---|---|---|---|---|
| car | 60 | 20 | 30 | 56 |
| van | 55 | 15 | 25 | 60 |
| bus | 50 | 12 | 20 | 92 |

`move = min(speed + accel, top, √(2·brake·free), free)`, where `free` is the room to the rear of the vehicle ahead
(minus a gap of 10), to the stop line of a junction it may not enter yet, or to its destination. A vehicle never
overshoots, so bodies never overlap on a lane (checked by `validateWorld`), and it slows smoothly before queues and
stops. Speed is what it actually moved, so stopping is predictable.

**Pulling out**: a car waits in its lot until the curb lane has room and traffic behind can stop comfortably. After
3 ticks it claims the gap (traffic behind yields); after 9 it accepts any gap that nothing overlaps. A driver who
waits 120 ticks to leave a full lot walks instead.

**Stalls**: after 20 ticks without progress a vehicle tries another route; after 120 it pulls over (driver walks on,
car goes home), so no jam is permanent. Under ordinary demand this does not happen (0 stalls a day in the 188-resident
test town and in Coral Bay); in a deliberately overloaded 780-resident town on single-lane streets it happens 2–4
times a day at the peak (measurements in [performance.md](performance.md)).

## Mode choice

When a resident leaves a building (`TripPlanner.plan`, called from Life):

1. Walking time is the real walking route ÷ their walking speed. Trips of 12 game minutes or less are walked.
2. **Car**: if they own a car parked here, the drive's route cost (lane units + turn and junction costs + congestion
   penalties) ÷ car top speed + 4 min (getting the car out, parking) + 2 min per car already queued to leave this lot.
3. **Bus**: the best stop pair within 8 tiles of each end on an active line: walk + half the headway + ride (forward
   around the loop at bus speed, plus dwells) + walk.
4. Car and bus estimates are scaled by the remembered slowdown (`experience`, see below) and the resident's stable
   tolerance (80–120%). The fastest wins (ties: walk, bus, car). A car parked away from home is always taken.
5. Over the active-vehicle cap (400) residents walk.

**Experience**: at each day rollover, the ratio of actual to expected minutes of completed trips (if ≥ 10) is
blended into a memory (¾ old, ¼ new; 100–400%). A jammed day makes some drivers walk or ride the next day; quiet
days relax it. In the overloaded 780-resident town car trips settle from 583 to ~320 per day over 5 days.

Residents in a car or on a bus have movement status `vehicle`; their position follows the vehicle. Walking to a stop
is an ordinary walk whose end hands over to the stop.
