# Acceptance: Visual World 3.1

**Baseline:** `main` at `01ec34d` (PR #18). CI run 38409390925 passed all 3 jobs.
**Branch:** `feature/visual-world-3-1-architecture`. **PR:** #19 (draft, not merged).

## Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Players can select architectural collections | Met | Selector radiogroup; e2e `visual-world-3-1` selector, mix and phone tests; screenshots 12 and 20 |
| 2 | Players can select specific building models | Met | Model radiogroup; planned models disabled; e2e |
| 3 | Placement preview matches the chosen model | Met | Ghost uses the predicted ID and design; label names the model; e2e checks the preview then the built model; screenshot 13 |
| 4 | Luxury Minimalist has genuinely distinct modern designs | Met | 6 villas, 4 duplexes, 4 townhouses, 4 apartments, each with its own massing; screenshots 01–05 |
| 5 | Residential architecture is visibly more varied | Met | Matched before/after pairs (`*-before-3.0c.jpg`); 34 residential models now selectable (13 classic + 21 new) |
| 6 | Commercial and public architecture is more distinctive | Met | 16 new models: 3 malls, 4 offices, 3 clubhouses, 3 pools, 3 parks; screenshots 06–09, 16 |
| 7 | Identity persists through save/load | Met | Unit tests (construction, move, save, reload, malformed data); e2e undo, redo and reload |
| 8 | Cloud saves and guest sessions still work | Met | API test: cloud save keeps designs verbatim; `account-cloud-saves` and `guest-session` e2e unchanged and passing |
| 9 | AI Architect handles architectural requests | Met | Planner validation without substitution; interpreter tests for all spec examples; e2e AI styled build and refusal; screenshots 15 and 15b |
| 10 | Existing worlds remain compatible | Met | Classic atlases byte-identical; legacy selection test; older-save e2e |
| 11 | Renderer is stable during long sessions | Met | e2e long session (night/day, zoom and undo/redo cycles, `vectorBuildings = 0`); benchmark long session |
| 12 | Performance is acceptable | Met | 60 fps, p95 ≤ 16.8 ms in all scenarios; +12.8 MB GPU for a fully designed district; [performance.md](performance.md) |
| 13 | Real gameplay screenshots prove better visuals | Met | 27 browser captures in [screenshots/](screenshots/), including matched before/after |
| 14 | All relevant tests pass | See the CI table below | Local results below |
| 15 | GitHub Actions reports 3/3 success | Pending | Recorded in the PR once the run on the latest commit finishes |

## Tests (local, latest commit)

| Suite | Result |
|---|---|
| Typecheck (all packages, app, e2e) | Pass |
| Frontend unit (Vitest) | 195 passed |
| Simulation | 286 passed (unchanged) |
| AI Architect | 64 passed (includes 12 new architecture tests) |
| API (pytest) | 80 passed |
| Production build, security scan | Pass, 0 findings |
| Playwright e2e | 53 tests. The full run passed 52; the remaining preview-label test was fixed and passes on its own (13/13 in the affected specs) |

## CI history on this PR

- **First run** (38429543593) failed 2 of 3 jobs. A typing issue in a test helper (`exactOptionalPropertyTypes`)
  failed typecheck. A null texture slot in the new GPU stats threw a page error that failed every e2e spec checking
  for errors. Both were fixed in `2418452`.
- The preview-label contract regression ("Type · W × H") was fixed in `c087a0b`.

## Known limitations

- The four smaller collections do not cover every building type; 3 models are listed as planned. See the
  [catalog](architectural-catalog.md).
- All atlases are downloaded at start-up (4.39 MB). GPU upload is on demand.
- Night lighting appears only once the city has residents. This is unchanged 3.0C behaviour.
- `--only=` partial bakes can differ slightly from a full bake; commit only full-bake output.

## Verdict

**VISUAL WORLD 3.1 NOT ACCEPTED — BLOCKERS REMAIN** until GitHub Actions reports 3/3 on the latest commit. This
document is updated when it does.
