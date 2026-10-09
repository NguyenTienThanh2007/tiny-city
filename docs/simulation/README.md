# TINY CITY — Phase 0 simulation foundation

The headless simulation lives in `packages/simulation`. It has no runtime dependencies on a UI framework, renderer, browser, API, or wall clock. The minimal FastAPI scaffold lives in `apps/api` and is independent of the simulation runtime.

This checkout started from `feature/ai-simulation` at `e83edc1` (the initial README). Tooling is scoped to these packages because the repository has no root workspace configuration yet.

## Install and verify

Use Node.js 22.12+ and Python 3.11+. From the repository root:

```sh
npm --prefix packages/simulation ci
npm --prefix packages/simulation run typecheck
npm --prefix packages/simulation test
npm --prefix packages/simulation run build
```

For the backend:

```sh
cd apps/api
uv sync --locked --extra dev
uv run --locked --extra dev python -m pytest -q
uv run --locked uvicorn tiny_city_api.main:app --reload --host 127.0.0.1 --port 8000
```

The npm and uv lockfiles pin the dependency graphs. Generated JavaScript, dependencies, virtual environments, and test caches are ignored locally.

## Public documentation

- [Interfaces and behavior](./contracts.md)
- [Developer B / PixiJS integration](./integration.md)
- [API setup](../../apps/api/README.md)

## Delivered scope

- Readonly, JSON-safe `WorldState`, `CityPlan`, `Building`, `Citizen`, and `DailySchedule` interfaces.
- An explicit fixed-timestep clock with remainder accumulation, pause/resume, and manual stepping.
- Seeded random helpers with serializable state.
- FIFO commands and typed event batches, with predictable rejection reasons.
- Daily activity/target selection at tick boundaries and two reproducible fixtures.
- Vitest coverage of core behavior and FastAPI health/CORS smoke tests.

Daily schedules select activity and a target building. They do not move citizens. The relocation command is a direct position update for integration/debugging. Building capacities are descriptive metadata. Collision rules, pathfinding, economy, needs, AI/Gemini, persistence implementations, and simulation HTTP endpoints are outside Phase 0.

## Ownership and coordination

All contracts are package-local under `packages/simulation/src/types.ts`. No shared contract package has been introduced or changed. Developer B should review these interfaces before promoting them into shared contracts or exposing them over HTTP. Developer B owns the frontend dependency registration, renderer adapter, and the eventual root workspace setup.

`packages/persistence` has no implementation in Phase 0. Snapshots are serializable to make later persistence possible without selecting a storage backend now.
