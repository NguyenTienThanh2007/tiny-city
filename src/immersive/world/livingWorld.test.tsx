import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { cleanup, render, screen, within } from '@testing-library/react';
import { deserializeWorld, serializeWorld } from '@tiny-city/simulation';
import type { RoadNavigator, WorldState } from '@tiny-city/simulation';
import { buildWalkGrid, isClear, moveCircle } from '../collision';
import { MOVEMENT } from '../controller';
import { planDecor } from '../../game/worldDecor';
import { skyState } from '../three/atmosphere';
import { ACTOR_LIMITS, ResidentActors, SIDEWALK_OFFSET, walkerOffset } from '../three/actors';
import { InspectPanel } from '../InspectPanel';
import { venueView } from '../../simulation/societyView';
import { releaseGpuResources } from '../three/cityScene';
import { LIVING_TOWN, livingTown } from './livingFixture';
import { actorScene, diffStatic, drawableVehicles, staticSceneOf, stopFootprint, stopObstacles, type ResidentEntity } from './sceneModel';

const designs = new Map(LIVING_TOWN.buildings.flatMap((b) => (b.design ? [[b.id, b.design] as const] : [])));
const roadsOf = (world: WorldState) => { const set = new Set(world.plan.roads.map((r) => `${r.x},${r.y}`)); return (x: number, y: number) => set.has(`${x},${y}`); };
const actorsOf = (world: WorldState) => actorScene(world, roadsOf(world), staticSceneOf(world, designs).stops);

describe('rendering rules for residents', () => {
  it('draws walkers on the sidewalk to the right of their heading, like vehicles keep to their lane', () => {
    const offset = (x: number, y: number) => { const o = walkerOffset({ x, y }); return { x: o.x + 0, y: o.y + 0 }; };
    expect(offset(1, 0)).toEqual({ x: 0, y: SIDEWALK_OFFSET });      // walking east: the south curb (y down)
    expect(offset(-1, 0)).toEqual({ x: 0, y: -SIDEWALK_OFFSET });
    expect(offset(0, 1)).toEqual({ x: -SIDEWALK_OFFSET, y: 0 });
    expect(offset(0, 0)).toEqual({ x: 0, y: 0 });
    // Inside the road tile, on its sidewalk band (sidewalks are the outer 0.2 of the tile).
    expect(0.5 + SIDEWALK_OFFSET).toBeLessThan(1); expect(0.5 + SIDEWALK_OFFSET).toBeGreaterThan(0.8);
  });

  it('shows a running concert with exactly its real attendees at the stage', () => {
    // Day 4 is Friday: the stage concert starts at 20:00.
    const sim = livingTown(4 * 1440 + 20 * 60 + 50);
    const world = sim.getState();
    const concert = world.society!.events.find((e) => e.kind === 'concert' && e.status === 'running');
    expect(concert).toBeDefined();
    const atStage = actorsOf(world).residents.filter((r) => r.mode === 'at-venue' && r.venueId === concert!.venueId);
    expect(atStage.length).toBeGreaterThan(0);
    for (const r of atStage) {
      // Every visitor drawn at the stage is really there on an outing to it, and counted as an attendee.
      expect(world.society!.residents[r.id]!.outing).toMatchObject({ venueId: concert!.venueId, status: 'present' });
      expect(concert!.attendees).toContain(r.id);
      expect(r.action).toBe('cheer');
    }
  });

  it('is a pure function of the world: the same state (paused, replayed, any speed) gives the same scene', () => {
    const a = livingTown(17 * 60), b = livingTown(17 * 60);
    expect(serializeWorld(a.getState())).toBe(serializeWorld(b.getState()));
    expect(actorsOf(a.getState())).toEqual(actorsOf(b.getState()));
    // 30 ticks in one call (a fast-forwarded frame) or one at a time: identical world, identical scene.
    a.step(30);
    for (let i = 0; i < 30; i += 1) b.step(1);
    expect(serializeWorld(a.getState())).toBe(serializeWorld(b.getState()));
    expect(actorsOf(a.getState())).toEqual(actorsOf(b.getState()));
    // Paused: computing the scene again changes nothing and gives the same answer.
    a.pause();
    const before = serializeWorld(a.getState());
    expect(actorsOf(a.getState())).toEqual(actorsOf(a.getState()));
    expect(serializeWorld(a.getState())).toBe(before);
  });
});

