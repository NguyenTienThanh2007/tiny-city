# Third-person camera

`src/immersive/orbitCamera.ts` holds the camera's state and math as pure functions with no Three.js; the engine applies the result to a `PerspectiveCamera` (55° field of view, near 0.02, far = view distance + 30).

## Default

The camera looks at a point 0.21 tiles above the character's feet, just under their eye line. It sits 0.92 tiles (≈ 6 m) behind them, raised 0.3 rad (≈ 17°), and starts looking the way the character faces at spawn.

## Input

- **Orbit.** `orbitBy(dx, dy)`. Sensitivity defaults to 0.0034 rad per pixel; the menu offers 0.001–0.008, stored per viewer. Dragging right turns the view right. Dragging down looks further down, unless *Invert vertical look* is set.
- **Pointer lock.** A click (no drag) captures the mouse; `movementX/Y` then orbit and Esc frees it. Dragging always works, for trackpads and for browsers that refuse pointer lock.
- **Zoom.** `zoomBy(deltaY)`. The distance is multiplied by `exp(0.0015·deltaY)`, so zoom is proportional to the scroll amount and steps are exact inverses. Each wheel event is clamped to ±0.5 in the exponent. Zero deltas never zoom.

## Limits

| | Min | Max |
|---|---|---|
| Pitch | −0.12 rad (slightly below the eye line, looking up) | 1.15 rad (≈ 66°, looking down on the character) |
| Distance | 0.32 tiles | 2.1 tiles |
| Nearest after obstruction | 0.16 tiles | n/a |
| Eye height | 0.05 tiles above the ground | n/a |

The pitch limits stay well clear of the poles, so yaw is never ill-defined and there is no gimbal flip. Yaw is free and unwrapped; smoothing always takes the shortest angle.

## Damping

Each frame (`updateOrbit`), with `1 − exp(−dt/τ)` so behaviour is frame-rate independent:

- look-at point → the character: τ = 0.06 s;
- yaw and pitch → input: τ = 0.04 s;
- distance → zoom: τ = 0.12 s.

A unit test runs 30 fps and 120 fps sequences and matches them to 6 decimal places. With `prefers-reduced-motion`, every smoothing step snaps.

## Obstructions

The camera never renders through solid buildings:

1. A ray runs from the look-at point toward the wanted camera position.
2. It is tested against every building's solid box (slab method, `rayBox`). Solid boxes come from each model's real mass: meshes taller than a garden wall with a footprint over 0.03 tile², excluding foliage. Trunks, posts and pergola columns never pull the camera in.
3. The camera sits 0.06 tiles in front of the first hit, and never closer than 0.16.
4. Pulling in is immediate, so the camera is never even briefly inside a wall.
5. When the view clears, the camera eases back out over τ = 0.35 s. There is no pumping at corners.

The ground acts as a floor: a camera pitched up and far back is kept 0.05 tiles above it.

The camera only ever changes the camera. Orbiting, zooming and obstruction never move the character or touch the simulation; a browser test orbits and checks the character's position is unchanged.

## Tests

Unit tests:
- clamping of pitch, zoom and sensitivity, and exact inverse zoom steps;
- the right-drag direction;
- the camera sits behind and above at exactly the set distance;
- `rayBox` hits and misses;
- immediate pull-in in front of a wall, gradual recovery and the final distance;
- the ground floor and the nearest distance;
- frame-rate independence, and the reduced-motion snap.

Browser tests (scenarios E, F, G): follow distance, drag orbit direction, pitch and zoom limits.
