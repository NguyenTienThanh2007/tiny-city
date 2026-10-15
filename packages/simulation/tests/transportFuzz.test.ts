import { describe, expect, it } from 'vitest';
import { decodePath, deserializeWorld, serializeWorld, Simulation, validateRoadPlacement } from '../src/index.js';
import type { CitySnapshot, Position, BuildingType } from '../src/index.js';
import { transportTown } from './transportFixture.js';
import { assertTransportInvariants } from './transportHelpers.js';

/** Small deterministic PRNG for the fuzz schedule (not the simulation's own RNG). */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SEEDS = Number(process.env.TRANSPORT_FUZZ_SEEDS ?? 4);
const STEPS = Number(process.env.TRANSPORT_FUZZ_STEPS ?? 60);

describe('transport fuzz: edits, undo, lines, save/load and ticks keep every invariant', () => {
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    it(`seed ${seed}`, () => {
      const random = prng(seed * 7919);
      const pick = <T>(list: readonly T[]): T | undefined => list.length ? list[Math.floor(random() * list.length)] : undefined;
      let sim = new Simulation(transportTown({ apartment: 3, townhouse: 4, villa: 8, office: 3, mall: 1, park: 1, pool: 1 }, { seed: `fuzz-${seed}`, funds: 60_000 }));
      sim.executeTransport({ type: 'transport.create-line', stops: [{ x: 10, y: 8 }, { x: 45, y: 8 }, { x: 45, y: 22 }, { x: 10, y: 22 }], buses: 3 });
      sim.step(400 + Math.floor(random() * 120));
      const history: CitySnapshot[] = [];
      for (let step = 0; step < STEPS; step += 1) {
        const state = sim.getState();
        const roll = random();
        if (roll < 0.18) {
          // Remove a few road tiles somewhere (possibly under traffic or a stop).
          const start = pick(state.plan.roads)!;
          const remove = state.plan.roads.filter((t) => Math.abs(t.x - start.x) + Math.abs(t.y - start.y) <= Math.floor(random() * 3));
          history.push(sim.getCitySnapshot());
          sim.execute({ type: 'city.edit-roads', add: [], remove });
        } else if (roll < 0.3) {
          // Build a short road (possibly a new shortcut or a reconnection).
          const x = 3 + Math.floor(random() * 56), y = 9 + Math.floor(random() * 40);
          const add: Position[] = [];
          for (let i = 0; i < 6; i += 1) { const tile = random() < 0.5 ? { x: x + i, y } : { x, y: y + i }; if (validateRoadPlacement(state, tile).valid && !add.some((t) => t.x === tile.x && t.y === tile.y)) add.push(tile); }
          if (add.length) { history.push(sim.getCitySnapshot()); sim.execute({ type: 'city.edit-roads', add, remove: [] }); }
        } else if (roll < 0.38) {
          const building = pick(state.plan.buildings);
          if (building) { history.push(sim.getCitySnapshot()); sim.execute({ type: 'city.demolish', buildingId: building.id }); }
        } else if (roll < 0.44) {
          const type = pick<BuildingType>(['villa', 'townhouse', 'office', 'park'])!;
          const road = pick(state.plan.roads)!;
          history.push(sim.getCitySnapshot());
          sim.execute({ type: 'city.build', buildingType: type, position: { x: road.x + 1, y: road.y + 1 } });
        } else if (roll < 0.52 && history.length) {
          const snapshot = history.pop()!;
          if (sim.canRestoreCity(snapshot)) sim.restoreCity(snapshot);
        } else if (roll < 0.58) {
          const stops = [pick(state.plan.roads)!, pick(state.plan.roads)!, pick(state.plan.roads)!];
          sim.executeTransport({ type: 'transport.create-line', stops, buses: 1 + Math.floor(random() * 4) });
        } else if (roll < 0.62) {
          const line = pick(state.transport!.lines);
          if (line) sim.executeTransport(random() < 0.5 ? { type: 'transport.delete-line', lineId: line.id } : { type: 'transport.set-buses', lineId: line.id, buses: 1 + Math.floor(random() * 6) });
        } else if (roll < 0.68) {
          const saved = serializeWorld(sim.getState());
          const reloaded = new Simulation(deserializeWorld(saved));
          expect(serializeWorld(reloaded.getState())).toBe(saved);
          sim = reloaded;
        }
        try { assertTransportInvariants(sim.getState()); }
        catch (error) {
          if (process.env.TRANSPORT_FUZZ_DEBUG) {
            const ids = /(\S+) and (\S+) cross/.exec((error as Error).message);
            console.log('operation roll', roll.toFixed(3), 'events', JSON.stringify(sim.getState().revision));
            for (const [label, w] of [['before', state], ['after', sim.getState()]] as const) {
              console.log(label, 'tick', w.clock.tick, 'rev', w.revision);
              for (const v of w.transport!.vehicles.filter((x) => ids && (x.id === ids[1] || x.id === ids[2]))) {
                const r = decodePath(v.origin, v.path);
                console.log('  ', v.id, v.state, 'edge', v.edge, 'off', v.offset, 'grants', JSON.stringify(v.grants), 'route', r.slice(0, v.edge + 4).map((p) => `${p.x},${p.y}`).join('>'));
              }
            }
          }
          throw error;
        }
        const ticks = 1 + Math.floor(random() * 40);
        for (let i = 0; i < ticks; i += 1) {
          const before = sim.getState();
          sim.step(1);
          if (i % 4 !== 0) continue;
          try { assertTransportInvariants(sim.getState()); }
          catch (error) {
            if (process.env.TRANSPORT_FUZZ_DEBUG) {
              const ids = /(\S+) and (\S+) cross/.exec((error as Error).message);
              for (const [label, w] of [['before', before], ['after', sim.getState()]] as const) {
                console.log(label, 'tick', w.clock.tick, 'rev', w.revision);
                for (const v of w.transport!.vehicles.filter((x) => ids && (x.id === ids[1] || x.id === ids[2]))) {
                  const r = decodePath(v.origin, v.path);
                  console.log('  ', v.id, v.state, 'edge', v.edge, 'off', v.offset, 'speed', v.speed, 'wait', v.waitTicks, 'grants', JSON.stringify(v.grants), 'planned', v.plannedRevision, 'route', r.map((p) => `${p.x},${p.y}`).join('>'));
                }
              }
            }
            throw error;
          }
        }
      }
      assertTransportInvariants(sim.getState());
    }, 120_000);
  }
});
