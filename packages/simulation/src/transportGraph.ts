import { compareTiles, tileKey } from './grid.js';
import { RoadNavigator } from './navigation.js';
import { TRANSPORT } from './transportConfig.js';
import type { Building, BusLine, BusStop, CompassDirection, Position } from './types.js';

/**
 * Phase 6 vehicle network, derived from the same road tiles as `RoadGraph` (no second road representation).
 *
 * Every road tile is a node; every pair of neighbouring road tiles is joined by two directed lanes (traffic keeps to
 * the right). A tile with three or more road neighbours is an intersection ("junction"); one neighbour is a dead end,
 * where vehicles may turn around. Routing is a deterministic Dijkstra over lane states (tile + heading), so turn costs
 * and the no-U-turn rule are exact; ties break by state index, which follows tile order.
 */
export const DIRECTIONS: readonly CompassDirection[] = Object.freeze(['N', 'E', 'S', 'W']);
export const STEP: Readonly<Record<CompassDirection, Position>> = Object.freeze({
  N: Object.freeze({ x: 0, y: -1 }), E: Object.freeze({ x: 1, y: 0 }), S: Object.freeze({ x: 0, y: 1 }), W: Object.freeze({ x: -1, y: 0 }),
});
const DIR_INDEX: Readonly<Record<CompassDirection, number>> = { N: 0, E: 1, S: 2, W: 3 };
const UNITS = TRANSPORT.unitsPerTile;

export function directionBetween(a: Position, b: Position): CompassDirection | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  return dx === 0 && dy === -1 ? 'N' : dx === 1 && dy === 0 ? 'E' : dx === 0 && dy === 1 ? 'S' : dx === -1 && dy === 0 ? 'W' : null;
}

/** Lane key: the tile a vehicle leaves and its heading (`12,7E` is the eastbound lane from (12,7) to (13,7)). */
export const laneKey = (tile: Position, direction: CompassDirection): string => `${tile.x},${tile.y}${direction}`;

/** Decoded routes by origin object, then path: vehicles keep both objects across ticks, so lookups are cheap. */
const decodedByOrigin = new WeakMap<Position, Map<string, readonly Position[]>>();
/** Tiles of a stored route (origin plus compass steps). Hundreds of vehicles decode every tick. */
export function decodePath(origin: Position, path: string): readonly Position[] {
  let byPath = decodedByOrigin.get(origin);
  let tiles = byPath?.get(path);
  if (!tiles) {
    const out: Position[] = [Object.freeze({ x: origin.x, y: origin.y })];
    let { x, y } = origin;
    for (const step of path) {
      const d = STEP[step as CompassDirection];
      if (!d) throw new RangeError('invalid route step');
      x += d.x; y += d.y;
      out.push(Object.freeze({ x, y }));
    }
    tiles = Object.freeze(out);
    if (!byPath) { byPath = new Map(); decodedByOrigin.set(origin, byPath); }
    if (byPath.size >= 8) byPath.delete(byPath.keys().next().value!);
    byPath.set(path, tiles);
  }
  return tiles;
}

export function encodePath(tiles: readonly Position[]): { origin: Position; path: string } {
  let path = '';
  for (let i = 1; i < tiles.length; i += 1) {
    const d = directionBetween(tiles[i - 1]!, tiles[i]!);
    if (!d) throw new RangeError('route tiles must be orthogonal neighbours');
    path += d;
  }
  return { origin: { x: tiles[0]!.x, y: tiles[0]!.y }, path };
}

/**
 * Intersection quadrants as a 4-bit mask: bit 0 NW, 1 NE, 2 SW, 3 SE. With right-hand traffic a vehicle heading `h`
 * enters a junction in the near-right quadrant; going straight it also crosses the far-right one, turning right it
 * stays in its entry quadrant, and turning left it crosses three. Two movements conflict when their masks overlap, so
 * opposite straight movements and simultaneous right turns share a junction safely.
 */
