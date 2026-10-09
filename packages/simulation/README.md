# @tiny-city/simulation

Headless TypeScript simulation foundation with no runtime dependencies. Exposes JSON-safe readonly contracts, a deterministic fixed-step runner, seeded random helpers, typed commands/events, and optional frontend fixtures.

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

See [public contracts](../../docs/simulation/contracts.md) and [Developer B integration](../../docs/simulation/integration.md). No AI, movement/pathfinding, storage backend, renderer code, or shared-contract package is included.
