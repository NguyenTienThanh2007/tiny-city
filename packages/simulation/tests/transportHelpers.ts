import { decodePath, movementMask, TRANSPORT, TransportNetwork, RoadNavigator, directionBetween, validateWorld } from '../src/index.js';
import type { Position, Vehicle, WorldState } from '../src/index.js';

const U = TRANSPORT.unitsPerTile;
export const frontS = (v: Vehicle) => v.edge * U + v.offset;
export const routeOf = (v: Vehicle) => decodePath(v.origin, v.path);
/** The tile containing a vehicle's front. */
export function frontTile(v: Vehicle): Position {
  const route = routeOf(v);
  return route[Math.max(0, Math.min(route.length - 1, Math.floor((frontS(v) + U / 2) / U)))]!;
}

/**
 * Invariants checked after every step of the transport tests (beyond `validateWorld`, which already checks
 * references, capacities, lane overlaps and that routes stay on roads):
 * - no NaN or fractional positions, offsets within a lane;
 * - no two non-following vehicles occupy conflicting quadrants of one junction tile at the same time;
 * - every rider and driver is where their vehicle is.
 */
export function assertTransportInvariants(world: WorldState): void {
  validateWorld(world);
  const t = world.transport;
  if (!t) return;
  const network = new TransportNetwork(new RoadNavigator(world.plan));
  const inside = new Map<string, { id: string; mask: number; path: string }[]>();
  for (const v of t.vehicles) {
    if (!Number.isSafeInteger(v.offset) || !Number.isSafeInteger(v.edge) || !Number.isSafeInteger(v.speed)) throw new Error(`${v.id} has a non-integer position`);
    if (v.state === 'departing') continue;
    const route = routeOf(v);
    const s = frontS(v), rear = s - TRANSPORT.vehicles[v.kind].length;
    for (let i = 0; i < route.length; i += 1) {
      if (!(i * U - U / 2 < s && i * U + U / 2 > rear) || !network.isJunction(route[i]!)) continue;
      // A granted crossing keeps the mask it was granted with (the route may have been trimmed behind it since).
      const mask = v.grants.find((g) => g.index === i)?.mask ??
        movementMask(i === 0 ? null : directionBetween(route[i - 1]!, route[i]!), i < route.length - 1 ? directionBetween(route[i]!, route[i + 1]!) : null);
      const key = `${route[i]!.x},${route[i]!.y}`;
      const path = route.slice(Math.max(0, i - 1), i + 2).map((p) => `${p.x},${p.y}`).join('>');
      for (const other of inside.get(key) ?? []) {
        if ((other.mask & mask) !== 0 && other.path !== path) throw new Error(`${v.id} and ${other.id} cross ${key} on conflicting paths at tick ${world.clock.tick}`);
      }
      const list = inside.get(key) ?? [];
      list.push({ id: v.id, mask, path });
      inside.set(key, list);
    }
    const at = frontTile(v);
    const people = v.kind === 'car' ? [v.ownerId!] : v.passengers;
    for (const id of people) {
      const c = world.citizens.find((x) => x.id === id)!;
      if (c.position.x !== at.x + 0.5 || c.position.y !== at.y + 0.5) throw new Error(`${id} is not with ${v.id}`);
    }
  }
}

/** Steps a simulation, checking invariants every `every` ticks; returns all events. */
export function run(sim: { step(n?: number): { events: readonly { type: string }[]; state: WorldState } }, ticks: number, every = 1) {
  const events: { type: string; [key: string]: unknown }[] = [];
  for (let i = 0; i < ticks; i += 1) {
    const result = sim.step(1);
    events.push(...(result.events as typeof events));
    if (every > 0 && i % every === 0) assertTransportInvariants(result.state);
  }
  return events;
}
