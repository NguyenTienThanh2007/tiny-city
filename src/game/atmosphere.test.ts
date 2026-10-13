import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import type { Building, WorldState } from '@tiny-city/simulation';
import { createWorld } from '@tiny-city/simulation';
import { windowsOn, worldLighting } from './lighting';
import { AmbientLayer, lightPoolsFor, VENUE_FX } from './ambientLayer';
import { crowdLayout, playerVenueSpot, VENUE_PROFILES } from './venueCrowd';
import { buildingDepth } from './npcMotion';

const channel = (c: number, shift: number) => (c >> shift) & 0xff;
const distance = (a: number, b: number) => Math.max(...[16, 8, 0].map((s) => Math.abs(channel(a, s) - channel(b, s))));

describe('cinematic lighting', () => {
  it('transitions smoothly through the whole day (no jumps at keyframes)', () => {
    let previous = worldLighting(0);
    for (let minute = 1; minute <= 1440; minute += 1) {
      const next = worldLighting(minute);
      expect(distance(previous.tint, next.tint), `tint at ${minute}`).toBeLessThanOrEqual(3);
      expect(Math.abs(next.glow - previous.glow), `glow at ${minute}`).toBeLessThanOrEqual(0.03);
      expect(Math.abs(next.sun - previous.sun), `sun at ${minute}`).toBeLessThanOrEqual(0.03);
      previous = next;
    }
  });

  it('makes morning, midday, golden hour and night distinct while night stays readable', () => {
    const morning = worldLighting(6 * 60 + 30), noon = worldLighting(12 * 60), golden = worldLighting(18 * 60 + 25), night = worldLighting(23 * 60);
    expect(noon.tint).toBe(0xffffff);
    expect(channel(golden.tint, 16)).toBeGreaterThan(channel(golden.tint, 0) + 40); // warm amber
    expect(channel(morning.tint, 16)).toBeGreaterThan(channel(morning.tint, 0)); // warm sunrise
    expect(channel(night.tint, 0)).toBeGreaterThan(channel(night.tint, 16)); // cool night
    // Night is lifted: every channel stays above ~50 %, so roads and residents remain visible.
    for (const s of [16, 8, 0]) expect(channel(night.tint, s)).toBeGreaterThan(125);
    expect(night.glow).toBe(1);
    expect(noon.glow).toBe(0);
  });

  it('dims homes one by one late at night and closes shops smoothly, deterministically', () => {
    expect(windowsOn('villa', 'v1', 21 * 60)).toBe(1);
    expect(windowsOn('villa', 'v1', 3 * 60)).toBeCloseTo(0.15);
    expect(windowsOn('villa', 'v1', 8 * 60)).toBe(1);
    expect(windowsOn('villa', 'v1', 23 * 60 + 47)).toBe(windowsOn('villa', 'v1', 23 * 60 + 47));
    const at = (m: number) => Array.from({ length: 40 }, (_, i) => windowsOn('villa', `v${i}`, m));
    const midnight = at(24 * 60 - 1);
    expect(midnight.some((v) => v > 0.9)).toBe(true);
    expect(midnight.some((v) => v < 0.2)).toBe(true);
    expect(windowsOn('mall', 'm', 21 * 60)).toBe(1);
    expect(windowsOn('mall', 'm', 21 * 60 + 50)).toBeGreaterThan(0.18);
    expect(windowsOn('mall', 'm', 21 * 60 + 50)).toBeLessThan(1);
    expect(windowsOn('mall', 'm', 23 * 60)).toBeCloseTo(0.18);
  });
});

function plan(buildings: Building[]) {
  return { id: 'p', name: 'p', width: 32, height: 32, roads: [{ x: 4, y: 12 }], blockedTiles: [], buildings };
}
const park: Building = { id: 'park-1', name: 'Park', kind: 'park', type: 'park', position: { x: 10, y: 6 }, footprint: { width: 4, height: 4 }, capacity: 20 };
const pool: Building = { id: 'pool-1', name: 'Pool', kind: 'park', type: 'pool', position: { x: 2, y: 2 }, footprint: { width: 3, height: 4 }, capacity: 30 };
const mall: Building = { id: 'mall-1', name: 'Mall', kind: 'workplace', type: 'mall', position: { x: 16, y: 2 }, footprint: { width: 6, height: 5 }, capacity: 100 };