const quadrant = (x: number, y: number): number => (y > 0 ? 2 : 0) + (x > 0 ? 1 : 0);
export const ALL_QUADRANTS = 0b1111;
export function movementMask(entering: CompassDirection | null, leaving: CompassDirection | null): number {
  if (entering === null) return ALL_QUADRANTS;
  const h = STEP[entering], r = { x: -h.y, y: h.x };
  const entry = 1 << quadrant(-h.x + r.x, -h.y + r.y);
  if (leaving === null) return entry;
  const out = STEP[leaving];
  if (out.x === h.x && out.y === h.y) return entry | (1 << quadrant(h.x + r.x, h.y + r.y));
  if (out.x === r.x && out.y === r.y) return entry;
  if (out.x === -r.x && out.y === -r.y) return entry | (1 << quadrant(h.x + r.x, h.y + r.y)) | (1 << quadrant(h.x - r.x, h.y - r.y));
  return ALL_QUADRANTS;
}

export interface CarRoute { readonly tiles: readonly Position[]; readonly cost: number }
export interface LinePlan {
  /** legs[i] runs from stop i to stop i+1 (the last leg returns to stop 0); each starts and ends on the stop tiles. */
  readonly legs: readonly (readonly Position[])[];
  /** Route units from stop 0 to each stop along the loop, and the whole loop. */
  readonly offsets: readonly number[];
  readonly loopUnits: number;
}
export type LinePlanResult = { readonly plan: LinePlan; readonly reason: null } | { readonly plan: null; readonly reason: 'stop-removed' | 'unreachable' };
export interface BusOption {
  readonly lineId: string;
  readonly boardStopId: string;
  readonly alightStopId: string;
  readonly minutes: number;
}
export interface NetworkStats { readonly searches: number; readonly cacheHits: number; readonly expanded: number }

class MinHeap {
  private readonly costs: number[] = [];
  private readonly ids: number[] = [];
  get size(): number { return this.ids.length; }
  push(cost: number, id: number): void {
    let i = this.ids.length;
    this.costs.push(cost); this.ids.push(id);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(p, i)) break;
      this.swap(i, p); i = p;
    }
  }
  pop(): [number, number] {
    const cost = this.costs[0]!, id = this.ids[0]!;
    const lastCost = this.costs.pop()!, lastId = this.ids.pop()!;
    if (this.ids.length) {
      this.costs[0] = lastCost; this.ids[0] = lastId;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.less(l, m)) m = l;
        if (r < this.ids.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return [cost, id];
  }
  private less(a: number, b: number): boolean { return this.costs[a]! < this.costs[b]! || this.costs[a] === this.costs[b] && this.ids[a]! < this.ids[b]!; }
  private swap(a: number, b: number): void {
    [this.costs[a], this.costs[b]] = [this.costs[b]!, this.costs[a]!];
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
  }
}

const lineCaches = new WeakMap<RoadNavigator, Map<string, LinePlanResult>>();

/** Immutable per (plan, routing snapshot). Route results are pure functions of those, so the caches are only memos. */
export class TransportNetwork {
  readonly navigator: RoadNavigator;
  private readonly tiles: readonly Position[];
  private readonly index = new Map<string, number>();
  /** Neighbour node per direction (N, E, S, W), or −1. */
  private readonly neighbours: Int32Array;
  private readonly routing: Readonly<Record<string, number>>;
  /** Road-neighbour count per map tile (dense; 0 off-road), for constant-time junction checks. */
  private readonly degrees: Uint8Array;
  private readonly width: number;
  private readonly height: number;
  private readonly carCache = new Map<string, CarRoute | null>();
  /** Bus loops use free-flow costs, so they depend only on the roads: shared by every network on the same plan. */
  private readonly lineCache: Map<string, LinePlanResult>;
  private searches = 0;
  private cacheHits = 0;
  private expanded = 0;

