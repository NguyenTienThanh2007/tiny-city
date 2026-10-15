# Performance

All figures come from the running game: `node scripts/p8a_benchmark.mjs`, which reads the renderer's own stats in `window.__tinyCityImmersive` and the precise JS heap after a forced GC (CDP `Runtime.getHeapUsage`). Hardware runs used an Apple M2 (ANGLE Metal) in Chromium at 1440 × 900. The dev server and deterministic engine-built saves were set at 10:00 with the player at home.

## Entering and the scene

| Scenario | Residents | Preset | Enter (click → playable) | Scene build | Models | Decor items | Scene triangles | Est. GPU memory | JS heap in the 3D view | Geometries / textures on the GPU |
|---|---|---|---|---|---|---|---|---|---|---|
| Small street (7 buildings) | 11 | high | 1.04 s | 301 ms | 7 | 1,654 | 2.32 M | 22.6 MB | 18.3 MB | 254 / 18 |
| Small street | 11 | light | 0.86 s | 285 ms | 7 | 1,034 | 2.03 M | 22.1 MB | 17.5 MB | 132 / 16 |
| Palm Terrace (25 buildings, dense villas) | 59 | high | 1.34 s | 582 ms | 16 | 1,582 | 2.35 M | 39.9 MB | 20.4 MB | 358 / 18 |
| Palm Terrace | 59 | light | 1.11 s | 490 ms | 16 | 959 | 2.05 M | 39.5 MB | 18.7 MB | 218 / 16 |
| Coral Bay Nights (62 buildings) | 239 | high | 1.85 s | 1,076 ms | 43 | 1,402 | 2.56 M | 102.3 MB | 26.8 MB | 453 / 21 |
| Coral Bay Nights | 239 | light | 1.71 s | 1,088 ms | 43 | 817 | 2.27 M | 101.8 MB | 24.6 MB | 284 / 19 |

- *Enter* includes downloading nothing (the chunk was cached), building the scene, compiling every shader and the first frame.
- *Scene triangles* counts every instanced copy in the whole neighbourhood.
- *Est. GPU memory* is vertex buffers (instance matrices included) plus mipmapped textures for the static scene.

## Frame rate (sampled every 250 ms)

| Scenario | Preset | Idle fps (min) | Walking + running fps (min) | Orbiting fps (min) | p95 frame interval | CPU per frame | Draw calls (idle / orbit) | Triangles drawn |
|---|---|---|---|---|---|---|---|---|
| Small street | high | 59.9 (60) | 59.4 (57) | 60.0 (60) | 16.8 ms | 1.6–1.9 ms | 654 / 718 | 1.2–1.6 M |
| Small street | light | 59.3 (58) | 59.9 (59) | 59.8 (58) | 16.8 ms | 1.0–1.2 ms | 264 / 343 | 0.5–0.7 M |
| Palm Terrace | high | 59.7 (60) | 58.8 (57) | 59.9 (60) | 16.8 ms | 2.4–2.8 ms | 756 / 1,211 | 1.1–1.6 M |
| Palm Terrace | light | 58.3 (56) | 58.2 (57) | 58.2 (56) | 16.8 ms | 1.3–1.6 ms | 312 / 720 | 0.4–0.6 M |
| Coral Bay Nights | high | 58.5 (58) | 58.5 (57) | 59.1 (56) | 16.8 ms | 2.7–3.2 ms | 969 / 1,778 | 1.0–1.6 M |
| Coral Bay Nights | light | 59.7 (59) | 58.9 (58) | 60.0 (60) | 16.8 ms | 2.2–2.3 ms | 396 / 905 | 0.4–0.7 M |

- *CPU per frame* is the mean cost of the engine's frame callback: simulation advance, controller, collision, commits, camera, scene update and render submission.
- The display refresh is 60 Hz, so 60 fps is the ceiling.
- Draw calls include the shadow pass (high preset).

## Long sessions and switching views

| Check | Result |
|---|---|
| Extended session: 120 s walking and running around Palm Terrace | 59.2 fps average (min 51), 487 steps committed, **0 refused**, heap +3.4 MB, GPU geometries and textures stable |
| Repeated switching: 10 × Enter World → Return to City | heap 59.7 → 62.3 MB (+0.26 MB per round trip in development); one canvas left after every return |
| Repeated switching, production build, 30 round trips | 39.1 → 44.3 MB. After warm-up the growth flattens to ≈ 0.1 MB per round trip. Heap-snapshot diffs show V8 compiled code and a few shader-source strings; no WebGL programs, renderers, geometries or textures are retained |

Two leaks were found by these measurements and fixed before acceptance:

1. **About 1.8 MB per step.** `executeLife` deep-cloned the whole world for every step, so the suspended City View redrew its buildings each time and its deferred clean-up never ran. Life commands now clone only the player. Result: +0.6 MB over 41 steps instead of +74 MB.
2. **About 0.5 MB and 35 shader programs per round trip.** The shared art materials kept three's dispose listeners, which hold the old renderer. Every scene resource is now released before the renderer is disposed.

## Software rendering (SwiftShader, as on the CI runners)

| Scenario | Preset (automatic) | Enter | fps (idle / walking / orbiting) | CPU per frame |
|---|---|---|---|---|
| Small street | light | 8.9 s | 5.3 / 5.0 / 4.5 | 63–190 ms |
| Palm Terrace | light | 8.2 s | 5.1 / 5.0 / 4.0 | 71–206 ms |
| Coral Bay Nights | light | 8.8 s | 5.3 / 5.0 / 4.5 | 76–219 ms |

Software rendering is not a supported way to play. It is what keeps the browser tests honest on GPU-less runners. The controller integrates real elapsed time, so movement speed is right even at 5 fps. The CI run of the four Phase 8A tests took about 8.8 minutes.

## Bundle

- The main chunk is unchanged in kind: `index` 1,125 kB (344 kB gzip). It carries only the small pure modules: spawn, collision and coordinates.
- Three.js, the art modules and the engine are a separate lazily loaded chunk: `ImmersiveView` 781 kB (214 kB gzip), downloaded the first time someone enters the world.

## What keeps it fast

- Models are built once and shared; meshes merge per material, with colours in vertex attributes; roughness and metalness are bucketed.
- Roads and decor are instanced per 12-tile chunk; frustum culling plus distance culling (fog hides the edge); ground cover only nearby.
- One shadow map that follows the character; small props skip it.
- Scene build in time slices; shaders compiled during loading.
- Only one renderer and one frame loop exist at a time (the Pixi ticker is stopped).
- Commits run at about 4 per second, and each clones only the player.

Reproduce with `node scripts/p8a_benchmark.mjs [url]`, adding `--software` for SwiftShader or `--quick` for shorter samples.
