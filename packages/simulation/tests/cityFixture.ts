import { createWorld } from '../src/index.js';
import type { Building, Position, WorldState } from '../src/index.js';

export function cityFixture(options: { roads?: readonly Position[]; blockedTiles?: readonly Position[]; buildings?: readonly Building[]; funds?: number } = {}): WorldState {
  return createWorld({ id: 'city-test', seed: 'city-test', startingFunds: options.funds ?? 1000, clock: { paused: true },
    plan: { id: 'plan-test', name: 'Test city', width: 16, height: 16, roads: options.roads ?? [],
      blockedTiles: options.blockedTiles ?? [], buildings: options.buildings ?? [] } });
}

export const testHome: Building = {
  id: 'existing-home', type: 'villa', name: 'Existing villa', kind: 'home',
  position: { x: 4, y: 4 }, footprint: { width: 2, height: 2 }, capacity: 2,
};
