# Limitations and next steps

What Phase 8B does not do, stated plainly. Nothing below is claimed as complete.

## Not in scope (by the phase's own limits)

- **Interiors.** Buildings are solid. Residents inside a building, an indoor venue, a car or a bus are counted (`hidden`), not shown. The inspector says so ("Interiors come later").
- **First-person view, multiplayer, One World, AI NPC dialogue.** Not started. Resident conversations are the existing Life Mode Greet and Chat commands.
- **New economy, road or transport engines.** None. The view reuses Phases 5–7 as they are.

## Known limitations

- **Distant residents.** At most 60 residents (30 on low quality) are drawn, the nearest within 26 tiles (18). Farther residents exist and keep living but are not drawn. Vehicles: 90 within 34 tiles (40 within 24).
- **Walkers use the road tile's sidewalk band.** Phase 3 routes run along tile centres. The 3D view offsets walkers 0.36 tiles to the right of their heading. At junctions and while turning, a figure can briefly cross the carriageway corner, exactly where the simulated route turns. There are no pedestrian crossings or traffic lights in the simulation, so none are invented.
- **Residents and vehicles are not solid for the character.** The character's collision covers lots, furniture, shelters and the map edge. Solid moving actors would let the renderer push the simulation, which 8B forbids.
- **Venue light follows night, not opening hours.** Signs and festoons glow after dark. Windows use the City View's per-building `windowsOn` schedule. Opening hours are shown in the inspector, not in the lighting.
- **Models are detailed on their street faces.** The bake's models are designed for the isometric south and east views (8A). Their back faces are simpler.
- **Bus signs** float above the bus and can be cut off at the screen edge when the bus is very close.
- **Software rendering** (SwiftShader, CI only) runs at 5–10 fps at every city size, and entering takes about 9 s. Hardware GPUs run at 53–60 fps ([performance.md](performance.md)).
- **Motion videos** begin with the "Entering the world" loading card, because recording starts when the page opens. No ffmpeg was available to trim them.
- **No touch controls** (as in 8A).
- **Player recovery after edits is the simulation's.** If an edit removes the road under the character, `reconcilePlayer` moves them to the nearest road (for example 42.5 → 41.5), and the view follows that position. It never picks a spot itself.

## Next (from the 8A roadmap)

- **8C:** collision with residents and vehicles (designed so the simulation stays the authority) and further 3D interaction prompts on the same Life commands.
- **8.5:** playable interiors, so hidden residents can be seen inside.
- **Phase 9:** first-person camera.
- Not yet assigned to a phase: touch controls, and venue lights driven by opening hours.