  constructor(navigator: RoadNavigator, routing: Readonly<Record<string, number>> = {}) {
    this.navigator = navigator;
    this.routing = routing;
    let lines = lineCaches.get(navigator);
    if (!lines) { lines = new Map(); lineCaches.set(navigator, lines); }
    this.lineCache = lines;
    const roads = navigator.graph.getComponents().flat().sort(compareTiles);
    this.tiles = roads;
    roads.forEach((tile, i) => this.index.set(tileKey(tile), i));
    this.neighbours = new Int32Array(roads.length * 4).fill(-1);
    roads.forEach((tile, i) => {
      DIRECTIONS.forEach((d, k) => {
        const n = this.index.get(tileKey({ x: tile.x + STEP[d].x, y: tile.y + STEP[d].y }));
        if (n !== undefined) this.neighbours[i * 4 + k] = n;
      });
    });
    this.width = navigator.grid.width; this.height = navigator.grid.height;
    this.degrees = new Uint8Array(this.width * this.height);
    roads.forEach((tile, i) => {
      let n = 0;
      for (let k = 0; k < 4; k += 1) if (this.neighbours[i * 4 + k]! >= 0) n += 1;
      this.degrees[tile.y * this.width + tile.x] = n;
    });
  }

  getStats(): NetworkStats { return Object.freeze({ searches: this.searches, cacheHits: this.cacheHits, expanded: this.expanded }); }
  get roadCount(): number { return this.tiles.length; }
  isRoad(tile: Position): boolean { return this.index.has(tileKey(tile)); }
  degree(tile: Position): number {
    return tile.x >= 0 && tile.y >= 0 && tile.x < this.width && tile.y < this.height ? this.degrees[tile.y * this.width + tile.x]! : 0;
  }
  /** Three or more road neighbours. */
  isJunction(tile: Position): boolean { return this.degree(tile) >= 3; }
  /** Every directed lane (for overlays and validation). */
  lanes(): { tile: Position; direction: CompassDirection }[] {
    const out: { tile: Position; direction: CompassDirection }[] = [];
    this.tiles.forEach((tile, i) => DIRECTIONS.forEach((d, k) => { if (this.neighbours[i * 4 + k]! >= 0) out.push({ tile, direction: d }); }));
    return out;
  }
  hasLane(key: string): boolean {
    const match = /^(-?\d+),(-?\d+)([NESW])$/.exec(key);
    if (!match) return false;
    const i = this.index.get(`${match[1]},${match[2]}`);
    return i !== undefined && this.neighbours[i * 4 + DIR_INDEX[match[3] as CompassDirection]]! >= 0;
  }
  /** Road tiles a building can be entered from (the same access points residents walk to). */
  access(buildingId: string): readonly Position[] { return this.navigator.getAccessPoints(buildingId); }

  private laneCost(node: number, k: number, freeFlow: boolean): number {
    if (freeFlow) return UNITS;
    const penalty = this.routing[laneKey(this.tiles[node]!, DIRECTIONS[k]!)] ?? 0;
    return UNITS + Math.min(TRANSPORT.routing.maxCongestionPenalty, penalty);
  }
  private turnCost(from: number, to: number): number {
    if (from === to) return 0;
    if ((from + 2) % 4 === to) return TRANSPORT.routing.uTurn;
    return (from + 1) % 4 === to ? TRANSPORT.routing.rightTurn : TRANSPORT.routing.leftTurn;
  }

  /**
   * Shortest drive over lane states. `starts` are lane states with their initial cost; a state is done when its lane
   * ends on a goal tile. U-turns are only allowed at dead ends. Returns the tile sequence from the first start tile.
   */
  private search(starts: readonly { node: number; k: number; cost: number }[], goals: ReadonlySet<number>, freeFlow: boolean): CarRoute | null {
    this.searches += 1;
    const n = this.tiles.length * 4;
    const best = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    for (const s of starts) {
      const id = s.node * 4 + s.k;
      if (s.cost < best[id]!) { best[id] = s.cost; parent[id] = -1; heap.push(s.cost, id); }
    }
    let popped = 0;
    while (heap.size && popped < TRANSPORT.routing.maxStates) {
      const [cost, id] = heap.pop();
      if (cost > best[id]!) continue;
      popped += 1; this.expanded += 1;
      const k = id & 3, next = this.neighbours[id]!;
      if (goals.has(next)) {
        const states: number[] = [];
        for (let s = id; s >= 0; s = parent[s]!) states.push(s);
        states.reverse();
        const tiles = [this.tiles[states[0]! >> 2]!, ...states.map((s) => this.tiles[this.neighbours[s]!]!)];
        return Object.freeze({ tiles: Object.freeze(tiles), cost: Math.round(cost) });
      }
      const degree = [0, 1, 2, 3].filter((j) => this.neighbours[next * 4 + j]! >= 0).length;
      for (let j = 0; j < 4; j += 1) {
        if (this.neighbours[next * 4 + j]! < 0) continue;
        if ((k + 2) % 4 === j && degree > 1) continue;
        const step = cost + this.laneCost(next, j, freeFlow) + this.turnCost(k, j) + (degree >= 3 ? TRANSPORT.routing.junction : 0);
        const to = next * 4 + j;
        if (step < best[to]!) { best[to] = step; parent[to] = id; heap.push(step, to); }
      }
    }
    return null;
  }

