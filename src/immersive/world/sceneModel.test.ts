import { describe, expect, it } from 'vitest';
import { serializeWorld, validateWorld } from '@tiny-city/simulation';
import type { WorldState } from '@tiny-city/simulation';
import { actorScene, CHUNK, chunkKey, diffStatic, drawableVehicles, interactionTarget, staticSceneOf, stopSlot } from './sceneModel';
import { LIVING_TOWN, livingTown } from './livingFixture';

const designs = new Map(LIVING_TOWN.buildings.flatMap((b) => (b.design ? [[b.id, b.design] as const] : [])));
const roadsOf = (world: WorldState) => { const set = new Set(world.plan.roads.map((r) => `${r.x},${r.y}`)); return (x: number, y: number) => set.has(`${x},${y}`); };

describe('static scene: buildings, roads, stops and landscaping from the plan', () => {
  it('maps every building, road tile and stop to one stable entity, nothing more', () => {
    const world = livingTown(0).getState();
    const scene = staticSceneOf(world, designs);
    expect([...scene.buildings.keys()].sort()).toEqual(world.plan.buildings.map((b) => b.id).sort());
    expect(scene.roads.size).toBe(world.plan.roads.length);
    expect([...scene.stops.keys()].sort()).toEqual(world.transport!.stops.map((s) => s.id).sort());
    for (const b of scene.buildings.values()) {
      const source = world.plan.buildings.find((p) => p.id === b.id)!;
      expect(b.position).toEqual(source.position); expect(b.footprint).toEqual(source.footprint);
    }
    // Villas north of Terrace Road face south (onto it); the café south of Market Street turns north to meet it.
    expect(scene.buildings.get('glass')!.facing).toBe('S');
    expect(scene.buildings.get('cafe')!.facing).toBe('N');
    expect(scene.buildings.get('glass')!.design?.model).toBe('lm.villa.glass-pavilion');
    // Same input, same scene (deterministic, renderer-independent).
    const again = staticSceneOf(world, designs);
    expect(diffStatic(scene, again).empty).toBe(true);
  });

  it('hydrates from nothing, then diffs construction, demolition and road edits by ID and chunk', () => {
    const sim = livingTown(0);
    const first = staticSceneOf(sim.getState(), designs);
    const hydrate = diffStatic(null, first);
    expect(hydrate.buildings.added).toHaveLength(LIVING_TOWN.buildings.length);
    expect(hydrate.roadChunks.size).toBeGreaterThan(0);
    // Build a villa on Market Street's north side.
    const built = sim.execute({ type: 'city.build', buildingType: 'villa', position: { x: 24, y: 22 } });
    expect(built.applied).toBe(true);
    const afterBuild = staticSceneOf(sim.getState(), designs);
    const d1 = diffStatic(first, afterBuild);
    expect(d1.buildings.added.map((b) => b.position)).toEqual([{ x: 24, y: 22 }]);
    expect(d1.buildings.removed).toEqual([]);
    expect(d1.decorChunks.has(chunkKey(24, 22)) || d1.decorChunks.size === 0).toBe(true);
    // Demolish it again: removed by its ID.
    const id = d1.buildings.added[0]!.id;
    expect(sim.execute({ type: 'city.demolish', buildingId: id }).applied).toBe(true);
    const d2 = diffStatic(afterBuild, staticSceneOf(sim.getState(), designs));
    expect(d2.buildings.removed).toEqual([id]);
  });

  it('a road edit marks the chunks of the changed tile and of neighbours whose masks change', () => {
    const sim = livingTown(0);
    const before = staticSceneOf(sim.getState(), designs);
    expect(sim.execute({ type: 'city.edit-roads', add: [{ x: 31, y: 24 }], remove: [] }).applied).toBe(true);
    const after = staticSceneOf(sim.getState(), designs);
    const d = diffStatic(before, after);
    expect(d.roadChunks.has(chunkKey(31, 24))).toBe(true);
    expect(after.roads.get('30,24')!.mask).not.toBe(before.roads.get('30,24')!.mask);
    expect(d.roadChunks.has(chunkKey(30, 24))).toBe(true);
    expect(d.buildings.added).toEqual([]);
    expect(CHUNK).toBe(12);
  });
});

