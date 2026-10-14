# Post-merge CI recovery (after PR #21)

## What failed

On main at `a38ae68`, run 38547083877 failed the Gameplay E2E job; the API and Frontend/Simulation jobs passed.

```
Timed out waiting 3000s for the test suite to run
Timed out waiting 3000s for the teardown for test suite to run
14 did not run
50 passed (50.0m)
```

No test failed or hung:
- All 50 tests that ran passed.
- The last finished at 10:55:53, 1 s before Playwright's 50-minute `globalTimeout` (3,000 s) stopped the run.
- The "teardown" line is Playwright's standard follow-on message when that timeout ends a run with work outstanding.

## Evidence

| Run | Code | Tests | Result | e2e wall time |
|---|---|---|---|---|
| 38515129976 (PR #20) | Phase 4.6 | 60 | passed | 39.5 min |
| 38519117899 (main after PR #20) | Phase 4.6, no Phase 5 | 60 | **timed out**, 49 passed | 50.0 min |
| 38531545380 (PR #21) | Phase 5 | 64 | passed | 29.9 min |
| 38547083877 (main after PR #21) | Phase 5, same code | 64 | **timed out**, 50 passed | 50.0 min |

- **The same code ran about 2× slower on the failing runs, uniformly.** Every test, not one test:
  - `account-cloud-saves`: 40.6 s → 1.2 min;
  - each `city-builder` building test: 39 s → 1.4 min;
  - `phase-4-6` A/B: 2.2 → 4.6 min;
  - `phase-4-6` J: 1.9 → 4.1 min;
  - Phase 5 D–K: 29 → 53 s.

  The software renderer (SwiftShader) is CPU-bound, and game time follows the frame rate. A slower hosted runner
  therefore stretches the whole suite. The failing runners also built the app about 25% slower (400–410 ms vs
  307–332 ms).
- **It predates Phase 5.** The main run after PR #20, which has no economy code, failed identically.
- **Phase 5 is not a performance regression.** On the two slow runners, the 48 tests common to both took 48.9 min
  before Phase 5 and 48.0 min after (ratio 0.98). The four Phase 5 tests add about 1.2 min on a fast runner and about
  2.5 min on a slow one. The headless and browser benchmarks show no frame-time change
  ([performance.md](performance.md)).

## Root cause

The Playwright suite runs serially (`workers: 1`) inside one job:
- It takes about 30 min on a fast hosted runner and about 60 min on a slow one.
- Its Playwright budget is a fixed 50 minutes (`globalTimeout`), under the job's 60-minute limit.

The suite grew from 48 to 64 tests. Any run landing on a slow runner (both main pushes did) runs out of budget before
the last specs start. The workflow comment already recorded "up to ~2x longer on a slow one".

## Fix

The browser suite now runs in two shards on separate runners:
- **`gameplay shard 1/2`:** 34 tests.
- **`gameplay shard 2/2`:** 30 tests.
- **`gameplay` check:** a small aggregate job that is green only when both shards pass.

Each shard needs about 15 min on a fast runner and about 26–32 min on a slow one, comfortably inside the unchanged
budgets. Each shard records the runner's CPU, so a slow runner can be told apart from a slow test. Each shard uploads
its own traces on failure.

What did not change:
- No test, assertion, wait or timeout changed.
- `workers: 1` is kept inside each shard: game-time tests share neither a browser nor the CPU.
- Phase 5 economy, Camera 4.6, Visual World 3.1, authentication and cloud saves are untouched.

## Verification

- Both shards pass locally in CI mode (`CI=1 npx playwright test --shard=N/2`): 34/34 in 8.1 min and 30/30 in 10.6 min (all 64).
- All unit, simulation, AI Architect and API suites pass.
- GitHub Actions results are recorded in the recovery PR; a green post-merge main run is the final acceptance.
