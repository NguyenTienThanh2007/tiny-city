# Performance

All numbers come from `node scripts/vw31_benchmark.mjs`. Raw data is in [benchmark-3.1.json](benchmark-3.1.json).

**Setup:** Apple M2, Playwright Chromium with ANGLE Metal, vsync on, 1440 × 900, deviceScaleFactor 1, production
builds served by `vite preview`.

**Builds and cities compared:**
- **3.0C:** `main` at `01ec34d`, on the same city layouts without designs.
- **3.1:** this branch, on the same layouts with designs.
- **3.1 classic:** this branch with designs off. This isolates the GPU cost of the new art; the `main` build has no
  GPU counter.

**Scenarios:**
- Default sample city.
- Dense residential: Coral Bay, 47 buildings and 168 residents.
- Large mixed-use: a generated grid of 74 buildings of every type, with residents.
- Cameras: gameplay (24 tiles across), zoomed in (10 tiles) and overview; day and 22:00 night.
- Repeated camera movement while measuring.
- Long session: 60 s of wall time at 4×.
- Life Mode following a new character.

## Frame pacing, renderer JS and GPU textures

Frame pacing is avg / p95 / p99 ms (fps). Renderer JS is per frame. GPU textures are **measured**: bytes of every
texture actually uploaded to the GPU (Pixi `managedTextures`, mip chains included), 3.1 classic → 3.1 with designs.

| Scenario | 3.0C pacing | 3.1 pacing | Renderer JS, 3.0C → 3.1 (ms) | GPU textures (MB) | Vector-fallback buildings |
|---|---|---|---|---|---|
| default-city-gameplay-day | 16.67 / 16.7 / 16.8 (60) | 16.67 / 16.8 / 16.8 (60) | 0.09 → 0.09 | 107.7 → 107.7 | 0 |
| dense-residential-gameplay-day | 16.67 / 16.7 / 16.8 (60) | 16.67 / 16.7 / 16.8 (60) | 0.29 → 0.2 | 118.9 → 131.7 | 0 |
| dense-residential-zoomed-in-day | 16.67 / 16.7 / 16.8 (60) | 16.67 / 16.7 / 16.8 (60) | 0.31 → 0.26 | 118.9 → 131.7 | 0 |
| dense-residential-overview-day | 16.67 / 16.7 / 16.8 (60) | 16.67 / 16.7 / 16.8 (60) | 0.72 → 0.69 | 118.9 → 131.7 | 0 |
| dense-residential-gameplay-night | 16.67 / 16.7 / 16.8 (60) | 16.67 / 16.7 / 16.8 (60) | 0.25 → 0.21 | 118.9 → 131.7 | 0 |
| dense-residential-camera-movement | 16.76 / 16.8 / 16.8 (59.7) | 16.67 / 16.8 / 16.8 (60) | – → – | – → – | – |
| large-mixed-use-gameplay-day | 16.67 / 16.7 / 16.8 (60) | 16.67 / 16.7 / 16.8 (60) | 0.51 → 0.53 | 119 → 131.7 | 0 |
| large-mixed-use-overview-day | 16.67 / 16.8 / 16.8 (60) | 16.67 / 16.7 / 16.8 (60) | 0.6 → 0.54 | 119 → 131.7 | 0 |
| large-mixed-use-after-long-session | 16.67 / 16.8 / 16.8 (60) | 16.67 / 16.7 / 16.8 (60) | 0.28 → 0.23 | 119 → 131.7 | 0 |
| life-mode-follow | 16.67 / 16.7 / 16.8 (60) | 16.67 / 16.7 / 16.8 (60) | 0.31 → 0.28 | 107.7 → 120.4 | 0 |
**Findings:**
- **Frame rate:** every scenario holds 60 fps with p95 ≤ 16.8 ms on both versions.
- **Renderer JS:** on par with or slightly below 3.0C, at most 0.69 ms per frame.
- **No vector fallback:** every building stayed on baked art in every scenario, including after the long session
  (`vectorBuildings = 0`).

## Memory

- **New pages stay off the GPU when unused.** The default city uploads exactly the same 107.7 MB on 3.1 as on
  classic content: pages are uploaded only when something on screen uses them.
- **A fully designed district** (every building a 3.1 model) adds **12.8 MB** of uploaded textures (118.9 → 131.7 MB).
- **Upper bound:** the estimated maximum with every atlas page uploaded is 133.6 MB, up from 64.7 MB in 3.0C. Real
  cities stay well below it.
- **JS heap after the long session:** 92.9 MB (3.1 designs), 68.9 MB (3.1 classic), 77.6 MB (3.0C). Heap samples
  vary with GC timing; there was no growth trend across runs.

## Download and loading

| | 3.0C | 3.1 |
|---|---|---|
| Atlas download (all pages, JSON and manifest) | 2.42 MB | 4.39 MB (`luxury` 1.04 MB, `collections` 0.77 MB, manifest 56 KB) |
| Atlas pages | 7 | 13 |
| Catalog thumbnails | none | 63 files, 387 KB, lazy `<img>` loaded only when the selector opens |
| Time to `data-art="ready"` (local preview, warm disk) | 0.85 s | 1.25 s |
| Full bake (`npm run bake:art`) | not re-measured | about 15 s (buildings 5.6 s, luxury 3.5 s, collections 2.1 s) |

## Known limits and next optimisations

- Every atlas is downloaded at start-up. Loading collection atlases on demand, when a city or the selector first
  needs a collection, would cut the initial download back to the 3.0C size. That needs a loading state that never
  shows the vector fallback, so it was left out of this phase.
- Software rendering (no GPU) was not re-measured for 3.1. 3.0C measured 12–21 fps there, and the new art adds
  sprites, not per-frame work.
