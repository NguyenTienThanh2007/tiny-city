# Camera coordinate system (Phase 4.6)

## Spaces

| Space | Units | Origin and axes | Used by |
|---|---|---|---|
| Grid | tiles (fractional for walkers) | map corner (0, 0); x and y along the map's edges | simulation, saves, AI plans, minimap |
| World | Pixi local units of the `world` container | `iso(x, y) = (1792 + (x − y)·28, (x + y)·14)` | every map sprite, hit masks, labels |
| Screen | CSS pixels of the canvas | the canvas's top-left corner | pointer events (`event.global`), wheel `clientX − rect.left`, DOM overlays |
| Device | backing-store pixels | screen × resolution | Pixi only (`autoDensity`, resolution = min(devicePixelRatio, 2)) |

`toGrid` is the exact inverse of `iso` (`mapGeometry.ts`). The camera works only in world and screen space, so the
device pixel ratio never enters camera maths. A 2× display maps the same client point to the same world point, and
e2e covers this in "retina pointer mapping".

## The pose

```
CameraPose = { x, y, zoom }   // the world point shown at the focal point, and the zoom
Viewport   = { width, height, insets }   // canvas CSS size; HUD panels covering each edge
focal      = centre of the canvas minus insets (visibleBox)

screen = focal + (world − pose) · zoom
world  = pose + (screen − focal) / zoom
Pixi:  world.position = focal − pose · zoom,  world.scale = zoom
```

- `worldToScreen` and `screenToWorld` are exact inverses. 500 fuzzed cases agree within 1e-9.
- The Pixi transform reproduces `worldToScreen` exactly, so picking (`world.toLocal(event.global)`), building hit
  masks and placement previews read the same transform the camera wrote. `applyCamera()` in `CityViewport.tsx` is
  the only writer of the world transform.

## Operations

| Operation | Formula | Property |
|---|---|---|
| Zoom at a screen point s | `anchor = screenToWorld(s)`; `pose = anchor − (s − focal) / zoom'` | the world point under s stays under s |
| Wheel factor | `exp(−clamp(deltaY·unit, ±240) · k)`, k = 0.0018 (0.01 with ctrl/pinch) | proportional; f(d)·f(−d) = 1; deltaY = 0 → 1 |
| Button zoom | ×1.25 or ×0.8 about the focal point, from the target zoom | rapid clicks return exactly |
| Pan by (dx, dy) | `pose −= (dx, dy) / zoom` | the grabbed point follows the pointer at every zoom |
| Glide (Focus, home, views) | eased (cubic in-out) interpolation, zoom in log space, 260–700 ms by distance | one glide at a time; a new one replaces it |
| Zoom animation | log-zoom approaches the target with `1 − exp(−dt / 55 ms)` | anchor pinned on every frame |
| Follow | pose approaches the target with `1 − exp(−dt / 140 ms)`; stops within 0.05 screen px | frame-rate independent; a still target leaves a still camera |

## Bounds

- **Zoom:**
  - The minimum is `0.92 × fit`, where `fit` scales the whole map (3584 × 1952 world units including the skyline)
    into the visible area. The floor is 0.08 and the cap 0.6.
  - The maximum is 2.4. Atlases are baked at 2×, so close-ups stay sharp on standard displays.
- **Centre:**
  - The visible centre stays inside the map diamond, plus 1.5 tiles, clamped in grid space.
  - On any axis where the view is wider than the map, the centre keeps the whole map on screen. A zoomed-out map
    therefore never slides into a corner.
  - Within those limits every pan is kept.
- **Scope:** bounds come from the map size and viewport only, never from one example city.

## Viewport and insets

- **Canvas size:** the camera uses the canvas's own size (`app.screen` after `ResizeObserver`), not the window.
- **Insets:** these are measured from the real layout (`src/ui/cameraInsets.ts`).
  - Every element marked `data-camera-inset="top|right|bottom|left"` that overlaps the stage pushes that edge in,
    plus a 12 px gap. Collapsed panels, which are transformed off screen, count as nothing.
  - Each inset is capped at 45% of the stage.
  - The marked elements are the top bar, tool rail, side panel (or phone sheet), planner bar, Life strip, and the
    phone's simulation dock.
- **Resize:** keeps the looked-at point at the new focal point.
- **Inset change:** when a panel opens or closes, the picture stays exactly where it is, so nothing shifts under
  the pointer. Framing actions (Focus, Follow, Life View, home) then use the new visible area.
- **Device pixel ratio:** a change, such as moving the window to another display, updates the renderer resolution
  and re-applies the camera.

## State ownership

| State | Owner | Persisted |
|---|---|---|
| Pose, motion, Follow flag | `CameraController` in a ref of `CityViewport` (outlives renderer recreation) | no (ephemeral) |
| City View pose kept during Life View | `cityPoseRef` in `CityViewport` | no |
| Camera view (City / Life), Follow wanted | `App` state | no |
| Preferred Life View zoom | `localStorage` `tiny-city-camera-v1` `{ lifeZoom }`, validated (1.2–2.4) | per viewer, never in saves |
| Player and resident positions | the simulation (`WorldState`) | in saves; the camera only reads them |

The camera never writes to the simulation. Simulation time advances from the Pixi ticker independently of camera
motion, and camera motion uses real frame time, so pausing time does not freeze the camera and the camera never
changes the simulation.

## Diagnostics

`window.__tinyCityCamera` exposes `{ x, y, zoom, following, moving, width, height, focalX, focalY, minZoom, maxZoom,
subject }` for tests and tooling. `subject` is the world point of the followed character or resident. `moving` is true
while a glide or zoom animation runs and while Follow has not yet caught up with its target (more than 0.05 screen px
away), so tests can wait for a camera that has really come to rest.
