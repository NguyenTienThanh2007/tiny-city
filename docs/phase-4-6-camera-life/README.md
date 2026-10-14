# Phase 4.6: camera stability, Life Mode UX and player Follow

**Baseline:** `main` at `57225d0c70183397d5463889306c46aec9b13950` (Visual World 3.1, PR #19).
**Branch:** `feature/p4-6-camera-life-ux`.

This phase fixes the camera at its root and makes Life Mode a close, readable character view. It stays within the
isometric PixiJS renderer, with no 3D, no economy work, no simulation or save-schema change, and no auth change.

| Document | Contents |
|---|---|
| [camera-root-cause.md](camera-root-cause.md) | the reproduced drift, the confirmed mechanism, the correction and proof |
| [camera-coordinate-system.md](camera-coordinate-system.md) | spaces, the single camera pose, transforms, bounds, insets, state ownership |
| [life-camera-ux.md](life-camera-ux.md) | City View / Life View, Focus, Follow, controls, locator, nearby name tags |
| [regression-tests.md](regression-tests.md) | unit, browser and e2e coverage, with results |
| [performance.md](performance.md) | before/after measurements |
| [acceptance.md](acceptance.md) | criteria, evidence and verdict |
| [screenshots/](screenshots/) | real browser captures, before/after |

## What changed

- **Camera** (`src/game/camera.ts`, new):
  - One pose (the world point at the centre of the unobstructed viewport, plus a zoom) and pure, inverse
    transforms.
  - Proportional, invertible wheel zoom with an anchored animation.
  - Map bounds and a viewport-derived minimum zoom.
  - Frame-rate-independent glides, zoom and Follow; reduced motion makes them instant.
  - `CameraController` holds the state and motion. `CityViewport` keeps it across renderer recreation and is the
    only writer of the Pixi world transform.
- **Input** (`src/game/CityViewport.tsx`):
  - Drag to pan with the select tool (press-to-click threshold), and two-finger pinch on touch.
  - Sideways and zero-delta wheel events no longer zoom.
  - The device pixel ratio is watched. Minimap navigation jumps; framing actions glide.
- **Real visible area** (`src/ui/cameraInsets.ts`, new): HUD insets are measured from the actual panels
  (`data-camera-inset`) instead of window-width guesses.
- **City View / Life View** (`App.tsx`):
  - Entering Life Mode frames and follows the character.
  - Leaving it restores the City View camera.
  - Life View zoom is 1.85 (1.45 on phones), up from the old Focus scale of 1.2.
- **One camera control group** (`src/ui/CameraControls.tsx`, new):
  - The Life view / City view switch, Focus, Follow, zoom and Center neighborhood.
  - Duplicate Focus and Follow buttons were removed from the Life panel and HUD strip.
- **Finding the character and neighbours:**
  - An off-screen locator button on the edge of the visible area.
  - Quiet name tags over up to three nearby residents (`src/game/nearbyTags.ts`).
- **No App re-renders from camera motion:** the minimap footprint moved to an external store, so a moving camera
  re-renders only the minimap.
- **Diagnostics:** `window.__tinyCityCamera`, plus `nearbyTags` in `__tinyCityRenderer`.

## Unchanged by design

- The simulation, schema-2 saves, cloud saves and authentication.
- AI Architect contracts, building art and atlases, character art, lighting and depth sorting.
- All accessible names e2e depends on: `Zoom in`, `Zoom out`, `Center neighborhood` and the
  `minimap-camera` footprint.

## Reproduce and verify

```sh
node scripts/p46_camera_repro.mjs http://127.0.0.1:4173          # drift reproduction on any running build
npx vitest run src/game/camera.test.ts src/game/camera.perf.test.ts
npx playwright test e2e/phase-4-6-camera.spec.ts
node scripts/capture_p46.mjs <after-url> <baseline-url>        # screenshots
node scripts/p46_benchmark.mjs <url> --label=after --out=f.json # performance
```

## Screenshots

These are real captures of Coral Bay 3.1 at 1440 × 900 (phones 390 × 844 @2×), taken with
`node scripts/capture_p46.mjs`. "Before" is the baseline build.

| # | View | Files |
|---|---|---|
| 1, 2 | City overview before / after | `01-city-overview-before.jpg`, `02-city-overview-after.jpg` |
| 3 | Life Mode default camera (before: overview distance; after: Life View) | `03-life-default-camera-before.jpg`, `03-life-default-camera-after.jpg` |
| 4 | Player close-up | `04-player-close-up.jpg` |
| 5 | Panned away (edge locator), then Focus | `05a-panned-away-locator.jpg`, `05b-focus-result.jpg` |
| 6 | Follow while walking, in sequence (the "you" marker stays visible behind a tower) | `06-follow-walking-1…4.jpg` |
| 7 | Zoomed-out city at the zoom limit | `07-zoomed-out-city.jpg` |
| 8 | Zoomed-in Luxury Minimalist neighbourhood | `08-luxury-minimalist-zoomed-in.jpg` |
| 9 | Mobile Life Mode before / after | `09-mobile-life-mode-before.jpg`, `09-mobile-life-mode-after.jpg` |
| 10 | Final framing after the repeated-zoom reproduction, before / after | `10-zoom-cycles-final-before.jpg`, `10-zoom-cycles-final-after.jpg` |
| 11 | Morning commute in Life View with nearby name tags | `11-life-nearby-residents.jpg` |
