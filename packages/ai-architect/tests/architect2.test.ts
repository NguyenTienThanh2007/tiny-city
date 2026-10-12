import { describe, expect, it } from 'vitest';
import { BUILDING_CATALOG, createWorld, playerHomeOptions, RoadGraph, Simulation, serializeWorld } from '@tiny-city/simulation';
import type { Building, BuildingType, WorldState } from '@tiny-city/simulation';
import { createProposal, decodeIntent, interpretLocally, PlanReview, resolveTarget } from '../src/index.js';
import type { ArchitectIntent, PlanningConstraints, TargetSelector } from '../src/index.js';

const b = (id: string, type: BuildingType, x: number, y: number, name = id): Building =>
  ({ id, name, type, kind: BUILDING_CATALOG[type].kind, capacity: BUILDING_CATALOG[type].capacity, position: { x, y }, footprint: { ...BUILDING_CATALOG[type].footprint } });
/** A 40×30 street grid with villas, two apartment buildings, a park and an office. */
function city(options: { population?: boolean; buildings?: Building[] } = {}): WorldState {
  const roads = [...Array.from({ length: 36 }, (_, i) => ({ x: i + 2, y: 5 })), ...Array.from({ length: 36 }, (_, i) => ({ x: i + 2, y: 15 })),
    ...Array.from({ length: 9 }, (_, i) => ({ x: 2, y: i + 6 }))];
  return createWorld({ id: 'ai2', seed: 'ai2', startingFunds: 20_000, clock: { paused: true }, ...(options.population ? { population: { maxCitizens: 1000 } } : {}),
    plan: { id: 'ai2-plan', name: 'AI 2', width: 40, height: 30, blockedTiles: [], roads,
      buildings: options.buildings ?? [b('villa-l', 'villa', 3, 6, 'Lagoon Villa'), b('villa-m', 'villa', 10, 6, 'Palm Villa'), b('villa-r', 'villa', 20, 6, 'Dune Villa'),
        b('apt-a', 'apartment', 4, 16, 'Harbor Flats'), b('apt-b', 'apartment', 24, 16, 'Sea Flats'), b('park-1', 'park', 14, 16, 'Sunny Park'), b('office-1', 'office', 30, 6, 'Harbor Office')] } });
}
const sel = (patch: Partial<TargetSelector>): TargetSelector => ({ buildingType: null, ids: [], quantity: 1, all: false, relative: null, ...patch });
const protectAll = (world: WorldState): Partial<PlanningConstraints> => ({ preserveBuildingIds: world.plan.buildings.map((x) => x.id) });
const plan = (world: WorldState, prompt: string, constraints: Partial<PlanningConstraints> = protectAll(world)) =>
  createProposal(world, world.revision, interpretLocally(prompt, { buildings: world.plan.buildings }), 0, constraints);
/** What the UI sends after explicit authorization: lift protection for exactly these IDs and allow their demolition. */
const authorize = (world: WorldState, ids: { demolish: string[]; move: string[] }): Partial<PlanningConstraints> => ({
  preserveBuildingIds: world.plan.buildings.map((x) => x.id).filter((id) => !ids.demolish.includes(id) && !ids.move.includes(id)),
  allowDestructive: ids.demolish.length > 0, allowedDemolitions: ids.demolish });

