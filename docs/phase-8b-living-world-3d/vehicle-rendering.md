# Vehicle rendering

## Which vehicles

`drawableVehicles(world)` is every simulated vehicle on the road, excluding vehicles still `departing` (pulling out of a lot, as in the City View):

- residents' own cars (`car-<citizen>`);
- staffed malls' delivery vans;
- buses of player-created lines.

The 3D view creates none and removes none. The nearest 90 within 34 tiles are drawn (40 within 24 on low quality).

## Pose and motion

The City View's own motion model (`src/game/vehicleMotion.ts`): `routeOf`, `nextSample`, `sampleFront`, `vehiclePose`.

- The front distance along the stored route is interpolated between ticks and never extrapolated.
- The pose comes from the route geometry: lane offset, turning arcs at junctions, heading.
- Queues, junction reservations and congestion are the transport engine's. The renderer only shows them (screenshot 03, video `motion-cars-turning`).

## Models and draw calls

Each vehicle model (`scripts/art/vehicles/models.js`) is merged per (model, colour) into one vertex-coloured body geometry and one lamp geometry. All vehicles sharing a model and colour are a single `InstancedMesh` pair, so 90 vehicles cost a few dozen draw calls. Lamp lenses are unlit, and their brightness follows the night glow (head and tail lights at night).

## Buses and passengers

Each drawn bus carries a small sign sprite: its line name and its real passenger count, for example `Line 1 · 1 on board`, in the line's colour.

- Residents on a bus are trip phase `riding` and are never drawn walking. They are counted in `hidden.riding`, which equals the sum of the buses' `passengers` (e2e test 1).
- Residents waiting for a bus are drawn at the shelter (`at-stop`).
- When a bus picks them up they vanish from the shelter as their trip phase changes (screenshots 05 → 04, video `motion-bus-movement`).
