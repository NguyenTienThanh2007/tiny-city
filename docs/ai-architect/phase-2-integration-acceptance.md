# Phase 2 integration recovery and acceptance

Authoritative branch: `feature/p2-ai-engine`. Starting integration HEAD: `6a86956b95ad49e07ecf86a13d8f511e9034644e`, containing Phase 2B PR #6 merged into Phase 2A. All branches were fetched, and the clean local checkout was fast-forwarded safely. PR #5 remains the main-targeted integration PR; nothing was merged into main or force-pushed.

## Failure reproduction and resolved findings

GitHub Actions [run 38121034947](https://github.com/NguyenTienThanh2007/tiny-city/actions/runs/38121034947) passed API checks but failed frontend typechecking and Playwright startup. Generated architect outputs were preserved outside the repository, then removed from the active build state to reproduce the clean-checkout failures locally.

| Severity | Finding | Resolution and regression evidence |
| --- | --- | --- |
| Blocker | Root scripts built only simulation before frontend imports of `@tiny-city/ai-architect`; missing declarations caused cascading implicit-any/unknown errors in App, client, viewport and map geometry. | Declare the root architect dependency and lock entry; dev/build/test/typecheck prepare simulation → architect → frontend. Cold typecheck passes with both package outputs absent. No compiler strictness was reduced. |
| Blocker | Playwright's production build exited before webServer startup. | Correct dependency order fixes the build; fresh frontend and API servers are started with visible startup diagnostics. Gameplay CI installs the existing locked Python/uv environment. |
| High | Native Cancel click reused a button that became Submit, launching another request after cancellation. | Distinct React button keys plus preventDefault stop the default submission. Browser regression gates a real API response and confirms exactly one POST, no late preview and unchanged city. |
| High | Rejected identical deterministic proposals could never be reviewed again. | A new review may replace a rejected session. Session identity prevents retired async work from inheriting replacement approval. Applied IDs still block replay. Engine/UI/browser regressions cover rejection, regeneration and failure cleanup. |
| High | Responsive AI panel covered narrow maps and CSS hid Phase 1 inspector actions. | Collapsible mobile panel, non-overlapping toggle and restored inspector content. Small-screen map/build/close-inspector and AI preview/approval cases pass. Desktop layout and Pixi geometry are retained. |
| Medium | Malformed commands/intent/constraints could pass the HTTP parser and reach rendering. | Shared intent/constraint decoders, command discriminants, catalog types, seeds and positive footprints are checked before preview data enters React. Seven malformed-response regressions pass. |
| Medium | Real Gemini labeled one English request Vietnamese. | Language is explicitly derived from userRequest rather than city context. The strict English live UI retest passed; the assertion was not relaxed. |

Map geometry retains the shared `BuildingType`, and the stable frontend commit adapter explicitly accepts readonly `CityCommand[]`. Public wire contracts remain version 1; simulation state and save versions are unchanged. `decodeConstraints` accepts unknown input for runtime validation and returns the same strict contract. Failed/rejected reviews are released safely; atomic application still uses the original simulation/history boundary.

## Verification

| Check | Result |
| --- | --- |
| Clean npm ci / locked uv sync | PASS; no unrelated dependency versions changed |
| Cold workspace typecheck | PASS with generated simulation and architect outputs absent |
| TypeScript app, workspace and E2E checks / production build | PASS; strict settings retained |
| Simulation Vitest | 155 passed |
| AI planner/review Vitest | 29 passed |
| React/client/geometry/frontend Vitest | 72 passed |
| FastAPI/provider/smoke pytest, warnings as errors | 57 passed |
| Production browser regressions | 22 passed: 16 Phase 1 + 6 integrated AI cases |
| Ordinary automated total | **335 passed** |
| Separate paid Gemini production UI check | **1 passed**, excluded from the 335 CI-safe tests |
| Secret/history scan and exact configured-key scan of frontend assets | PASS; no findings; backend .env is ignored |
| Paid UI flag under CI | PASS guard check: configuration rejects it before starting services |

The 22-case browser run used the real FastAPI routes, real Node planner, browser WebCrypto review, real Pixi canvas and real simulation/history/save flow. Only Gemini interpretation was mocked. English and Vietnamese requests both previewed visibly, preserved the complete saved world before approval, rejected and regenerated identical proposals, applied atomically, undid/redid as one edit and survived reload. Error, cancellation/late response, manual-edit staleness and mobile access were exercised. All nine manual Phase 1 building tools retained construction, selection, movement, demolition, history and persistence coverage.

An early API test ran concurrently with a workspace rebuild and encountered a transient unavailable worker artifact. The isolated rerun and complete serialized API suite passed. Build mutation and API/browser verification were subsequently sequenced; this was not treated as a provider or city-rule failure.

## Actual Gemini UI result

On 2026-10-11, the separate `TINY_CITY_LIVE_UI=1 npm run test:e2e` check used the configured backend key and `gemini-3.5-flash-lite`, not a mock. The first response's language mismatch was fixed and recorded above. The final run returned HTTP 200 in **2,158 ms**, request `5b20d98db9014f7cb61a28c0eb81f86d`, plan `plan-b29c46a905d7703aaa1ccf970a59fc1d1603dbe2c107a46a7519d9d5358c1ecd`.

The English prompt requested two villas at distinct preferred coordinates and one park, road connectivity, a 500 budget and preservation. It produced **3 builds, 12 new road tiles, 5 commands / 15 operations**, cost **416**, funds **5,000 → 4,584**, and a `RELOCATED` warning for the park. The preview rendered while serialized world state stayed unchanged. Explicit approval matched the authoritative projected plan; the existing villa remained unchanged; roads formed one component; undo/redo and save/reload preserved plan and budget. No user's existing game or save was touched. [Machine-readable result](examples/phase-2-live-ui-result.json).

This is evidence for the tested live prompt, not exhaustive model semantics or future provider availability. Prior bilingual live API evidence remains in [Phase 2A acceptance](phase-2a-acceptance.md).

## Reproduction and handoff

```sh
npm ci
uv sync --locked --extra dev --directory apps/api
npm run typecheck
npm run test:simulation
npm run test:architect
npm test
# With workspace outputs built, run the API suite before another rebuild:
cd apps/api
uv run --locked --extra dev python -m pytest -q -W error
cd ../..
npm run build
npx playwright install chromium
npm run test:e2e
```

Normal Playwright/CI starts a fresh frontend on 4173 and FastAPI on 8012. The API uses explicit mock mode and an empty `GEMINI_API_KEY` environment override, even if a local ignored .env contains a key. No paid authentication is needed in CI. UV/Python setup is part of the gameplay job.

The optional live UI command above makes one paid planning request (plus the configured bounded transient retry), runs only the dedicated live spec and is rejected if CI is set. It reads the existing backend key without displaying or changing it. Do not set `TINY_CITY_LIVE_UI` in normal CI. The default application still uses API port 8000 unless `VITE_AI_ARCHITECT_API_URL` specifies another URL.

No Phase 3, NPC pathfinding, unrelated rendering redesign, new storage model or automatic merge is included. Existing limits remain: 32 requested buildings, 128 operations, 4096 map tiles/candidates; heuristic spatial preferences; process/session-local quotas/review records. The existing frontend bundle-size advisory is non-blocking. PR #5 must be reviewed before a human merge into main.
