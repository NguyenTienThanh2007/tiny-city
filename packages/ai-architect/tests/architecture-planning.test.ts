import { describe, expect, it } from 'vitest';
import { createWorld, Simulation } from '@tiny-city/simulation';
import { createProposal, interpretLocally, PlanReview, decodeIntent } from '../src/index.js';
import type { ArchitectIntent, BuildRequest } from '../src/index.js';

const intent = (builds: BuildRequest[], patch: Partial<ArchitectIntent> = {}): ArchitectIntent => ({ summary: 'Build', language: 'en', style: 'compact', near: 'existing', region: null, budgetLimit: null,
  connectRoads: true, builds, moves: [], demolish: [], roadAdd: [], roadRemove: [], preserveBuildingIds: [], unsupportedRequests: [], ambiguities: [], demolishTargets: [], moveTargets: [], preserveRoads: false, preserveTypes: [], ...patch });
const world = () => createWorld({ id: 'arch', seed: 7, startingFunds: 20_000, clock: { paused: true },
  plan: { id: 'arch-plan', name: 'Arch', width: 40, height: 40, buildings: [], roads: Array.from({ length: 34 }, (_, i) => ({ x: 3 + i, y: 20 })), blockedTiles: [] } });
const villas = (design: BuildRequest['design'], quantity = 3): BuildRequest => ({ buildingType: 'villa', quantity, preferredPosition: null, design });

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
