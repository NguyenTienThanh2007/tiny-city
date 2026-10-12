import { describe, expect, it } from 'vitest';
import { Simulation } from '@tiny-city/simulation';
import { createLivingWorldFixture } from '@tiny-city/simulation/fixtures';
import { describeCitizen, formatMinute, residentsWithoutJobs, scheduleRows, summarizeActivities } from './citizenView';
import { emptyLifeFeed, reduceLifeFeed } from './lifeFeed';

describe('resident presentation', () => {
  it('formats minutes and summarizes every activity', () => {
    expect(formatMinute(0)).toBe('00:00');
    expect(formatMinute(427)).toBe('07:07');
    expect(formatMinute(1440 + 61)).toBe('01:01');
    const world = new Simulation(createLivingWorldFixture()).getState();
    const summary = summarizeActivities(world.citizens);
    expect(Object.values(summary).reduce((sum, count) => sum + count, 0)).toBe(world.citizens.length);
  });

  it('describes homes, jobs, schedule and live travel from authoritative data only', () => {
    const simulation = new Simulation(createLivingWorldFixture());
    let state = simulation.getState();
    for (let step = 0; step < 1440; step += 1) {
      state = simulation.step().state;
      if (state.citizens.some((citizen) => citizen.movement?.status === 'travelling' && citizen.activity === 'travel')) break;
    }
    const traveller = state.citizens.find((citizen) => citizen.movement?.status === 'travelling')!;
    const details = describeCitizen(traveller, state);
    const home = state.plan.buildings.find((building) => building.id === traveller.homeBuildingId)!;
    expect(details.home).toBe(home.name);
    expect(details.travelStatus).toMatch(/^Heading to /);
    expect(details.remainingTiles).toBeGreaterThan(0);
    const rows = scheduleRows(traveller, state, 7 * 60 + 30);
    expect(rows).toHaveLength(traveller.schedule.entries.length);
    expect(rows.filter((row) => row.current)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ time: '00:00', activity: 'sleep', place: home.name });
    expect(rows.at(-1)!.endMinute).toBe(1440);
    const inside = state.citizens.find((citizen) => citizen.movement?.status === 'inside')!;
    expect(describeCitizen(inside, state).location).toMatch(/^Inside /);
  });

  it('counts residents without jobs', () => {
    const world = new Simulation(createLivingWorldFixture()).getState();
    expect(residentsWithoutJobs(world.citizens)).toBe(world.citizens.filter((citizen) => citizen.workBuildingId === null).length);
  });
});

describe('city life feed', () => {
  it('merges departures per game hour and reports population once', () => {
    const simulation = new Simulation(createLivingWorldFixture());
    let feed = reduceLifeFeed(emptyLifeFeed, [{ type: 'population.changed', tick: 0, count: simulation.getPopulationCount() }], simulation.getState());
    expect(feed.entries[0]!.text).toBe(`Population is now ${simulation.getPopulationCount()} residents`);
    for (let step = 0; step < 8 * 60; step += 1) {
      const result = simulation.step();
      feed = reduceLifeFeed(feed, result.events, result.state);
    }
    const commutes = feed.entries.filter((entry) => entry.kind === 'commute');
    expect(commutes.length).toBeGreaterThan(0);
    expect(new Set(commutes.map((entry) => entry.bucket)).size).toBe(commutes.length);
    expect(commutes.reduce((sum, entry) => sum + entry.count, 0)).toBeGreaterThan(1);
    expect(feed.entries.length).toBeLessThanOrEqual(8);
  });

  it('is a no-op for legacy worlds and for routine ticks', () => {
    const legacy = { ...new Simulation(createLivingWorldFixture()).getState(), population: undefined };
    expect(reduceLifeFeed(emptyLifeFeed, [{ type: 'population.changed', tick: 0, count: 3 }], legacy)).toBe(emptyLifeFeed);
    const simulation = new Simulation(createLivingWorldFixture());
    const primed = reduceLifeFeed(emptyLifeFeed, [{ type: 'clock.ticked', tick: 1, day: 0, minuteOfDay: 1 }], simulation.getState());
    expect(reduceLifeFeed(primed, [{ type: 'clock.ticked', tick: 2, day: 0, minuteOfDay: 2 }], simulation.getState())).toBe(primed);
  });

  it('reports an unreachable destination once per city revision', () => {
    const world = new Simulation(createLivingWorldFixture()).getState();
    const destination = world.plan.buildings.find((building) => building.kind === 'park')!;
    const citizen = world.citizens[0]!;
    const blocked = { type: 'citizen.route-blocked' as const, tick: 1, citizenId: citizen.id, destinationBuildingId: destination.id, reason: 'unreachable' as const };
    const once = reduceLifeFeed(emptyLifeFeed, [blocked], world);
    const twice = reduceLifeFeed(once, [blocked], world);
    expect(once.entries.filter((entry) => entry.kind === 'blocked')).toHaveLength(1);
    expect(twice.entries.filter((entry) => entry.kind === 'blocked')).toHaveLength(1);
    const edited = reduceLifeFeed(twice, [blocked], { ...world, revision: world.revision + 1 });
    expect(edited.entries.filter((entry) => entry.kind === 'blocked')).toHaveLength(2);
  });
});