  private nodes(tiles: readonly Position[]): number[] {
    return tiles.map((t) => this.index.get(tileKey(t))).filter((i): i is number => i !== undefined);
  }

  /**
   * Door-to-door drive between two buildings (curb to curb). Null when they share a curb (walk), either has no road
   * access, or no drivable route exists. Cached per network (routing epoch).
   */
  carRoute(fromBuildingId: string, toBuildingId: string): CarRoute | null {
    const key = `${fromBuildingId}>${toBuildingId}`;
    if (this.carCache.has(key)) { this.cacheHits += 1; return this.carCache.get(key)!; }
    const from = this.nodes(this.access(fromBuildingId)), goals = new Set(this.nodes(this.access(toBuildingId)));
    let route: CarRoute | null = null;
    if (from.length && goals.size && !from.some((n) => goals.has(n))) {
      const starts = from.flatMap((node) => [0, 1, 2, 3].filter((k) => this.neighbours[node * 4 + k]! >= 0)
        .map((k) => ({ node, k, cost: this.laneCost(node, k, false) })));
      route = this.search(starts, goals, false);
    }
    if (this.carCache.size >= TRANSPORT.routing.cacheSize) this.carCache.delete(this.carCache.keys().next().value!);
    this.carCache.set(key, route);
    return route;
  }

  /**
   * Continue from a lane already being driven (from `tile` heading `direction`, `offset` units along it) to any goal
   * tile. Used when a destination changes or the road network is edited mid-trip. Not cached.
   */
  routeFromLane(tile: Position, direction: CompassDirection, offset: number, goalTiles: readonly Position[], freeFlow = false): CarRoute | null {
    const node = this.index.get(tileKey(tile));
    const k = DIR_INDEX[direction];
    if (node === undefined || this.neighbours[node * 4 + k]! < 0) return null;
    const goals = new Set(this.nodes(goalTiles));
    if (!goals.size) return null;
    return this.search([{ node, k, cost: this.laneCost(node, k, freeFlow) - offset }], goals, freeFlow);
  }

  /** Free-flow leg between two stop tiles, continuing from the heading the bus arrived with (null: any heading). */
  private busLeg(from: Position, arrival: CompassDirection | null, to: Position): CarRoute | null {
    const node = this.index.get(tileKey(from)), goal = this.index.get(tileKey(to));
    if (node === undefined || goal === undefined) return null;
    const degree = this.degree(from);
    const starts = [0, 1, 2, 3].filter((k) => this.neighbours[node * 4 + k]! >= 0 &&
      (arrival === null || (DIR_INDEX[arrival] + 2) % 4 !== k || degree === 1))
      .map((k) => ({ node, k, cost: UNITS + (arrival === null ? 0 : this.turnCost(DIR_INDEX[arrival], k)) }));
    return this.search(starts, new Set([goal]), true);
  }

  /**
   * The loop a line drives: stop to stop in order and back to the first, never turning around except at dead ends.
   * The first leg is re-planned from the heading the bus returns with, so every lap is identical.
   */
  linePlan(line: Pick<BusLine, 'id' | 'stopIds'>, stops: ReadonlyMap<string, BusStop>): LinePlanResult {
    const key = `${line.id}:${line.stopIds.join(',')}`;
    const cached = this.lineCache.get(key);
    if (cached) return cached;
    const result = this.computeLinePlan(line, stops);
    this.lineCache.set(key, result);
    return result;
  }

