// Phase 8B showcase: Coral Bay Nights (scripts/p7_city.mjs: five architecture collections, an entertainment district,
// ~240 residents, a real bus line) with the player living in a Luxury Minimalist villa. Advanced by the real engine.
import { createWorld, serializeWorld, Simulation } from '@tiny-city/simulation';
import { coralBayNights, LINE_STOPS, toCityPlan } from './p7_city.mjs';

export const PLAYER = { name: 'Linh', appearance: { skinTone: 2, hairStyle: 'bun', hairColor: 1, outfit: 'jacket', outfitColor: 1, accessory: 'none' } };

/** The player's home: the Luxury Minimalist villa nearest the entertainment district (so a walk crosses districts). */
export function playerHome(city) {
  const villas = city.buildings.filter((b) => b.kind === 'villa' && b.design?.model?.startsWith('lm.villa'));
  return villas.sort((a, b) => Math.hypot(a.x - 44, a.y - 22) - Math.hypot(b.x - 44, b.y - 22))[0];
}

/**
 * Coral Bay Nights at `minute`, with the player at home in the Luxury Minimalist villa nearest the district. While the
 * engine runs to the moment, the player rests and eats at home with the real Life commands (every two hours, when
 * needed), so captures show a cared-for character rather than one left alone for days.
 */
export function livingCityAt(minute, { player = true, at = null, lead = 75 } = {}) {
  const city = coralBayNights();
  const sim = new Simulation(createWorld({ id: 'villa-gardens-world', plan: toCityPlan(city), seed: 'villa-gardens', clock: { paused: true },
    startingFunds: city.funds, economy: {}, transport: true, society: true }));
  const home = playerHome(city);
  if (player) {
    const created = sim.executeLife({ type: 'player.create', name: PLAYER.name, appearance: PLAYER.appearance, homeBuildingId: home.id });
    if (!created.applied) throw new Error(`player: ${created.reason}`);
  }
  sim.enablePopulation({ maxCitizens: 1000 });
  sim.executeTransport({ type: 'transport.create-line', stops: LINE_STOPS.map(([x, y]) => ({ x, y })), buses: 4 });
  // `at`: a road tile the player walks to (the real move-to command) `lead` minutes before the moment, so a capture
  // starts on the street where the scene is.
  const walkFrom = at ? Math.max(0, minute - lead) : minute;
  for (let t = 0; t < walkFrom; t += 120) {
    const p = sim.getState().player;
    if (p && p.activity.kind === 'idle') {
      if (p.needs.hunger < 65) sim.executeLife({ type: 'player.start-activity', activity: 'eat' });
      else if (p.needs.energy < 60) sim.executeLife({ type: 'player.start-activity', activity: 'rest' });
    }
    sim.step(Math.min(120, walkFrom - t));
  }
  if (at && player) {
    const moved = sim.executeLife({ type: 'player.move-to', destination: { type: 'tile', position: at } });
    if (!moved.applied) throw new Error(`move-to: ${moved.reason}`);
  }
  if (minute > walkFrom) sim.step(minute - walkFrom);
  sim.pause();
  const state = sim.getState();
  return { save: { size: city.size, funds: state.budget.balance, roads: city.roads, buildings: city.buildings, saveVersion: 3, simulation: JSON.parse(serializeWorld(state)) }, state, city, home };
}
