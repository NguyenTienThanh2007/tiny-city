import { describe, expect, it, vi } from 'vitest';
import { initialCity } from '../data/initialCity';
import { buildingAtPoint } from './CityViewport';

vi.mock('pixi.js', () => ({
  Application: class {},
  Container: class {},
  Graphics: class {},
  Rectangle: class {},
  Text: class {},
}));

describe('isometric building hit testing', () => {
  it('selects a villa when clicking its raised roof instead of the empty tile behind it', () => {
    const villa = initialCity.buildings.find((building) => building.id === 'villa-seed-1')!;
    const roofCenter = {
      x: 32 * 56 + (villa.x - villa.y) * 28,
      y: (villa.x + villa.y + 2) * 14 - 30,
    };

    expect(buildingAtPoint(initialCity, roofCenter)?.id).toBe(villa.id);
  });

  it('keeps footprint-cell selection working for ground-level clicks', () => {
    const villa = initialCity.buildings.find((building) => building.id === 'villa-seed-1')!;
    const footprintCenter = {
      x: 32 * 56 + (villa.x - villa.y) * 28,
      y: (villa.x + villa.y + 2) * 14,
    };

    expect(buildingAtPoint(initialCity, footprintCenter)?.id).toBe(villa.id);
  });
});