describe('actors: residents and vehicles exactly as the simulation has them', () => {
  /** Every invariant the renderer relies on, at one moment. */
  function check(world: WorldState) {
    validateWorld(world);
    const scene = staticSceneOf(world, designs);
    const actors = actorScene(world, roadsOf(world), scene.stops);
    const ids = actors.residents.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const byId = new Map(world.citizens.map((c) => [c.id, c]));
    for (const r of actors.residents) {
      const c = byId.get(r.id)!;
      expect(c).toBeDefined();
      expect(r.name).toBe(c.name);
      expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true);
      if (r.mode === 'walking' || r.mode === 'waiting') {
        expect(r.x).toBe(c.position.x); expect(r.y).toBe(c.position.y);
        expect(roadsOf(world)(Math.floor(r.x), Math.floor(r.y))).toBe(true);
      }
      if (r.mode === 'at-stop') expect(world.transport!.trips.find((t) => t.citizenId === r.id)?.phase).toBe('waiting');
      if (r.mode === 'at-venue') expect(c.movement?.status === 'inside' && c.movement.currentBuildingId === r.venueId && c.activity === 'leisure').toBe(true);
      // Never inside a building's walls: walkers stand on roads, visitors at open-air venues only.
      if (r.mode !== 'at-venue') for (const b of world.plan.buildings) {
        const inside = r.x >= b.position.x && r.x < b.position.x + b.footprint.width && r.y >= b.position.y && r.y < b.position.y + b.footprint.height;
        expect(inside).toBe(false);
      }
    }
    // Everyone is accounted for exactly once: drawn, or hidden for a stated reason.
    const h = actors.hidden;
    expect(actors.residents.length + h.inside + h.onLot + h.riding + h.driving).toBe(world.citizens.length);
    const riders = (world.transport?.vehicles ?? []).filter((v) => v.kind === 'bus').reduce((n, v) => n + v.passengers.length, 0);
    expect(h.riding).toBe(riders);
    for (const v of drawableVehicles(world)) expect(v.state).not.toBe('departing');
    return actors;
  }

  it('holds the invariants all day: commutes, buses, outings and evenings', () => {
    const sim = livingTown(0);
    const seen = { walking: 0, atStop: 0, atVenue: 0, riding: 0, driving: 0 };
    for (let minute = 0; minute < 1440; minute += 20) {
      sim.step(20);
      const a = check(sim.getState());
      seen.walking += a.residents.filter((r) => r.mode === 'walking').length;
      seen.atStop += a.residents.filter((r) => r.mode === 'at-stop').length;
      seen.atVenue += a.residents.filter((r) => r.mode === 'at-venue').length;
      seen.riding += a.hidden.riding; seen.driving += a.hidden.driving;
    }
    // A real day in this town has walkers, bus riders, drivers and venue visitors.
    expect(seen.walking).toBeGreaterThan(0);
    expect(seen.atVenue).toBeGreaterThan(0);
    expect(seen.riding + seen.atStop + seen.driving).toBeGreaterThan(0);
  });

  it('never changes the world (no renderer-driven economy, transport or society changes)', () => {
    const sim = livingTown(17 * 60);
    const world = sim.getState();
    const before = serializeWorld(world);
    const scene = staticSceneOf(world, designs);
    actorScene(world, roadsOf(world), scene.stops);
    interactionTarget({ x: 12, y: 14.5 }, 0, [], scene.buildings.values(), scene.stops.values());
    expect(serializeWorld(world)).toBe(before);
  });

  it('places waiting passengers beside their stop, on the curb half of the tile', () => {
    const stop = { tile: { x: 9, y: 14 }, side: 'N' as const };
    for (let i = 0; i < 12; i += 1) {
      const p = stopSlot(stop, i);
      expect(Math.floor(p.x)).toBe(9); expect(Math.floor(p.y)).toBe(14);
      expect(p.y).toBeLessThan(14.5);
    }
    const slots = Array.from({ length: 10 }, (_, i) => stopSlot(stop, i));
    for (let i = 0; i < slots.length; i += 1) for (let j = i + 1; j < slots.length; j += 1) expect(Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.y - slots[j]!.y)).toBeGreaterThan(0.06);
  });
});

describe('interaction targets resolve to real records', () => {
  const world = livingTown(0).getState();
  const scene = staticSceneOf(world, designs);
  it('picks the resident the character faces and ignores one behind', () => {
    const people = [{ id: 'a', name: 'Ahead', x: 12, y: 15 }, { id: 'b', name: 'Behind', x: 12, y: 13.6 }];
    expect(interactionTarget({ x: 12, y: 14.4 }, 0, people, [], [])).toMatchObject({ kind: 'resident', id: 'a', label: 'Ahead' });
    expect(interactionTarget({ x: 12, y: 14.4 }, Math.PI, people, [], [])).toMatchObject({ kind: 'resident', id: 'b' });
    expect(interactionTarget({ x: 12, y: 14.4 }, Math.PI / 2, [{ id: 'c', name: 'Far', x: 15, y: 14.4 }], [], [])).toBeNull();
  });

  it('picks the building whose lot the character faces, and a stop next to it', () => {
    // Facing north (−y) toward the Glass Pavilion's lot from Terrace Road.
    const t = interactionTarget({ x: 11, y: 14.3 }, Math.PI, [], scene.buildings.values(), scene.stops.values());
    expect(t?.kind === 'building' || t?.kind === 'stop').toBe(true);
    const villa = interactionTarget({ x: 11.5, y: 14.4 }, Math.PI, [], scene.buildings.values(), []);
    expect(villa).toMatchObject({ kind: 'building', id: 'glass' });
    const stop = interactionTarget({ x: 9.5, y: 14.8 }, Math.PI, [], [], scene.stops.values());
    expect(stop?.kind).toBe('stop');
    expect(world.transport!.stops.some((s) => s.id === stop!.id)).toBe(true);
  });
});
