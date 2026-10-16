# Phase 8A: Immersive Life Mode (third-person 3D vertical slice)

> **Since Phase 8B**, `three/neighbourhood.ts`, `residents.ts` and `vehicles.ts` described here have been replaced by the whole-city `cityScene.ts` and `actors.ts` on a pure scene model. See [docs/phase-8b-living-world-3d/](../phase-8b-living-world-3d/README.md). These 8A docs describe the slice as it was delivered.

Press **Enter World** and your Life Mode character steps out of their front door into a real-time 3D version of your neighbourhood. Walk and run with W A S D and Shift, look around with the mouse or trackpad, and press **Return to City** to go back to the isometric City View exactly where you stopped. There is one city, one character and one simulation: the 3D view reads the same live world and moves the character only through validated simulation commands.

| Doc | What it covers |
|---|---|
| [hybrid-renderer-architecture.md](hybrid-renderer-architecture.md) | How PixiJS and Three.js coexist, the single frame driver, lifecycle, models, quality presets |
| [coordinate-systems.md](coordinate-systems.md) | Grid ↔ 3D ↔ City View conventions, building placement and facing, tests |
| [third-person-controller.md](third-person-controller.md) | Controls, the fixed-step controller, speeds, animation, input focus |
| [camera.md](camera.md) | Orbit, zoom, limits, damping, obstruction handling, settings |
| [collision.md](collision.md) | Walkable ground, building and furniture collision, sliding, no tunnelling |
| [worldstate-integration.md](worldstate-integration.md) | Authority, the `player.walk` command, spawn rules, save/load, view switching, NPCs and vehicles |
| [art-direction.md](art-direction.md) | Real-time reuse of the procedural models, materials, lighting, sky, the character |
| [performance.md](performance.md) | Measured benchmarks (hardware and software rendering), memory, switching |
| [limitations-and-next-steps.md](limitations-and-next-steps.md) | What is not in 8A, and what Phase 8B / 8C / 8.5 / 9 pick up |
| [acceptance.md](acceptance.md) | Criteria, evidence, test counts, CI |
| [screenshots/](screenshots/) | Real browser captures and motion videos |

## In one paragraph

`src/immersive/` holds the Character View. Pure, unit-tested modules define the coordinate convention (`coordinates.ts`), walkable ground and collision (`collision.ts`), the fixed-step third-person controller (`controller.ts`), the orbit camera (`orbitCamera.ts`) and the spawn rules (`spawn.ts`). `three/` builds the scene: the bake's own procedural models built in real time and merged (`assetBuilder.ts`), the neighbourhood from the plan (`neighbourhood.ts`), sky and light from the clock (`atmosphere.ts`), the player's character from the bake's rig (`characterModel.ts`), nearby residents and vehicles from live state (`residents.ts`, `vehicles.ts`), and the engine that owns the renderer, the loop, input and the simulation bridge (`engine.ts`). `ImmersiveView.tsx` is the React shell and HUD, lazily loaded so Three.js never enters the main bundle. The simulation gained one command, `player.walk`, a short validated step on walkable ground.

## How to try it

1. Life Mode: create a character and move into a home beside a road.
2. Click **Enter World** in the top bar.
3. Press **Resume** (or Space) if time is paused, then W A S D to walk, hold Shift to run.
4. Drag on the view (or click to capture the mouse) to look around; scroll or pinch to zoom; Esc opens the menu or frees the mouse.
5. **Return to City** brings back the City View, framed on the character.

Without a character, without a home yet, or with no street beside the character, Enter World explains what is missing and offers the way forward (create a character, choose a home, back to the city).

## Tools

- `node scripts/p8a_city.mjs` validates the "Palm Terrace" showcase (all six Luxury Minimalist villa models, duplexes, townhouses, a park, a pool, an office).
- `node scripts/capture_p8a.mjs [url] [outDir]` produces the screenshots and motion videos with real keyboard and mouse input.
- `node scripts/p8a_benchmark.mjs [url] [--quick] [--software]` measures entering, idle, walking/running, orbiting, switching and a long session.
- `e2e/phase-8a-immersive.spec.ts`: browser acceptance.
- `window.__tinyCityImmersive`: the live renderer state (player, authority, camera, stats) for tests and benchmarks.
