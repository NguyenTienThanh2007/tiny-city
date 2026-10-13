import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOG } from '@tiny-city/simulation';
import type { BuildingType } from '@tiny-city/simulation';
import { ARCHITECTURE_COLLECTIONS, ARCHITECTURE_MODELS, architectureModel, classicModel, collectionModelAt, collectionsFor,
  findArchitectureMentions, isKnownDesign, isSelectableDesign, modelsFor } from '../src/architecture.js';

const PREFIX: Record<string, string> = { classic: 'classic', 'luxury-minimalist': 'lm', 'modern-coastal': 'mc', 'tropical-contemporary': 'tc', 'urban-premium': 'up', 'family-garden': 'fg' };
const TYPES = Object.keys(BUILDING_CATALOG) as BuildingType[];

describe('architecture registry (Visual World 3.1)', () => {
  it('has unique, stable, well-formed model IDs that encode their collection and building type', () => {
    const ids = ARCHITECTURE_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const model of ARCHITECTURE_MODELS) {
      expect(model.id).toMatch(/^[a-z]+\.[a-z]+\.[a-z0-9-]+$/);
      const [prefix, type] = model.id.split('.');
      expect(prefix, model.id).toBe(PREFIX[model.collection]);
      expect(type, model.id).toBe(model.buildingType);
      expect(TYPES).toContain(model.buildingType);
      expect(model.name.length).toBeGreaterThan(3);
      expect(model.nameVi.length).toBeGreaterThan(3);
      expect(model.features.length).toBeGreaterThan(0);
      for (const alias of model.aliases ?? []) expect(alias).toBe(alias.toLowerCase());
    }
    for (const collection of ARCHITECTURE_COLLECTIONS) for (const alias of collection.aliases) expect(alias).toBe(alias.toLowerCase());
  });

  it('keeps every classic 3.0B variant as a classic model, so cities from before 3.1 keep their exact look', () => {
    const variants: Record<BuildingType, number> = { villa: 4, duplex: 3, townhouse: 3, apartment: 3, park: 3, clubhouse: 3, pool: 2, mall: 2, office: 3 };
    for (const type of TYPES) {
      const classic = modelsFor(type, 'classic');
      expect(classic.map((model) => model.classicVariant).sort()).toEqual(Array.from({ length: variants[type] }, (_, i) => i));
      for (let v = 0; v < variants[type]; v += 1) expect(classicModel(type, v)?.collection).toBe('classic');
    }
  });

  it('meets the Luxury Minimalist targets: six villas and four each of duplex, townhouse and apartment', () => {
    const count = (type: BuildingType) => modelsFor(type, 'luxury-minimalist', true).length;
    expect(count('villa')).toBeGreaterThanOrEqual(6);
    expect(count('duplex')).toBeGreaterThanOrEqual(4);
    expect(count('townhouse')).toBeGreaterThanOrEqual(4);
    expect(count('apartment')).toBeGreaterThanOrEqual(4);
    // Commercial and public buildings get new designs too.
    for (const type of ['mall', 'office', 'clubhouse', 'pool', 'park'] as const) expect(ARCHITECTURE_MODELS.filter((m) => m.buildingType === type && m.collection !== 'classic' && m.status === 'available').length).toBeGreaterThanOrEqual(3);
    // Every listed collection offers at least one buildable model somewhere.
    for (const collection of ARCHITECTURE_COLLECTIONS) expect(ARCHITECTURE_MODELS.some((m) => m.collection === collection.id && m.status === 'available'), collection.id).toBe(true);
  });

  it('validates designs: right type and collection, never a planned model for new construction', () => {
    expect(isSelectableDesign('villa', { collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' })).toBe(true);
    expect(isSelectableDesign('duplex', { collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' })).toBe(false);
    expect(isSelectableDesign('villa', { collection: 'urban-premium', model: 'lm.villa.glass-pavilion' })).toBe(false);
    expect(isSelectableDesign('villa', { collection: 'luxury-minimalist', model: 'lm.villa.nope' })).toBe(false);
    expect(isSelectableDesign('villa', { collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion', extra: 1 })).toBe(false);
    const planned = ARCHITECTURE_MODELS.find((model) => model.status === 'planned')!;
    expect(isKnownDesign(planned.buildingType, { collection: planned.collection, model: planned.id })).toBe(false);
    expect(collectionsFor('villa').map((c) => c.id)).toEqual(expect.arrayContaining(['classic', 'luxury-minimalist', 'modern-coastal', 'tropical-contemporary', 'family-garden']));
  });

  it('cycles through a collection deterministically so a request for several buildings gets varied models', () => {
    const five = Array.from({ length: 5 }, (_, n) => collectionModelAt('villa', 'luxury-minimalist', n)!.id);
    expect(new Set(five).size).toBe(5);
    expect(collectionModelAt('villa', 'luxury-minimalist', 6)!.id).toBe(five[0]);
    expect(collectionModelAt('townhouse', 'family-garden', 0)).toBeUndefined();
  });

  it('finds collections and models named in English and Vietnamese requests', () => {
    const vi = findArchitectureMentions('Xây 5 biệt thự Luxury Minimalist gần công viên');
    expect(vi).toEqual([expect.objectContaining({ collection: 'luxury-minimalist', model: null })]);
    const en = findArchitectureMentions('Build three Glass Pavilion Villas along the main road');
    expect(en[0]?.model?.id).toBe('lm.villa.glass-pavilion');
    expect(findArchitectureMentions('Tạo một khu phố tối giản sang trọng')[0]?.collection).toBe('luxury-minimalist');
    expect(findArchitectureMentions('Create a premium Modern Coastal neighborhood')[0]?.collection).toBe('modern-coastal');
    expect(findArchitectureMentions('Build two Sculptural Concrete Villas near the pool')[0]?.model?.id).toBe('lm.villa.sculptural-concrete');
    expect(findArchitectureMentions('build two villas')).toEqual([]);
    expect(architectureModel('lm.villa.sky-terrace')?.status).toBe('available');
  });
});
