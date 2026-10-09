import { describe, expect, it } from 'vitest';
import { Simulation } from '@tiny-city/simulation';
import { initialCity } from '../data/initialCity';
import { createCityWorld } from './cityAdapter';
import { loadCitySave, saveCity, SAVE_KEY } from './citySave';

describe('compatible browser saves', () => {
  it('loads legacy v1 map data with a new paused simulation', () => {
    const legacy = { ...initialCity, funds: 1234 };
    localStorage.setItem(SAVE_KEY, JSON.stringify(legacy));
    const loaded = loadCitySave(localStorage);
    expect(loaded.city).toEqual(legacy);
    expect(loaded.world.clock.tick).toBe(0);
    expect(loaded.world.clock.paused).toBe(true);
  });

  it('roundtrips map metadata, clock remainder, pause state, and RNG', () => {
    const city = { ...initialCity, roads: [...initialCity.roads, { x: 40, y: 40 }], funds: 2345 };
    const simulation = new Simulation(createCityWorld(city));
    simulation.resume();
    simulation.advance(150);
    simulation.pause();
    saveCity(localStorage, city, simulation.getState());
    const loaded = loadCitySave(localStorage);
    expect(loaded.city).toEqual(city);
    expect(loaded.world).toEqual(simulation.getState());
    const resumed = new Simulation(loaded.world);
    resumed.resume();
    expect(resumed.advance(50).state.clock.tick).toBe(2);
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    expect(raw.size).toBe(64);
    expect(raw.saveVersion).toBe(2);
    expect(raw.buildings[0].createdAt).toBe(city.buildings[0].createdAt);
  });

  it.each(['corrupt clock', 'mismatched plan'])('preserves a valid map with a %s snapshot', (problem) => {
    const city = { ...initialCity, funds: 999 };
    const world = createCityWorld(city);
    const bad = problem === 'corrupt clock' ? { ...world, clock: { ...world.clock, tick: -1 } } :
      { ...world, plan: { ...world.plan, name: 'Another city' } };
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...city, saveVersion: 2, simulation: bad }));
    expect(loadCitySave(localStorage).city).toEqual(city);
    expect(loadCitySave(localStorage).world.clock.tick).toBe(0);
  });

  it.each(['invalid json', 'null road', 'unknown kind', 'duplicate id', 'out of bounds', 'infinite funds'])('falls back safely for %s', (problem) => {
    const invalid = {
      'invalid json': '{broken',
      'null road': JSON.stringify({ ...initialCity, roads: [null] }),
      'unknown kind': JSON.stringify({ ...initialCity, buildings: [{ ...initialCity.buildings[0], kind: 'alien' }] }),
      'duplicate id': JSON.stringify({ ...initialCity, buildings: [initialCity.buildings[0], initialCity.buildings[0]] }),
      'out of bounds': JSON.stringify({ ...initialCity, buildings: [{ ...initialCity.buildings[0], x: 100 }] }),
      'infinite funds': JSON.stringify({ ...initialCity, funds: Infinity }),
    }[problem]!;
    localStorage.setItem(SAVE_KEY, invalid);
    expect(loadCitySave(localStorage).city).toEqual(initialCity);
  });

  it('handles unavailable storage and propagates failed writes to the UI', () => {
    const storage = {
      getItem: () => { throw new Error('Unavailable'); },
      setItem: () => { throw new Error('Quota exceeded'); },
    };
    expect(loadCitySave(storage).city).toEqual(initialCity);
    expect(() => saveCity(storage, initialCity, createCityWorld(initialCity))).toThrow('Quota exceeded');
  });

  it('refuses to save mismatched map/simulation layouts', () => {
    const otherCity = { ...initialCity, buildings: [] };
    expect(() => saveCity(localStorage, initialCity, createCityWorld(otherCity))).toThrow(/layouts must match/);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });
});
