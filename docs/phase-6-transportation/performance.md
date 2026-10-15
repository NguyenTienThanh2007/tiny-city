# Performance

Measured on the development machine (Apple silicon, Node 24, hardware-accelerated headless Chromium). Reproduce with
`npm run build:simulation && node scripts/p6_benchmark.mjs` and `node scripts/p6_render_benchmark.mjs` (dev server
running).

## Simulation (headless, two full days, one 4-bus line)

| Town | Residents | Transport | Tick avg | Tick p95 | Worst tick | Peak vehicles | Car trips | Stalls | Car route requests | Searches | States per search | Save |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ~20 | 16 | off | 0.009 ms | 0.02 ms | 1.8 ms | — | — | — | — | — | — | 27 KB |
| ~20 | 16 | on | 0.049 ms | 0.11 ms | 3.0 ms | 13 | 66 | 0 | 66 | 44 | 46 | 30 KB |
| ~100 | 88 | off | 0.028 ms | 0.08 ms | 8.2 ms | — | — | — | — | — | — | 95 KB |
| ~100 | 88 | on | 0.113 ms | 0.28 ms | 4.3 ms | 29 | 214 | 0 | 284 | 189 | 93 | 102 KB |
| ~300 | 268 | off | 0.097 ms | 0.26 ms | 1.7 ms | — | — | — | — | — | — | 267 KB |
| ~300 | 268 | on | 0.286 ms | 0.73 ms | 5.7 ms | 123 | 519 | 0 | 862 | 610 | 153 | 274 KB |
| ~1000 | 956 | off | 0.348 ms | 0.99 ms | 3.3 ms | — | — | — | — | — | — | 919 KB |
| ~1000 | 956 | on | 0.916 ms | 2.45 ms | 9.9 ms | 388 | 1 402 | 7 | 3 746 | 2 284 | 179 | 942 KB |

- At 1× the game runs 10 ticks per real second, at 4× 40: the 956-resident town costs ≈ 9 ms of simulation per real
  second at 1× (≈ 37 ms at 4×, spread over 60 frames ≈ 0.6 ms per frame; worst single frame ≈ 4 ticks ≈ 10 ms).
- Searches are fewer than route requests: car routes are cached per routing epoch, and bus loops are cached for as
  long as the roads do not change (sharing that cache across networks cut searches 18× in the small town).
- The 956-resident town is deliberately overloaded (single-lane streets, 14 offices on one grid): the active-vehicle
  cap (400) is nearly reached and 7 vehicles pulled over in two days; residents' remembered slowdown then shifts trips
  to walking. Under ordinary demand no stalls occur.
- Transport adds 3–23 KB to a save (compact routes). The 1 000-resident save stays at the size Phase 5 already had
  (cloud saves have a 1 MB default limit, as noted in Phase 5).

Optimisations made during the phase: residents at rest no longer reallocate their state every tick (the baseline
without transport also got ≈ 25% faster), unchanged vehicles keep their objects, lane and tile keys are cached per
route, junction checks use a dense grid, the street list and approach index are built once per tick, and bus loops
are cached per road layout.

## Browser (Coral Bay 3.1, 168 residents, 6-bus line, morning rush)

| View | Speed | FPS avg (min) | Frame callback avg / max | Vehicles drawn |
|---|---|---|---|---|
| City view | 1× | 59.6 (58) | 0.50 / 0.63 ms | 55 |
| Downtown close-up | 1× | 59.3 (58) | 0.15 / 0.29 ms | 17 |
| Downtown close-up | 4× | 59.4 (57) | 0.16 / 0.51 ms | 31 |
| City view, late morning | 4× | 59.9 (59) | 0.34 / 0.67 ms | 45 |

GPU texture memory: 155 MB with every atlas page resident (the vehicle page adds about 16.6 MB with mipmaps). Vehicles batch
from one atlas page; lamps are one additive container shown only at night; culling skips vehicles outside the view.
React does not re-render per vehicle frame (trip events are routine; the HUD refreshes at most every 100 ms).
