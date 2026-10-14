# Acceptance: Phase 4.6

**Baseline:** `main` at `57225d0c70183397d5463889306c46aec9b13950`.
**Branch:** `feature/p4-6-camera-life-ux`.
**PR:** recorded in the PR description (draft, not merged).

## Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Zoom no longer accumulates drift | Met | Repro: 100 wheel cycles (centre and off-centre), 100 button cycles, button bursts and pinches all return the exact pose (1820, 687.384, 0.56327); [camera-root-cause.md](camera-root-cause.md). Unit C; e2e A. |
| 2 | Repeated zoom cycles preserve framing | Met | e2e A: 100 wheel and 40 button cycles give a pose change below 0.5 px and the building on the same pixel. Screenshot pair `10-zoom-cycles-final-before/after`. |
| 3 | Panning is stable and predictable | Met | Unit F (the grabbed point follows the pointer at every zoom). Drag with a click threshold, shift or right drag, pinch. e2e B, D and E pans. |
| 4 | Bounds prevent runaway empty-background views | Met | Unit D (400 fuzzed poses). e2e B (pans and zoom-out at an edge). Screenshot `07-zoomed-out-city`. |
| 5 | Building selection works at all zoom levels | Met | e2e H: six Luxury Minimalist building types at three zooms. e2e A selection after the cycles. |
| 6 | Road and construction placement stay accurate | Met | e2e F (the placement preview on the hovered lot after every mode cycle). The city-builder road, placement and retina suites pass. |
| 7 | Life Mode shows the player at a useful distance | Met | Life View zoom 1.85 (phones 1.45), up from 1.2. e2e C. Screenshots `03`, `04`, `06`, `09`. |
| 8 | Focus reliably finds the actual player | Met | e2e D and G (after a pan, after save/load, on phones in I). The subject equals the saved position. |
| 9 | Follow tracks the player smoothly | Met | Unit H (frame-rate independent; a still target gives a still camera). e2e E (a walk tracked within 60 px, resting exactly on arrival). Screenshot sequence `06`. |
| 10 | Focus and Follow do not conflict | Met | The rules table in [life-camera-ux.md](life-camera-ux.md). Unit J. e2e D and E. |
| 11 | Manual controls behave predictably | Met | A pan ends Follow and the button shows it. Zoom while following stays on the character. No snap-back after Follow off (e2e E). |
| 12 | Switching camera modes preserves gameplay state | Met | e2e F: three Build → Plan → Live → Life cycles; the save is unchanged and the City View pose is restored exactly. |
| 13 | Save/load and Cloud Save work | Met | e2e G and J (save, reload, Life View, Focus, Follow). `account-cloud-saves` e2e passes. No save-schema change. |
| 14 | Guest login and authentication remain secure | Met | No auth or API change. `guest-session` and `account-cloud-saves` e2e pass. API 80 passed. |
| 15 | Visual World 3.1 architecture remains intact | Met | e2e H (models drawn baked). The `visual-world-3-1` suite passes. Screenshot `08`. |
| 16 | Long sessions do not revert to legacy graphics | Met | e2e J (night to dawn, cycles, reloads: `vectorBuildings = 0`). Benchmark: 0 vector fallbacks and identical GPU textures. |
| 17 | Responsive layouts work | Met | e2e I (1440, collapsed panel, 1280, 1024, phone 390). Screenshot `09`. |
| 18 | Performance remains acceptable | Met | 60 fps with p95 ≤ 16.8 ms at 21–959 residents; camera cost 1 µs per frame. [performance.md](performance.md). |
| 19 | Automated and browser tests pass | Met locally | See the table below. |
| 20 | GitHub Actions reports 3/3 success | Pending | Recorded in the PR once the run on the latest commit finishes |

## Local results (final code)

| Suite | Result |
|---|---|
| Typecheck (all packages, app, e2e) | Pass |
| Frontend unit (Vitest) | 223 passed, including 24 camera, 1 camera cost, 1 name-tag and 2 inset tests |
| Simulation | 286 passed (unchanged) |
| AI Architect | 64 passed (unchanged) |
| API (pytest, `-W error`) | 80 passed (unchanged) |
| Production build, secret scan | Pass, 0 findings |
| Playwright, full CI-mode run | 58 of 60 passed on a clean run (see below) |
| Playwright, after the fixes | All affected specs pass: 37 of 38 in one rerun (see below), then 32 of 32 for phase-4-6, city-builder, visual-world and life-mode |

Three issues came up in the e2e runs.

- **Two life-mode tests in the clean full run.** They clicked a street tile while the new Center neighborhood
  glide was still running. The old helpers judged the camera settled when two minimap readings 250 ms apart matched,
  but on software rendering one frame can last longer than that.
  - Fix: a shared `e2e/support/camera.ts` `cameraSettled()` also requires the renderer's `moving` flag to be clear.
    Assertions are unchanged.
  - Both tests then passed.
- **Starved tests in an earlier run.** Four tests failed when run alongside heavy capture scripts: game time ran
  far slower than normal. All of them pass in isolation in 10–30 s.
- **One teardown hang.** A city-builder duplex test passed its steps but hung closing the browser context on
  macOS. Repeated three times, it passes each time in 27 s.

## Known limitations

- Holding a zoom button against a zoom limit and back does not return: the limit stops the extra steps, as in any
  map. The view stays on the map.
- Life View tracks the character's interpolated position. At 4× the camera trails further behind (speed × 140 ms)
  but keeps them in view.
- Inside a building the character is shown by a pin above the roof. That pin can sit under the top HUD at extreme
  framings; Focus re-centres it.
- Phone performance was not measured on hardware (Chromium emulation only).
- The camera's minimap update in the wheel benchmark lags one frame behind the baseline's synchronous update at
  about 1000 residents (see [performance.md](performance.md)).

## Verdict

**PHASE 4.6 NOT ACCEPTED — BLOCKERS REMAIN** until GitHub Actions reports 3/3 on the latest commit. This document
is updated when it does.
