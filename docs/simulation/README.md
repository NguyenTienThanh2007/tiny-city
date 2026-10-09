# TINY CITY — Phase 0 simulation foundation

The headless simulation lives in `packages/simulation`. It has no runtime dependencies on a UI framework, renderer, browser, API, or wall clock. The existing React/PixiJS frontend consumes its public contracts through `src/simulation`. The minimal FastAPI scaffold lives in `apps/api` and is independent of the simulation runtime.

The root npm workspace and lockfile install both the frontend and simulation dependencies. Development, build, and integration-test scripts build the simulation package before importing its public ESM exports.

## Install and verify

Use Node.js 22.12+ and Python 3.11+. From the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run test:simulation
npm run build
```

For the backend:

```sh
cd apps/api
uv sync --locked --extra dev
uv run --locked --extra dev python -m pytest -q
uv run --locked uvicorn tiny_city_api.main:app --reload --host 127.0.0.1 --port 8000
```

The root npm and API uv lockfiles pin the integrated dependency graphs. The simulation package's earlier standalone lockfile remains available for isolated package development. Generated JavaScript, dependencies, virtual environments, and test caches are ignored locally.

## Public documentation

- [Interfaces and behavior](./contracts.md)
- [Developer B / PixiJS integration](./integration.md)
- [API setup](../../apps/api/README.md)

## Delivered scope

- Readonly, JSON-safe `WorldState`, `CityPlan`, `Building`, `Citizen`, and `DailySchedule` interfaces.
- An explicit fixed-timestep clock with remainder accumulation, pause/resume, and manual stepping.
- Seeded random helpers with serializable state.
- FIFO commands and typed event batches, with predictable rejection reasons.
- A validated layout replacement API that retains clock, random state, and pending commands.
- Daily activity/target selection at tick boundaries and two reproducible fixtures.
- React clock controls, Pixi ticker integration, and compatible browser map/simulation saves.
- Vitest core/UI/adapter/save regression tests, FastAPI health/CORS smoke tests, and GitHub Actions CI.

Daily schedules select activity and a target building. They do not move citizens. The relocation command is a direct position update for integration/debugging. Building capacities are descriptive metadata. Collision rules, pathfinding, economy, needs, AI/Gemini, persistence implementations, and simulation HTTP endpoints are outside Phase 0.

## Ownership and coordination

All contracts remain package-local under `packages/simulation/src/types.ts`. No shared contract package has been introduced or changed. The frontend imports these types instead of duplicating them. Editor-specific roads, funds, construction timestamps, and visual kinds stay behind the adapter. Review any future shared-contract promotion or HTTP transport before extending this baseline.

`packages/persistence` has no implementation in Phase 0. Snapshots are serializable to make later persistence possible without selecting a storage backend now.