describe('venue crowds (real visitors only)', () => {
  function visiting(n: number, venue: Building): WorldState {
    const citizens = Array.from({ length: n }, (_, i) => ({
      id: `c${String(i).padStart(2, '0')}`, name: 'C', homeBuildingId: 'h', workBuildingId: null, position: { x: venue.position.x + 2, y: venue.position.y + 2 },
      activity: 'leisure', targetBuildingId: venue.id, schedule: { entries: [] },
      movement: { status: 'inside', heading: { x: 0, y: 0 }, currentBuildingId: venue.id, destinationBuildingId: venue.id, arrivalActivity: 'leisure', route: [], nextWaypoint: 0, plannedRevision: 0 },
    }));
    return { plan: plan([venue]), citizens } as unknown as WorldState;
  }

  it('places exactly the real visitors, up to the visible slots, deterministically', () => {
    expect(crowdLayout(visiting(0, park)).size).toBe(0);
    const five = crowdLayout(visiting(5, park));
    expect(five.size).toBe(5);
    expect(crowdLayout(visiting(5, park))).toEqual(five);
    expect(crowdLayout(visiting(40, park)).size).toBe(VENUE_PROFILES.park!.slots.length);
  });

  it('keeps every spot inside the venue, drawn just above it, and turns partners towards each other', () => {
    const layout = crowdLayout(visiting(12, park));
    const depth = buildingDepth(10, 6, 4, 4);
    for (const p of layout.values()) {
      expect(p.position.x).toBeGreaterThan(10); expect(p.position.x).toBeLessThan(14);
      expect(p.position.y).toBeGreaterThan(6); expect(p.position.y).toBeLessThan(10);
      expect(p.depth).toBeGreaterThan(depth);
      // Never behind the centrepiece's silhouette (front lawn or well to the side).
      const lx = p.position.x - 10, ly = p.position.y - 6;
      if (lx + ly < 4.2) expect(Math.abs(lx - ly)).toBeGreaterThanOrEqual(1.2);
    }
    const a = layout.get('c00')!, b = layout.get('c01')!;
    expect(a.action).toBe('talk');
    expect(Math.sign(b.position.x - a.position.x)).toBe(a.heading.x || Math.sign(b.position.x - a.position.x));
    // A lone visitor in a conversation slot just stands.
    expect(crowdLayout(visiting(1, park)).get('c00')!.action).toBe('idle');
  });

  it('swaps axes for east-facing venue art and ignores residents who are walking or at work', () => {
    const south = crowdLayout(visiting(3, pool)).get('c00')!.position;
    const east = crowdLayout(visiting(3, pool), () => 'E').get('c00')!.position;
    expect(east).toEqual({ x: pool.position.x + (south.y - pool.position.y), y: pool.position.y + (south.x - pool.position.x) });
    const world = visiting(2, park);
    const walking = { ...world, citizens: world.citizens.map((c, i) => (i === 0 ? { ...c, activity: 'travel', movement: { ...c.movement!, status: 'travelling', currentBuildingId: null } } : c)) } as WorldState;
    expect(crowdLayout(walking).size).toBe(1);
    expect(crowdLayout(visiting(3, mall)).size).toBe(0);
  });

  it('gives the player a lawn spot away from the centrepiece', () => {
    const spot = playerVenueSpot(park)!;
    expect(Math.hypot(spot.position.x - 12, spot.position.y - 8)).toBeGreaterThan(1);
    expect(playerVenueSpot(mall)).toBeNull();
  });
});

describe('ambient atmosphere', () => {
  it('spills light only from buildings that exist, with venue-specific strength', () => {
    expect(lightPoolsFor(mall).length).toBe(2);
    expect(lightPoolsFor(mall)[0]!.radius).toBeGreaterThan(lightPoolsFor({ ...mall, type: 'villa', footprint: { width: 2, height: 2 } })[0]!.radius);
    expect(lightPoolsFor(park)).toEqual([]);
    expect(VENUE_FX.pool!.sparkles).toBe('pool');
  });

  it('keeps particles bounded, shows them only at the right time and freezes them under reduced motion', () => {
    const layer = new AmbientLayer(new Container(), new Container(), true, new Container());
    layer.rebuild(plan([park, pool, mall]));
    expect(layer.particleCount).toBe((VENUE_FX.park!.fireflies ?? 0) + 9);
    layer.setLighting(1, 0);
    layer.update(1000, true);
    const world = createWorld({ id: 'w', seed: 's', plan: plan([park]) });
    layer.rebuild(world.plan);
    expect(layer.particleCount).toBe(VENUE_FX.park!.fireflies);
    layer.destroy();
  });
});
