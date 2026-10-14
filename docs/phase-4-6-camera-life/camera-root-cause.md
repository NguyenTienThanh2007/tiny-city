# Camera drift: confirmed root cause

**Baseline:** `main` at `57225d0` (Visual World 3.1, PR #19).
**Reproduction:** `node scripts/p46_camera_repro.mjs <url>`. It loads Coral Bay at 1440 × 900 and reads the camera
from the minimap footprint. On 4.6 builds it also prints the exact pose from `window.__tinyCityCamera`.

## Symptom, reproduced

The reported problem: after repeated zooming the city drifts to the bottom-left, with large empty background. The
repro and the screenshot pair `10-zoom-cycles-final-before/after` show it. These are the baseline numbers (`scale`
is the zoom; `cx, cy` is the world point at the screen centre):

| Step (each continues from the previous one) | Scale | Centre | Tile (20, 20) on screen |
|---|---|---|---|
| Initial framing | 0.5656 | 2078, 716 | 558, 362 |
| 100 mouse-wheel in/out cycles at the screen centre | **0.6251** | 2078, 716 | 541, 353 |
| 100 more cycles at a lower-left cursor (400, 650) | **0.6908** | **2029, 746** | 556, 322 |
| 20 sideways trackpad swipes (`deltaY = 0`) | **0.1048** | 2202, 732 | 677, 432 |
| Symmetric trackpad scrolls at (500, 600) | **0.08 (floor)** | **4439, −894** | 508, 566 |

The last row is the reported bug. The camera centre ends outside the map (whose world box is x 0–3584,
y 0–1792), at the zoom floor, so the city is a speck in the lower-left of an empty sea.

## The mechanism

The baseline transform itself was correct. `zoomAround` kept the world point under the cursor fixed, and the
world→screen and screen→world mappings were consistent. The drift came from four input and bounds defects that
compound:

1. **Every wheel event was a full step, whatever its size or sign.** `zoomAround(mouse, scale * (deltaY < 0 ? 1.1 : 0.91))`
   - A trackpad sends dozens of small events per gesture, each treated as a 10% step.
   - `deltaY === 0`, which comes from sideways swipes and the tail of momentum scrolling, counted as a zoom-out.
   - So a gesture with equal amounts of scrolling in and out still zoomed out overall, toward the cursor. Each
     zoom-out is anchored at the cursor, so the city shrank into wherever the pointer was, usually the lower-left
     of the map area where players hover.
2. **The in and out steps were not inverses.** 1.1 × 0.91 = 1.001, so the scale crept 0.1% per cycle: +10.5% after
   100 cycles (0.5656 → 0.6251). With an off-centre cursor that creep also moves the view.
3. **No bounds.**
   - Nothing kept the camera on the map. `MIN_SCALE = 0.08` shrank the 64 × 64 map to about 290 px.
   - The centre could go anywhere, here to (4439, −894), so drift and pans could lose the city entirely.
4. **A guessed viewport.**
   - The "safe area" came from window-width breakpoints (`right: 384` at ≥ 1100 px), even when the side panel was
     collapsed or the bottom sheet was closed.
   - Button zoom and "home" anchored on the centre of that guessed area, not the real one.

Two further defects affected Follow:

- **Frame-rate-dependent Follow.** `center += (goal − center) * 0.18` per frame moved 18% per frame, so it chased
  three times faster at 60 fps than at 20 fps.
- **Follow and manual offsets mixed.** Zoom while following left a residual offset (`view.x/y`), and the player
  drifted off centre.

These were ruled out:

- **Mixing CSS and renderer pixels:** Pixi's `autoDensity` reports `event.global` in CSS pixels, the same as the
  canvas client rect.
- **Scale applied twice:** `world` is the only scaled container.
- **Stale bounds after asset loading:** the camera never depended on art bounds.

## The correction

These are summarised here. The full mathematics is in [camera-coordinate-system.md](camera-coordinate-system.md).

- **One authoritative pose** (`src/game/camera.ts`): the world point shown at the centre of the unobstructed
  viewport, plus a zoom. The Pixi world transform is derived only from it (`worldTransform`), and the old `view.x/y`
  offsets are gone.
- **Proportional, exactly invertible wheel zoom.** `factor = exp(−deltaY · k)`, where k is 0.0018 per CSS pixel
  (0.01 for pinch). Zero and sideways deltas never zoom, and f(d) · f(−d) = 1.
- **Anchored animation.** Zoom animates in log space with the cursor's world point pinned. While a gesture is still
  animating at the same spot, its original anchor is kept, so a view recentred by the bounds while zoomed out still
  returns exactly when zoomed back.
- **Map bounds and a viewport-derived minimum zoom.** The visible centre stays on the map. When zoomed out far
  enough that the map fits, it stays fully on screen. Zooming out stops where the whole map fits.
- **The real viewport.** HUD insets are measured from the actual panels (`data-camera-inset`). The canvas size comes
  from its ResizeObserver, and the device pixel ratio is watched.
- **Frame-rate-independent motion.** `1 − exp(−dt/τ)` smoothing for zoom and Follow, and eased, cancelable glides.

## Proof

| Step (4.6 build) | Pose (x, y, zoom) |
|---|---|
| Initial framing | 1820, 687.384, 0.56327 |
| 100 mouse-wheel cycles at the centre | 1820, 687.384, 0.56327 |
| 100 cycles at (400, 650) | 1820, 687.384, 0.56327 |
| 100 button cycles | 1820, 687.384, 0.56327 |
| 20 × (6 in, 6 out) button bursts | 1820, 687.384, 0.56327 |
| 10 pinch gestures (20 events out, 20 in) | 1820, 687.384, 0.56327 |
| 20 sideways swipes | unchanged (sideways deltas never zoom) |

- The repro's own "symmetric momentum" data is not quite symmetric: it nets +3 px out per gesture. The 4.6 build
  zooms out by exactly exp(−3 · 10 · 0.0018) = 0.947 for it, and the view stays on the city.
- Holding a zoom button into the zoom limits and back (12 out, 12 in) does not return: the limit stops the extra
  steps, as in any map application. The view stays on the map.
- Unit tests in `src/game/camera.test.ts` cover the cursor anchor (300 fuzzed cases), 100 cycles, button bursts
  faster than the animation, symmetric momentum and a pinch through the bounds.
- The pinch-through-bounds test fails if the anchor reuse is removed.
- The e2e test `phase-4-6-camera` A repeats the 100 wheel and 40 button cycles, the trackpad bursts and the
  edge/zoom-out checks in the real app. It finds a pose change below 0.5 screen px (in practice 0) and the same
  building on the same pixel.
