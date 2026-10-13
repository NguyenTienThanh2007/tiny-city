import { describe, expect, it } from 'vitest';
import { createWorld } from '@tiny-city/simulation';
import { initialCity } from '../data/initialCity';
import { createCityWorld, toCityPlan } from '../simulation/cityAdapter';
import { BUILDINGS, type BuildingKind } from '../types';
import { buildingVariant, windowLit } from './buildingVariants';
import { planDecor, CURB_DECOR, MAX_DECOR, TALL_DECOR, tileNoise } from './worldDecor';
import { DAYLIGHT, worldLighting } from './lighting';

const kinds = Object.keys(BUILDINGS) as BuildingKind[];

describe('deterministic building variants', () => {
  it('derive the same look from the same ID across calls (save/reload safe)', () => {
    for (const kind of kinds) for (let index = 0; index < 50; index += 1) {
      expect(buildingVariant(`building-${index}`, kind)).toEqual(buildingVariant(`building-${index}`, kind));
    }
  });

  it('vary repeated buildings of one type', () => {
    const villas = Array.from({ length: 24 }, (_, index) => buildingVariant(`villa-seed-${index}`, 'villa'));
    expect(new Set(villas.map((v) => v.roof)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(villas.map((v) => v.wall)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(villas.map((v) => v.roofStyle)).size).toBe(2);
    expect(new Set(villas.map((v) => v.garden)).size).toBeGreaterThanOrEqual(3);
    const parks = Array.from({ length: 24 }, (_, index) => buildingVariant(`park-${index}`, 'park'));
    expect(new Set(parks.map((v) => v.parkFeature)).size).toBeGreaterThanOrEqual(3);
  });

  it('light a stable majority of windows at night', () => {
    const variant = buildingVariant('apartment-seed', 'apartment');
    const lit = Array.from({ length: 200 }, (_, index) => windowLit(variant, index));
    expect(lit).toEqual(Array.from({ length: 200 }, (_, index) => windowLit(variant, index)));
    const share = lit.filter(Boolean).length / lit.length;
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.85);
  });
});

describe('deterministic landscaping', () => {
  const plan = toCityPlan(initialCity);

  it('is identical for identical plans and bounded in size', () => {
    expect(planDecor(plan)).toEqual(planDecor(toCityPlan(initialCity)));
    expect(planDecor(plan).length).toBeLessThanOrEqual(MAX_DECOR);
    expect(tileNoise(3, 4, 7)).toBe(tileNoise(3, 4, 7));
  });

  it('never places decorations on roads, buildings or water; lamps only on real road curbs', () => {
    const roads = new Set(plan.roads.map((tile) => `${tile.x},${tile.y}`));
    const blocked = new Set(plan.blockedTiles.map((tile) => `${tile.x},${tile.y}`));
    const occupied = new Set(plan.buildings.flatMap((b) => Array.from({ length: b.footprint.width * b.footprint.height },
      (_, i) => `${b.position.x + (i % b.footprint.width)},${b.position.y + Math.floor(i / b.footprint.width)}`)));
    const decor = planDecor(plan);
    expect(decor.some((item) => item.kind === 'lamp')).toBe(true);
    expect(decor.some((item) => item.kind === 'tree')).toBe(true);
    for (const item of decor) {
      const tile = `${item.tile.x},${item.tile.y}`;
      expect(blocked.has(tile)).toBe(false);
      expect(occupied.has(tile)).toBe(false);
      if (CURB_DECOR.has(item.kind)) {
        expect(roads.has(tile)).toBe(true);
        // On the curb: well outside the walking lanes around the tile center.
        expect(Math.max(Math.abs(item.at.x - item.tile.x - 0.5), Math.abs(item.at.y - item.tile.y - 0.5))).toBeGreaterThan(0.35);
      } else {
        expect(roads.has(tile)).toBe(false);
        expect(item.at.x).toBeGreaterThanOrEqual(item.tile.x);
        expect(item.at.x).toBeLessThan(item.tile.x + 1);
      }
    }
  });

  it('clears decorations from tiles once something is built there', () => {
    const before = planDecor(plan).filter((item) => TALL_DECOR.has(item.kind) && !CURB_DECOR.has(item.kind));
    const target = before[0]!;
    const world = createCityWorld(initialCity);
    const withRoad = { ...world.plan, roads: [...world.plan.roads, { x: target.tile.x, y: target.tile.y }] };
    const after = planDecor(withRoad);
    expect(after.some((item) => !CURB_DECOR.has(item.kind) && item.tile.x === target.tile.x && item.tile.y === target.tile.y)).toBe(false);
    expect(planDecor(createWorld({ id: 'empty', seed: 's', plan: { ...withRoad, roads: [], buildings: [] } }).plan).every((item) => !CURB_DECOR.has(item.kind))).toBe(true);
  });
});

describe('time-of-day lighting', () => {
  it('is neutral by day and glows at night with smooth transitions', () => {
    expect(worldLighting(12 * 60)).toEqual({ tint: 0xffffff, glow: 0, sun: 1, phase: 'day' });
    expect(worldLighting(23 * 60).sun).toBe(0);
    const night = worldLighting(23 * 60);
    expect(night.phase).toBe('night');
    expect(night.glow).toBe(1);
    expect(night.tint).not.toBe(0xffffff);
    expect(worldLighting(18 * 60).phase).toBe('golden');
    expect(worldLighting(20 * 60).phase).toBe('dusk');
    expect(worldLighting(6 * 60).phase).toBe('dawn');
    let previous = worldLighting(16 * 60).glow;
    for (let minute = 16 * 60; minute <= 21 * 60; minute += 5) {
      const { glow } = worldLighting(minute);
      expect(glow).toBeGreaterThanOrEqual(previous);
      expect(glow - previous).toBeLessThan(0.1);
      previous = glow;
    }
    expect(worldLighting(1440 + 12 * 60)).toEqual(worldLighting(12 * 60));
    expect(DAYLIGHT.glow).toBe(0);
  });
});
