# Phase 6: Living transportation

Vehicles, public transit and traffic that come from the simulation itself. Every car, bus and van on screen is an
entity in `WorldState.transport.vehicles` with a stable ID, a route on real road lanes and an integer position
advanced by the fixed-step clock. Nothing is decorative.

## What exists

| Feature | Where |
|---|---|
| Lane network from the existing road tiles (no second road model), junctions, dead ends | [road-graph.md](road-graph.md) |
| Residents' own cars, mall delivery vans, line buses; car following, braking, merging from lots | [vehicle-model.md](vehicle-model.md) |
| Deadlock-safe intersections (quadrant reservations), congestion from lost progress, routing with turn costs | [routing-and-congestion.md](routing-and-congestion.md) |
| Mode choice (walk, car, bus) with remembered slowdown | [vehicle-model.md](vehicle-model.md#mode-choice) |
| Bus stops, lines, headway dispatch, boarding up to capacity, alighting, giving up | [public-transit.md](public-transit.md) |
| Fares, car running costs, bus operations through the daily settlement | [economy-integration.md](economy-integration.md) |
| Baked 3D vehicle art (16 headings, night lamps), renderer, overlays, panels | [rendering-and-art.md](rendering-and-art.md) |
| Saves, reloads, undo, legacy migration | [persistence-and-migration.md](persistence-and-migration.md) |
| Measurements | [performance.md](performance.md) |
| Acceptance against the 21 criteria | [acceptance.md](acceptance.md) |

## Code map

- `packages/simulation/src/transportConfig.ts`: every constant.
- `transportGraph.ts`: `TransportNetwork` (lanes, Dijkstra, quadrant masks, bus loops, bus options).
- `transport.ts`: state, validation, mode choice (`TripPlanner`), line commands, reconciliation after edits.
- `transportStep.ts`: one tick (`advanceTransport`).
- Frontend: `src/game/vehicleMotion.ts` (pure poses), `src/game/transportLayer.ts` (Pixi), `src/simulation/transportView.ts`
  (view models), `src/ui/TransportPanel.tsx`, `src/ui/VehicleInspector.tsx`.
- Art: `scripts/art/vehicles/`; review sheet `node scripts/art/vehicle-review.mjs`.
- Tests: `packages/simulation/tests/transport*.ts`, `src/game/vehicleMotion.test.ts`, `e2e/phase-6-transport.spec.ts`.
- Evidence: `node scripts/capture_p6.mjs` (screenshots), `node scripts/p6_benchmark.mjs` (headless).

## Simplifications (deliberate)

- One lane per direction on every road tile; no road classes, speed limits or traffic lights (see why in
  [routing-and-congestion.md](routing-and-congestion.md#no-traffic-lights)).
- The island has no outside road connection, so no through traffic exists: every vehicle starts and ends in the city.
- Walkers do not interact with vehicles (no crossings), and parked cars are not drawn (they are in the lots).
- The Life Mode player walks; drivable player vehicles are out of scope.
