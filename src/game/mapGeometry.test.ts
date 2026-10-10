import { describe, expect, it } from 'vitest';
import { cityView, footprint, iso, tileStroke, toCell, toGrid } from './mapGeometry';

describe('map coordinates and recovery', () => {
  it.each([[0, 0], [63, 63], [17, 23], [31.25, 7.75], [-1.5, 70]])('roundtrips %s,%s without truncating minimap corners', (x, y) => {
    expect(toGrid(iso(x, y))).toEqual({ x, y });
  });
  it('floors tile coordinates and preserves rectangular footprint vertices', () => {
    expect(toCell(iso(3.99, 4.01))).toEqual({ x: 3, y: 4 });
    expect(toCell(iso(-0.01, 2))).toEqual({ x: -1, y: 2 });
    expect(toCell(iso(2 - 1e-7, 2))).toEqual({ x: 1, y: 2 });
    expect(footprint(3, 4, 6, 5)).toEqual([iso(3, 4), iso(9, 4), iso(9, 9), iso(3, 9)]);
  });
  it('homes in on a saved neighborhood far from the old fixed camera', () => {
    const view = cityView({ size: 64, funds: 0, roads: [], buildings: [
      { id: 'remote', kind: 'villa', name: 'Remote', x: 50, y: 50, createdAt: 0 },
    ] }, 800, 600);
    const center = toGrid(view.center);
    expect(center.x).toBeGreaterThan(45);
    expect(center.y).toBeGreaterThan(45);
    expect(view.scale).toBe(0.86);
  });
  it('fits widely separated lots instead of centering an empty patch between offscreen buildings', () => {
    const city = { size: 64, funds: 0, roads: [], buildings: [
      { id: 'west', kind: 'park' as const, name: 'West', x: 0, y: 59, createdAt: 0 },
      { id: 'east', kind: 'park' as const, name: 'East', x: 59, y: 0, createdAt: 0 },
    ] };
    const view = cityView(city, 800, 600);
    for (const building of city.buildings) for (const point of footprint(building.x, building.y, 4, 4)) {
      const screenX = 400 + (point.x - view.center.x) * view.scale;
      expect(screenX).toBeGreaterThan(0);
      expect(screenX).toBeLessThan(800);
    }
  });
  it.each([{ x: 10, y: 10 }, { x: 1, y: 10 }, { x: 10, y: 1 }])('fills an orthogonally connected stroke to $x,$y', (to) => {
    const from = { x: 1, y: 1 };
    const tiles = tileStroke(from, to, 64);
    expect(tiles.at(-1)).toEqual(to);
    expect(tiles).toHaveLength(Math.abs(to.x - from.x) + Math.abs(to.y - from.y));
    [from, ...tiles].forEach((cell, i, cells) => {
      if (i) expect(Math.abs(cell.x - cells[i - 1].x) + Math.abs(cell.y - cells[i - 1].y)).toBe(1);
    });
  });
  it('bounds work for out-of-map pointer strokes and repeated samples', () => {
    expect(tileStroke({ x: 0, y: 0 }, { x: -1000000, y: 0 }, 64)).toEqual([{ x: -1000000, y: 0 }]);
    expect(tileStroke({ x: 3, y: 3 }, { x: 3, y: 3 }, 64)).toEqual([]);
  });
});
