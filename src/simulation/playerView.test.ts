import { describe, expect, it } from 'vitest';
import { createWorld, Simulation } from '@tiny-city/simulation';
import type { BuildingType, SimulationEvent, WorldState } from '@tiny-city/simulation';
import { BUILDING_CATALOG } from '@tiny-city/simulation';
import { DEFAULT_APPEARANCE } from '../game/playerLook';
import { describePlayer, emptyPlayerLog, interactionLine, needWord, reducePlayerLog, rejectionText, remainingTiles } from './playerView';

const building = (id: string, type: BuildingType, x: number, y: number) => ({ id, name: id === 'home' ? 'Lagoon Villa' : id === 'park' ? 'Sunny Park' : 'Harbor Office',
  type, kind: BUILDING_CATALOG[type].kind, capacity: BUILDING_CATALOG[type].capacity, position: { x, y }, footprint: BUILDING_CATALOG[type].footprint });
function world(): Simulation {
  const sim = new Simulation(createWorld({ id: 'view', seed: 'view', clock: { paused: true }, startingFunds: 100,
    plan: { id: 'p', name: 'p', width: 30, height: 12, roads: Array.from({ length: 24 }, (_, i) => ({ x: i + 2, y: 4 })), blockedTiles: [],
      buildings: [building('home', 'villa', 2, 5), building('park', 'park', 8, 5), building('office', 'office', 16, 5)] } }));
  sim.executeLife({ type: 'player.create', name: 'Mai', appearance: DEFAULT_APPEARANCE, homeBuildingId: 'home' });
  return sim;
}

describe('player presentation', () => {
  it('describes idle, travelling and performing states from authoritative data', () => {
    const sim = world();
    expect(describePlayer(sim.getPlayer()!, sim.getState())).toMatchObject({ headline: 'At home · Lagoon Villa', phase: 'idle' });
    sim.executeLife({ type: 'player.start-activity', activity: 'visit' });
    const travelling = describePlayer(sim.getPlayer()!, sim.getState());
    expect(travelling).toMatchObject({ headline: 'Walking to Sunny Park', phase: 'travelling' });
    expect(travelling.detail).toBe(`${remainingTiles(sim.getPlayer()!)} tiles to go`);
    for (let i = 0; i < 100 && sim.getPlayer()!.activity.phase !== 'performing'; i += 1) sim.step();
    sim.step(6);
    expect(describePlayer(sim.getPlayer()!, sim.getState())).toMatchObject({ headline: 'Enjoying Sunny Park', phase: 'performing', detail: '6 of 60 min' });
  });

  it('builds a short diary from events and ignores unrelated ones', () => {
    const sim = world();
    const state: WorldState = sim.getState();
    const created: SimulationEvent = { type: 'player.created', tick: 0, player: state.player! };
    const log = reducePlayerLog(emptyPlayerLog, [created], state);
    expect(log.entries[0]).toMatchObject({ tone: 'good', text: 'Mai moved into Lagoon Villa.' });
    expect(reducePlayerLog(log, [{ type: 'clock.ticked', tick: 1, day: 0, minuteOfDay: 1 }], state)).toBe(log);
    const ended: SimulationEvent = { type: 'player.activity-ended', tick: 2, outcome: { kind: 'rest', result: 'cancelled', reason: null, tick: 2, buildingId: 'home', citizenId: null, elapsedMinutes: 12 } };
    const low: SimulationEvent = { type: 'player.need-changed', tick: 3, need: 'hunger', level: 'low', previous: 'fair', value: 29 };
    const next = reducePlayerLog(log, [ended, low], state);
    expect(next.entries.map((e) => e.text)).toEqual(['Hunger: hungry. Eat at home.', 'Resting cancelled after 12 min.', 'Mai moved into Lagoon Villa.']);
  });

  it('phrases interactions only from the resident’s real home, work and destination', () => {
    const sim = world();
    sim.enablePopulation({ maxCitizens: 10 });
    const resident = sim.getState().citizens[0]!;
    const line = interactionLine('introduction', resident, sim.getState());
    expect(line).toContain(resident.name);
    expect(line).toContain('Lagoon Villa');
    expect(line).toContain('Harbor Office');
    expect(interactionLine('commute', undefined, sim.getState())).toBe('You chatted for a moment.');
  });

  it('explains every rejection and need level in plain language', () => {
    for (const text of Object.values(rejectionText)) expect(text.length).toBeGreaterThan(10);
    expect(needWord('energy', 'critical')).toBe('Exhausted');
    expect(needWord('social', 'good')).toBe('Connected');
  });
});
