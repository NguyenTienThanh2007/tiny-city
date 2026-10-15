# Road graph

`TransportNetwork` is derived from the same road tiles as `RoadGraph`/`RoadNavigator` (it reuses the navigator for
building access points), so pedestrians and vehicles never disagree about where roads are.

- **Nodes**: road tiles, indexed in tile order (`y`, then `x`), so every iteration and tie-break is deterministic.
- **Lanes**: two directed lanes between every pair of neighbouring road tiles, keyed `x,yD` (`12,7E` is the eastbound
  lane leaving (12,7)). Traffic keeps to the right.
- **Junction**: a tile with three or more road neighbours. **Dead end**: one neighbour (the only place a vehicle may
  turn around).
- **Access**: a building is reached from the road tiles around its footprint (the same access points residents use).
  Two buildings sharing a curb tile are never driven between (the resident walks).
- **Disconnected roads**: a route only exists inside one connected part; the traffic overlay outlines parts cut off
  from the main network.
- **Positions**: integer units, 100 per tile. A vehicle's front is `(edge, offset)` on its route; routes are stored as an
  origin tile plus compass steps (`"EEESSW"`), so a route can only ever follow orthogonal neighbours.

## Reconciliation after edits

`reconcileTransport` runs after every city command, batch, undo and redo (after population and player
reconciliation), and is deterministic:

| Situation | Rule |
|---|---|
| A stop's road is removed | the stop is deleted and dropped from its lines |
| A line with < 2 stops | suspended (`stop-removed`), buses withdrawn, riders walk on |
| A line's loop cannot be driven | suspended (`unreachable`); resumes by itself when roads reconnect |
| A vehicle's own tile removed | pulls over: the driver/riders walk from the nearest road; the car is taken home |
| Its remaining route lost a tile | re-routed from its current lane; a vehicle inside a junction keeps its movement there and re-plans from the exit lane |
| New roads (shortcuts) | routes stay valid; a few vehicles per tick re-plan (`plannedRevision`) |
| Destination demolished | the trip heads home |
| Resident left the city | the trip and car end |
| Car parked at a demolished building | taken home |
| Tiles behind a vehicle removed | forgotten (stored routes only hold real roads) |

Fixed along the way: undo/redo back to an identical plan bumped the revision without re-planning walkers (failed
validation on `main` too); reconciliation now runs on any revision change.
