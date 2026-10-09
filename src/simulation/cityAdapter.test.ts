import { describe, expect, it } from 'vitest';
import { Simulation, validateBuildingPlacement, validateWorld } from '@tiny-city/simulation';
import { initialCity } from '../data/initialCity';
import { BUILDINGS } from '../types';
import { createCityWorld, getRenderBuildings, plansMatch, projectCity, toCityPlan } from './cityAdapter';

describe('editor / public simulation contract integration', () => {
  it('projects authoritative roads, buildings, and funds while keeping only construction metadata', () => {
    const simulation = new Simulation(createCityWorld(initialCity));
    simulation.execute({ type: 'city.edit-roads', add: [{ x: 40, y: 39 }], remove: [] });
    simulation.execute({ type: 'city.build', buildingType: 'villa', position: { x: 40, y: 40 } });
    const view = projectCity(simulation.getState(), { ...initialCity, funds: 0, roads: [] }, 12345);
    expect(view.funds).toBe(initialCity.funds - 128);
    expect(view.roads).toContainEqual({ x: 40, y: 39 });
    expect(view.buildings.at(-1)?.createdAt).toBe(12345);
    expect(view.buildings[0].createdAt).toBe(initialCity.buildings[0].createdAt);
    expect(plansMatch(toCityPlan(view), simulation.getState().plan)).toBe(true);
  });

  it('models the existing coastal exclusion inside the authoritative plan', () => {
    const world = createCityWorld(initialCity);
    expect(world.plan.blockedTiles).toContainEqual({ x: 60, y: 60 });
    expect(validateBuildingPlacement(world, 'park', { x: 60, y: 60 })).toEqual({ valid: false, reason: 'blocked-tile' });
    expect(() => toCityPlan({ ...initialCity, size: Infinity })).toThrow(/dimensions/);
  });

  it('maps all editor kinds, stable IDs, footprints, and tile coordinates', () => {
    const plan = toCityPlan(initialCity);
    expect(plan.width).toBe(64);
    expect(plan.height).toBe(64);
    expect(plan.buildings.map((building) => building.id)).toEqual(initialCity.buildings.map((building) => building.id));
    for (const building of initialCity.buildings) {
      const mapped = plan.buildings.find((entry) => entry.id === building.id)!;
      expect(mapped.position).toEqual({ x: building.x, y: building.y });
      expect(mapped.footprint).toEqual({ width: BUILDINGS[building.kind].width, height: BUILDINGS[building.kind].height });
      expect(mapped.kind).toBe(building.kind === 'villa' ? 'home' : building.kind === 'clubhouse' ? 'workplace' : 'park');
    }
    expect(() => validateWorld(createCityWorld(initialCity))).not.toThrow();
  });

  it('renders public contract positions/names while preserving editor construction metadata', () => {
    const plan = toCityPlan(initialCity);
    const changed = { ...plan, buildings: plan.buildings.map((building, index) => index === 0 ?
      { ...building, name: 'Canonical name', position: { x: 40, y: 40 } } : building) };
    const rendered = getRenderBuildings(initialCity, changed);
    expect(rendered[0]).toEqual({ ...initialCity.buildings[0], x: 40, y: 40, name: 'Canonical name' });
    expect(initialCity.buildings[0].name).toBe('Villa 01');
    expect(plansMatch(plan, changed)).toBe(false);
    expect(plansMatch(plan, JSON.parse(JSON.stringify(plan)))).toBe(true);
  });

  it('preserves time, randomness, and pending command events while editing a city', () => {
    const simulation = new Simulation(createCityWorld(initialCity));
    simulation.resume();
    simulation.advance(150);
    const before = simulation.getState();
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'missing', position: { x: 0, y: 0 } });
    const nextCity = { ...initialCity, buildings: initialCity.buildings.slice(1) };
    simulation.execute({ type: 'city.demolish', buildingId: initialCity.buildings[0].id });
    expect(simulation.getState().clock).toEqual(before.clock);
    expect(simulation.getState().randomState).toBe(before.randomState);
    expect(simulation.advance(50).events[0]).toMatchObject({ type: 'command.rejected', reason: 'citizen-not-found', tick: 2 });
    expect(getRenderBuildings(nextCity, simulation.getState().plan)).toEqual(nextCity.buildings);
  });
});
