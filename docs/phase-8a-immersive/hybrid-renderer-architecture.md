# Hybrid renderer architecture

## Two views, one world

| | City View | Character View |
|---|---|---|
| Renderer | PixiJS 8, isometric, baked sprites | Three.js (r186), perspective, real-time meshes |
| Reads | `getWorld()` every frame | `getSnapshot()` (the same live `WorldState`) every frame |
| Writes | city commands, Life commands (click-to-move) | `player.walk` steps only (plus pause/resume and Save) |
| Frame driver | Pixi ticker | its own `requestAnimationFrame` loop |

Both views use the single `Simulation` instance held by `useCitySimulation`. There is no second world, no copy of the save, and no second player. The Character View is a presentation and input layer.

## One frame driver at a time

While the Character View is open:

- `CityViewport` receives `suspended` and stops its Pixi ticker (`app.ticker.stop()`), so the City View neither renders nor advances the simulation. Its canvas is hidden with `visibility: hidden`, and its state (camera pose, textures, layers) is kept.
- The engine's loop calls the same `advanceSimulation(elapsedMs)` the Pixi ticker uses (250 ms cap, speed 1/2/4×, paused/hidden handling), then reads the live world, moves the character, updates the scene and renders.
- The main app shell is `inert` and `aria-hidden`, and its keyboard shortcuts are off. The Character View owns the keyboard.

On **Return to City** the engine commits the last step, is disposed, and the Pixi ticker restarts. The camera then frames the character, using Life View in Life Mode or Focus otherwise. Nothing reloads.

## Why plain Three.js (not React Three Fiber)

- The 3D scene is driven by a game loop and a simulation, not by React state. The City View follows the same pattern: Pixi is imperative and outside React. A React reconciler per mesh would add per-frame overhead and a second state model.
- The art pipeline is already plain Three.js. `scripts/art/**` builds models into `THREE.Group`s at bake time, and those same functions run at runtime here unchanged.
- It adds one dependency, `three`, which was already a dev dependency for baking and is now a runtime dependency. `@types/three` is a dev dependency.
- The view is lazily loaded (`React.lazy` around `ImmersiveView`). Three.js and the art modules are a separate chunk that is downloaded the first time someone enters the world, so the main bundle is unchanged.

## Lifecycle and resources

`ImmersiveEngine` (`src/immersive/three/engine.ts`):

1. **Graphics preset.** `probeRenderer()` reads the GPU name from a throwaway context. A software renderer (SwiftShader, llvmpipe) gets the *light* preset, anything else *high*. The player can override this in the menu. The preset is chosen before the real context exists, because antialiasing cannot change afterwards.
2. **Renderer.** Each engine creates its own canvas, because a released WebGL context can never be reused (a React StrictMode remount would otherwise fail). Settings: ACES tone mapping, sRGB output, and PCF soft shadows in the high preset.
3. **Spawn.** `resolveSpawn` from authoritative state (see [worldstate-integration.md](worldstate-integration.md)). If there is no valid spawn, the engine stops and the app explains why.
4. **Scene.** `Neighbourhood.build()` runs in about 10 ms time slices with a progress card: ground → streets → homes → gardens.
5. **Shader warm-up.** `renderer.compileAsync()` compiles every shader the session can need (scene, vehicle paints, characters) before the first playable frame, so nothing compiles mid-walk.
6. **Loop.** Input → controller (fixed 120 Hz steps) → validated commits → character pose → residents and vehicles → camera → lights and culling → render.
7. **Dispose.** Before the renderer goes, every material, geometry and texture in the scene (plus the warm-up meshes, tint and vehicle materials) is disposed. This matters because the shared art caches outlive the view, and three keeps a dispose listener that holds the renderer on each. The asset cache is released, the renderer is disposed and its context lost, and the canvas is removed.

### Failure handling

- **No WebGL / renderer creation fails:** back to the City View with a notice ("Your browser could not start 3D graphics …").
- **`webglcontextlost`:** back to the City View with a notice. The world is untouched.
- **No valid spawn:** the app checks before mounting the view and shows a dialog with a recovery action.
- **Touch-only devices:** a dialog explains that walking in 3D needs a keyboard and a mouse or trackpad. The button is hidden at phone widths.

## Quality presets

| | High | Light (software GPUs, or chosen) |
|---|---|---|
| Shadows | 2048² PCF soft shadow map following the character (±9 tiles) | none |
| Pixel ratio | device ratio, at most 2 | 0.75 |
| MSAA | on | off |
| View distance | 30 tiles (fog from 13.5) | 20 tiles (fog from 9) |
| Ground cover (flowers, grass tufts, pebbles) | drawn within 13 tiles | not drawn |

## Debug surface

`window.__tinyCityImmersive` is refreshed about 6 times a second. It holds: `ready`, `quality`, `renderer`; the `player` (3D position, yaw, motion, speed, whether under direct control, `blocked`); the `authority` (the simulation's player position, status and tick); the `camera` (yaw, pitch, wanted and actual distance, position); `commits` and `rejected`; `stats` (buildings, models, fallbacks, decor, triangles, draw calls, geometries, textures, fps, CPU frame cost, p95 frame interval, estimated GPU memory, build and init time); the drawn `residents` and `vehicles`; and the character's composed `character` layers. Development builds also expose the live scene (`__tinyCityImmersiveScene`).