describe('time of day follows the game clock only', () => {
  it('passes through day, golden hour, dusk and night smoothly, with lights on at night', () => {
    expect(skyState(12 * 60).lighting.phase).toBe('day');
    expect(skyState(18 * 60 + 30).lighting.phase).toBe('golden');
    expect(skyState(20 * 60 + 30).lighting.phase).toBe('dusk');
    expect(skyState(23 * 60)).toMatchObject({ glow: 1, sunIntensity: 0 });
    expect(skyState(12 * 60).glow).toBe(0);
    for (let m = 0; m < 1440; m += 1) {
      const a = skyState(m), b = skyState(m + 1);
      expect(Math.abs(a.glow - b.glow)).toBeLessThan(0.05);
      expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.15);
    }
    // Only the minute matters: the same minute on another day is the same sky.
    expect(skyState(1440 * 3 + 600)).toEqual(skyState(600));
  });
});

describe('collision follows the city', () => {
  it('bus shelters are solid for the character, in the same place for camera and collision', () => {
    const world = livingTown(0).getState();
    const shelters = stopObstacles(world);
    expect(shelters).toHaveLength(world.transport!.stops.length);
    const grid = buildWalkGrid(world.plan, planDecor(world.plan), shelters);
    for (const s of shelters) expect(isClear(grid, { x: (s.minX + s.maxX) / 2, y: (s.minY + s.maxY) / 2 }, MOVEMENT.radius)).toBe(false);
    const stop = staticSceneOf(world, designs).stops.values().next().value!;
    expect(stopFootprint(stop)).toEqual({ minX: shelters[0]!.minX, minY: shelters[0]!.minY, maxX: shelters[0]!.maxX, maxY: shelters[0]!.maxY });
  });

  it('a removed road stops being walkable and a new one becomes walkable at once', () => {
    const sim = livingTown(0);
    expect(sim.execute({ type: 'city.edit-roads', add: [{ x: 31, y: 24 }], remove: [] }).applied).toBe(true);
    let grid = buildWalkGrid(sim.getState().plan, []);
    expect(moveCircle(grid, { x: 30.5, y: 24.5 }, { x: 0.8, y: 0 }, MOVEMENT.radius).position.x).toBeCloseTo(31.3, 6);
    expect(sim.execute({ type: 'city.edit-roads', add: [], remove: [{ x: 31, y: 24 }] }).applied).toBe(true);
    grid = buildWalkGrid(sim.getState().plan, []);
    expect(moveCircle(grid, { x: 30.5, y: 24.5 }, { x: 0.8, y: 0 }, MOVEMENT.radius).position.x).toBeLessThanOrEqual(31 - MOVEMENT.radius + 1e-9);
  });
});

