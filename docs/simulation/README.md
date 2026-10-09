# TINY CITY — Phase 1A simulation and city logic

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
- [Phase 1A contract coordination](./phase-1a.md)
- [Developer B / PixiJS integration](./integration.md)
- [API setup](../../apps/api/README.md)

## Delivered scope

- Readonly, JSON-safe `WorldState`, `CityPlan`, `Building`, `Citizen`, and `DailySchedule` interfaces.
- An explicit fixed-timestep clock with remainder accumulation, pause/resume, and manual stepping.
- Seeded random helpers with serializable state.
- FIFO commands and typed event batches, with predictable rejection reasons.
- Authoritative build/demolish/road commands, atomic batches, occupancy validation, road topology, and a central budget/catalog.
- Validated city history snapshots retaining time/RNG/queues and the building-ID high-water mark.
- Schema-2 deterministic serialization and Phase 0/browser-save migration.
- Daily activity/target selection at tick boundaries and two reproducible fixtures.
- React clock controls, Pixi ticker integration, and compatible browser map/simulation saves.
- Vitest core/UI/adapter/save regression tests, FastAPI health/CORS smoke tests, and GitHub Actions CI.

Daily schedules still select activity/target without movement. Capacity remains metadata. Phase 1A adds static tile occupancy and construction spending; NPC pathfinding, traffic, recurring economy/needs, Gemini, storage backends, and simulation HTTP endpoints remain outside this phase.

## Ownership and coordination

Contracts remain package-local. The frontend imports public types/rules instead of duplicating authority; old editor roads/funds/buildings are derived compatibility projections. Only visual styles/construction timestamps are editor metadata. Review the Phase 1A coordination document before extending contracts or exposing HTTP transport.

No storage backend or persistence package has been selected. The simulation owns validated deterministic snapshots and migration; the browser retains its local save flow.
