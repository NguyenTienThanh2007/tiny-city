export const MAP_SIZE = 64;

export type Tool = 'select' | 'road' | 'villa' | 'park' | 'clubhouse' | 'bulldoze';
export type BuildingKind = Exclude<Tool, 'select' | 'road' | 'bulldoze'>;

export interface Cell {
  x: number;
  y: number;
}

export interface BuildingSpec {
  kind: BuildingKind;
  label: string;
  width: number;
  height: number;
  cost: number;
  tint: number;
}

export interface Building {
  id: string;
  kind: BuildingKind;
  x: number;
  y: number;
  name: string;
  createdAt: number;
}

export interface CityState {
  size: number;
  roads: Cell[];
  buildings: Building[];
  funds: number;
}

export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
  villa: { kind: 'villa', label: 'Villa', width: 2, height: 2, cost: 120, tint: 0xe9d3a3 },
  park: { kind: 'park', label: 'Park', width: 4, height: 4, cost: 80, tint: 0x74a979 },
  clubhouse: { kind: 'clubhouse', label: 'Clubhouse', width: 3, height: 3, cost: 220, tint: 0xe7a66d },
};

export const cellKey = (x: number, y: number) => `${x},${y}`;

export function isLandCell(x: number, y: number, size = MAP_SIZE): boolean {
  return x >= 0 && y >= 0 && x < size && y < size && x + y < size * 2 - 8;
}

export function occupiedCells(building: Building): Cell[] {
  const spec = BUILDINGS[building.kind];
  const cells: Cell[] = [];
  for (let y = building.y; y < building.y + spec.height; y += 1) {
    for (let x = building.x; x < building.x + spec.width; x += 1) cells.push({ x, y });
  }
  return cells;
}

export function canPlace(city: CityState, kind: BuildingKind, x: number, y: number): boolean {
  const spec = BUILDINGS[kind];
  if (x < 0 || y < 0 || x + spec.width > city.size || y + spec.height > city.size) return false;
  const blocked = new Set(city.roads.map((cell) => cellKey(cell.x, cell.y)));
  for (const building of city.buildings) {
    for (const cell of occupiedCells(building)) blocked.add(cellKey(cell.x, cell.y));
  }
  for (let dy = 0; dy < spec.height; dy += 1) {
    for (let dx = 0; dx < spec.width; dx += 1) {
      if (!isLandCell(x + dx, y + dy, city.size)) return false;
      if (blocked.has(cellKey(x + dx, y + dy))) return false;
    }
  }
  return true;
}

export function createBuilding(kind: BuildingKind, x: number, y: number, index: number): Building {
  const spec = BUILDINGS[kind];
  const shortName = kind === 'villa' ? 'Villa' : spec.label;
  return {
    id: `${kind}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    x,
    y,
    name: kind === 'villa' ? `Villa ${String(index).padStart(2, '0')}` : shortName,
    createdAt: Date.now(),
  };
}
