import { describe, expect, it } from 'vitest';
import { createWorld, Simulation } from '@tiny-city/simulation';
import { createProposal, interpretLocally, PlanReview, decodeIntent } from '../src/index.js';
import type { ArchitectIntent, BuildDesignRequest, BuildRequest } from '../src/index.js';

const intent = (builds: BuildRequest[], patch: Partial<ArchitectIntent> = {}): ArchitectIntent => ({ summary: 'Build', language: 'en', style: 'compact', near: 'existing', region: null, budgetLimit: null,
  connectRoads: true, builds, moves: [], demolish: [], roadAdd: [], roadRemove: [], preserveBuildingIds: [], unsupportedRequests: [], ambiguities: [], demolishTargets: [], moveTargets: [], preserveRoads: false, preserveTypes: [], ...patch });
const world = () => createWorld({ id: 'arch', seed: 7, startingFunds: 20_000, clock: { paused: true },
  plan: { id: 'arch-plan', name: 'Arch', width: 40, height: 40, buildings: [], roads: Array.from({ length: 34 }, (_, i) => ({ x: 3 + i, y: 20 })), blockedTiles: [] } });
const villas = (design: BuildDesignRequest | null, quantity = 3): BuildRequest => ({ buildingType: 'villa', quantity, preferredPosition: null, design });

