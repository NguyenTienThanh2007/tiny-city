import { describe, expect, it } from 'vitest';
import { encodePath } from '@tiny-city/simulation';
import type { Position, Vehicle } from '@tiny-city/simulation';
import { directionFrame, LANE_OFFSET, nextSample, remapFront, sampleFront, vehiclePose } from './vehicleMotion';

const straight: Position[] = Array.from({ length: 6 }, (_, i) => ({ x: 10 + i, y: 5 }));
const corner: Position[] = [{ x: 10, y: 5 }, { x: 11, y: 5 }, { x: 12, y: 5 }, { x: 12, y: 6 }, { x: 12, y: 7 }];
const vehicle = (route: Position[], s: number, over: Partial<Vehicle> = {}): Vehicle => {
  const { origin, path } = encodePath(route);
  const edge = Math.min(route.length - 2, Math.max(0, Math.ceil(s / 100) - 1));
  return { id: 'car-npc-1', kind: 'car', model: 'sedan', color: 0, origin, path, edge, offset: s - edge * 100, speed: 0, state: 'moving', waitTicks: 0,
    grants: [], ownerId: 'npc-1', destinationBuildingId: 'b', lineId: null, stopIndex: 0, passengers: [], dwell: 0, departedTick: 0, plannedRevision: 0, ...over };
};

describe('vehicle poses', () => {
  it('keeps to the right of the lane and faces along it', () => {
    const east = vehiclePose(straight, 250, 56);
    expect(east.angle).toBeCloseTo(0);
    expect(east.y).toBeCloseTo(5.5 + LANE_OFFSET);       // right of eastbound is south (+y)
    const west = vehiclePose([...straight].reverse(), 250, 56);
    expect(Math.abs(west.angle)).toBeCloseTo(Math.PI);
    expect(west.y).toBeCloseTo(5.5 - LANE_OFFSET);
  });

  it('rounds corners: the heading turns gradually and the body stays within the road tiles', () => {
    const angles: number[] = [];
    for (let s = 150; s <= 330; s += 10) {
      const pose = vehiclePose(corner, s, 56);
      angles.push(pose.angle);
      const tile = { x: Math.floor(pose.x), y: Math.floor(pose.y) };
      expect(corner.some((t) => t.x === tile.x && t.y === tile.y)).toBe(true);
    }
    for (let i = 1; i < angles.length; i += 1) expect(Math.abs(angles[i]! - angles[i - 1]!)).toBeLessThan(0.35);
    expect(angles[0]).toBeCloseTo(0);
    expect(angles.at(-1)).toBeCloseTo(Math.PI / 2);
  });

  it('maps headings to the 16 baked frames', () => {
    expect(directionFrame(0)).toBe(0);
    expect(directionFrame(Math.PI / 2)).toBe(4);
    expect(directionFrame(Math.PI)).toBe(8);
    expect(directionFrame(-Math.PI / 2)).toBe(12);
    expect(directionFrame(-0.1)).toBe(0);
  });
});

describe('interpolation between ticks', () => {
  it('interpolates the front distance, not the screen position', () => {
    const a = nextSample(undefined, vehicle(straight, 100), 1, null);
    const b = nextSample(a, vehicle(straight, 160), 2, 100);
    expect(sampleFront(b, 0)).toBe(100);
    expect(sampleFront(b, 0.5)).toBe(130);
    expect(sampleFront(b, 1)).toBe(160);
  });

  it('follows a trimmed route and snaps on discontinuities', () => {
    expect(remapFront(straight, 450, straight.slice(2))).toBe(250);
    expect(remapFront(straight, 150, [{ x: 40, y: 40 }, { x: 41, y: 40 }])).toBeNull();
    const a = nextSample(undefined, vehicle(straight, 300), 1, null);
    // A vehicle reappearing far away (a new trip on the same car ID) snaps instead of sliding across the map.
    const b = nextSample(a, vehicle([{ x: 40, y: 40 }, { x: 41, y: 40 }], 20), 2, 300);
    expect(b.from).toBe(b.to);
    // Never backwards.
    const c = nextSample(a, vehicle(straight, 250), 2, 300);
    expect(c.from).toBe(250);
  });
});
