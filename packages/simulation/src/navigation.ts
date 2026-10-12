import { compareTiles, footprintPerimeter, OccupancyGrid, tileKey } from './grid.js';
import { RoadGraph } from './roads.js';
import type { Building, CityPlan, Position } from './types.js';

export const NPC_LIMITS = Object.freeze({ population: 10_000, routesPerTick: 16, searchNodes: 4096, cachedRoutes: 256 });
export interface NavigationStats { readonly searches: number; readonly cacheHits: number; readonly visitedNodes: number }
export type RouteResult = { readonly route: readonly Position[]; readonly reason: null } |
  { readonly route: null; readonly reason: 'unreachable' | 'search-limit' };
export const buildingCenter = (b: Building): Position => ({
  x: b.position.x + Math.floor(b.footprint.width / 2) + 0.5,
  y: b.position.y + Math.floor(b.footprint.height / 2) + 0.5,
});
export const containsPosition = (b: Building, p: Position): boolean => p.x >= b.position.x && p.y >= b.position.y &&
  p.x < b.position.x + b.footprint.width && p.y < b.position.y + b.footprint.height;
const center = (p: Position): Position => ({ x: p.x + 0.5, y: p.y + 0.5 });
const door = (b: Building, road: Position): Position => ({
  x: Math.max(b.position.x, Math.min(b.position.x + b.footprint.width - 1, road.x)) + 0.5,
  y: Math.max(b.position.y, Math.min(b.position.y + b.footprint.height - 1, road.y)) + 0.5,
});

/** Immutable topology, deterministic multi-source BFS, bounded per-plan route cache. */
export class RoadNavigator {
  readonly graph: RoadGraph;
  readonly grid: OccupancyGrid;
  readonly leisureBuildings: readonly Building[];
  private readonly buildings: Map<string, Building>;
  private readonly access = new Map<string, readonly Position[]>();
  private readonly cache = new Map<string, { path: readonly Position[] | null; reason: 'unreachable' | 'search-limit' | null }>();
  private searches = 0;
  private cacheHits = 0;
  private visitedNodes = 0;

  constructor(plan: CityPlan) {
    this.graph = new RoadGraph(plan.roads);
    this.grid = new OccupancyGrid(plan);
    const buildings=plan.buildings.map(b=>Object.freeze({...b,position:Object.freeze({...b.position}),footprint:Object.freeze({...b.footprint})}));
    this.buildings = new Map(buildings.map(b => [b.id, b]));
    this.leisureBuildings=Object.freeze(buildings.filter(b=>b.kind==='park'||b.type==='clubhouse').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
  }
  getBuilding(id: string | null): Building | undefined { return id === null ? undefined : this.buildings.get(id); }
  getStats(): NavigationStats { return Object.freeze({ searches: this.searches, cacheHits: this.cacheHits, visitedNodes: this.visitedNodes }); }
  getAccessPoints(buildingId: string): readonly Position[] {
    const b = this.buildings.get(buildingId);
    if (!b) return Object.freeze([]);
    let result = this.access.get(buildingId);
    if (!result) {
      result = Object.freeze(footprintPerimeter(b).filter(p => this.graph.getComponentId(p) !== null));
      this.access.set(buildingId, result);
    }
    return result;
  }
  findRoute(fromBuildingId: string, toBuildingId: string): RouteResult {
    const from = this.buildings.get(fromBuildingId);
    return from ? this.routeFrom(buildingCenter(from), from.id, toBuildingId) : { route: null, reason: 'unreachable' };
  }
  routeFrom(position: Position, currentBuildingId: string | null, destinationBuildingId: string): RouteResult {
    const source = this.getBuilding(currentBuildingId), destination = this.getBuilding(destinationBuildingId);
    if (!destination) return { route: null, reason: 'unreachable' };
    if (source && containsPosition(source, position) && source.id === destination.id) {
      return { route: Object.freeze([Object.freeze({ ...position })]), reason: null };
    }
    const sourceInside = source && containsPosition(source, position) ? source : undefined;
    const tile = { x: Math.floor(position.x), y: Math.floor(position.y) };
    const starts = sourceInside ? this.getAccessPoints(sourceInside.id) :
      this.graph.getComponentId(tile) === null ? [] : [tile];
    const goals = this.getAccessPoints(destination.id);
    if (!starts.length || !goals.length) return { route: null, reason: 'unreachable' };
    const key = `${sourceInside ? `b:${sourceInside.id}` : `r:${tileKey(tile)}`}→${destination.id}`;
    let cached = this.cache.get(key);
    if (cached) this.cacheHits += 1;
    else {
      cached = this.search(starts, goals);
      if (this.cache.size >= NPC_LIMITS.cachedRoutes) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, cached);
    }
    if (!cached.path) return { route: null, reason: cached.reason ?? 'unreachable' };
    const points: Position[] = [{ ...position }];
    const append = (p: Position) => { const last = points.at(-1)!; if (last.x !== p.x || last.y !== p.y) points.push(p); };
    const first = cached.path[0]!, last = cached.path.at(-1)!;
    const entrance = sourceInside ? door(sourceInside, first) : center(first);
    // Each interior leg stays in one rectangular source footprint; no diagonal shortcuts.
    append({ x: entrance.x, y: position.y }); append(entrance);
    for (const p of cached.path) append(center(p));
    const arrival = door(destination, last), inside = buildingCenter(destination);
    append(arrival); append({ x: inside.x, y: arrival.y }); append(inside);
    return { route: Object.freeze(points.map(p => Object.freeze(p))), reason: null };
  }
  private search(starts: readonly Position[], goals: readonly Position[]) {
    this.searches += 1;
    const components = new Set(starts.map(p => this.graph.getComponentId(p)));
    const goalKeys = new Set(goals.filter(p => components.has(this.graph.getComponentId(p))).map(tileKey));
    if (!goalKeys.size) return { path: null, reason: 'unreachable' as const };
    const queue = [...starts].sort(compareTiles), parent = new Map<string, Position | null>(queue.map(p => [tileKey(p), null]));
    for (let i = 0; i < queue.length && i < NPC_LIMITS.searchNodes; i += 1) {
      const p = queue[i]!; this.visitedNodes += 1;
      if (goalKeys.has(tileKey(p))) {
        const path: Position[] = []; let current: Position | null = p;
        while (current) { path.push(current); current = parent.get(tileKey(current)) ?? null; }
        return { path: Object.freeze(path.reverse()), reason: null };
      }
      for (const next of this.graph.getNeighbors(p)) {
        if (parent.has(tileKey(next))) continue;
        parent.set(tileKey(next), p); queue.push(next);
      }
    }
    return { path: null, reason: queue.length > NPC_LIMITS.searchNodes ? 'search-limit' as const : 'unreachable' as const };
  }
}