describe('offline Vietnamese and English interpretation (no AI calls)', () => {
  const cases: [string, Partial<ArchitectIntent>][] = [
    ['Xây 5 biệt thự gần công viên.', { language: 'vi', near: 'park', builds: [{ buildingType: 'villa', quantity: 5, preferredPosition: null }] }],
    ['Phá apartment đi.', { demolishTargets: [sel({ buildingType: 'apartment' })] }],
    ['Phá tất cả chung cư.', { demolishTargets: [sel({ buildingType: 'apartment', all: true })] }],
    ['Phá căn biệt thự bên trái.', { demolishTargets: [sel({ buildingType: 'villa', relative: 'left' })] }],
    ['Di chuyển tòa chung cư sang khu đất trống gần đường.', { moveTargets: [{ target: sel({ buildingType: 'apartment' }), near: 'road', position: null }] }],
    ['Xây 10 biệt thự và 2 chung cư, thêm đường kết nối.', { connectRoads: true, builds: [{ buildingType: 'villa', quantity: 10, preferredPosition: null }, { buildingType: 'apartment', quantity: 2, preferredPosition: null }] }],
    ['Build a residential neighborhood with eight villas and two parks.', { language: 'en', builds: [{ buildingType: 'villa', quantity: 8, preferredPosition: null }, { buildingType: 'park', quantity: 2, preferredPosition: null }] }],
    ['Remove the two apartment buildings but preserve the roads.', { preserveRoads: true, demolishTargets: [sel({ buildingType: 'apartment', quantity: 2 })] }],
  ];
  it.each(cases)('%s', (prompt, expected) => {
    const intent = interpretLocally(prompt);
    expect(intent).toMatchObject({ unsupportedRequests: [], ambiguities: [], ...expected });
    expect(() => decodeIntent(intent)).not.toThrow();
  });

  it('understands named buildings, mixed actions and preservation', () => {
    const world = city();
    const intent = interpretLocally('Phá Palm Villa và xây 2 hồ bơi, giữ nguyên công viên', { buildings: world.plan.buildings });
    expect(intent.demolishTargets).toEqual([sel({ ids: ['villa-m'] })]);
    expect(intent.builds).toEqual([{ buildingType: 'pool', quantity: 2, preferredPosition: null }]);
    expect(intent.preserveTypes).toEqual(['park']);
  });

  it('reports what it cannot do instead of substituting', () => {
    expect(interpretLocally('Xây một bệnh viện').unsupportedRequests[0]).toContain('bệnh viện');
    expect(interpretLocally('Build a hospital').builds).toEqual([]);
    expect(interpretLocally('blah blah').ambiguities).toHaveLength(1);
    expect(interpretLocally('Remove the roads').unsupportedRequests[0]).toContain('exact tiles');
    expect(interpretLocally('remove road at 3,5')).toMatchObject({ roadRemove: [{ x: 3, y: 5 }], unsupportedRequests: [] });
  });
});

describe('deterministic target resolution', () => {
  const world = city();
  it('resolves exact, all, relative and named targets; asks when several match; rejects impossible counts', () => {
    expect(resolveTarget(world, sel({ buildingType: 'office' }))).toEqual({ kind: 'resolved', ids: ['office-1'] });
    expect(resolveTarget(world, sel({ buildingType: 'apartment', all: true }))).toEqual({ kind: 'resolved', ids: ['apt-a', 'apt-b'] });
    expect(resolveTarget(world, sel({ buildingType: 'villa', relative: 'left' }))).toEqual({ kind: 'resolved', ids: ['villa-l'] });
    expect(resolveTarget(world, sel({ buildingType: 'villa', relative: 'right' }))).toEqual({ kind: 'resolved', ids: ['villa-r'] });
    const choose = resolveTarget(world, sel({ buildingType: 'apartment' }));
    expect(choose).toMatchObject({ kind: 'choose', quantity: 1 });
    expect(choose.kind === 'choose' && choose.candidates.map((c) => c.buildingId)).toEqual(['apt-a', 'apt-b']);
    expect(resolveTarget(world, sel({ buildingType: 'apartment', quantity: 3 }))).toMatchObject({ kind: 'error', code: 'TARGET_COUNT' });
    expect(resolveTarget(world, sel({ buildingType: 'mall' }))).toMatchObject({ kind: 'error', code: 'TARGET_NOT_FOUND', message: expect.stringContaining('no shopping mall') });
    expect(resolveTarget(world, sel({ ids: ['ghost'] }))).toMatchObject({ kind: 'error', code: 'TARGET_NOT_FOUND' });
    expect(resolveTarget(world, sel({}))).toMatchObject({ kind: 'error', code: 'TARGET_UNSPECIFIED' });
  });

  it('asks instead of guessing when "leftmost" is a tie', () => {
    const tied = city({ buildings: [b('v1', 'villa', 3, 6), b('v2', 'villa', 5, 8), b('v3', 'villa', 20, 6)] });
    // (3,6) and (5,8) have the same screen x (x − y), so neither is "the left one".
    expect(resolveTarget(tied, sel({ buildingType: 'villa', relative: 'left' }))).toMatchObject({ kind: 'choose' });
  });
});

