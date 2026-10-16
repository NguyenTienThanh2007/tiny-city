# Time and lighting

## One clock

The minute of day comes from `getGameTime(world.clock)` and nothing else. `skyState(minute)` (`three/atmosphere.ts`, on top of the City View's `worldLighting`) gives:

- the sky gradient;
- the sun direction, colour and intensity;
- the moon;
- hemisphere and environment light;
- fog colour;
- a night `glow` from 0 to 1.

The keyframes are smoothstep-interpolated. The unit test steps through all 1,440 minutes: glow changes by less than 0.05 and sun intensity by less than 0.15 per minute, the same minute on any day gives the same sky, and it passes through day → golden → dusk → night.

## What the light drives

| Element | Rule |
|---|---|
| Street lamps | Lamp heads' emissive = 2.2 × glow; instanced light pools on the ground (opacity = glow) |
| Windows | Each building's window materials = 1.6 × glow × `windowsOn(type, id, minute)` (the City View's per-building schedule); mid-level windows 1.3 × glow |
| Venue glow | Coloured night light on venues (`userData.glow` materials: signs, festoons, marquees) = 0.2 + 2 × glow |
| Vehicle lamps | Head and tail lenses brighten with glow |
| Sun shadows | Cast by near buildings (through proxies), trees and vehicles; off when the sun is down |

e2e test 3 starts at 18:40, where the view must agree with the saved minute and be in the golden phase. It runs at 4× until after 21:15, then checks that the phase is night with glow 1 and sun 0, and that lamps are above 2 and windows above 1. Smoothness is the unit test's job (above). Screenshots 12 (18:25) and 13 (21:50) and video `motion-day-night` (18:25 → 20:27 at 4×) show the transition.

## Pause and speed

- Paused: the clock stops and so does everything that follows it: residents, vehicles, light, idle animation. e2e test 2 checks that the drawn set and positions stay still while paused.
- The **1× / 2× / 4×** buttons in the Character View clock card set the same speed as the City View. Speed scales the time fed to the one clock and never ticks twice.
- A hidden tab never advances time (by design, as in the City View).
