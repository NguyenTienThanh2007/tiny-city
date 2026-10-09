import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/index.js';
import type { SimulationEvent, WorldState } from '../src/index.js';
import { createDemoWorldFixture, createEmptyWorldFixture } from '../src/fixtures.js';

describe('simulation runner', () => {
  it('defers commands until a whole tick, then applies them FIFO', () => {
    const simulation = new Simulation(createDemoWorldFixture());
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'citizen-1', position: { x: 3, y: 4 } });
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'citizen-1', position: { x: 5, y: 6 } });
    expect(simulation.advance(99).events).toEqual([]);
    expect(simulation.pendingCommandCount).toBe(2);
    const result = simulation.advance(1);
    expect(result.state.citizens[0]?.position).toEqual({ x: 5, y: 6 });
    expect(result.events.map((event) => event.type)).toEqual(['command.applied', 'command.applied', 'clock.ticked']);
    expect(result.events.every((event) => event.tick === 1)).toBe(true);
    expect(simulation.pendingCommandCount).toBe(0);
    expect(simulation.step().events.map((event) => event.type)).toEqual(['clock.ticked']);
  });

  it('rejects bad commands without preventing later valid commands', () => {
    const simulation = new Simulation(createDemoWorldFixture());
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'missing', position: { x: 0, y: 0 } });
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'citizen-1', position: { x: 24, y: 0 } });
    simulation.enqueue({ type: 'citizen.set-schedule', citizenId: 'citizen-1', schedule: { entries: [] } });
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'citizen-1', position: { x: 0, y: 0 } });
    const result = simulation.step();
    expect(result.events.filter((event) => event.type === 'command.rejected').map((event) => event.reason))
      .toEqual(['citizen-not-found', 'invalid-position', 'invalid-schedule']);
    expect(result.state.citizens[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('copies initial state and enqueued payloads without freezing caller objects', () => {
    const fixture = createDemoWorldFixture();
    const initial = { ...fixture, citizens: fixture.citizens.map((citizen) => ({ ...citizen, position: { ...citizen.position } })) };
    const simulation = new Simulation(initial);
    const original = simulation.getState().citizens[0]?.position;
    initial.citizens[0]!.position.x = 20;
    expect(simulation.getState().citizens[0]?.position).toEqual(original);
    const position = { x: 3, y: 4 };
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'citizen-1', position });
    position.x = 10;
    expect(Object.isFrozen(position)).toBe(false);
    expect(simulation.step().state.citizens[0]?.position).toEqual({ x: 3, y: 4 });
  });

  it('changes activity exactly at schedule boundaries without spatial movement', () => {
    const simulation = new Simulation(createDemoWorldFixture({ clock: { minutesPerTick: 60 } }));
    const position = simulation.getState().citizens[0]?.position;
    simulation.step(7);
    expect(simulation.getState().citizens[0]?.activity).toBe('home');
    const work = simulation.step();
    expect(work.state.citizens[0]?.activity).toBe('work');
    expect(work.state.citizens[0]?.targetBuildingId).toBe('workshop');
    expect(work.state.citizens[0]?.position).toEqual(position);
    expect(work.events).toContainEqual({ type: 'citizen.activity-changed', tick: 8, citizenId: 'citizen-1', activity: 'work', targetBuildingId: 'workshop' });
  });

  it('selects a replacement schedule on the same tick the command is applied', () => {
    const simulation = new Simulation(createDemoWorldFixture());
    const entries = [{ startMinute: 0, activity: 'idle' as const, targetBuildingId: null }];
    simulation.enqueue({ type: 'citizen.set-schedule', citizenId: 'citizen-1', schedule: { entries } });
    entries[0]!.startMinute = 50;
    const result = simulation.step();
    expect(result.state.citizens[0]?.activity).toBe('idle');
    expect(result.events.map((event) => event.type)).toEqual(['command.applied', 'citizen.activity-changed', 'clock.ticked']);
  });

  it('handles midnight and reports every crossed day for larger game increments', () => {
    const simulation = new Simulation(createDemoWorldFixture({ clock: { minutesPerTick: 60 } }));
    const result = simulation.step(24);
    expect(result.state.citizens[0]?.activity).toBe('sleep');
    expect(result.events).toContainEqual({ type: 'clock.day-started', tick: 24, day: 1 });
    expect(result.events.at(-1)).toEqual({ type: 'clock.ticked', tick: 24, day: 1, minuteOfDay: 0 });
    const fast = new Simulation(createEmptyWorldFixture({ clock: { minutesPerTick: 3000 } }));
    expect(fast.step().events).toEqual([
      { type: 'clock.day-started', tick: 1, day: 1 },
      { type: 'clock.day-started', tick: 1, day: 2 },
      { type: 'clock.ticked', tick: 1, day: 2, minuteOfDay: 120 },
    ]);
  });

  it('replays identically across frame chunking and avoids consuming RNG on ticks', () => {
    const world = createDemoWorldFixture({ seed: 'replay', clock: { minutesPerTick: 60 } });
    const a = new Simulation(world);
    const b = new Simulation(world);
    for (const simulation of [a, b]) {
      simulation.enqueue({ type: 'citizen.relocate', citizenId: 'citizen-1', position: { x: 8, y: 8 } });
    }
    const all = a.advance(2400);
    const events: SimulationEvent[] = [];
    for (const elapsed of [17, 283, 600, 1499, 1]) events.push(...b.advance(elapsed).events);
    expect(b.getState()).toEqual(all.state);
    expect(events).toEqual(all.events);
    expect(all.state.randomState).toBe(world.randomState);
  });

  it('keeps commands queued during pauses and supports deterministic manual ticks', () => {
    const simulation = new Simulation(createDemoWorldFixture());
    simulation.advance(40);
    simulation.pause();
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'citizen-1', position: { x: 5, y: 5 } });
    expect(simulation.advance(5000).steps).toBe(0);
    expect(simulation.pendingCommandCount).toBe(1);
    expect(simulation.step().steps).toBe(1);
    expect(simulation.getState().clock.paused).toBe(true);
    expect(simulation.getState().clock.accumulatedMs).toBe(40);
    simulation.resume();
    expect(simulation.advance(60).state.clock.tick).toBe(2);
  });

  it('resumes a JSON snapshot with its fractional time and seeded random state', () => {
    const a = new Simulation(createDemoWorldFixture());
    a.advance(1234);
    const snapshot: WorldState = JSON.parse(JSON.stringify(a.getState()));
    const b = new Simulation(snapshot);
    expect(b.advance(966)).toEqual(a.advance(966));
  });

  it('leaves state and pending commands untouched after invalid advances', () => {
    const simulation = new Simulation(createDemoWorldFixture());
    simulation.enqueue({ type: 'citizen.relocate', citizenId: 'citizen-1', position: { x: 2, y: 3 } });
    const before = simulation.getState();
    expect(() => simulation.advance(-1)).toThrow(RangeError);
    expect(() => simulation.step(0.5)).toThrow(RangeError);
    expect(simulation.getState()).toBe(before);
    expect(simulation.pendingCommandCount).toBe(1);
    expect(simulation.step(0).events).toEqual([]);
    expect(simulation.pendingCommandCount).toBe(1);
    const result = simulation.step();
    expect(Object.isFrozen(result.events)).toBe(true);
    expect(Object.isFrozen(result.state.citizens[0]?.position)).toBe(true);
  });
});