describe('safe demolition and modification', () => {
  it('requires target selection for an ambiguous demolition, then explicit authorization, then demolishes only the chosen building', async () => {
    const world = city();
    const ambiguous = await plan(world, 'Phá apartment đi.');
    expect(ambiguous).toMatchObject({ status: 'REJECTED', commands: [], authorization: null });
    expect(ambiguous.clarifications).toEqual([expect.objectContaining({ kind: 'demolish', index: 0, quantity: 1 })]);
    expect(ambiguous.clarifications[0]!.candidates.map((c) => c.name)).toEqual(['Harbor Flats', 'Sea Flats']);
    // The UI re-plans the same intent with the user's choice (no new AI call).
    const chosen = { ...ambiguous.intent, demolishTargets: [{ ...ambiguous.intent.demolishTargets[0]!, ids: ['apt-b'] }] };
    const blocked = await createProposal(world, world.revision, chosen, 0, protectAll(world));
    expect(blocked.status).toBe('REJECTED');
    expect(blocked.authorization).toMatchObject({ demolish: ['apt-b'], protectedIds: ['apt-b'], destructiveRequired: true });
    expect(blocked.warnings.map((w) => w.code)).toContain('PRESERVATION_CONFLICT');
    const allowed = await createProposal(world, world.revision, chosen, 0, authorize(world, { demolish: ['apt-b'], move: [] }));
    expect(allowed).toMatchObject({ status: 'VALIDATED', commands: [{ type: 'city.demolish', buildingId: 'apt-b' }] });
    expect(allowed.impact).toMatchObject({ buildingsRemoved: 1, roomsRemoved: 24 });
    // Preview never mutates; approval needs the destructive flag; application is atomic and revalidated.
    const sim = new Simulation(world);
    const before = serializeWorld(sim.getState());
    const review = new PlanReview(sim, allowed);
    await review.preview();
    expect(serializeWorld(sim.getState())).toBe(before);
    expect(() => review.approve(allowed.planId)).toThrow(/destructive/i);
    review.approve(allowed.planId, { allowDestructive: true });
    const applied = await review.apply();
    expect(applied.state.plan.buildings.map((x) => x.id)).not.toContain('apt-b');
    expect(applied.state.plan.buildings.map((x) => x.id)).toContain('apt-a');
  });

  it('never demolishes without destructive consent even when protection is off', async () => {
    const world = city();
    const result = await plan(world, 'Phá tất cả chung cư.', {});
    expect(result).toMatchObject({ status: 'REJECTED', commands: [], authorization: { demolish: ['apt-a', 'apt-b'], protectedIds: [], destructiveRequired: true } });
    expect(result.warnings.map((w) => w.code)).toContain('DESTRUCTIVE_NOT_AUTHORIZED');
    const ok = await plan(world, 'Phá tất cả chung cư.', { allowDestructive: true, allowedDemolitions: ['apt-a', 'apt-b'] });
    expect(ok.commands).toEqual([{ type: 'city.demolish', buildingId: 'apt-a' }, { type: 'city.demolish', buildingId: 'apt-b' }]);
  });

  it('resolves "the villa on the left" exactly and rejects counts the city cannot satisfy', async () => {
    const world = city();
    const left = await plan(world, 'Phá căn biệt thự bên trái.', authorize(world, { demolish: ['villa-l'], move: [] }));
    expect(left.commands).toEqual([{ type: 'city.demolish', buildingId: 'villa-l' }]);
    const three = await plan(world, 'Remove three apartments', {});
    expect(three).toMatchObject({ status: 'REJECTED', commands: [] });
    expect(three.warnings[0]).toMatchObject({ code: 'TARGET_COUNT', message: expect.stringContaining('the city has 2') });
  });

  it('respects request-level preservation and road preservation conflicts', async () => {
    const world = city();
    const kept = await plan(world, 'Phá tất cả chung cư nhưng giữ Sea Flats', { allowDestructive: true, allowedDemolitions: ['apt-a', 'apt-b'] });
    expect(kept.authorization).toMatchObject({ protectedIds: ['apt-b'] });
    const conflict = await createProposal(world, world.revision, { ...interpretLocally('remove road at 10,5'), preserveRoads: true }, 0, { allowDestructive: true, allowedRoadRemovals: [{ x: 10, y: 5 }] });
    expect(conflict.warnings.map((w) => w.code)).toContain('ROAD_PRESERVATION_CONFLICT');
    expect(conflict.commands).toEqual([]);
    const removed = await plan(world, 'Remove the two apartment buildings but preserve the roads.', { allowDestructive: true, allowedDemolitions: ['apt-a', 'apt-b'] });
    expect(removed.status).toBe('VALIDATED');
    expect(removed.roads.remove).toEqual([]);
    expect(removed.projectedPlan.roads).toEqual(world.plan.roads);
  });

  it('moves a building to an empty lot that already touches a road, only after authorization', async () => {
    const world = city({ buildings: [b('apt-a', 'apartment', 4, 16, 'Harbor Flats'), b('villa-l', 'villa', 3, 6)] });
    const blocked = await plan(world, 'Di chuyển tòa chung cư sang khu đất trống gần đường.');
    expect(blocked.authorization).toMatchObject({ move: ['apt-a'], destructiveRequired: false });
    const moved = await plan(world, 'Di chuyển tòa chung cư sang khu đất trống gần đường.', authorize(world, { demolish: [], move: ['apt-a'] }));
    expect(moved.status).toBe('VALIDATED');
    expect(moved.roads.add).toEqual([]);
    expect(moved.placements).toEqual([expect.objectContaining({ buildingId: 'apt-a', operation: 'move' })]);
    const after = moved.projectedPlan.buildings.find((x) => x.id === 'apt-a')!;
    expect(new RoadGraph(moved.projectedPlan.roads).getAdjacentComponents(after).length).toBeGreaterThan(0);
  });
});

