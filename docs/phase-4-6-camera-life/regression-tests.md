# Regression tests (Phase 4.6)

## Camera unit tests: `src/game/camera.test.ts` (24 tests)

All tests use tolerances in world units or screen pixels. Fuzz cases use a seeded generator, and none depends on one
city seed.

| ID | Requirement | Test |
|---|---|---|
| A | World ↔ screen round trips | 500 fuzzed poses, viewports and points are inverse within 1e-9. The Pixi container transform equals `worldToScreen`, and the pose sits at the focal point. |
| B | Cursor-anchored zoom invariance | 300 fuzzed cursors and zooms: the world point under the cursor stays within 1e-9. Wheel factors are proportional and exact inverses; zero and sideways deltas never zoom. |
| C | 100 repeated zoom cycles | 100 wheel cycles at three cursors return the same pose (1e-6) and the same building pixel. 100 button cycles clicked mid-animation return exactly. The baseline symmetric trackpad scroll no longer moves the camera. A pinch that zooms out past where the map fits (so the bounds recentre it) and back returns exactly; this test fails if the fix is removed. |
| D | Bounds | 400 fuzzed poses: the visible centre stays inside the map plus 1.5 tiles, the zoom stays within the limits, and the whole map is on screen at the widest zoom. Limits derive from the viewport and map size. |
| E | Viewport resize | A resize keeps the looked-at point at the focal point. A panel opening or closing keeps the picture still, and later framing uses the new area. |
| F | Pan | The content follows the pointer at four zooms. A pan ends Follow, and endless pans stay on the map. |
| G | Reset | The home glide ends exactly on the framing, with a minimum duration. |
| H | Follow interpolation | The same steady-state lag at 20 and 60 fps (within one world pixel), under 12 screen px behind a walker, and `approach()` composes exactly across frame rates. A stationary target leaves the camera perfectly still. |
| I | Focus position | The glide lands the target on the focal point at the requested zoom; a new glide replaces an older one. |
| J | Follow cancellation | Follow-on glides onto a moving target and hands over. Zoom while following stays on the target. Off means no later pull-back. |
| K | Mode switching | The City View pose is kept and restored exactly. Life View zoom by viewport. |
| L | Reduced motion | Glides, zoom and Follow are immediate. |
| M | High-DPI | The camera works in CSS pixels, so the same client point maps to the same world point at 1× and 2×. e2e "retina pointer mapping" covers it in the browser. |
| N | Renderer recreation | Re-applying the same viewport to the kept controller gives the identical transform. Preferences are validated and never throw. |

## Other unit tests

- `src/game/camera.perf.test.ts`: camera cost per frame stays in microseconds, with a budget of 50 µs. Measured on
  an M2: Follow 1.1 µs, zoom animation 0.5 µs, footprint 0.4 µs.
- `src/game/nearbyTags.test.ts`: only the nearest outdoor residents are tagged; excluded and indoor residents never
  are.
- `src/ui/cameraInsets.test.ts`: insets are measured from visible panels; collapsed (off-screen) panels count as
  nothing; insets are capped.

## Browser acceptance: `e2e/phase-4-6-camera.spec.ts` (real app, Playwright)

| Test | Scenarios | What it proves |
|---|---|---|
| A/B | A, B | 100 mouse-wheel cycles over an off-centre building and 40 rapid button cycles: zoom within 1e-6, pose within 0.5 screen px, the building on the same pixel, and still selectable. Trackpad bursts (sideways and symmetric) do not change zoom. Hard pans in four directions keep the visible centre on the map. Zooming out at an edge stops at the limit with the map on screen. Center neighborhood returns exactly to the start. |
| C/D/E | C, D, E | Life View zoom > 1.4 and > 2× the City View zoom, following, character within 1.5 px of the focal point, and the controls present. A drag ends Follow and Focus returns at the same zoom. The off-screen locator brings the character back. Follow tracks a walk (under 60 px), zoom while following stays on the character, the camera rests exactly on a standing character, and after Follow off plus a pan it stays put while time runs. |
| F | F | City view ↔ Life view, then three cycles of Build → Plan → Live → Life. The placement preview still lands on the hovered lot, and leaving Life restores the exact City View pose. The save (buildings, funds, character, clock tick) is unchanged. |
| G | G | Walk, save, reload, Life View: the camera subject equals the saved position (< 0.01 world units). Focus and Follow work. |
| H | H | Luxury Minimalist villa, duplex, townhouse, apartment, mall and office are each selected at three zoom levels (the minimap brings them into view when close up). Architecture is shown, the models are drawn baked, and `vectorBuildings = 0`. |
| I | I | 1440 → collapsed panel (focal moves; Follow re-centres) → panel back → 1280 → 1024 → phone 390: the character stays centred. On phones the camera group works and the page has no horizontal overflow. |
| J | J | Night to dawn at 4×, wheel cycles, mode switches, two walks with save and reload: baked art throughout (`vectorBuildings = 0`), and the Life View zoom is remembered exactly across reloads. |

## Existing suites kept green

Existing e2e specs rely on camera behaviour. `city-builder`, `life-mode`, `living-world`, `phase-4-5`,
`visual-world-3c` and `visual-world-3-1` pass unchanged with one exception: `city-builder` "zoom and pan" now
scrolls one wheel notch (`-100`) instead of three (`-300`). Zoom is now proportional to the scroll distance, and
three notches zoomed past the tile the test clicks afterwards. The test's assertions are unchanged.

The CI timeouts, game-time waits and traces from PR #18 are unchanged.

## Results

See [acceptance.md](acceptance.md) for the run on the final commit.
