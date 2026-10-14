import { describe, expect, it } from 'vitest';
import type { Citizen } from '@tiny-city/simulation';
import { nearbyTagIds } from './nearbyTags';

const resident = (id: string, x: number, y: number, outdoors = true) => ({
  id, name: id, position: { x, y },
  movement: { status: outdoors ? 'travelling' : 'inside', currentBuildingId: outdoors ? null : 'home' },
}) as unknown as Citizen;

describe('Life View name tags', () => {
  it('names only the nearest few residents who are actually outdoors near the character', () => {
    const citizens = [resident('far', 20, 20), resident('c', 11, 10), resident('a', 10, 11), resident('inside', 10, 10, false),
      resident('b', 12, 12), resident('d', 13, 13), resident('selected', 10.2, 10)];
    expect(nearbyTagIds(citizens, { x: 10, y: 10 }, new Set(['selected']))).toEqual(['a', 'c', 'b']);
    expect(nearbyTagIds(citizens, { x: 10, y: 10 }, new Set(), 1)).toEqual(['selected', 'a', 'c']);
    expect(nearbyTagIds([], { x: 0, y: 0 }, new Set())).toEqual([]);
  });
});
