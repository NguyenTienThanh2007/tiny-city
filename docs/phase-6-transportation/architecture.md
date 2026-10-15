# Architecture

```
            Life (life.ts)                      Transport (transportStep.ts)
 resident leaves a building ──► TripPlanner.plan ──► walk │ car trip + car (departing) │ walk to a stop
 walk ends at a stop ────────► TripPlanner.reachedStop ─────────────► waiting at the stop
                                                     │
            one fixed tick:  settle economy (midnight) → city commands → Life → advanceTransport → player → visits
                                                     │
 advanceTransport: hand-offs → destination changes → bus dispatch, vans → re-plans → junction grants → movement
                   → arrivals, stops (alight, board) → pulling out → stalls, give-ups → positions → congestion
```

- **Authority**: the simulation package owns everything (`WorldState.transport`). The frontend reads snapshots and
  sends `TransportCommand`s (`create-line`, `set-buses`, `rename-line`, `delete-line`) through `Simulation.executeTransport`.
- **Determinism**: integer positions and speeds, sorted iteration everywhere (vehicle IDs, lanes, citizens), seeded
  stable hashes for ownership and looks, routing from saved snapshots only, no wall clock and no `Math.random`. Same
  state + commands + ticks ⇒ byte-identical saves (tested across frame chunking, pause, speed and save/load).
- **City edits**: `applyCityCommand` and `restoreCity` run `reconcileTransport` after population and player
  reconciliation; validation then checks the whole world.
- **Rendering**: Pixi reads the live snapshot every frame (`TransportLayer.sync`), interpolating fronts between ticks;
  React re-renders only at the HUD cadence (trip events are routine, so they do not force renders).
- **Separation of movement kinds**: pedestrians route on road tiles and building interiors (BFS, `RoadNavigator`);
  vehicles on directed lanes with turn rules (`TransportNetwork`); buses on fixed free-flow loops. All three read the
  same road tiles.
