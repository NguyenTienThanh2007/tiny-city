# Phase 4 Complete Life Mode — acceptance

Branch `feature/p4-complete-life-mode`, created from `origin/main` @ `83a11c8`. That commit already contains Phase 3
(#7, #8) and Visual World 2.0 (#9).

Related docs:
- [Phase 4A contracts](phase-4a-contracts.md)
- [Phase 4A architecture](phase-4a-architecture.md)
- [Phase 4B experience](phase-4b-experience.md)

Evidence:
- `packages/simulation/tests/player.test.ts`
- `e2e/life-mode.spec.ts`
- the screenshots in `docs/life/screenshots/` (captured by `scripts/capture_life.mjs` and reviewed)
- `docs/life/benchmark-results.json` and `docs/life/render-benchmark-results.json`

## Acceptance criteria

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Create and customize a character | Met | Creator: name, skin, hairstyle, hair color, outfit, outfit color, accessory; validated engine-side (`invalid-name`, `invalid-appearance`). e2e journey, App tests, screenshots 02, 03, 15, 18 |
| 2 | Select a valid home | Met | Map badges and list with real vacancies; one housing slot; `home-full`, `not-a-home`; full-housing fallback (e2e, screenshot 16) |
| 3 | Character appears in the Pixi world | Met | `src/game/playerLayer.ts`; screenshots 05–08 |
| 4 | Moves on valid paths | Met | Shared road BFS, orthogonal legs and validation; grass, water and unreachable clicks rejected (unit tests and e2e) |
| 5 | Energy, hunger, social, mood | Met | Bounded, tick-driven, pause-safe, identical at 1×/2×/4× (unit tests); meters in the HUD |
| 6 | Activities | Met | Rest, eat, visit, greet, socialize and move, with travel, performing, completion, cancellation and failure (unit tests and e2e) |
| 7 | Interact with real residents | Met | Greet and chat with real residents in the street or in the same venue. Residents are never mutated, and leaving ends the chat (unit tests and e2e) |
| 8 | Player and resident movement compatible | Met | One tick drives both; resident tests unchanged (212 pass); the housing slot is never filled or taken back |
| 9 | Save/reload preserves Life Mode | Met | e2e: reload, then "Continue life", gives an identical player; unit round-trips and replay equality |
| 10 | Existing saves stay valid | Met | Phase 3 save loads without a player (e2e and unit); schema 2 unchanged |
| 11 | AI Architect still works | Met | Existing AI e2e; Life e2e previews and approves with a player, and the preview never mutates the player |
| 12 | Build/Plan/Live functional | Met | All earlier e2e and unit suites pass; Life is a separate fourth tab |
| 13 | Polished, responsive UI | Met | Desktop, tablet and phone screenshots reviewed and issues fixed (below) |
| 14 | No critical gameplay or performance regression | Met | Engine and render measurements below |
| 15 | Regression tests pass | Met | Results below |
| 16–17 | Pushed; PR to `main` | See the final report | Recorded after the push |

## Test results (2026-10-12, local)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass (strictness unchanged) |
| `npm test` | 122 passed (was 110; 12 new: look, presentation, saves, App Life flow) |
| `npm run test:simulation` | 261 passed (was 212; 49 new in `tests/player.test.ts`) |
| `npm run test:architect` | 31 passed |
| `npm run security` | 0 findings |
| `npm run build` | Pass |
| API `uv run --locked --extra dev python -m pytest -q -W error` | 61 passed |
| `npm run test:e2e` (mock Gemini, production preview) | 33 passed (was 29; 4 new in `e2e/life-mode.spec.ts`) |

New browser coverage in `e2e/life-mode.spec.ts`:
- **Complete life:** create (including the invalid name and four style choices), choose a home, spawn, walk to a
  clicked road, rejected grass and unreachable clicks, evening visit to the park, meet a resident from Nearby
  residents and Greet (diary lines), go home, rest at 4×, save, reload, Continue Life (identical player and tick).
- **Phase 3 save without a player**, and full housing with the "Build a home" fallback.
- **Edge cases:** rest cancelled with partial progress; AI preview leaves the player identical; approving runs one
  batch; bulldozing the player's home relocates them to a road and clears the home; move into another home; undo
  restores the villa without rewinding the player.
- **Phone layout:** Life tab, full-screen creator, home sheet, two-row HUD and profile sheet, Build still reachable.

The regression specs for Phase 1 construction (`city-builder`), Phase 2 AI (`ai-architect`), Phase 3 residents
(`living-world`, `npc-persistence`) and Visual World 2.0 (`visual-world`) are unchanged and run in the same suite.

## Performance

**Engine** (`node scripts/life_benchmark.mjs`, Apple M2, Node 24, 400 ticks): the same commuting city with and
without a player who keeps walking the whole street.

| Residents | Mean tick (no player) | Mean tick (player) | p95 (no player / player) |
| --- | --- | --- | --- |
| 100 | 0.082 ms | 0.081 ms | 0.165 / 0.178 ms |
| 1000 | 0.920 ms | 0.846 ms | 1.537 / 1.202 ms |
| 3000 | 2.672 ms | 2.664 ms | 3.545 / 3.554 ms |

**Browser rendering** (`node scripts/npc_render_benchmark.mjs`, 1440×900, Vite dev build, median fps):
- "+ walking player" means a character moved in first and walked a long route while sampling, with the dashed path
  redrawn every frame.
- The Visual World 2.0 columns come from `docs/npc/render-benchmark-results.json`.

| Residents | VW2 GPU | Phase 4 GPU | + walking player | VW2 software | Phase 4 software | + walking player |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | 60 | 60 | 60 | 33 | 33 | 29 |
| 100 | 60 | 60 | 61 | 31 | 31 | 28 |
| 300 | 60 | 60 | 60 | 16 | 19 | 22 |
| 1000 | 57 | 59 | 58 | 7 | 7 | 8 |

- Phase 4 without a character is at parity with Visual World 2.0.
- With a walking character, GPU rendering is unchanged.
- Software rendering is about 10% lower at 30 and 100 residents. That is within the fpsMin spread of the same runs
  (16–17), and the camera framing differs because the benchmark centers the city in Life mode.
- At 300 and 1000 residents software rendering is at parity.
- Scene update time per frame grows by up to 0.25 ms at 1000 residents on GPU (0.61 to 0.85 ms).
- A first software run overlapped CPU-heavy test suites and was discarded and re-measured on an idle machine.

Test hardening: the office case in `e2e/city-builder.spec.ts` failed intermittently in two full runs. Since Visual
World 2.0 the inspector shows "Ready" immediately, but the 5.2 s rise animation (which also drives the roof hit-test
height) keeps running. The tallest building could be clicked before reaching full height. The test now waits until
the canvas stops changing before the roof click; its assertions are unchanged. `visual-world` determinism failed
once in one full run and passed in every other run, including the final one.

## Issues found in visual review and fixed

- Creator swatches: the circle intercepted clicks while scaled on hover, so radios were not clickable in automation.
- On a tablet (1024 px) the fourth tab overlapped the funds stat. The top bar now compacts below 1240 and 1080 px.
- The phone profile sheet reopened scrolled down (it kept the home picker's scroll position). The panel now resets
  scroll when its view or visibility changes.
- The phone HUD hid the name and status. It is now a two-row strip with needs on the second row.
- Life errors used a success check icon. Warning toasts now have their own tone and icon.
- A creator submit button marked `aria-disabled` read as disabled; it is now styled as incomplete while staying
  usable, and explains the error.
- The player was hard to spot among residents. It is now 12% larger, with a terracotta ring and chevron marker.
- Home footprints were hidden under buildings during selection. Floating badges now mark each home's state above its
  roof.
- Needs drained to zero within one game day. Decay was rebalanced (idle day: energy −65, hunger −79, social −58).

## Known limitations

- No keyboard movement (optional in the brief). Road-constrained routing is click-driven only.
- Conversations are deterministic template lines from real resident data; there is no free-form AI dialogue or
  relationship system beyond "met".
- Eating is home-only because no catalog building provides food.
- Inside homes and the clubhouse the character is shown as a pin, not drawn.
- The game clock starts at midnight, so a new city's first spawn is at night.
- Residents choose leisure venues in building-ID order (Phase 3 behavior), so evening crowds favour the first venue.
- `usedJSHeapSize` readings varied too much between identical runs to report memory use.
- A hidden browser tab freezes time by design, so manual testing needs a visible tab.
