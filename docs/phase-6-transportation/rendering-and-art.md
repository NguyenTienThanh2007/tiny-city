# Rendering and art

## Art

Original procedural models (`scripts/art/vehicles/models.js`): compact, sedan, SUV, delivery van and a low-floor city
bus with soft rounded bodies, clearcoat paint, glass greenhouses, lamps, mirrors and wheels; plus a bus-stop shelter
(posts, glass panel, canopy, bench, round sign). Baked by the existing Three.js bake (`npm run bake:art -- --only=vehicles`)
with the game's 2:1 projection at 4× resolution, 16 headings (22.5°), as four layers:

- `body`: near-white paint, tinted at runtime (resident car colours, line colours);
- `detail`: glass, wheels, trim (other layers act as depth occluders, so layers composite exactly);
- `lights`: lamps and warm headlight pools on the road, pre-bloomed (drawn additively at night only);
- `shadow`: a soft ground shadow sheared along the scene sun.

One 2048 × 1520 page (330 frames). Review: `node scripts/art/vehicle-review.mjs`.

## Runtime (`transportLayer.ts`, `vehicleMotion.ts`)

- The front distance is interpolated between the two latest ticks (never the screen position), so vehicles always stay
  on their lane, including through corners. Corners are rounded by averaging the centre line ±0.32 tiles; vehicles
  keep 0.21 tiles to the right; the heading picks the nearest of 16 frames.
- Bodies and detail share the depth-sorted container with buildings and residents; shadows go in the shadow layer;
  lamps in one additive layer above the scene, faded by the scene's night glow. Culling uses the visible map area.
- Residents driving or riding are drawn as the vehicle; residents waiting at a stop stand at its shelter.
- Overlays: congestion per road tile (green/yellow/orange/red) and cut-off roads; bus lines along their real loops
  with stops; the selected vehicle's remaining route. Overlay state is view-only.
- Without the atlas, vehicles fall back to small vector bodies.
- `window.__tinyCityTransport` (debug) lists what is drawn; e2e compares it with the saved world.
