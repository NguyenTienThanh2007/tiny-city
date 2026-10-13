# Visual World 3.0C: Lighting and atmosphere

## Approach (hybrid)

Buildings, trees and characters are baked with one fixed sun direction (upper left). At runtime the day cycle adds:

1. a **container tint** per daypart (terrain, ground, roads, buildings, decor);
2. a **sun strength** that fades the baked ground shadows (`shadowLayer.alpha = 0.2 + 0.8 · sun`);
3. a **glow** that reveals baked window emissive frames, lamp pools and building light spill.

No full-screen overlays, post-processing or bloom are used, so it stays cheap and readable. A real-time
directional shadow would contradict the baked shading, so shadow *direction* does not change through the day
(documented limitation).

## Keyframes (`src/game/lighting.ts`)

| Time | Tint | Glow | Sun | Intent |
|---|---|---|---|---|
| 00:00–04:36 | `#8590c2` | 1 | 0 | Moonlit, lifted night: every channel above 50 % keeps roads and residents visible |
| 05:36 | `#b8a9c9` | 0.7 | 0.15 | Blue hour |
| 06:24 | `#ffdcbc` | 0.18 | 0.6 | Fresh golden sunrise |
| 07:18 | `#fff2e2` | 0 | 0.95 | Soft warm morning |
| 09:00–15:48 | `#ffffff` | 0 | 1 | Clear, neutral midday |
| 17:12 | `#ffe7c4` | 0.03 | 0.97 | Warm afternoon |
| 18:24 | `#ffcf9f` | 0.25 | 0.75 | Golden hour: amber but not orange-washed |
| 19:18 | `#e2ad9e` | 0.62 | 0.35 | Sunset |
| 20:12 | `#a79bc6` | 0.9 | 0.08 | Violet dusk |
| 21:12 | `#8590c2` | 1 | 0 | Night |

Interpolation uses smoothstep within each segment. A unit test sweeps every minute of the day and asserts no
channel jumps by more than 3/255 per minute, and that glow and sun never jump by more than 0.03.

## Night

- **Windows:** baked emissive frames (homes about 62 % lit; shopfronts, signs and lanterns lit). `windowsOn()`
  varies them over the night, deterministically per building. Each home picks a bedtime between 23:00 and 01:30
  and fades to 15 % over 20 minutes, waking between 05:30 and 06:30. Shops and offices fade to a security light
  from 21:40 to 22:00. The clubhouse stays lively until about midnight. This is checked every 0.4 s, not per
  frame, and there's no flicker.
- **Street lamps:** soft eight-ring warm pools on the pavement and a bright lamp head (additive, `glow` alpha).
- **Building spill:** `AmbientLayer` draws soft warm pools in front of each lit building's visible facades. Size
  and strength come from `VENUE_FX`: mall about 2.2 tiles, clubhouse 1.4 and offices cool 1.5; homes are subtle.
  The pools sit on the ground under walkers and buildings.
- **Residents** are lifted halfway towards white (`liftTint`), so they remain recognisable in the dark.

## Ambient motion

| Effect | Where | Cost control |
|---|---|---|
| Foliage sway | Trees, accent trees, street trees, palms (`DecorLayer.sway`): slow skew about the trunk base, out of phase | Only on-screen trees, only at zoom ≥ 0.32, off under reduced motion |
| Pool shimmer | 9 twinkling sparkles per pool over the lane-pool water, in the depth-sorted scene | Daylight only (`sun > 0.3`), fixed count |
| Fireflies | 7 per park at night, slow drift, additive | Night only (`glow > 0.4`), fixed count |
| Window life | See Night | Throttled |

`prefers-reduced-motion: reduce` freezes sway, sparkles, fireflies, idle breathing and walk-in animation. The
static lighting and poses stay.

## Extensibility

`VENUE_FX` is keyed by building type. Future venues add light pools, sparkles, fireflies or the reserved
`stageLights` (coloured beams) without renderer changes. Only buildings that exist in the plan receive effects.
