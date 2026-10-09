import { type CityState, MAP_SIZE } from '../types';

const roads = new Map<string, { x: number; y: number }>();
const addRoad = (x: number, y: number) => roads.set(`${x},${y}`, { x, y });

// A short street grid creates walkable blocks around the Villa Gardens sample lots.
for (let y = 10; y <= 29; y += 1) addRoad(18, y);
for (let x = 10; x <= 27; x += 1) addRoad(x, 20);
for (let y = 14; y <= 26; y += 1) {
  addRoad(12, y);
  addRoad(25, y);
}
for (let x = 13; x <= 23; x += 1) {
  addRoad(x, 12);
  addRoad(x, 27);
}

const homes = [
  [14, 14], [20, 14], [14, 17], [20, 17], [14, 22],
  [20, 22], [14, 25], [20, 25], [9, 15], [27, 24],
] as const;

export const initialCity: CityState = {
  size: MAP_SIZE,
  roads: [...roads.values()],
  funds: 24_680,
  buildings: [
    ...homes.map(([x, y], index) => ({
      id: `villa-seed-${index + 1}`,
      kind: 'villa' as const,
      x,
      y,
      name: `Villa ${String(index + 1).padStart(2, '0')}`,
      createdAt: Date.now() - 120_000,
    })),
    { id: 'clubhouse-seed', kind: 'clubhouse', x: 8, y: 21, name: 'Garden Clubhouse', createdAt: Date.now() - 120_000 },
    { id: 'park-seed', kind: 'park', x: 29, y: 17, name: 'Coastal Park', createdAt: Date.now() - 120_000 },
  ],
};
