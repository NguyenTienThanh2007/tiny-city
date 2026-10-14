# Life Mode camera and UX (Phase 4.6)

## City View and Life View

These are two camera experiences in the same isometric game. They share one simulation, one renderer and one
camera.

| | City View | Life View |
|---|---|---|
| For | building, planning, roads, the AI Architect, overviews | living as the character |
| Framing | the neighbourhood framing (Center neighborhood), free pan and zoom | close on the character: zoom 1.85 (1.45 on phones), character centred in the visible area |
| Follow | off | on by default |
| Character figure | ~20 px | ~45 px, readable next to the houses around them |

- **Entering Life View:**
  - Life View starts when Life Mode is entered and the character is in the world: after creating them and moving
    in, when returning from Build, Plan or Live, and after a reload.
  - The City View camera is remembered.
  - The camera glides to the character's real position, taken from the simulation and never invented. It tracks
    them if they move during the glide, then Follow takes over.
- **No placed character:** if the character is waiting for a home, or there is none, the camera stays where it is,
  and Focus and Follow are disabled with an explanation ("Mai has not moved in yet").
- **Switching back:**
  - Leaving Life Mode, or choosing **City view**, glides back to the remembered City View camera.
  - **Center neighborhood** frames the whole neighbourhood and also switches to City View.
- **Remembered zoom:** a zoom chosen while in Life View becomes the Life View zoom from then on. It's a per-viewer
  preference, never part of a save.
- **What switching keeps:** switching never recreates the world. Gameplay state, the character, city edits and
  simulation time are untouched (e2e F compares the save before and after three full mode cycles).

## Controls (one place)

All camera controls live in the map tools, next to zoom and the minimap. The duplicate Focus and Follow buttons were
removed from the Life panel and the Life HUD strip.

- **Character camera** (Life Mode only):
  - `Life view` / `City view`: a two-button switch; `aria-pressed` marks the current view.
  - `Focus` ("Focus on your character"): glides to the character's real position, keeping the current zoom
    unless it's too far out to read (below 1.2), in which case it uses the Life View zoom. Focus is one-shot and
    never turns Follow on or off.
  - `Follow` / `Following` ("Follow your character", `aria-pressed`): turning it on glides onto the character and
    then follows. The pressed state always mirrors the camera's real follow state.
- **Camera** (all modes, desktop): Zoom in, Zoom out, Center neighborhood.
- **Pointer:**
  - Scroll or pinch to zoom at the cursor.
  - Drag with the select tool (Build and Life) to pan. A press only counts as a click if the pointer moves less
    than 6 px (10 px on touch).
  - Shift-drag, or the right or middle button, pans with any tool.
  - On phones, two fingers pinch-zoom and pan.
- **Phone:** the character camera block sits above the minimap, full width, with labelled buttons.

### Rules that keep controls from fighting

| Action | Effect on Follow | Effect on other motion |
|---|---|---|
| Drag / pan | ends Follow (button shows "Follow") | cancels any glide or zoom animation |
| Wheel or button zoom | keeps Follow; zoom is anchored on the character, not the cursor | cancels a glide (unless following) |
| Focus | unchanged | replaces any glide |
| Follow on | on | glides onto the character, then follows |
| City view / Center neighborhood | off | glides to the overview |

Follow uses frame-rate-independent smoothing (`1 − exp(−dt/140 ms)`).

- It behaves the same at 20 and 60 fps (unit-tested).
- It trails a walking character by speed × 140 ms, well under a screen pixel per frame of jitter.
- It stops exactly on a standing character, so a still character means a still camera.
- At 4× it trails proportionally further behind but still keeps the character in view.
- It never changes positions and never drives simulation time.

## Finding the character

- **Marker:**
  - At normal Life View zoom the character has the 3.0C ring and "you" chevron. These are unchanged and slightly
    larger than residents.
  - Inside a building, a pin marks the building.
- **Off-screen locator:**
  - When the character is outside the visible area, or hidden under a HUD card (the dock or the map tools), a round
    terracotta button sits on the edge of the visible area, pointing at them ("Your character is off screen · show
    them"). Clicking it focuses the character.
  - It is a DOM button the renderer positions each frame (no React render). It avoids the map controls and stays
    above the HUD cards.

## Nearby residents

- **Who gets a tag:** in Life View, at readable zoom, up to three residents outdoors within 5 tiles of the
  character get a small, quiet name tag.
- **Stacking:** tags stack instead of overlapping, and never cover the character.
- **Hover and selection:** the hovered or selected resident keeps the full nameplate.
- **Panel list:** the "Nearby residents" list in the Life panel is unchanged.
- **Data:** tags show only names of residents the simulation actually has nearby.
- **Cost:**
  - Membership is recomputed every 300 ms; tags only move per frame.
  - Text and background are redrawn only when a name changes. At most three Pixi `Text` objects exist.

## Panels and the visible area

The camera centres the character in the part of the canvas no panel covers. This is measured from the real layout:
the side panel open or collapsed, the phone sheet, the Life strip, the top bar and the dock.

- **Panel opens or closes:** the picture does not move. With Follow on, the camera re-centres the character in the
  new area smoothly (e2e I).
- **Resizing:** desktop → laptop → 1024 → phone keeps the character centred.

## Interactions kept

The following are unchanged and covered by the existing life-mode, living-world and phase-4-5 e2e specs:

- click-to-walk
- clicking a resident (profile and Interact)
- clicking a building (place card)
- home selection (highlighted homes; the camera glides to each)
- activities
- needs and the daily routine display
- the diary

Picking goes through the single camera transform at every zoom.