  private computeLinePlan(line: Pick<BusLine, 'stopIds'>, stops: ReadonlyMap<string, BusStop>): LinePlanResult {
    const tiles = line.stopIds.map((id) => stops.get(id)?.tile);
    if (tiles.length < TRANSPORT.minStopsPerLine || tiles.some((t) => !t || !this.isRoad(t))) return { plan: null, reason: 'stop-removed' };
    const stopTiles = tiles as Position[];
    let legs: (readonly Position[])[] = [];
    let arrival: CompassDirection | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const next: (readonly Position[])[] = [];
      let heading: CompassDirection | null = arrival;
      for (let i = 0; i < stopTiles.length; i += 1) {
        const leg = this.busLeg(stopTiles[i]!, heading, stopTiles[(i + 1) % stopTiles.length]!);
        if (!leg) return { plan: null, reason: 'unreachable' };
        next.push(leg.tiles);
        heading = directionBetween(leg.tiles.at(-2)!, leg.tiles.at(-1)!);
      }
      const settled = arrival !== null && heading === arrival && legs.length === next.length &&
        legs.every((leg, i) => leg.length === next[i]!.length && leg.every((t, j) => t.x === next[i]![j]!.x && t.y === next[i]![j]!.y));
      legs = next;
      if (settled) break;
      arrival = heading;
    }
    const offsets: number[] = [];
    let units = 0;
    for (const leg of legs) { offsets.push(units); units += (leg.length - 1) * UNITS; }
    if (legs.reduce((sum, leg) => sum + leg.length, 0) > TRANSPORT.maxRouteTiles) return { plan: null, reason: 'unreachable' };
    return { plan: Object.freeze({ legs: Object.freeze(legs), offsets: Object.freeze(offsets), loopUnits: units }), reason: null };
  }

  /**
   * Best bus journey between two buildings on the active lines: walk to a stop within reach (measured along the grid),
   * wait half a headway, ride forward around the loop, walk on. Null when no line serves both ends.
   */
  busOption(origin: Building, destination: Building, walkingSpeed: number, lines: readonly BusLine[], stops: ReadonlyMap<string, BusStop>): BusOption | null {
    const near = (building: Building) => {
      const access = this.access(building.id);
      const out = new Map<string, number>();
      for (const stop of stops.values()) {
        let best = Infinity;
        for (const a of access) best = Math.min(best, Math.abs(a.x - stop.tile.x) + Math.abs(a.y - stop.tile.y));
        if (best <= TRANSPORT.stopWalkTiles) out.set(stop.id, best + 1);
      }
      return out;
    };
    const from = near(origin), to = near(destination);
    if (!from.size || !to.size) return null;
    const bus = TRANSPORT.vehicles.bus;
    let best: BusOption | null = null;
    for (const line of lines) {
      if (line.status !== 'active') continue;
      const { plan } = this.linePlan(line, stops);
      if (!plan) continue;
      const loopMinutes = plan.loopUnits / bus.maxSpeed + line.stopIds.length * (TRANSPORT.busDwellTicks + 1);
      const wait = loopMinutes / line.buses / 2;
      for (let b = 0; b < line.stopIds.length; b += 1) {
        const walk1 = from.get(line.stopIds[b]!);
        if (walk1 === undefined) continue;
        for (let a = 0; a < line.stopIds.length; a += 1) {
          const walk2 = to.get(line.stopIds[a]!);
          if (walk2 === undefined || a === b) continue;
          const ride = (plan.offsets[a]! - plan.offsets[b]! + plan.loopUnits) % plan.loopUnits;
          const passed = (a - b + line.stopIds.length) % line.stopIds.length;
          const minutes = (walk1 + walk2) / walkingSpeed + wait + ride / bus.maxSpeed + passed * (TRANSPORT.busDwellTicks + 1);
          if (best === null || minutes < best.minutes - 1e-9) best = { lineId: line.id, boardStopId: line.stopIds[b]!, alightStopId: line.stopIds[a]!, minutes };
        }
      }
    }
    return best;
  }
}
