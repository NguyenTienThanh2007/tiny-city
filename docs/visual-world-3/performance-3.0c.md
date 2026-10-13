# Visual World 3.0C: Performance

All numbers come from `node scripts/vw3c_benchmark.mjs <url> [--uncapped] [--software]` on production builds of
3.0B (`main` @ `78c6927`) and 3.0C, run on the same machine. Raw data is in `benchmark-3.0c.json`.

**Reference machine:** Apple M2, macOS 26, Playwright Chromium. GPU runs use ANGLE Metal; software runs use
SwiftShader (no GPU), a pessimistic stand-in for weak laptops. Viewport 1440 × 900, deviceScaleFactor 1.

**Scenario:** a road-grid city sized for N residents with offices, measured at the morning commute (07:15, when
most residents are outdoors). "Visible" is the renderer's own count of on-screen residents.

## Vsync on (what players see)

All scenarios hold **60 fps, p95 16.7–16.8 ms, p99 16.8 ms** on both versions.

| Residents | View | Visible (3.0C) | Renderer JS per frame, 3.0B → 3.0C |
|---|---|---|---|
| 20 | gameplay | 3 | 0.08 → 0.32 ms |
| 100 | gameplay | 1 | 0.21 → 0.22 ms |
| 300 | gameplay | 80 | 0.27 → 0.60 ms |
| 300 | zoomed out | 7 | 0.29 → 0.47 ms |
| 1,000 | gameplay | 607 | 0.57 → 1.54 ms |
| 1,000 | zoomed out | 273 | 0.44 → 1.02 ms |

Renderer JS covers resident and player poses, venue crowds, ambient particles, foliage sway and lighting. At
1,000 residents it uses about 9 % of a 60 Hz frame.

## Uncapped (real frame cost), avg / p95 / p99 ms (fps)

| Residents | View | 3.0B | 3.0C |
|---|---|---|---|
| 20 | gameplay | 1.90 / 3.6 / 3.8 (526) | 1.87 / 3.4 / 4.0 (534) |
| 100 | gameplay | 1.99 / 3.8 / 4.6 (502) | 1.86 / 3.5 / 3.8 (538) |
| 300 | gameplay | 2.40 / 4.6 / 5.6 (417) | 2.04 / 3.9 / 4.7 (491) |
| 300 | zoomed out | 1.69 / 3.1 / 3.5 (593) | 1.46 / 2.8 / 3.2 (685) |
| 1,000 | gameplay | 7.36 / 11.0 / 12.8 (136) | 7.20 / 10.6 / 12.4 (139) |
| 1,000 | zoomed out | 3.50 / 5.5 / 7.3 (286) | 2.95 / 4.7 / 6.6 (339) |

3.0C is on par with or faster than 3.0B. Baked character sprites from one atlas batch better than 2.0's
many-shape vector figures.

## Software rendering (no GPU), fps

| Residents | View | 3.0B | 3.0C |
|---|---|---|---|
| 20 | gameplay | 21.3 | 21.0 |
| 100 | gameplay | 19.4 | 20.0 |
| 300 | gameplay | 12.3 | 15.3 |
| 300 | zoomed out | 29.4 | 30.7 |

Neither version is smooth without a GPU. 3.0C is equal or better.

## Optimisations

- **One character atlas page** (2048 × 1080 WebP, 0.5 MB download, about 8.4 MB GPU). Every resident is a few
  quads from it, so they batch together.
- **Change-only sprite updates** in `CharacterRig`: texture, anchor and tint are touched only when they change,
  and each frame's texture list is cached. This brought 1,000 residents from 3.07 ms to 1.54 ms of JS per frame.
- **Viewport-aware updates.** Off-screen residents (above 60 residents) skip all pose work. Tree sway only touches
  on-screen trees. Ambient particles and small decor are skipped when zoomed far out (`LOD_SCALE`).
- **Bounded effects:** 9 sparkles per pool and 7 fireflies per park. Building light pools are drawn once per plan
  change. The window-life check runs every 0.4 s.
- **Pause freezes the whole scene,** so a paused city does no animation work.

## Memory and loading

| | 3.0B | 3.0C |
|---|---|---|
| Atlas download | 1.63 MB | 2.42 MB (characters page 0.53 MB plus their JSON frame data) |
| Atlas GPU memory | about 40 MB (53.5 MB with mipmaps) | about 48.5 MB (64.7 MB with mipmaps) |
| Load | Atlases load in parallel; vector fallback until ready | Same; characters swap in when the atlas arrives |

## Camera

Wheel and button zoom reach the screen within two frames, as before. Repeated button zoom cycles return exactly
to the same view (e2e `visual-world-3c.spec.ts`). See `acceptance-3.0c.md` for the pre-existing drift found on
3.0B and how this branch behaves.
