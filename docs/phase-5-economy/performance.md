# Performance (Phase 5)

## Setup

- **Machine:** Apple M2; Node 22; Chromium (Playwright) on Metal with vsync, 1440 × 900 at 1×.
- **Builds:**
  - Before: `main` at `fe78a9e`.
  - After: this branch.
  - Both are production builds served with `vite preview`.

| Benchmark | Command | Raw data |
|---|---|---|
| Headless economy | `node scripts/p5_economy_benchmark.mjs` (the simulation package itself) | [benchmark-economy.json](benchmark-economy.json) |
| Browser | `node scripts/p5_benchmark.mjs <url>` | [benchmark-before.json](benchmark-before.json), [benchmark-after.json](benchmark-after.json) |

Cities are generated with housing for N residents. They are filled through the real character-creation flow ("welcome
residents") and run at 4× through an evening and a real midnight settlement.

## Economy cost (headless)

| Residents | Settlement (one day) | Projection (dashboard estimate) | One game day of ticks, with / without the economy | Save size, with / without | After 60 days |
|---|---|---|---|---|---|
| 20 | 0.13 ms | 0.05 ms | 27.0 / 28.5 ms | 70.7 / 24.9 KB | 74.4 KB; history 28; ledger 200 |
| 100 | 0.32 ms | 0.20 ms | 138.8 / 147.4 ms | 144.0 / 93.1 KB | 148.0 KB |
| 300 | 0.50 ms | 0.50 ms | 381.2 / 359.9 ms | 331.0 / 266.9 KB | 335.0 KB |
| 1000 | 1.42 ms | 1.03 ms | 1,058.5 / 1,004.5 ms | 983.7 / 873.6 KB | 987.0 KB |

- **Settlement** happens once per game day (every 144 s at 1×, every 36 s at 4×). At 1,000 residents it is 1.4 ms,
  under a tenth of one frame.
- **Ticks:** between settlements the economy only records venue arrivals. The day-of-ticks difference is within run
  noise (−6% to +6%); earlier, a per-tick lookup cost about 10% and was removed.
- **Saves:** the economy adds a fixed bounded part (28 daily reports and the latest 200 ledger entries, about 45 KB)
  plus about 60 bytes per resident account. It stops growing after 28 days (60-day sizes are within 0.4% of the
  10-day ones).
- **Dashboard updates:** the projection is computed only while the economy panel is open, at the HUD refresh rate.

## Frame pacing (browser, before → after)

| Scenario | Residents | FPS | p95 frame | Worst frame | Renderer JS per frame |
|---|---|---|---|---|---|
| City running at 4× | 21 | 60 → 60 | 16.8 → 16.7 ms | 16.8 → 16.8 ms | 0.48 → 0.28 ms |
| | 101 | 60 → 60 | 16.8 → 16.8 ms | 16.8 → 16.8 ms | 0.34 → 0.26 ms |
| | 301 | 60 → 60 | 16.7 → 16.7 ms | 16.8 → 16.8 ms | 0.35 → 0.41 ms |
| | 959 | 60 → 60 | 16.8 → 16.8 ms | 16.8 → 16.8 ms | 0.53 → 0.64 ms |
| ±2 s around a midnight settlement | 21 / 101 / 301 / 959 | 60 → 60 | ≤ 16.7 ms | 16.8 ms in every case | equal |
| Economy panel open, clock at 4× (after only) | 21 / 101 / 301 / 959 | 60 | ≤ 16.8 ms | 16.8 ms | 0.27–0.50 ms |

| Metric | 21 | 101 | 301 | 959 |
|---|---|---|---|---|
| Economy panel DOM mutations per second while time runs | 55 | 52 | 53 | 55 |
| Save size, before → after | 29.7 → 39.6 KB | 96.0 → 112.9 KB | 267.3 → 304.0 KB | 841.6 → 927.1 KB |
| JS heap at the end (single sample) | 61 → 93 MB | 117 → 82 MB | 82 → 65 MB | 159 → 228 MB |

What the numbers show:
- **Frame rate:** the settlement never shows up as a long frame. Every scenario holds 60 fps on vsync, before and
  after, including the frames around midnight at about 1,000 residents.
- **Panel update frequency:** the panel follows the HUD's existing ~100 ms refresh (about 53 small DOM updates a
  second) and does not re-render per frame. It updates the clock-driven estimate and alert list, not the whole map.
- **Heap:** single end-of-session samples. They follow garbage-collection timing (some sizes fall, some rise) and show
  no trend with population.
- **Rendering:** the economy adds no rendering work. Buildings stay baked (`vectorBuildings = 0` everywhere) and
  texture memory is unchanged.

## Large cities and cloud saves

A 1,000-resident save is about 0.93–0.98 MB, of which the economy is about 11%. The cloud API's default upload limit
is 1 MB (`max_cloud_save_bytes`, configurable up to 8 MB). Most of a large save was already residents' routes and
schedules before Phase 5. Very large cities are near that default and may need the limit raised; this is listed as a
known limitation in [acceptance.md](acceptance.md).

## Not measured

- Phone hardware: the phone layout was checked in Chromium emulation only.
- SwiftShader (CI): the browser tests run there within their timeouts.
