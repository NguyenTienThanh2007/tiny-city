# Visual World 3.0C: Animation system

## Principles

- **The simulation is authoritative.** Figures read `WorldState` and never write it. Positions are blended between
  the two latest fixed ticks, as in Phase 3B, and animation never moves a resident's simulated coordinates.
- **One figure per real resident.** No decorative crowds are invented. Activity poses only show what the
  simulation is actually doing.
- **No synchronised loops.** Idle timing and glances come from each resident's stable ID.

## Runtime pieces

| Module | Role |
|---|---|
| `art/characterLook.ts` | Pure functions: `citizenLook`, `lookFromAppearance`, `characterLayers`, `frameName`, `facingFor` and `selectPose` |
| `art/characterRig.ts` | `CharacterRig`: one sprite per layer from the character atlas; textures change only when the frame changes |
| `npcLayer.ts` | Residents: motion blending, lanes, facing, poses, venue visitors, interaction poses, picking, rings and badges |
| `playerLayer.ts` | The player: the same rig from the saved appearance; walking, greeting and chatting poses; venue spot; follow focus |
| `venueCrowd.ts` | Real park, pool and terrace visitors → deterministic spots and actions (`VENUE_PROFILES`) |
| `npcMotion.ts` | `lotDepths` and `figureDepth`: figures inside a lot sort above its opaque plate |

## Pose selection (`selectPose`)

| State (real data) | Pose |
|---|---|
| Travelling (status `travelling` and actually displaced) | `walk`, 8 frames. The frame comes from the walk phase, which advances with displacement (2.6 strides per tile), so speed changes the cadence, pausing freezes mid-stride and nothing slides. |
| Standing, waiting, or outdoors but stationary | `idle`: breathing frames 0/1 at a per-resident period (1.4–2.1 s), plus a glance left or right (frames 2/3) for about 0.9 s every 7–11 s, offset by ID |
| Player greeting a resident (`player.activity.kind = 'greet'`, phase `performing`) | Player `wave`; the resident `wave` and turns to face the player when standing |
| Player chatting (`socialize`) | `talk` for both, facing each other |
| Park, pool or terrace visitor (status `inside` the venue, activity `leisure`) | At their venue spot: `talk` when the partner slot is filled by another real visitor, otherwise `idle`; some spots `sit` on the lawn or loungers. They walk in from where they were last seen. |
| Player visiting a park or pool | Standing at the venue's player spot (never on the fountain or pavilion) |
| Reduced motion | Frame 0 of the pose and no walk-in: an instant, still placement |

**Facing.** Two facings are baked: `front` (screen down-right) and `back` (screen up-right). The two others are
mirrors. Stationary figures keep their last horizontal direction and face the camera.

**Start and stop.** Idle frame 0 and walk frames 0/4 share the neutral contact silhouette, so starting and stopping
reads naturally without a blend.

## Spatial correctness

- Sprites anchor at the feet (`iso(x, y)`). The contact shadow is drawn at the same origin.
- Depth: `x + y` (as for buildings and trees in one sorted container), raised above a lot the figure stands inside
  (entrance paths, walk-ins) and above a venue's sprite for its visitors.
- Venue spots avoid baked trees, water, beds and the centrepiece silhouette. Spots behind the venue centre keep a
  screen-lateral offset of at least 1.2 tiles (unit-tested).
- Picking, selection ring, hover ring and activity badge are unchanged, and tested across zoom levels.

## Future hooks (Phase 7)

`VENUE_PROFILES` (crowd spots and actions) and `VENUE_FX` (light pools, sparkles, fireflies, reserved
`stageLights`) are the extension points for café, shopping street, concert stage, night market, cinema, amusement
park, music club and performance plaza. Shopping or performing poses should only be added together with the
simulation activities that drive them.
