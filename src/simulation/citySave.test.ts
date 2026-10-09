import { describe, expect, it } from 'vitest';
import { Simulation } from '@tiny-city/simulation';
import { initialCity } from '../data/initialCity';
import { createCityWorld, projectCity } from './cityAdapter';
import { loadCitySave, saveCity, SAVE_KEY } from './citySave';

describe('compatible browser saves', () => {
  it('loads a valid Phase 1 snapshot as authority even when legacy top-level fields are stale', () => {
    const simulation = new Simulation(createCityWorld(initialCity));
    simulation.execute({ type: 'city.edit-roads', add: [{ x: 40, y: 40 }], remove: [] });
    const city = projectCity(simulation.getState(), initialCity);
    saveCity(localStorage, city, simulation.getState());
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    raw.funds = 0;
    raw.roads = [];
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadCitySave(localStorage);
    expect(loaded.world).toEqual(simulation.getState());
    expect(loaded.city.funds).toBe(initialCity.funds - 8);
    expect(loaded.city.roads).toContainEqual({ x: 40, y: 40 });
    expect(loaded.world.budget.totalSpent).toBe(8);
  });

  it('migrates Phase 0 schema-1 snapshots in v2 envelopes without losing time or editor metadata', () => {
    const legacy = JSON.parse(JSON.stringify(createCityWorld(initialCity)));
    legacy.schemaVersion = 1;
    delete legacy.budget; delete legacy.revision; delete legacy.nextBuildingId;
    delete legacy.plan.roads; delete legacy.plan.blockedTiles;
    for (const building of legacy.plan.buildings) delete building.type;
    legacy.clock.tick = 123;
    legacy.clock.accumulatedMs = 40;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...initialCity, saveVersion: 2, simulation: legacy }));
    const loaded = loadCitySave(localStorage);
    expect(loaded.city).toEqual(initialCity);
    expect(loaded.world.clock).toEqual(legacy.clock);
    expect(loaded.world.schemaVersion).toBe(2);
    expect(loaded.world.budget).toEqual({ openingBalance: initialCity.funds, balance: initialCity.funds, totalSpent: 0 });
    expect(loaded.world.plan.roads).toEqual(initialCity.roads);
    expect(loaded.world.plan.buildings[0]?.type).toBe('villa');
  });

  it('rejects saving stale view funds and preserves Phase 1 ID/ledger state on reload', () => {
    const simulation = new Simulation(createCityWorld(initialCity));
    simulation.execute({ type: 'city.build', buildingType: 'park', position: { x: 40, y: 40 } });
    const city = projectCity(simulation.getState(), initialCity, 12345);
    expect(() => saveCity(localStorage, { ...city, funds: 0 }, simulation.getState())).toThrow(/budget/);
    saveCity(localStorage, city, simulation.getState());
    const restored = new Simulation(loadCitySave(localStorage).world);
    expect(restored.execute({ type: 'city.build', buildingType: 'park', position: { x: 46, y: 40 } }).state.plan.buildings.at(-1)?.id).toBe('building-2');
    expect(restored.getState().budget.totalSpent).toBe(160);
    expect(loadCitySave(localStorage).city.buildings.at(-1)?.createdAt).toBe(12345);
  });

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
    expect(raw.saveVersion).toBe(3);
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
    expect(() => saveCity(localStorage, initialCity, createCityWorld(otherCity))).toThrow(/layouts.*must match/);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });
});
