# @tiny-city/simulation

Headless TypeScript engine with no runtime dependencies. Exposes readonly schema-2 contracts, a deterministic clock, seeded randomness, authoritative city build/move/demolish/road commands and budgets, occupancy and road topology, typed events, and deterministic serialization/Phase 0 migration.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

```ts
import { Simulation } from '@tiny-city/simulation';
import { createDemoWorldFixture } from '@tiny-city/simulation/fixtures';

const simulation = new Simulation(createDemoWorldFixture({ seed: 'tiny-city' }));
const result = simulation.advance(100);
// result.state, result.events, result.steps, result.alpha
```

Requires Node.js 22.12+ for development tooling. Output is ESM targeting ES2022 and includes declarations. Build before consuming the package.

See [public contracts](../../docs/simulation/contracts.md), [Phase 1A coordination](../../docs/simulation/phase-1a.md), [Phase 1B builder](../../docs/simulation/phase-1b.md), and [frontend integration](../../docs/simulation/integration.md). No Gemini, NPC movement/pathfinding, storage backend, or shared-contract copy is included.
