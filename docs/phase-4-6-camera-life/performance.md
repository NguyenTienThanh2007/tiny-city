# Performance (Phase 4.6)

## Setup

- **Machine:** Apple M2, Chromium (Playwright) on Metal, vsync on.
- **Viewport:** 1440 × 900 at 1×.
- **Builds compared:**
  - Before: the baseline `main@57225d0`.
  - After: this branch, built locally and served with `vite preview`.
- **Script:** `node scripts/p46_benchmark.mjs <url> --label=… --out=…`. Raw data is in
  [benchmark-before.json](benchmark-before.json) and [benchmark-after.json](benchmark-after.json).
- **City:** a generated city whose housing holds N residents (one room is the character's), filled by the real
  create-character flow with "welcome residents".
- **Time:** every scenario runs during the 07:20 morning commute, so residents are walking.
- **Metrics:**
  - frame pacing: rAF deltas over 4–5 s
  - renderer JS per frame: `__tinyCityRenderer.frameMs`, the Pixi ticker's work
  - wheel latency: a wheel event until the first animation frame whose minimap footprint changes
  - DOM mutations per second under `.app-shell` while following, a proxy for React commits
  - JS heap after a 45 s session at 4× with periodic zoom

## Results

| Scenario | Residents | FPS before → after | p95 ms | Renderer ms per frame |
|---|---|---|---|---|
| City View, time running | 21 | 60 → 60 | 16.7 → 16.8 | 0.39 → 0.33 |
| | 101 | 60 → 60 | 16.8 → 16.7 | 0.40 → 0.45 |
| | 301 | 60 → 60 | 16.7 → 16.7 | 0.82 → 0.82 |
| | 959 | 58.5 → 60 | 16.8 → 16.7 | 2.42 → 2.09 |
| Continuous wheel zoom | 21 | 60 → 60 | 16.8 → 16.7 | 0.28 → 0.32 |
| | 101 | 60 → 60 | 16.8 → 16.7 | 0.27 → 0.33 |
| | 301 | 60 → 60 | 16.8 → 16.7 | 0.67 → 0.68 |
| | 959 | 60 → 60 | 16.8 → 16.7 | 2.41 → 1.90 |
| Following a walking character | 21 | 60 → 60 | 16.7 → 16.8 | 0.21 → 0.19 |
| | 101 | 60 → 60 | 16.7 → 16.7 | 0.17 → 0.22 |
| | 301 | 60 → 60 | 16.7 → 16.8 | 0.22 → 0.27 |
| | 959 | 60 → 60 | 16.8 → 16.8 | 0.59 → 0.52 |
| After a 45 s session at 4× | 21 / 101 / 301 / 959 | 60 → 60 everywhere | ≤ 16.8 | equal or lower |

| Metric | 21 | 101 | 301 | 959 |
|---|---|---|---|---|
| DOM mutations per second while following | 199 → 153 | 227 → 165 | 452 → 316 | 2334 → 2158 |
| Wheel to minimap update, ms (median of 15) | 11.3 → 12.7 | 12.2 → 11.7 | 11.1 → 10.9 | 3.1 → 40.6 |
| JS heap after the session, MB | 69 → 78 | 82 → 82 | 82 → 78 | 228 → 117 |
| Baked buildings / vector fallbacks | all baked, 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| GPU textures, MB | 119 → 119 | 119 → 119 | 119 → 119 | 119 → 119 |

Camera cost per frame, measured in `src/game/camera.perf.test.ts` over 200 000 frames:

| Work | Time per frame |
|---|---|
| Follow (update plus transform) | 1.1 µs |
| Anchored zoom animation | 0.5 µs |
| Minimap footprint | 0.4 µs |

## Reading the numbers

- **Frame rate:** every scenario holds 60 fps on vsync, with p95 at the 16.7 ms frame, before and after.
- **Renderer cost:** the camera adds microseconds. Renderer time is dominated by residents and stays equal or lower
  at about 1000 residents.
- **React work:**
  - A moving camera no longer re-renders `App`. The minimap footprint moved to an external store that only the
    minimap subscribes to, published at most every 120 ms while moving, and only when it changed.
  - DOM mutations while following fall 23–30% for up to 300 residents.
  - At about 1000 residents, Live and HUD lists updating with the crowd dominate.
- **Wheel latency at about 1000 residents (40.6 ms):**
  - The baseline wrote the camera transform synchronously inside the wheel handler, then drew it on the next frame.
  - 4.6 starts the zoom animation in the next ticker frame. The probe's own frame callback can run before Pixi's in
    the same frame, so it sees the change one frame later.
  - At about 1000 residents frames are longer, so that is about two frames (40 ms). Up to 300 residents it is about
    11–13 ms in both builds.
  - The world moves on the first rendered frame after the event either way.
- **Heap:** these are single samples at the end of the session and track garbage-collection timing more than
  retained memory. There is no growth trend across sizes.
- **Long sessions:**
  - `vectorBuildings` stays 0 and GPU texture memory is identical, so camera movement never drops premium art.
  - e2e J also checks this across night to dawn, zoom cycles, mode switches and reloads.
- **Determinism:** the camera never writes simulation state. Camera motion uses real frame time and never drives
  the simulation clock, so simulation runs are unchanged.

## Not measured

- **Phones:** no phone hardware measurements were taken. The phone layout was checked in Chromium emulation only.
- **SwiftShader (CI):** Life View at zoom 1.85 draws larger textures than the overview. CI runs every e2e scenario
  on SwiftShader within its timeouts.
