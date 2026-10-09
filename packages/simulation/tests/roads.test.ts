import { describe, expect, it } from 'vitest';
import { RoadGraph } from '../src/index.js';
import { testHome } from './cityFixture.js';

describe('road connectivity graph', () => {
  it('finds orthogonal neighbors and components independently of input order', () => {
    const roads = [{ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 9, y: 9 }];
    const graph = new RoadGraph(roads);
    expect(graph.getComponents()).toEqual(new RoadGraph([...roads].reverse()).getComponents());
    expect(graph.getComponents()).toHaveLength(2);
    expect(graph.getNeighbors({ x: 1, y: 0 })).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }]);
    expect(graph.areConnected({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(true);
    expect(graph.areConnected({ x: 0, y: 0 }, { x: 9, y: 9 })).toBe(false);
    expect(graph.areConnected({ x: 8, y: 8 }, { x: 8, y: 8 })).toBe(false);
    expect(graph.getComponentId({ x: 8, y: 8 })).toBeNull();
  });

  it('splits a bridge on removal and joins it on insertion', () => {
    const ends = [{ x: 0, y: 0 }, { x: 2, y: 0 }];
    expect(new RoadGraph(ends).getComponents()).toHaveLength(2);
    expect(new RoadGraph([...ends, { x: 1, y: 0 }]).getComponents()).toHaveLength(1);
    expect(new RoadGraph([{ x: 0, y: 0 }, { x: 1, y: 1 }]).getComponents()).toHaveLength(2);
  });

  it('handles loops and returns immutable query results', () => {
    const graph = new RoadGraph([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
    expect(graph.getComponents()[0]).toHaveLength(4);
    expect(Object.isFrozen(graph.getComponents())).toBe(true);
    expect(Object.isFrozen(graph.getComponents()[0])).toBe(true);
    expect(Object.isFrozen(graph.getNeighbors({ x: 0, y: 0 })[0])).toBe(true);
  });

  it('finds all components touching a building, excluding corner-only roads', () => {
    const graph = new RoadGraph([{ x: 3, y: 4 }, { x: 6, y: 5 }, { x: 3, y: 3 }]);
    expect(graph.getAdjacentComponents(testHome)).toEqual(['3,3', '6,5']);
    expect(new RoadGraph([{ x: 3, y: 3 }]).getAdjacentComponents(testHome)).toEqual([]);
  });

  it('validates unique integer road nodes and traverses long networks iteratively', () => {
    expect(() => new RoadGraph([{ x: 0, y: 0 }, { x: 0, y: 0 }])).toThrow(/unique/);
    expect(() => new RoadGraph([{ x: 0.5, y: 0 }])).toThrow(/integer/);
    expect(new RoadGraph(Array.from({ length: 5000 }, (_, x) => ({ x, y: 0 }))).getComponents()[0]).toHaveLength(5000);
  });
});
