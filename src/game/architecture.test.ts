import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHITECTURE_MODELS, classicModel, modelsFor } from '@tiny-city/ai-architect';
import { Simulation } from '@tiny-city/simulation';
import { BUILDINGS, type BuildingKind, type CityState } from '../types';
import { indexManifest, selectBuildingAsset, type ArtManifest } from './art/artManifest';
import { applyCollectionToAll, DEFAULT_CHOICE, designOf, legacyDesign, predictBuildingId, resolveChoice, sanitizeDesign } from './architecture';
import { hashString } from './npcMotion';
import { createCityWorld, projectCity } from '../simulation/cityAdapter';
import { loadCitySaveValue, saveCity } from '../simulation/citySave';

const dir = resolve(__dirname, '../../public/art/vw3');
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as ArtManifest;
const index = indexManifest(manifest);
const NO_ROAD = { north: false, south: false, east: false, west: false };
const EAST = { ...NO_ROAD, east: true };

describe('architecture models and baked art agree (Visual World 3.1)', () => {
  it('bakes every available model for both facings (parks: one), with its building type and catalog footprint', () => {
    for (const model of ARCHITECTURE_MODELS.filter((m) => m.status === 'available' && m.collection !== 'classic')) {
      const assets = index.models.get(model.id) ?? [];
      expect(assets.length, model.id).toBeGreaterThan(0);
      if (model.buildingType !== 'park') expect(assets.map((a) => a.front).sort(), model.id).toEqual(['E', 'S']);
      for (const asset of assets) {
        expect(asset.kind).toBe(model.buildingType);
        expect(asset.footprint).toEqual({ w: BUILDINGS[model.buildingType].width, d: BUILDINGS[model.buildingType].height });
      }
    }
    // Nothing baked that the registry does not list as available (no orphan or planned art in the catalog).
    for (const id of index.models.keys()) expect(ARCHITECTURE_MODELS.find((m) => m.id === id)?.status, id).toBe('available');
  });

  it('ships a catalog thumbnail for every available model, classic ones included', () => {
    for (const model of ARCHITECTURE_MODELS.filter((m) => m.status === 'available')) expect(existsSync(resolve(dir, 'thumbs', `${model.id}.webp`)), model.id).toBe(true);
  });

  it('never gives a building without a design one of the new models: older cities keep their exact classic look', () => {
    for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
      const variants = [...new Set(index.buildings.get(kind)!.map((a) => a.variant))];
      for (let i = 0; i < 40; i += 1) {
        const id = `building-${i}`;
        const asset = selectBuildingAsset(index, { kind, id }, NO_ROAD)!;
        expect(asset.model).toBeUndefined();
        expect(asset.variant).toBe(variants[hashString(`vw3:${kind}:${id}`) % variants.length]);
        // The explicit classic design that "Classic mix" stores shows exactly the same art.
        expect(selectBuildingAsset(index, { kind, id, design: legacyDesign(kind, id) }, NO_ROAD)).toBe(asset);
      }
    }
  });

  it('shows exactly the chosen model, facing the road; a model missing from the bundle falls back within its collection', () => {
    const glass = selectBuildingAsset(index, { kind: 'villa', id: 'building-9', design: { collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' } }, NO_ROAD)!;
    expect(glass.model).toBe('lm.villa.glass-pavilion');
    expect(glass.front).toBe('S');
    expect(selectBuildingAsset(index, { kind: 'villa', id: 'building-9', design: { collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' } }, EAST)!.front).toBe('E');
    const removed = selectBuildingAsset(index, { kind: 'villa', id: 'building-9', design: { collection: 'luxury-minimalist', model: 'lm.villa.retired-model' } }, NO_ROAD)!;
    expect(modelsFor('villa', 'luxury-minimalist').map((m) => m.id)).toContain(removed.model);
    // A design for another building type or an unknown collection never shows foreign art.
    expect(selectBuildingAsset(index, { kind: 'duplex', id: 'b', design: { collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' } }, NO_ROAD)!.kind).toBe('duplex');
    expect(selectBuildingAsset(index, { kind: 'villa', id: 'b', design: { collection: 'nowhere', model: 'x.villa.y' } }, NO_ROAD)!.model).toBeUndefined();
  });
});

describe('design choices', () => {
  it('resolve a specific model exactly and a mix deterministically from the building ID', () => {
    expect(resolveChoice('villa', { collection: 'luxury-minimalist', model: 'lm.villa.sky-terrace' }, 'building-3')).toEqual({ collection: 'luxury-minimalist', model: 'lm.villa.sky-terrace' });
    expect(resolveChoice('villa', DEFAULT_CHOICE, 'building-3')).toEqual(legacyDesign('villa', 'building-3'));
    const mix = Array.from({ length: 24 }, (_, i) => resolveChoice('villa', { collection: 'luxury-minimalist', model: null }, `building-${i}`).model);
    expect(new Set(mix).size).toBeGreaterThan(3);
    expect(mix.every((id) => id.startsWith('lm.villa.'))).toBe(true);
    expect(resolveChoice('villa', { collection: 'luxury-minimalist', model: null }, 'building-5')).toEqual(resolveChoice('villa', { collection: 'luxury-minimalist', model: null }, 'building-5'));
    // A model of another type, a planned model or a collection without models for this type falls back safely.
    expect(resolveChoice('duplex', { collection: 'luxury-minimalist', model: 'lm.villa.sky-terrace' }, 'b').model.startsWith('lm.duplex.')).toBe(true);
    expect(resolveChoice('townhouse', { collection: 'family-garden', model: null }, 'b')).toEqual(legacyDesign('townhouse', 'b'));
    expect(legacyDesign('villa', 'x')).toEqual({ collection: 'classic', model: classicModel('villa', hashString('vw3:villa:x') % 4)!.id });
  });

  it('apply a collection to every building type it covers, keeping other types unchanged', () => {
    const next = applyCollectionToAll({ townhouse: { collection: 'classic', model: 'classic.townhouse.market-row' } }, 'tropical-contemporary');
    expect(next.villa).toEqual({ collection: 'tropical-contemporary', model: 'tc.villa.lanai' });
    expect(next.mall).toEqual({ collection: 'tropical-contemporary', model: 'tc.mall.shopping-pavilion' });
    expect(next.townhouse).toEqual({ collection: 'classic', model: 'classic.townhouse.market-row' });
  });

  it('predict the ID the simulation gives the next building, so the preview shows what gets built', () => {
    const simulation = new Simulation(createCityWorld({ size: 64, funds: 9000, roads: Array.from({ length: 8 }, (_, i) => ({ x: 8 + i, y: 12 })), buildings: [] }));
    for (let i = 0; i < 3; i += 1) {
      const predicted = predictBuildingId(simulation.getState());
      const result = simulation.execute({ type: 'city.build', buildingType: 'villa', position: { x: 8 + i * 2, y: 10 } });
      const built = result.events.find((event) => event.type === 'city.building-built');
      expect(built?.type === 'city.building-built' && built.building.id).toBe(predicted);
    }
  });

  it('sanitize saved designs: keep sound unknown IDs (newer bundles), drop malformed values', () => {
    expect(sanitizeDesign({ collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' })).toEqual({ collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' });
    expect(sanitizeDesign({ collection: 'future-collection', model: 'fx.villa.something' })).toEqual({ collection: 'future-collection', model: 'fx.villa.something' });
    for (const bad of [null, 'lm.villa.x', [], { collection: 'x' }, { collection: 'A B', model: 'x' }, { collection: 'x', model: 'y', extra: 1 }, { collection: 'x', model: '<script>' }]) expect(sanitizeDesign(bad)).toBeUndefined();
  });
});

describe('architectural identity persists', () => {
  const city: CityState = { size: 64, funds: 5000, roads: Array.from({ length: 12 }, (_, i) => ({ x: 8 + i, y: 12 })), buildings: [] };
  const storage = () => { const data = new Map<string, string>(); return { setItem: (k: string, v: string) => data.set(k, v), getItem: (k: string) => data.get(k) ?? null, data }; };

  it('through construction, edits, save/reload (local or cloud envelope) and undo snapshots, without touching cost or footprint', () => {
    const simulation = new Simulation(createCityWorld(city));
    const design = { collection: 'luxury-minimalist' as const, model: 'lm.villa.glass-pavilion' };
    const before = simulation.getState().budget.balance;
    const result = simulation.execute({ type: 'city.build', buildingType: 'villa', position: { x: 9, y: 10 } });
    const built = result.events.find((event) => event.type === 'city.building-built')!;
    if (built.type !== 'city.building-built') throw new Error('not built');
    // Cost and footprint are the catalog's, whatever the design.
    expect(before - simulation.getState().budget.balance).toBe(BUILDINGS.villa.cost);
    expect(built.building.footprint).toEqual({ width: 2, height: 2 });
    const projected = projectCity(simulation.getState(), city, 1, new Map([[built.building.id, design]]));
    expect(projected.buildings[0]!.design).toEqual(design);
    // A later edit (move) keeps the design by building ID.
    simulation.execute({ type: 'city.move-building', buildingId: built.building.id, position: { x: 12, y: 10 } });
    const moved = projectCity(simulation.getState(), projected, 2);
    expect(moved.buildings[0]).toMatchObject({ x: 12, design });
    // Save and reload (cloud saves store this same envelope).
    const store = storage();
    saveCity(store, moved, simulation.getState());
    const envelope = JSON.parse(store.data.get('tiny-city-imagine-save-v1')!);
    const loaded = loadCitySaveValue(JSON.parse(JSON.stringify(envelope)));
    expect(loaded.notice).toBeUndefined();
    expect(loaded.city.buildings[0]!.design).toEqual(design);
    expect(designOf(loaded.city.buildings[0]!)).toEqual(design);
  });

  it('loads older saves without designs unchanged, and keeps the layout when a design is malformed', () => {
    const simulation = new Simulation(createCityWorld(city));
    simulation.execute({ type: 'city.build', buildingType: 'duplex', position: { x: 9, y: 10 } });
    const legacy = projectCity(simulation.getState(), city, 1);
    expect(legacy.buildings[0]!.design).toBeUndefined();
    const store = storage();
    saveCity(store, legacy, simulation.getState());
    const envelope = JSON.parse(store.data.get('tiny-city-imagine-save-v1')!);
    const old = loadCitySaveValue(envelope);
    expect(old.city.buildings[0]!.design).toBeUndefined();
    expect(designOf(old.city.buildings[0]!)).toEqual(legacyDesign('duplex', old.city.buildings[0]!.id));
    envelope.buildings[0].design = { collection: 42, model: ['x'] };
    const broken = loadCitySaveValue(envelope);
    expect(broken.city.buildings).toHaveLength(1);
    expect(broken.city.buildings[0]!.design).toBeUndefined();
  });
});
