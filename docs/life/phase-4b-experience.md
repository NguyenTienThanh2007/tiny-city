# Phase 4B Playable Life experience

Life Mode is a fourth tab beside **Build · Plan · Live**. The first three keep their behavior:
- **Build** edits the city;
- **Plan** is the AI Architect;
- **Live** observes residents without a character.

**Life** is where you control your own character. Everything shown comes from the authoritative world snapshot.
Screenshots referenced below are in `docs/life/screenshots/` and were captured with `node scripts/capture_life.mjs`
(sample city, real UI interactions) and reviewed.

## Entry and onboarding

1. **No character yet** (`01-life-entry`): an intro card explains walking, needs and neighbours. **Create character**
   opens the creator. Live mode still works without a character, and nothing is created automatically.
2. **Character Creator** (`02`, `03`, `15`): a modal on a solid ivory surface, with no blur over the WebGL canvas.
   - Name input with inline validation: 1–24 letters, numbers, spaces, `'`, `.`, `-`; Vietnamese diacritics are
     supported.
   - Swatches for skin tone, hair color and outfit color.
   - Choice chips for hairstyle, outfit and accessory.
   - All controls are native radio inputs, so they are keyboard and screen-reader accessible.
   - **Suggest a look** gives a deterministic suggestion; Cancel and Escape close the creator.
   - The live preview uses `src/game/playerLook.ts`, the same shape list the Pixi layer draws. The creator, the
     in-world sprite, the HUD portrait and the profile therefore show the same person. The preview has a gentle walk
     cycle, static under reduced motion.
3. **Choose a home** (`04`, `16`, `19`):
   - The side panel lists every home with real `residents / capacity` and a chip: Free room, Full, Your home or No
     road.
   - On the map, eligible homes get green floating badges, full homes grey ones, and the selected home a gold
     bobbing badge.
   - Clicking a home on the map or in the list focuses the camera there.
   - A confirm card explains the occupancy rule, warns when the home has no road, and offers to welcome residents
     too (checked by default when none live there yet).
   - With no free room, the picker says so and offers **Build a home**, which opens Build mode with the villa tool.
   **Full-housing recovery** (`16`, `22`–`24`):
   1. The character is created when you continue from the creator and is saved while waiting.
   2. With no free room, the picker explains why, shows the real counts ("20 of 20 rooms taken in 10 homes"), says
      residents are never moved out, and offers **Build a home**.
   3. In Build mode a **Back to home selection** chip ("Mai needs a home") stays visible, and the Life tab title
      reads "Choose a home for Mai".
   4. Once a build frees a room (the engine holds one for the waiting character), a notice names the home, and the
      chip shows the free room count.
   5. Back in home selection, new homes are listed first with a **New** chip and a gold halo badge on the map.
   6. Confirm, then move in to spawn and play. No restart or save editing is needed. On phones, Build mode opens with
      the map visible.
4. **First spawn** (`05`): the character appears inside their home, shown by a terracotta pin over the roof. Time
   resumes, the camera focuses, and a welcome toast explains the controls.

## Controls

- **Click a road** to walk there. Valid clicks get a green ring pulse; invalid ones a red cross and a toast:
  - "You can only walk on roads and paths."
  - "No road connects you to that place."
  - "There is no road near you…"
- Hovering shows a green or red tile and a label such as "Walk here", "Meet Kim 7" or "Coastal Park · Visit or walk
  here".
- **Click a building** to open a contextual place card (no instant action):
  - own home: Walk here, Rest, Eat;
  - park, pool or clubhouse: Visit, Walk here;
  - a home with a free room: Walk here, Move in here;
  - anything else: Walk here (stops at the curb).
- **Click a resident**, or use **Nearby residents**, to open their real profile with an **Interact** section: Greet
  (5 min) and Chat (30 min). It shows whether you have met and live progress. Interacting from Live mode switches to
  Life mode and keeps the profile open.
- **Click your character** (or the HUD portrait) to return to your profile. Clicking the character in another mode
  opens Life mode.
- Build shortcuts are disabled in Life mode. The build tool rail and AI composer step aside, so world clicks cannot
  place, paint, move or bulldoze. Space still pauses, and Escape clears selections.
- **Camera:**
  - Follow is on when you enter Life mode, and the camera eases after the character.
  - Panning, Center neighborhood or the minimap stop following.
  - Focus re-centers on the character, and the HUD eye button toggles follow.

## Life HUD

- **Side panel** (`08`, `11`, `12`, `14`):
  - portrait, name and home, with Edit look and Change home;
  - a live status card (headline, detail, progress bar, Cancel) and a paused-time hint;
  - four need meters with values and words such as Rested, Peckish, Lonely or Gloomy (`role="meter"` with
    `aria-valuetext`);
  - four action cards that show why they are unavailable ("Already home", "Too tired", "No park yet");
  - Focus and Follow, nearby residents, and a diary of recent outcomes, meetings and need warnings.
- **Compact strip** (bottom left; two rows on phones, `20`): portrait, name, status, four mini meters, Cancel and
  Follow. It keeps the world visible when the side panel is collapsed.
- **Path and markers:**
  - The walking route is drawn as a dashed terracotta line to a pulsing destination ring.
  - Destination or venue buildings are outlined.
  - A terracotta chevron floats above the character, with a pulsing ring at their feet.
  - Residents keep their gold selection style, so you and a selected resident are never confused.

Action states are distinct:
- available: card;
- unavailable: muted card plus reason;
- travelling: amber pulsing dot plus "N tiles to go";
- performing: green dot plus progress;
- completed or cancelled: a diary entry;
- failed: a diary entry plus a warning toast, for example "Chatting stopped: they had to go."

## Visual design

- Native to Visual World 2.0: ivory panels, sage and deep green, terracotta accents, Fraunces display type, and
  shadows and tokens from `src/styles.css`.
- The character is a chibi-proportioned figure 12% larger than residents, with a silhouette outline and walk cycle.
  The night tint applies to the figure but not to its markers.
- Characters in open-air venues (park, pool) stand visibly inside. In homes and the clubhouse, a pin shows where
  they are.
- Animations are short and restrained. `prefers-reduced-motion` stops bobbing, pulses and the preview walk cycle.
- Responsive layouts:
  - desktop: side panel plus strip;
  - tablet (`17`): the top bar compacts for four tabs;
  - phone (`18`–`21`): full-screen creator, bottom-sheet panels, icon tabs with accessible names, and a two-row HUD.

## Save, load and resume

- Save stores the player inside the existing simulation snapshot: identity, appearance, home, position, route,
  activity progress, needs, acquaintances and last outcome.
- After a reload, the Life tab says **Continue life as <name>**, and the character resumes exactly where they were.
- Phase 3 and earlier saves load unchanged with no character.
- A corrupt player rejects the simulation snapshot, so the save loader recovers the city layout with a notice, and the
  original save is untouched until you save again.
- Save failures show a notice and keep all in-memory progress.

## Limits (honest scope)

- Conversations are short template lines built from the resident's real home, work and destination. There is no
  free-form AI dialogue and no relationship economy beyond "met".
- Eating happens only at home; the catalog has no food service buildings.
- No keyboard movement. Routes always follow roads, so a key-driven mode was left out rather than risk bypassing
  collision rules.
- Residents allocate leisure venues by building-ID order (Phase 3 behavior), so in the sample city evening crowds go
  to the clubhouse first.
