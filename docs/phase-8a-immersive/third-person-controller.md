# Third-person controller

## Controls

| Input | Action |
|---|---|
| W / ↑ | Walk away from the camera |
| S / ↓ | Walk toward the camera |
| A / ← · D / → | Walk left / right (camera-relative strafe; the character turns to face where they walk) |
| Shift (held) | Run |
| Drag on the view (mouse or trackpad) | Orbit the camera |
| Click on the view | Capture the mouse for free looking (pointer lock); Esc frees it |
| Wheel / two-finger scroll / pinch | Zoom |
| Esc | Free the mouse, or open/close the menu |
| Space | Pause / resume time (as in the City View) |

Movement is camera-relative: forward is where the camera looks. The camera never swings on its own, because with camera-relative controls an auto-follow would turn a held strafe into a circle. Keys are read by physical position (`KeyboardEvent.code`), so AZERTY and other layouts work. While the view is open:

- movement keys and Space call `preventDefault`, so the page never scrolls;
- the City View's build shortcuts are off;
- held keys are cleared when the window loses focus or the tab is hidden, so nothing sticks;
- with the menu open, the character stands still and keys go to the menu's controls.

There is no jump in 8A. Nothing in the city needs one, and a half-built jump would invite walking over walls.

## The model (`src/immersive/controller.ts`)

The controller is a pure function: `(state, input, camera yaw, elapsed real time, walk grid) → next state`.

- **Fixed step.** Movement integrates at 120 Hz. A frame's real time is split into whole steps, and the remainder carries to the next frame. The same input over the same time therefore gives the same path at 30, 60 or 120 fps; a unit test compares all three to 9 decimal places. Uneven frames differ only by the one carried step.
- **Speeds (tiles per real second).** Walk 0.32 (≈ 2.1 m/s) and run 0.78 (≈ 5.1 m/s). An exhausted character (energy below the critical threshold) moves at 60%, matching routed walking. Direct control is real-time input, so 1/2/4× game speed does not change walking speed.
- **Acceleration.** Velocity approaches the wanted velocity with `1 − exp(−dt/τ)`: τ = 0.12 s to speed up and 0.08 s to stop. A walk reaches full speed in about 0.4 s and stops within 0.03 tiles, with no sliding.
- **Turning.** The facing turns toward the travel direction with τ = 0.07 s (a half turn takes about 0.2 s, never in one step).
- **Collision.** Each step moves a circle of radius 0.07 tiles (the capsule's footprint) through `moveCircle`; see [collision.md](collision.md). After a blocked step, the velocity is the motion that actually happened, so pushing into a wall leaves the character still rather than "running in place" at full speed.
- **Pause.** While the simulation clock is paused the controller does not move (the camera can still orbit), and the HUD says so.
- **Long frames.** One frame replays at most 250 ms (the simulation clock's own cap). A slow software-rendered frame keeps real-time speed, and a stalled tab never jumps more than a fifth of a tile.

## Animation

The character model is the bake's rig (`scripts/art/characters/rig.js`), posed live:

- **Walking** uses the bake's walk pose with a continuous phase. The stride advances with the distance actually covered (0.2 tiles per cycle walking, 0.34 running), so feet don't skate and pausing freezes mid-stride.
- **Running** blends in over 0.15 s: longer swings, bent elbows and knees, a forward lean and more bounce.
- **Standing** uses the idle pose with breathing and a slow glance. Each character is offset in time so neighbours are never in sync.
- A soft contact shadow under the feet keeps the figure grounded even where the shadow map is coarse.

## Motion states

The HUD and `window.__tinyCityImmersive.player.motion` report `standing`, `walking` or `running`, based on speed. The HUD also shows when the character is still indoors ("move to step outside"), when they are walking a click-to-move route ("move to take over"), and when time is paused.

## Tests (`src/immersive/immersive.test.ts`)

- WASD directions match a real Three.js camera at three yaws: right projects to screen-right, forward goes into the screen.
- Diagonals are normalised. Walk and run speeds are reached, and stopping leaves no residual velocity.
- Frame-rate independence across 30, 60, 120 fps and uneven frames.
- No movement while paused, and the frame cap holds.
- Turning is smooth, never overshoots, and the stride advances.
- Every position the controller reaches is accepted by the simulation's `playerWalkCheck`, over 900 frames of walking and running in a real street.
- Browser: walking and running peak speeds are within their limits (`e2e/phase-8a-immersive.spec.ts`, scenario D).
