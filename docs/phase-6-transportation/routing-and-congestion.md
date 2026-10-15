# Routing and congestion

## Routing

Dijkstra over lane states (tile + heading) with a binary heap; ties break by state index (tile order). Costs:
100 per lane + congestion penalty (lane), +10 right turn, +25 left turn, +20 entering a junction, U-turns only at
dead ends (+120). Searches are bounded (40 000 states). Car routes between buildings are cached per network; the
network is rebuilt when the roads change or the routing snapshot changes, so the cache only ever memoises a pure
function of saved state (identical results after a reload). Re-planning from a lane (destination change, edits)
uses the same search from the current lane with its progress.

Buses use free-flow costs (no congestion), so every lap of a line is the same.

## Intersections

A junction tile is split into four quadrants. With right-hand traffic a movement entering heading `h` uses its
entry quadrant; straight adds the far-right one, a left turn three, a right turn only its entry quadrant. Movements
conflict when their quadrant masks overlap; opposite straight movements and opposite right turns can share a
junction.

- A vehicle reaching the stop line of a **run** of consecutive junction tiles asks for all of them at once, and gets
  them only if no conflicting vehicle holds those quadrants **and** there is room to leave the last tile completely.
  So a vehicle never stops inside a junction and junctions cannot deadlock each other.
- Vehicles following exactly the same path may follow each other in (platooning), each with room behind the one ahead.
- Requests are served longest-waiting first; a long-waiting request blocks later conflicting ones for a tick (first
  come, first served; no starvation by a steady stream).
- Holds are also derived from physical presence, so a tile that becomes a junction under a vehicle stays safe.

### No traffic lights

The clock advances one game minute per tick (10 ticks per real second at 1×). A real signal cycle would last a few
ticks and flash several times a second, and timed phases would cost throughput the reservation scheme does not.
Lights are therefore not drawn: drawing them without the behaviour would be decorative. Reservations are the actual
control rule.

## Congestion

Each tick, a vehicle's lost progress (what it would have moved on an empty road minus what it moved) is added to its
lane. Per lane: `c ← c − ⌊c/16⌋ + delay` (equilibrium ≈ 16 × delay per tick). Levels: slow ≥ 160, heavy ≥ 480,
jammed ≥ 960. Every 30 ticks the routing snapshot freezes `min(300, ⌊c/8⌋)` per lane as a routing penalty.
Congestion therefore only exists where real vehicles were slowed by real vehicles or junctions; it is never random.

Players reduce it by adding connections (shortcuts are picked up as routes re-plan), splitting bottlenecks, or
running buses that residents prefer over driving.

## Trade-offs

- One lane per direction and tile-level junctions keep the model explainable and cheap (≈1 ms per tick at ~800
  residents at rush hour); multi-lane roads and lane changes are not modelled.
- Vehicles are integer and tick-based; smoothness comes from the renderer interpolating the front distance.
