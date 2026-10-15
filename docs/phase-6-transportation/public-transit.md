# Public transit

## Player workflow

Transport panel → **New bus line** → click road tiles on the map in order (straight stretches; intersections are
refused with a reason) → choose 1–6 buses → **Create line**. Lines can get more or fewer buses, and be deleted.
Stops are free; each bus costs $40 a day.

## Rules

- **Stops** sit on road tiles (not junctions); a stop on a tile shared by two lines is reused. Shelters are drawn on
  the curb.
- **Loop**: stop 1 → stop 2 → … → back to stop 1, each leg the shortest free-flow drive continuing from the heading
  the bus arrived with (no U-turns except at dead ends); the first leg is re-planned from the returning heading so
  every lap is identical.
- **Dispatch**: missing buses enter service one at a time at stop 1, spaced by the headway (loop time ÷ buses).
  Extra buses leave service at their next stop.
- **At a stop** the bus stops just past the stop tile (its tail clear of any junction). Riders for that stop get off
  first and walk on; then waiting residents board in arrival order while seats remain (24). Dwell: 1 tick + 1 per 8
  riders moved. A full bus leaves the rest waiting (`transport.bus-full`).
- **Waiting**: residents give up after 90 minutes and walk.
- **Riding**: a rider whose destination changes gets off at the next stop and walks.

## Invalid service

| Event | Behaviour |
|---|---|
| Stop road removed | stop deleted; line suspended if < 2 stops remain |
| Loop cut | line suspended (`unreachable`); resumes when roads reconnect |
| Line deleted / suspended | buses leave the street, riders walk on from where the bus is, waiting residents walk |
| Paused | nothing moves (dwell, boarding and waits use ticks) |
| Save/load | buses, riders, queues and dispatch timing are saved |

Residents choose the bus only when it beats walking and their car door to door (see mode choice), so ridership is
earned: short lines with frequent buses near homes and jobs get riders; long loops with few buses do not.
