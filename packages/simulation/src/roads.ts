import { compareTiles, footprintPerimeter, isGridPosition, tileKey } from './grid.js';
import type { Building, Position } from './types.js';

/** Orthogonal road topology only: no citizen routing or traffic model. */
export class RoadGraph {
  #neighbors = new Map<string, readonly Position[]>();
  #componentIds = new Map<string, string>();
  #components: readonly (readonly Position[])[];

  constructor(roads: readonly Position[]) {
    if (roads.length > 1_000_000 || !roads.every(isGridPosition) || new Set(roads.map(tileKey)).size !== roads.length) {
      throw new RangeError('road graph requires unique integer tiles');
    }
    const tiles = [...roads].sort(compareTiles).map((tile) => Object.freeze({ ...tile }));
    const roadSet = new Set(tiles.map(tileKey));
    for (const tile of tiles) {
      const neighbors = [{ x: tile.x, y: tile.y - 1 }, { x: tile.x - 1, y: tile.y },
        { x: tile.x + 1, y: tile.y }, { x: tile.x, y: tile.y + 1 }].filter((entry) => roadSet.has(tileKey(entry)));
      this.#neighbors.set(tileKey(tile), Object.freeze(neighbors.map((entry) => Object.freeze(entry))));
    }
    const components: (readonly Position[])[] = [];
    for (const start of tiles) {
      const id = tileKey(start);
      if (this.#componentIds.has(id)) continue;
      const queue = [start];
      this.#componentIds.set(id, id);
      for (let i = 0; i < queue.length; i += 1) {
        for (const neighbor of this.#neighbors.get(tileKey(queue[i]!)) ?? []) {
          const key = tileKey(neighbor);
          if (this.#componentIds.has(key)) continue;
          this.#componentIds.set(key, id);
          queue.push(neighbor);
        }
      }
      components.push(Object.freeze(queue.sort(compareTiles)));
    }
    this.#components = Object.freeze(components);
    Object.freeze(this);
  }

  getComponents(): readonly (readonly Position[])[] { return this.#components; }
  getNeighbors(position: Position): readonly Position[] { return this.#neighbors.get(tileKey(position)) ?? Object.freeze([]); }
  getComponentId(position: Position): string | null { return this.#componentIds.get(tileKey(position)) ?? null; }
  areConnected(a: Position, b: Position): boolean {
    const id = this.getComponentId(a);
    return id !== null && id === this.getComponentId(b);
  }
  getAdjacentComponents(building: Building): readonly string[] {
    return Object.freeze([...new Set(footprintPerimeter(building).map((tile) => this.getComponentId(tile))
      .filter((id): id is string => id !== null))].sort());
  }
}
