# Performance

All numbers are measured by `node scripts/p8b_benchmark.mjs` in Playwright Chromium (1440 × 900, device scale 1) against the dev server. Raw rows are in [benchmarks/](benchmarks/).

## Method

Each run uses the benchmark cities of `scripts/p8b_bench_cities.mjs`:

- villas, apartments, offices, cafés, shops, a market, parks, plazas, a cinema and a nightclub;
- a real population;
- a bus line from the medium size up;
- every city at 17:20, the evening rush, so traffic and buses are real demand.

For each city the script measures:

1. **Entering:** from the click to the first playable frame, which builds the whole city. `hydrateMs` is the static scene part (every chunk).
2. **Three 8–10 s windows with the clock running:** idle, walking and running in a loop, and orbiting the camera. Each window records the engine's own stats: fps, worst fps, p95 frame time, CPU time split into simulation / scene sync (actors, light, levels) / render submission, draw calls, visible meshes, triangles, drawn residents and vehicles, and buildings near / mid / far.
3. **Five view switches** on the kept scene, then heap after forced GC: in the city before entering, in the world, and after switching.

## Hardware GPU (Apple M2, Metal)

Run 2 (the committed `hardware-run2.jsonl`, measured while other work shared the machine):

| City | Residents | Vehicles | Buildings | Enter | Idle fps (min) | Walk fps (min) | Orbit fps (min) | p95 ms (walk) | Draw calls | Meshes | Triangles | Drawn res. / veh. | Near / mid / far |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| small | 19 | 12 | 11 | 1.27 s | 59.6 (58) | 58.7 (56) | 58.1 (53) | 16.8 | 236 | 367 | 0.46 M | 3 / 7 | 5 / 6 / 0 |
| medium | 103 | 45 | 14 | 1.51 s | 56.6 (49) | 58.7 (57) | 59.3 (55) | 33.2 | 326 | 518 | 0.80 M | 37 / 27 | 7 / 5 / 2 |
| large | 299 | 98 | 30 | 1.70 s | 53.9 (43) | 54.1 (46) | 56.8 (48) | 33.4 | 494 | 750 | 1.38 M | 60 / 69 | 11 / 16 / 3 |
| stress | 995 | 223 | 74 | 1.96 s | 54.1 (51) | 49.8 (40) | 53.0 (46) | 50.1 | 617 | 937 | 2.02 M | 60 / 90 | 12 / 44 / 18 |

Run 1 (`hardware-run1.jsonl`, quiet machine, before the mesh counter was added): small 59.8 / 58.7 / 59.3 fps; medium 58.9 / 58.2 / 58.9; large 57.6 / 56.7 / 58.7; stress 54.7 / 53.4 / 57.2 (idle / walk / orbit).

CPU per frame on the stress city while walking, from run 2:

| Part | Time |
|---|---|
| Simulation (995 residents, 223 vehicles) | 1.0 ms |
| Scene sync | 3.1 ms |
| Render submission | 3.4 ms |
| Total | 7.5 ms |

The frame is bound by GPU fill and vertex work (2 M triangles), not by the simulation.

| City | Static scene (hydrate) | GPU memory (static) | Re-enter (5 switches) | Heap: city → world → after switching |
|---|---|---|---|---|
| small | 440 ms | 42.8 MB | 293–347 ms | 47.4 → 67.7 → 65.7 MB |
| medium | 635 ms | 75.3 MB | 267–374 ms | 50.9 → 78.0 → 71.3 MB |
| large | 736 ms | 93.2 MB | 316–374 ms | 57.4 → 94.5 → 85.1 MB |
| stress | 966 ms | 106.5 MB | 401–1119 ms | 75.8 → 125.6 → 116.6 MB |

Re-entering uses the kept scene (`reusedScene: true`), so it rebuilds only GPU objects. The heap returns after switching instead of growing; 8A's repeated-switching e2e test checks this precisely.

## Software rendering (SwiftShader; CI)

`--software --quick` (low quality preset: no shadows, pixel ratio 0.5, shorter distances):

| City | Enter | Idle fps | Walk fps | Orbit fps | Draw calls | Triangles | Re-enter |
|---|---|---|---|---|---|---|---|
| small | 9.1 s | 8.5 | 9.0 | 9.9 | 90 | 0.17 M | 5.6 s |
| medium | 8.5 s | 8.0 | 7.1 | 7.1 | 139 | 0.27 M | 5.8–6.0 s |
| large | 9.4 s | 7.0 | 6.0 | 6.0 | 246 | 0.49 M | 6.1 s |
| stress | 9.4 s | 5.7 | 5.0 | 4.7 | 291 | 0.65 M | 7.2–8.0 s |

That is enough for CI's functional tests. All 7 Character View e2e tests run in about 4.2 min locally in CI mode. It is not a supported way to play.

## Budget

| Budget item | Value |
|---|---|
| Target | 60 fps on ordinary scenes on a supported GPU; at least 45 fps average at 1,000 residents |
| Drawn actors | ≤ 60 residents within 26 tiles and ≤ 90 vehicles within 34 tiles (low quality: 30 / 18, 40 / 24) |
| New resident models | ≤ 3 built per frame (low: 2), pooled by ID |
| Static scene | Draw calls stay under ~900 and triangles under ~2.7 M at 1,000 residents (measured maximum while orbiting: 861 and 2.6 M) |
| Entering | ≤ 2 s on hardware; re-entering ≈ 0.3–0.6 s |
| Light | One shadow-casting sun. Lamps are emissive materials plus instanced light pools, not lights. |

## What made it fit

| Change | Effect |
|---|---|
| Mid-level models (`assetLod`: one vertex-coloured material, large parts only) and instanced far massing | Draw calls in the Coral Bay showcase during development: 1,424 → 485–730 |
| Near buildings cast shadows through an invisible mid-geometry proxy | — |
| Residents built at rig detail 0.4 as one skinned mesh, without contact discs | 60 residents: 1.24 M → 0.19 M triangles, 60 draw calls |
| Vehicles instanced per (model, colour); roads merged per chunk and material; stops merged | Draw calls per vehicle, road tile and stop fall to a shared few |
| Incremental sync: only changed buildings, road chunks and decor chunks are rebuilt | A single tick or a single edit never rebuilds the city |
| Interaction targets | A distance and view-cone test over the scene model's entities, with no raycasts against meshes |
| Levels | Re-evaluated every 200 ms with hysteresis |
| Window levels | Re-evaluated every 400 ms |
| React | Never re-renders per resident: the HUD updates at most every 160 ms |