describe('resource cleanup', () => {
  it('releases every geometry, material, texture and instanced buffer under a scene (renderer listeners dropped)', () => {
    const scene = new THREE.Scene();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const geometry = new THREE.BoxGeometry();
    const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4);
    scene.add(new THREE.Mesh(geometry, material), instanced);
    const spies = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    texture.addEventListener('dispose', spies[0]!); material.addEventListener('dispose', spies[1]!);
    geometry.addEventListener('dispose', spies[2]!); instanced.addEventListener('dispose', spies[3]!);
    releaseGpuResources(scene);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('drawn residents follow the simulation and keep their identity', () => {
  const entity = (id: string, x: number, y: number, heading = { x: 1, y: 0 }): ResidentEntity =>
    ({ id, name: `Name ${id}`, x, y, heading, mode: 'walking', action: 'none', activity: 'travel', venueId: null, stopId: null });
  const at = (actors: ResidentActors, id: string) => actors.list().find((r) => r.id === id)!;

  it('eases toward each new authoritative position, snaps across jumps, and draws each ID once', () => {
    const actors = new ResidentActors(ACTOR_LIMITS.high);
    actors.sync([entity('npc-1', 10.5, 14.5)], { x: 10, y: 14 }, 0, 0);
    const offset = walkerOffset({ x: 1, y: 0 });
    expect(at(actors, 'npc-1')).toMatchObject({ x: 10.5 + offset.x, y: 14.5 + offset.y });
    // The simulation moves them 0.2 tiles: one short frame moves the figure part of the way, never past the target.
    actors.sync([entity('npc-1', 10.7, 14.5)], { x: 10, y: 14 }, 0.016, 0.016);
    const x1 = at(actors, 'npc-1').x;
    expect(x1).toBeGreaterThan(10.5 + offset.x); expect(x1).toBeLessThan(10.7 + offset.x);
    for (let i = 0; i < 60; i += 1) actors.sync([entity('npc-1', 10.7, 14.5)], { x: 10, y: 14 }, 0.016, 0.016 * i);
    expect(at(actors, 'npc-1').x).toBeCloseTo(10.7 + offset.x, 3);
    // A jump (a new venue spot, a stop slot) is taken at once rather than gliding through walls.
    actors.sync([entity('npc-1', 20.5, 14.5)], { x: 10, y: 14 }, 0.016, 1);
    expect(at(actors, 'npc-1').x).toBeCloseTo(20.5 + offset.x, 6);
    // Paused (dt = 0): nothing moves even if asked to sync again.
    const still = at(actors, 'npc-1');
    actors.sync([entity('npc-1', 21.5, 14.5)], { x: 10, y: 14 }, 0, 1);
    expect(at(actors, 'npc-1').x).toBe(still.x);
    // The same ID twice in a frame is still one figure; leaving the simulation removes it.
    actors.sync([entity('npc-1', 20.5, 14.5), entity('npc-2', 11.5, 14.5)], { x: 10, y: 14 }, 0.016, 2);
    expect(actors.count).toBe(2);
    actors.sync([entity('npc-2', 11.5, 14.5)], { x: 10, y: 14 }, 0.016, 2);
    expect(actors.list().map((r) => r.id)).toEqual(['npc-2']);
    for (const r of actors.list()) expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true);
    actors.dispose();
    expect(actors.count).toBe(0);
  });

  it('draws only the nearest residents within the radius, building a bounded number per frame', () => {
    const actors = new ResidentActors(ACTOR_LIMITS.low);
    const crowd = Array.from({ length: 50 }, (_, i) => entity(`npc-${String(i).padStart(2, '0')}`, 10 + (i % 10) * 0.3, 14 + Math.floor(i / 10) * 0.3));
    const far = entity('npc-far', 10 + ACTOR_LIMITS.low.residentRadius + 5, 14);
    actors.sync([...crowd, far], { x: 10, y: 14 }, 0.016, 0);
    expect(actors.count).toBe(ACTOR_LIMITS.low.builds);
    for (let i = 0; i < 40; i += 1) actors.sync([...crowd, far], { x: 10, y: 14 }, 0.016, i);
    expect(actors.count).toBe(ACTOR_LIMITS.low.residents);
    expect(actors.list().some((r) => r.id === 'npc-far')).toBe(false);
    actors.dispose();
  });
});

describe('save and load', () => {
  it('a reloaded world gives the same scene: same entities, same residents, nothing duplicated', () => {
    const world = livingTown(18 * 60).getState();
    const loaded = deserializeWorld(serializeWorld(world));
    const a = staticSceneOf(world, designs), b = staticSceneOf(loaded, designs);
    expect([...b.buildings.values()]).toEqual([...a.buildings.values()]);
    expect([...b.roads.keys()]).toEqual([...a.roads.keys()]);
    expect([...b.stops.values()]).toEqual([...a.stops.values()]);
    expect(diffStatic(a, b).empty).toBe(true);
    expect(actorsOf(loaded)).toEqual(actorsOf(world));
    expect(drawableVehicles(loaded).map((v) => v.id)).toEqual(drawableVehicles(world).map((v) => v.id));
  });
});

describe('inspecting a building', () => {
  it('shows the simulation’s own occupancy (an office, a café) and changes nothing', () => {
    const sim = livingTown(12 * 60);
    const world = sim.getState();
    const before = serializeWorld(world);
    const office = world.plan.buildings.find((b) => b.type === 'office')!;
    const occupancy = sim.getBuildingOccupancy(office.id);
    render(<InspectPanel target={{ kind: 'building', id: office.id, label: office.name, distance: 0.5 }} world={world} nav={{} as RoadNavigator}
      occupancy={(id) => sim.getBuildingOccupancy(id)} onLife={() => { throw new Error('no command expected'); }} onClose={() => {}} />);
    const panel = screen.getByRole('dialog', { name: `Inspect ${office.name}` });
    expect(within(panel).getByRole('heading', { name: office.name })).toBeTruthy();
    expect(within(panel).getByText(`${occupancy.workerIds.length} of ${office.capacity} jobs`)).toBeTruthy();
    cleanup();
    // A café: hours and the visitors inside now, from the society view model the City View uses.
    const cafe = world.plan.buildings.find((b) => b.type === 'cafe')!;
    const venue = venueView(world, cafe)!;
    render(<InspectPanel target={{ kind: 'building', id: cafe.id, label: cafe.name, distance: 0.5 }} world={world} nav={{} as RoadNavigator}
      occupancy={(id) => sim.getBuildingOccupancy(id)} onLife={() => { throw new Error('no command expected'); }} onClose={() => {}} />);
    const cafePanel = screen.getByRole('dialog', { name: `Inspect ${cafe.name}` });
    expect(within(cafePanel).getByText(`${venue.openNow ? 'Open' : 'Closed'} · ${venue.hours}`)).toBeTruthy();
    expect(within(cafePanel).getByText(`${venue.visitors} of ${venue.capacity}`)).toBeTruthy();
    expect(within(cafePanel).getByRole('button', { name: 'Eat here' })).toBeTruthy();
    expect(serializeWorld(sim.getState())).toBe(before);
  });
});