describe('better planning', () => {
  it('builds exact multi-type requests with a connected road network and never silently reduces quantities', async () => {
    const world = city();
    const result = await plan(world, 'Xây 10 biệt thự và 2 chung cư, thêm đường kết nối.');
    expect(result.status).toBe('VALIDATED');
    const counts = result.placements.reduce<Record<string, number>>((n, p) => ({ ...n, [p.buildingType]: (n[p.buildingType] ?? 0) + 1 }), {});
    expect(counts).toEqual({ villa: 10, apartment: 2 });
    expect(new RoadGraph(result.projectedPlan.roads).getComponents()).toHaveLength(1);
    const poor = createWorld({ ...JSON.parse(JSON.stringify({ id: 'poor', plan: world.plan })), seed: 1, startingFunds: 500, clock: { paused: true } });
    const tooMany = await plan(poor, 'Build eight villas');
    expect(tooMany).toMatchObject({ status: 'REJECTED', commands: [] });
    expect(tooMany.warnings.map((w) => w.code)).toContain('QUANTITY_UNFULFILLED');
  });

  it('prefers lots that already touch roads and keeps a multi-building request together', async () => {
    const world = city();
    const result = await plan(world, 'Build a residential neighborhood with eight villas and two parks.');
    expect(result.status).toBe('VALIDATED');
    // Villas take lots that already touch a road; only the parks get short links (connectRoads).
    const graph = new RoadGraph(world.plan.roads);
    for (const p of result.placements.filter((x) => x.buildingType === 'villa')) expect(graph.getAdjacentComponents({ ...p, id: p.buildingId, name: '', kind: 'home', capacity: 2 } as Building).length).toBeGreaterThan(0);
    expect(result.roads.add.length).toBeLessThanOrEqual(6);
    const xs = result.placements.map((p) => p.position.x), ys = result.placements.map((p) => p.position.y);
    expect(Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)).toBeLessThan(40);
  });

  it('normalizes legacy intents so Phase 2 clients plan identically', async () => {
    const world = city();
    const full = interpretLocally('Build two villas');
    const { demolishTargets: _d, moveTargets: _m, preserveRoads: _r, preserveTypes: _t, ...legacy } = full;
    expect((await createProposal(world, 0, legacy as ArchitectIntent)).digest).toBe((await createProposal(world, 0, full)).digest);
  });
});

describe('population, housing and the waiting player', () => {
  it('reports displaced residents and a removed player home in the impact, and the engine re-homes residents first', async () => {
    const world = city({ population: true });
    const sim = new Simulation(world);
    const look = { skinTone: 1, hairStyle: 'bun', hairColor: 1, outfit: 'tee', outfitColor: 0, accessory: 'none' } as const;
    // Every room is taken: the character waits unplaced.
    sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    expect(playerHomeOptions(sim.getState()).every((o) => !o.available)).toBe(true);
    // AI-planned housing keeps a room for the waiting player; residents never take it.
    const live = sim.getState();
    const housing = await createProposal(live, live.revision, interpretLocally('Xây 2 biệt thự gần đường'), 0, protectAll(live));
    expect(housing.status).toBe('VALIDATED');
    const review = new PlanReview(sim, housing);
    await review.preview();
    review.approve(housing.planId);
    await review.apply();
    const free = playerHomeOptions(sim.getState()).filter((o) => o.available);
    expect(free).toHaveLength(1);
    expect(sim.executeLife({ type: 'player.move-in', homeBuildingId: free[0]!.buildingId }).reason).toBeNull();
    // Demolishing the player's home through AI is visible in the impact before approval.
    const now = sim.getState();
    const home = now.player!.homeBuildingId!;
    const demolish = await createProposal(now, now.revision, { ...interpretLocally('demolish'), ambiguities: [], demolishTargets: [sel({ ids: [home] })] }, 0,
      { preserveBuildingIds: [], allowDestructive: true, allowedDemolitions: [home] });
    expect(demolish.status).toBe('VALIDATED');
    expect(demolish.impact).toMatchObject({ playerHomeRemoved: true, buildingsRemoved: 1, roomsRemoved: 2 });
    expect(demolish.impact.residentsRemoved + demolish.impact.residentsRehoused).toBe(1);
    const second = new PlanReview(sim, demolish);
    await second.preview();
    second.approve(demolish.planId, { allowDestructive: true });
    await second.apply();
    expect(sim.getPlayer()).toMatchObject({ homeBuildingId: null });
  });
});
