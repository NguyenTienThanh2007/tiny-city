import { describe, expect, it } from 'vitest';
import { Simulation } from '@tiny-city/simulation';
import type { Citizen, WorldState } from '@tiny-city/simulation';
import { createLivingWorldFixture } from '@tiny-city/simulation/fixtures';
import {
  blendPosition, buildingDepth, citizenAppearance, citizenDepth, isCitizenOutdoors, laneOffset, receiveSnapshot, screenFacing, skyTint,
} from './npcMotion';

describe('resident appearance', () => {
  it('is stable per ID and always resolves every palette slot', () => {
    for (let index = 1; index <= 2000; index += 1) {
      const look = citizenAppearance(`npc-${index}`);
      expect(look).toEqual(citizenAppearance(`npc-${index}`));
      for (const value of [look.skin, look.hair, look.shirt, look.pants]) expect(Number.isInteger(value)).toBe(true);
      expect(['short', 'long', 'bun', 'cap']).toContain(look.hairStyle);
      expect(['shirt', 'dress', 'jacket']).toContain(look.silhouette);
      expect(look.lane).toBeGreaterThan(0.1);
      expect(look.lane).toBeLessThan(0.25);
    }
  });

  it('varies visibly across a neighborhood', () => {
    const looks = Array.from({ length: 40 }, (_, index) => citizenAppearance(`npc-${index + 1}`));
    expect(new Set(looks.map((look) => look.shirt)).size).toBeGreaterThan(5);
    expect(new Set(looks.map((look) => look.hairStyle)).size).toBe(4);
  });
});

describe('motion between fixed ticks', () => {
  function travelling(): { simulation: Simulation; citizen: Citizen; world: WorldState } {
    const simulation = new Simulation(createLivingWorldFixture());
    for (let step = 0; step < 1440; step += 1) {
      const result = simulation.step();
      const citizen = result.state.citizens.find((entry) => entry.movement?.status === 'travelling' && isCitizenOutdoors(entry));
      if (citizen) return { simulation, citizen, world: result.state };
    }
    throw new Error('no resident travelled during a full day');
  }

  it('blends ordinary steps and snaps discontinuities', () => {
    const { simulation, citizen, world } = travelling();
    const first = receiveSnapshot(undefined, citizen, world).sample;
    const next = simulation.step().state;
    const moved = next.citizens.find((entry) => entry.id === citizen.id)!;
    const update = receiveSnapshot(first, moved, next);
    expect(update.snapped).toBe(false);
    const halfway = blendPosition(update.sample, 0.5);
    expect(halfway.x).toBeCloseTo((citizen.position.x + moved.position.x) / 2);
    expect(halfway.y).toBeCloseTo((citizen.position.y + moved.position.y) / 2);
    const teleported = receiveSnapshot(update.sample, { ...moved, position: { x: moved.position.x + 9, y: moved.position.y } }, { ...next, clock: { ...next.clock, tick: next.clock.tick + 1 } });
    expect(teleported.snapped).toBe(true);
    expect(blendPosition(teleported.sample, 0.2)).toEqual({ x: moved.position.x + 9, y: moved.position.y });
  });

  it('does not create a new sample when the snapshot is unchanged', () => {
    const { citizen, world } = travelling();
    const first = receiveSnapshot(undefined, citizen, world).sample;
    expect(receiveSnapshot(first, citizen, world).sample).toBe(first);
  });

  it('hides residents inside buildings and on private entrance legs', () => {
    const { citizen } = travelling();
    expect(isCitizenOutdoors(citizen)).toBe(true);
    expect(isCitizenOutdoors({ ...citizen, movement: { ...citizen.movement!, currentBuildingId: 'home-villa' } })).toBe(false);
    expect(isCitizenOutdoors({ ...citizen, movement: { ...citizen.movement!, status: 'inside' } })).toBe(false);
    expect(isCitizenOutdoors({ ...citizen, movement: undefined })).toBe(false);
  });
});

describe('isometric presentation helpers', () => {
  it('keeps residents to the right of their heading', () => {
    expect(laneOffset({ x: 1, y: 0 }, 0.2)).toEqual({ x: -0, y: 0.2 });
    expect(laneOffset({ x: -1, y: 0 }, 0.2)).toEqual({ x: -0, y: -0.2 });
    expect(laneOffset({ x: 0, y: 1 }, 0.2)).toEqual({ x: -0.2, y: 0 });
    expect(laneOffset({ x: 0, y: 0 }, 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('faces left/right and away from the camera from tile headings', () => {
    expect(screenFacing({ x: 1, y: 0 }, -1)).toEqual({ facing: 1, away: false });
    expect(screenFacing({ x: 0, y: 1 }, 1)).toEqual({ facing: -1, away: false });
    expect(screenFacing({ x: -1, y: 0 }, 1)).toEqual({ facing: -1, away: true });
    expect(screenFacing({ x: 0, y: 0 }, -1)).toEqual({ facing: -1, away: false });
  });

  it('sorts walkers behind and in front of catalog footprints', () => {
    for (const [width, height] of [[2, 2], [3, 2], [2, 3], [4, 4], [3, 4], [6, 5]] as const) {
      const depth = buildingDepth(10, 10, width, height);
      for (let index = 0; index < width; index += 1) {
        // Road behind (north) and in front (south), with the widest lane offset.
        expect(citizenDepth({ x: 10 + index + 0.5 + 0.2, y: 9.5 + 0.2 })).toBeLessThan(depth);
        expect(citizenDepth({ x: 10 + index + 0.5 - 0.2, y: 10 + height + 0.5 - 0.2 })).toBeGreaterThan(depth);
      }
      for (let index = 0; index < height; index += 1) {
        expect(citizenDepth({ x: 9.5 + 0.2, y: 10 + index + 0.5 + 0.2 })).toBeLessThan(depth);
        expect(citizenDepth({ x: 10 + width + 0.5 - 0.2, y: 10 + index + 0.5 - 0.2 })).toBeGreaterThan(depth);
      }
    }
  });

  it('tints only dusk, night and dawn', () => {
    expect(skyTint(12 * 60).opacity).toBe(0);
    expect(skyTint(23 * 60).opacity).toBeGreaterThan(0.2);
    expect(skyTint(18 * 60).opacity).toBeGreaterThan(0);
    expect(skyTint(6.5 * 60).opacity).toBeGreaterThan(0);
  });
});
