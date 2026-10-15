# Acceptance: Phase 8A

- **Baseline:** `main` at `45bbea73311deba626c558243262a50fc8112aba` (Phase 7 merged, PR #24). Its PR passed all 5 checks; on the merge commit, `api`, `frontend-and-simulation` and gameplay shard 1/2 had passed and shard 2/2 was still running when this branch started.
- **Branch:** `feature/p8a-immersive-third-person`.
- **PR:** [#25](https://github.com/NguyenTienThanh2007/tiny-city/pull/25). Draft until every check passes; never merged without explicit approval.
- **GitHub Actions** results are recorded on the PR for its final commit (this docs commit is part of it).

## Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | A genuine Three.js world exists | Met | Perspective camera, mesh architecture, real depth and shadows, sky, fog. Screenshots 01–13, motion videos. |
| 2 | It reflects the actual layout | Met | Built from the live plan, catalog footprints, saved designs and the City View's decor plan; one coordinate convention, tested against `iso()` ([coordinate-systems.md](coordinate-systems.md)). City View before/after: 14, 15. |
| 3 | Luxury Minimalist villas look premium | Met | The bake's own models, built in real time: ivory render, concrete, stone, walnut slats, glass, pools (04, 05, 07, 12). All six villa models are present by ID (browser A). |
| 4 | A proper stylized 3D character | Met | The bake's rig with the City View's appearance mapping, at eye-level scale; walk, run and idle animation (03, 04, 13). |
| 5 | Third person is the default camera | Met | Behind and above at spawn (01, 09). |
| 6 | WASD works | Met | Browser C, D; unit tests for directions against a real camera. |
| 7 | Running works | Met | Shift: 0.78 tiles/s, peak within limits (browser D; screenshot 03; video `motion-run`). |
| 8 | Camera orbit works | Met | Drag or pointer lock; pitch and zoom limits; obstruction pull-in (browser E–G; screenshot 08; video `motion-orbit`). |
| 9 | Collision prevents walking through buildings | Met | Lot edges are solid; no tunnelling at any step size; curb furniture solid; sliding (browser H; screenshot 10; video `motion-collision`). |
| 10 | Spawn is valid | Met | Door spawn on the sidewalk outside the lot, exactly the rule's result (browser B); street spawn where the character stands (K, L). |
| 11 | Player identity stays consistent | Met | Same `player-1`, name, appearance and composed layers across switches, reloads and re-entry (browser J, K, L). |
| 12 | City/Character switching works | Met | Enter World and Return to City, framing the character (J, K, O; video `motion-view-switch`). |
| 13 | Saved gameplay data stays intact | Met | Only validated `player.walk` steps change the world; save and reload keep the position (L); the saved world validates (J). |
| 14 | Existing worlds load safely | Met | A legacy save without economy, transport, society or designs enters with classic models and no fallbacks (M). The new-city flow too (M, N). |
| 15 | Rendering performance is acceptable | Met | 56–60 fps on all scenarios and presets, enter in 0.9–1.9 s; no leaks in long sessions or switching ([performance.md](performance.md)). |
| 16 | Real browser screenshots | Met | 15 captures and 5 motion videos in [screenshots/](screenshots/), driven by real keyboard and mouse input. |
| 17 | Automated movement and camera tests pass | Met | 24 unit tests in `src/immersive/immersive.test.ts`, 7 simulation tests for `player.walk`, and the walk fuzz. |
| 18 | Existing gameplay is not broken | Met | Full suites (below); city-builder, camera, economy, transport, society, life, AI Architect and account specs in CI. |
| 19 | Full e2e passes | See PR | 84 Playwright tests in two shards (the 80 existing plus 4 new). The four Phase 8A tests pass locally and on CI. |
| 20 | Required GitHub Actions jobs pass | See PR | `api`, `frontend-and-simulation`, gameplay shard 1/2, gameplay shard 2/2, `gameplay`. |

## Browser scenarios A–U

| Scenario | Where it is checked |
|---|---|
| A Enter World · B spawn · C WASD · D running · E follow · F orbit · G pitch and zoom limits · H villa collision · I valid ground · J return · K re-enter | `e2e/immersive-third-person.spec.ts`, test 1 |
| L save and reload · M legacy save | test 2 |
| N no character or no home (recovery) · M new city | test 3 |
| O repeated switching without leaks (precise heap after GC, canvases, GPU stats) · P camera 4.6 · Q build tools · the City View clock resumes | test 4 |
| Q AI Architect | `ai-architect*.spec.ts` |
| R economy (Phase 5) | `phase-5-economy.spec.ts` |
| S transportation (Phase 6) | `phase-6-transport.spec.ts` |
| T living society (Phase 7) | `phase-7-society.spec.ts` |
| U authentication and cloud saves | `guest-session.spec.ts`, `account-cloud-saves.spec.ts` |
| P camera (full) | `phase-4-6-camera.spec.ts` |

## Test results

| Suite | Result |
|---|---|
| Typecheck (all packages, app, e2e) | Pass |
| Simulation (Vitest) | 429 passed: 7 new `player.walk` tests, and the invariants fuzz now includes walk steps (wide sweep `AUDIT_SEEDS=40 AUDIT_STEPS=300` passed) |
| Frontend (Vitest) | 269 passed: 24 new Character View tests |
| AI Architect | 78 passed |
| API (pytest `-W error`) | 81 passed |
| Production build, secret scan | Pass; 0 findings |
| Playwright, Phase 8A spec (CI mode, SwiftShader) | 4/4 locally (≈ 2.6 min) and on CI (≈ 8.8 min, shard 1/2) |

One older test needed a change in product code, not in the test: the city-builder zoom/pan test clicked a map tile that the first placement of the Enter World button (above the minimap) covered at 1100 × 740. The button moved to the top bar, where it covers no map.

## Screenshots (Palm Terrace, real browser)

| | |
|---|---|
| 01 Third person behind the character at spawn | 02 Walking on the sidewalk |
| 03 Running | 04 Glass Pavilion Villa close-up |
| 05 Several villa models along Terrace Road | 06 Tree-lined street at eye level |
| 07 Sidewalk and building entrance | 08 Camera orbited to the side |
| 09 Camera behind the walking character | 10 Collision at the Palm House lot edge |
| 11 Golden hour (18:25) | 12 Night (21:50) |
| 13 Character View HUD | 14 City View before entering |
| 15 City View after returning | Motion: `motion-walk-turn`, `motion-run`, `motion-orbit`, `motion-collision`, `motion-view-switch` (WebM) |

Positions, camera, frame rate and draw calls for each capture are in [`screenshots/evidence.json`](screenshots/evidence.json).

## Known limitations

See [limitations-and-next-steps.md](limitations-and-next-steps.md). In short:
- the walkable ground is the streets (lots and parks are solid);
- models are detailed on their south and east faces;
- there are no interiors or 3D interactions yet;
- residents and vehicles are drawn but not solid;
- there are no touch controls;
- software rendering runs at about 5 fps (CI only).