describe('AI Architect architecture requests (Visual World 3.1)', () => {
  it('builds a requested collection with varied models of that collection, and names them in the plan', async () => {
    const p = await createProposal(world(), 0, intent([villas({ collection: 'luxury-minimalist', model: null }, 5)]));
    expect(p.validation).toMatchObject({ valid: true, fulfilled: true });
    const models = p.placements.map((placement) => placement.design?.model);
    expect(models).toHaveLength(5);
    expect(new Set(models).size).toBe(5);
    for (const placement of p.placements) expect(placement.design).toMatchObject({ collection: 'luxury-minimalist' });
    expect(p.explanation).toMatch(/designs: .*Glass Pavilion Villa/);
  });

  it('builds a model named by display name or ID exactly, and preserves it through review and approval', async () => {
    const initial = world();
    const p = await createProposal(initial, 0, intent([villas({ collection: null, model: 'Glass Pavilion Villa' }, 3)]));
    expect(p.placements.map((placement) => placement.design)).toEqual(Array(3).fill({ collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' }));
    // Re-validation reproduces the same designs (they are part of the digest), and the predicted IDs are the real ones.
    const simulation = new Simulation(initial);
    const review = new PlanReview(simulation, p);
    await review.preview();
    review.approve(p.planId);
    const result = await review.apply();
    const built = result.events.flatMap((event) => (event.type === 'city.building-built' ? [event.building.id] : []));
    expect(built).toEqual(p.placements.map((placement) => placement.buildingId));
  });

  it('never silently substitutes: unknown, planned, mistyped or uncovered requests are refused with a reason', async () => {
    const cases: [BuildRequest, RegExp][] = [
      [villas({ collection: null, model: 'Moon Base Villa' }), /not in the catalog/],
      [villas({ collection: 'Gothic Revival', model: null }), /not in the catalog/],
      [villas({ collection: null, model: 'lm.duplex.twin-glass' }), /duplex model, not a villa/],
      [{ buildingType: 'duplex', quantity: 1, preferredPosition: null, design: { collection: null, model: 'mc.duplex.dune' } }, /planned but not available/],
      [{ buildingType: 'townhouse', quantity: 2, preferredPosition: null, design: { collection: 'family-garden', model: null } }, /has no townhouse models yet/],
      [villas({ collection: 'modern-coastal', model: 'lm.villa.sky-terrace' }), /belongs to Luxury Minimalist/],
    ];
    for (const [request, reason] of cases) {
      const p = await createProposal(world(), 0, intent([request]));
      expect(p.status, String(reason)).toBe('REJECTED');
      expect(p.commands).toEqual([]);
      expect(p.warnings.find((w) => w.code === 'UNSUPPORTED_DESIGN')?.message).toMatch(reason);
    }
    // With partial plans allowed, the supported part is built and the refused part is reported.
    const partial = await createProposal(world(), 0, intent([villas({ collection: null, model: 'Moon Base Villa' }, 1), villas({ collection: 'luxury-minimalist', model: 'sky terrace' }, 1)]), 0, { allowPartial: true });
    expect(partial.validation).toMatchObject({ valid: true, fulfilled: false });
    expect(partial.placements.map((placement) => placement.design?.model)).toEqual(['lm.villa.sky-terrace']);
  });

  it('keeps cost, footprint and capacity the catalog’s whatever the design', async () => {
    const plain = await createProposal(world(), 0, intent([villas(null, 2)]));
    const styled = await createProposal(world(), 0, intent([villas({ collection: 'tropical-contemporary', model: null }, 2)]));
    expect(styled.estimatedCost).toBe(plain.estimatedCost);
    expect(styled.placements.map((p) => p.footprint)).toEqual(plain.placements.map((p) => p.footprint));
    expect(plain.placements.every((p) => p.design === null)).toBe(true);
  });

  it('accepts older intents without designs and rejects malformed ones', () => {
    expect(decodeIntent(intent([{ buildingType: 'villa', quantity: 1, preferredPosition: null }])).builds[0]!.design).toBeNull();
    expect(() => decodeIntent(intent([villas({ collection: 'x', model: 'y', extra: 1 } as never)]))).toThrow();
    expect(() => decodeIntent(intent([villas({ collection: 42, model: null } as never)]))).toThrow();
    expect(() => decodeIntent(intent([villas({ collection: 'x'.repeat(200), model: null })]))).toThrow();
  });

  it('interprets the documented English and Vietnamese style requests offline', async () => {
    const vi = interpretLocally('Xây 5 biệt thự Luxury Minimalist gần công viên.');
    expect(vi.builds).toEqual([{ buildingType: 'villa', quantity: 5, preferredPosition: null, design: { collection: 'luxury-minimalist', model: null } }]);
    expect(vi.near).toBe('park');
    const en = interpretLocally('Build three Glass Pavilion Villas along the main road');
    expect(en.builds).toEqual([{ buildingType: 'villa', quantity: 3, preferredPosition: null, design: { collection: 'luxury-minimalist', model: 'lm.villa.glass-pavilion' } }]);
    expect(en.near).toBe('road');
    const mixed = interpretLocally('Tạo một khu phố hiện đại gồm 4 biệt thự và 6 nhà phố');
    expect(mixed.builds.map((b) => [b.buildingType, b.quantity, b.design?.collection])).toEqual([['villa', 4, 'luxury-minimalist'], ['townhouse', 6, 'luxury-minimalist']]);
    expect(mixed.summary).toMatch(/Luxury Minimalist/);
    const coastal = interpretLocally('Create a premium Modern Coastal neighborhood');
    expect(coastal.builds).toEqual([]);
    expect(coastal.ambiguities.join(' ')).toMatch(/how many/);
    const concrete = interpretLocally('Build two Sculptural Concrete Villas near the pool');
    expect(concrete.builds).toEqual([{ buildingType: 'villa', quantity: 2, preferredPosition: null, design: { collection: 'luxury-minimalist', model: 'lm.villa.sculptural-concrete' } }]);
    // Planning the Vietnamese request uses only Luxury Minimalist villas.
    const p = await createProposal(world(), 0, vi);
    expect(p.placements.every((placement) => placement.design?.collection === 'luxury-minimalist')).toBe(true);
    // Plain requests keep the classic look.
    expect(interpretLocally('Xây 2 biệt thự gần đường').builds[0]!.design).toBeUndefined();
  });
});

describe('Phase 7 entertainment venues', () => {
  const town = () => createWorld({ id: 'fun', seed: 7, startingFunds: 20_000, clock: { paused: true },
    plan: { id: 'fun-plan', name: 'Fun', width: 48, height: 48, buildings: [], roads: [...Array.from({ length: 40 }, (_, i) => ({ x: 4 + i, y: 16 })), ...Array.from({ length: 40 }, (_, i) => ({ x: 4 + i, y: 30 }))], blockedTiles: [] } });

  it('understands the venue types in Vietnamese and English, and an entertainment district', () => {
    const vi = interpretLocally('Xây một khu phố giải trí với quán cà phê, rạp chiếu phim và chợ đêm.');
    expect(vi.builds.map((b) => b.buildingType)).toEqual(['cafe', 'cinema', 'market']);
    const district = interpretLocally('Create a modern entertainment district near the mall.');
    expect(district.builds.map((b) => [b.buildingType, b.quantity])).toEqual([['cafe', 2], ['cinema', 1], ['shops', 1], ['nightclub', 1]]);
    // "modern" implies Luxury Minimalist only where that collection has models; venues keep the classic look.
    expect(district.builds.every((b) => b.design === undefined)).toBe(true);
    // "surrounded by parks" places the stage by the parks (a location, not a build).
    const stage = interpretLocally('Build a concert stage surrounded by parks');
    expect(stage.builds.map((b) => b.buildingType)).toEqual(['stage']);
    expect(stage.near).toBe('park');
    const walkable = interpretLocally('Make a walkable neighborhood with cafes and restaurants');
    expect(walkable.builds.map((b) => b.buildingType)).toEqual(['cafe', 'cafe']);
    expect(interpretLocally('Thêm 2 câu lạc bộ âm nhạc và một công viên giải trí').builds.map((b) => [b.buildingType, b.quantity])).toEqual([['nightclub', 2], ['amusement', 1]]);
    expect(interpretLocally('Xây câu lạc bộ').builds[0]!.buildingType).toBe('clubhouse');
    expect(interpretLocally('Build a Premium Community Plaza').builds.map((b) => b.buildingType)).toEqual(['park']);
  });

  it('plans venues on legal lots at catalog cost, with preview and validation like any building', async () => {
    const p = await createProposal(town(), 0, interpretLocally('Xây một khu phố giải trí với quán cà phê, rạp chiếu phim và chợ đêm.'));
    expect(p.validation).toMatchObject({ valid: true, fulfilled: true });
    expect(p.placements.map((placement) => placement.buildingType).sort()).toEqual(['cafe', 'cinema', 'market']);
    // Catalog prices for the venues, plus any connecting road tiles at the road price.
    expect((p.estimatedCost - (260 + 700 + 300)) % 8).toBe(0);
    expect(p.estimatedCost).toBeGreaterThanOrEqual(260 + 700 + 300);
    const simulation = new Simulation(town());
    const review = new PlanReview(simulation, p);
    await review.preview();
    expect(simulation.getState().plan.buildings).toHaveLength(0);
  });
});
