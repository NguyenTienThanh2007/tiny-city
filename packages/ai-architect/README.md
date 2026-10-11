# @tiny-city/ai-architect

Phase 2A versioned contracts, deterministic spatial planning, validation/repair and explicit approval/application for TINY CITY. This package imports Phase 1 simulation rules; it does not duplicate prices, footprints or world models, and has no React/Pixi/Gemini runtime dependency.

Browser exports: `createProposal`, `PlanReview`, wire interfaces and helpers. Node worker: `dist/worker.js`, JSON stdin/stdout, consumed only by FastAPI's fixed subprocess bridge. Generated catalog metadata: `dist/catalog.json`.

From root: `npm run build:architect`, `npm run test:architect`, `npm run typecheck`. Apply through one stable `PlanningHost` wrapping the existing simulation/commit boundary. The package uses WebCrypto, available in Node 24 and modern browsers on HTTPS/localhost.

See [contracts](../../docs/ai-architect/phase-2a-contracts.md) and [integration](../../docs/ai-architect/phase-2a-integration.md).
