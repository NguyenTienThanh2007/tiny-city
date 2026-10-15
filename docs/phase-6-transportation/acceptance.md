# Acceptance: Phase 6

**Baseline:** `main` at `3e8102253e3ffe6a1fce0d9e60aa527c0a891795` (Phase 5 + CI sharding PR #22; main CI green).
**Branch:** `feature/p6-living-transportation`. **PR:** draft until GitHub Actions passes every check; never merged automatically.

## Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Vehicles use the real road network | Met | Lanes derived from the plan's road tiles; routes stored as compass steps from a road tile; `validateTransport` rejects any route tile that is not a road. Browser test checks every drawn vehicle is within 0.75 tiles of a road centre and every route tile is a road. |
| 2 | Vehicle movement is deterministic | Met | Integer state, sorted iteration, routing from saved snapshots. Byte-identical replays across frame chunking, pause, 4× vs 4 × 1×, save/load mid-traffic (unit) and browser Step = engine replay (e2e). Fuzz 60 × 150 with save/load. |
| 3 | Cars move and turn smoothly | Met | Acceleration and √(2·brake·d) braking; renderer interpolates the front distance and rounds corners (`vehicleMotion.test.ts`: heading changes < 0.35 rad per 10 units, body stays on corner tiles). Screenshots 01–03. |
| 4 | Intersections work correctly | Met | Quadrant reservations per junction run with exit space; invariant checked after every fuzz step: no two vehicles on conflicting paths inside one junction. Screenshot 02. |
| 5 | Vehicles never travel through invalid roads | Met | Reconciliation re-routes or pulls over vehicles on removed roads; remaining routes never contain removed tiles (unit + e2e road removal). |
| 6 | Congestion derives from actual road usage | Met | Smoothed lost progress per lane only from real obstruction; quiet towns record none (test). Overlay (screenshot 04) shows heavy lanes exactly where cars queue. |
| 7 | NPC transportation demand is meaningful | Met | Trips are residents' real schedule trips (home↔work, leisure); cars belong to residents and stay where parked; vans only for staffed malls with local sales. |
| 8 | Transit mode selection is consistent | Met | Documented rule (walk ≤ 12 min, car/bus estimates × remembered slowdown × tolerance, fastest wins, stable tie-break); converges (car trips 583 → ~320/day in an overloaded town). |
| 9 | Buses use real routes and stops | Met | Line commands validated against the network (not-a-road, junction, duplicate, unreachable); identical laps; dwell at stops only (test). Screenshots 05, 06. |
| 10 | Bus capacity and passenger state are correct | Met | 30 waiting → 24 board, `bus-full` with 6 left, next bus takes the rest; riders are real residents with a riding trip on exactly one bus (unit, e2e). |
| 11 | Road edits reconcile active transportation safely | Met | Unit tests and fuzz (edits, undo, demolition, new shortcuts, stop removal → suspended line); e2e removes a road under traffic and undoes it. |
| 12 | Transportation metrics use authoritative data | Met | `transportView.ts` reads only the world; e2e compares HUD/panel figures with the saved world. |
| 13 | Economy integration is correct | Met | Fares → treasury, car costs → outside, bus operations once per day; ledger directions fixed; no double billing after reload (test); Phase 5 worlds unchanged. |
| 14 | Save/load preserves valid transportation state | Met | Exact round trip (unit); identical reload mid-journey (e2e); invalid saved routes rejected. |
| 15 | Existing cities migrate safely | Met | Older saves enable transport with no vehicles; IDs and money untouched (tests). |
| 16 | Life Mode and Camera 4.6 remain stable | Met | Phase 4/4.5/4.6 suites in the full run; screenshot 09 (Life View, Follow with traffic). Vehicle Follow uses the same camera controller. |
| 17 | Premium architecture and character art remain intact | Met | Visual World 3.0C/3.1 suites in the full run; renderer reports 0 vector buildings; vehicles composite from one extra atlas page. |
| 18 | Performance is acceptable | Met | ≈ 0.9 ms per tick at 956 residents and 388 vehicles; 57–60 fps in the browser at rush hour ([performance.md](performance.md)). |
| 19 | Browser evidence shows a living city | Met | 12 real-UI captures (`screenshots/`). |
| 20 | Full tests pass | See below | |
| 21 | GitHub Actions passes all required checks | Pending | Recorded on the PR. |

## Local results

| Suite | Result |
|---|---|
| Typecheck (all packages, app, e2e) | Pass |
| Simulation (Vitest) | 340 passed (26 new transport tests, fuzz; wide sweep 60 × 150 passed) |
| Frontend (Vitest) | 238 passed (5 new pose tests) |
| AI Architect | 68 passed |
| API (pytest `-W error`) | 81 passed |
| Production build, secret scan | Pass; 0 findings |
| Playwright `e2e/phase-6-transport.spec.ts` | 4 / 4 passed |
| Playwright full suite (CI mode, 2 shards) | PENDING |

## Screenshots

| | |
|---|---|
| 01 residential street with active cars and a bus at its stop | 02 intersection traffic |
| 03 commercial district traffic | 04 congestion overlay |
| 05 bus stop and bus inspector | 06 bus route overlay |
| 07 daytime traffic (evening rush) | 08 dusk traffic with headlights |
| 09 Life Mode with traffic | 10 transportation dashboard |
| 11 vehicle inspector (Follow) | 12 phone layout |

## Known limitations

- One lane per direction; no road classes, speed limits, lane changes or traffic lights (signals are not drawn because
  they would be decorative at one game minute per tick).
- No pedestrian–vehicle interaction; parked cars are not drawn; vans visualise deliveries that the economy already
  pays as business upkeep (they create no money).
- Mode choice ignores fares and car costs (time only); ridership is modest unless lines are short and frequent.
- In deliberately overloaded cities the 400-vehicle cap and stall safety net engage (documented, never silent).
- Bus lines are not part of undo/redo history; a stop removed with its road is not restored by undo.
- The Life Mode player walks (no player vehicles).

## Verdict

**PHASE 6 NOT ACCEPTED — BLOCKERS REMAIN** until the full Playwright suite and GitHub Actions report every check green.
This document is updated when they do.
