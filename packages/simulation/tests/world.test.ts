import { describe, expect, it } from 'vitest';
import { cloneWorld, createWorld, validateSchedule, validateWorld } from '../src/index.js';
import { createDemoWorldFixture, createEmptyWorldFixture } from '../src/fixtures.js';

describe('world contracts and fixtures', () => {
  it('provides valid demo and empty worlds without renderer dependencies', () => {
    const demo = createDemoWorldFixture();
    expect(demo.plan.buildings).toHaveLength(6);
    expect(demo.citizens).toHaveLength(4);
    expect(() => validateWorld(demo)).not.toThrow();
    const empty = createEmptyWorldFixture();
    expect(empty.plan.buildings).toEqual([]);
    expect(empty.citizens).toEqual([]);
    expect(() => validateWorld(empty)).not.toThrow();
  });

  it('produces repeatable but fresh seeded snapshots with stable IDs', () => {
    const first = createDemoWorldFixture({ seed: 7 });
    const second = createDemoWorldFixture({ seed: 7 });
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    const different = createDemoWorldFixture({ seed: 8 });
    expect(different.citizens[0]?.position).not.toEqual(first.citizens[0]?.position);
    expect(different.citizens.map((citizen) => citizen.id)).toEqual(first.citizens.map((citizen) => citizen.id));
  });

  it('roundtrips plain JSON and keeps snapshots deeply immutable', () => {
    const world = createDemoWorldFixture();
    expect(JSON.parse(JSON.stringify(world))).toEqual(world);
    expect(Object.isFrozen(world)).toBe(true);
    expect(Object.isFrozen(world.plan.buildings[0]?.position)).toBe(true);
    expect(Object.isFrozen(world.citizens[0]?.schedule.entries)).toBe(true);
    const clone = cloneWorld(world);
    expect(clone).toEqual(world);
    expect(clone.plan.buildings[0]).not.toBe(world.plan.buildings[0]);
    expect(clone.citizens[0]?.schedule.entries).not.toBe(world.citizens[0]?.schedule.entries);
  });

  it('copies caller-owned plan data when creating a world', () => {
    const plan = { id: 'plan', name: 'Plan', width: 4, height: 4, buildings: [] };
    const world = createWorld({ id: 'world', plan, seed: 0 });
    plan.name = 'Changed';
    expect(world.plan.name).toBe('Plan');
    expect(world.randomState).toBe(0);
    expect(Object.isFrozen(plan)).toBe(false);
  });

  it('rejects invalid dimensions, duplicate IDs, footprints, and building references', () => {
    const world = createDemoWorldFixture();
    const building = world.plan.buildings[0]!;
    const citizen = world.citizens[0]!;
    expect(() => validateWorld({ ...world, plan: { ...world.plan, width: 0 } })).toThrow();
    expect(() => validateWorld({ ...world, plan: { ...world.plan, buildings: [building, building] } })).toThrow(/duplicate/);
    expect(() => validateWorld({ ...world, plan: { ...world.plan, buildings: [{ ...building, footprint: { width: 100, height: 2 } }] } })).toThrow(/footprint/);
    expect(() => validateWorld({ ...world, citizens: [citizen, citizen] })).toThrow(/duplicate/);
    expect(() => validateWorld({ ...world, citizens: [{ ...citizen, homeBuildingId: 'missing' }] })).toThrow(/unknown home/);
    expect(() => validateWorld({ ...world, citizens: [{ ...citizen, workBuildingId: 'missing' }] })).toThrow(/unknown workplace/);
    expect(() => validateWorld({ ...world, citizens: [{ ...citizen, position: { x: NaN, y: 0 } }] })).toThrow(/position/);
  });

  it('rejects incomplete, unsorted, duplicate, and dangling schedules', () => {
    const plan = createDemoWorldFixture().plan;
    expect(() => validateSchedule({ entries: [] }, plan)).toThrow();
    expect(() => validateSchedule({ entries: [{ startMinute: 1, activity: 'idle', targetBuildingId: null }] }, plan)).toThrow(/minute 0/);
    for (const minute of [-1, 0, 1.5, 1440]) {
      expect(() => validateSchedule({ entries: [
        { startMinute: 0, activity: 'idle', targetBuildingId: null },
        { startMinute: minute, activity: 'home', targetBuildingId: 'home-maple' },
      ] }, plan)).toThrow(/minutes/);
    }
    expect(() => validateSchedule({ entries: [{ startMinute: 0, activity: 'home', targetBuildingId: 'missing' }] }, plan)).toThrow(/unknown building/);
  });
});
