import { describe, expect, it } from 'vitest';
import { footprintPerimeter, footprintTiles, OccupancyGrid } from '../src/index.js';
import { cityFixture, testHome } from './cityFixture.js';

describe('occupancy grid', () => {
  it('indexes every footprint tile, roads, blocked tiles, and vacant tiles', () => {
    const grid = new OccupancyGrid(cityFixture({ buildings: [testHome], roads: [{ x: 3, y: 4 }], blockedTiles: [{ x: 15, y: 15 }] }).plan);
    for (const position of footprintTiles(testHome)) expect(grid.get(position)).toEqual({ type: 'building', buildingId: 'existing-home' });
    expect(grid.get({ x: 3, y: 4 })).toEqual({ type: 'road' });
    expect(grid.get({ x: 15, y: 15 })).toEqual({ type: 'blocked' });
    expect(grid.get({ x: 0, y: 0 })).toBeNull();
    expect(Object.isFrozen(grid.get({ x: 4, y: 4 }))).toBe(true);
    expect(Object.isFrozen(grid)).toBe(true);
  });

  it.each([{ x: -1, y: 0 }, { x: 16, y: 0 }, { x: 0, y: 16 }, { x: 1.5, y: 0 }, { x: NaN, y: 0 }])('does not accept invalid grid position %j', (position) => {
    const grid = new OccupancyGrid(cityFixture().plan);
    expect(grid.isInBounds(position)).toBe(false);
    expect(grid.get(position)).toBeNull();
  });

  it('rejects duplicate and overlapping authored roads/buildings/blocked tiles', () => {
    const plan = cityFixture({ buildings: [testHome] }).plan;
    expect(() => new OccupancyGrid({ ...plan, roads: [{ x: 4, y: 4 }] })).toThrow(/overlapping/);
    expect(() => new OccupancyGrid({ ...plan, buildings: [testHome, { ...testHome, id: 'other' }] })).toThrow(/overlapping/);
    expect(() => new OccupancyGrid({ ...plan, roads: [{ x: 0, y: 0 }, { x: 0, y: 0 }] })).toThrow(/overlapping/);
    expect(() => new OccupancyGrid({ ...plan, roads: [{ x: 0, y: 0 }], blockedTiles: [{ x: 0, y: 0 }] })).toThrow(/overlapping/);
  });

  it('rejects overflowing footprints and oversized maps before allocating tile collections', () => {
    const plan = cityFixture().plan;
    expect(() => new OccupancyGrid({ ...plan, width: 1_000_001 })).toThrow(/dimensions/);
    expect(() => new OccupancyGrid({ ...plan, buildings: [{ ...testHome, position: { x: 15, y: 15 } }] })).toThrow(/footprint/);
    expect(() => footprintTiles({ ...testHome, footprint: { width: 2, height: Infinity } })).toThrow(/footprint/);
  });

  it('computes a perimeter without counting diagonals or interior tiles', () => {
    const perimeter = footprintPerimeter(testHome);
    expect(perimeter).toHaveLength(8);
    expect(perimeter).toContainEqual({ x: 4, y: 3 });
    expect(perimeter).toContainEqual({ x: 6, y: 5 });
    expect(perimeter).not.toContainEqual({ x: 3, y: 3 });
    expect(perimeter).not.toContainEqual({ x: 4, y: 4 });
  });
});
