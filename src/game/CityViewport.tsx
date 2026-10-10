import { Application, Container, Graphics, Rectangle, Text } from 'pixi.js';
import { useEffect, useRef } from 'react';
import type { CityPlan, WorldState } from '@tiny-city/simulation';
import { validateBuildingMove, validateBuildingPlacement, validateRoadPlacement } from '@tiny-city/simulation';
import { getRenderBuildings } from '../simulation/cityAdapter';
import { connectSimulationTicker } from '../simulation/tickerAdapter';
import { BUILDINGS, cellKey, isLandCell, occupiedCells, type Building, type BuildingKind, type CityState, type Cell, type Tool } from '../types';

const TILE_W = 56;
const TILE_H = 28;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
const MAP_OFFSET_X = 32 * TILE_W;

type Props = {
  city: CityState;
  world: WorldState;
  onSimulationFrame: (elapsedMs: number) => void;
  tool: Tool;
  selectedBuildingId: string | null;
  movingBuildingId: string | null;
  onSelectBuilding: (id: string | null) => void;
  onPlaceBuilding: (kind: BuildingKind, x: number, y: number) => void;
  onBeginMoveBuilding: (id: string) => void;
  onMoveBuilding: (id: string, x: number, y: number) => void;
  onAddRoad: (cell: Cell) => void;
  onBulldoze: (cell: Cell) => void;
  onCameraFootprintChange: (points: Point[]) => void;
};

type Point = { x: number; y: number };

const iso = (x: number, y: number): Point => ({
  x: MAP_OFFSET_X + (x - y) * HALF_W,
  y: (x + y) * HALF_H,
});

function polygon(graphics: Graphics, points: Point[], color: number, alpha = 1, stroke?: number) {
  graphics.poly(points.flatMap((point) => [point.x, point.y])).fill({ color, alpha });
  if (stroke !== undefined) graphics.poly(points.flatMap((point) => [point.x, point.y])).stroke({ color: stroke, width: 1, alpha: 0.28 });
}

function tileDiamond(x: number, y: number): Point[] {
  return [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)];
}

function footprint(x: number, y: number, width: number, height: number): Point[] {
  return [iso(x, y), iso(x + width, y), iso(x + width, y + height), iso(x, y + height)];
}

function drawTerrain(layer: Container, size: number) {
  const terrain = new Graphics();
  const colors = [0x91b88e, 0x96bd91, 0x8bb287, 0x9bc396];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const colorIndex = (x * 7 + y * 13 + (x * y) % 5) % colors.length;
      const coast = x + y;
      const color = coast >= size * 2 - 8 ? 0x79b3b0 : coast >= size * 2 - 13 ? 0xd7c88f : colors[colorIndex];
      polygon(terrain, tileDiamond(x, y), color, 1, coast >= size * 2 - 8 ? 0x619c9b : 0x779c7c);
    }
  }
  layer.addChild(terrain);
}

function drawRoads(layer: Container, city: CityState) {
  const roadSet = new Set(city.roads.map(({ x, y }) => cellKey(x, y)));
  const roadGraphics = new Graphics();
  for (const { x, y } of city.roads) {
    polygon(roadGraphics, tileDiamond(x, y), 0x56636a, 1, 0x424e54);
    const center = iso(x + 0.5, y + 0.5);
    const hasX = roadSet.has(cellKey(x - 1, y)) || roadSet.has(cellKey(x + 1, y));
    const hasY = roadSet.has(cellKey(x, y - 1)) || roadSet.has(cellKey(x, y + 1));
    const axes = [
      ...(hasX ? [[{ x: center.x - 11, y: center.y - 5.5 }, { x: center.x + 11, y: center.y + 5.5 }]] : []),
      ...(hasY ? [[{ x: center.x + 11, y: center.y - 5.5 }, { x: center.x - 11, y: center.y + 5.5 }]] : []),
    ];
    for (const [start, end] of axes) {
      roadGraphics.moveTo(start.x, start.y).lineTo(end.x, end.y).stroke({ color: 0xe9dcae, width: 1.7, alpha: 0.86 });
    }
  }
  layer.addChild(roadGraphics);
}

function drawVilla(graphics: Graphics, building: Building, progress: number) {
  const spec = BUILDINGS.villa;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const lift = buildingLift(building, progress);
  const top = ground.map((point) => ({ x: point.x, y: point.y - lift }));
  polygon(graphics, ground, 0x647768, 0.25);
  polygon(graphics, [ground[0], ground[1], top[1], top[0]], 0xd8c49f);
  polygon(graphics, [ground[1], ground[2], top[2], top[1]], 0xc4ac83);
  polygon(graphics, top, progress < 0.62 ? 0xb9a587 : 0xb86e54, 1, 0x89513e);

  const center = iso(building.x + 1, building.y + 1);
  const window = new Graphics();
  window.roundRect(center.x - 7, center.y - 23, 5, 7, 1).fill(0xa7d1ca);
  window.roundRect(center.x + 3, center.y - 23, 5, 7, 1).fill(0xa7d1ca);
  graphics.addChild(window);
  const tree = new Graphics();
  tree.rect(center.x + 16, center.y - 11, 2, 8).fill(0x765a3f);
  tree.circle(center.x + 17, center.y - 15, 6).fill(0x4f8d63);
  graphics.addChild(tree);
}

function drawPark(graphics: Graphics, building: Building) {
  const spec = BUILDINGS.park;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const upper = ground.map((point) => ({ x: point.x, y: point.y - 5 }));
  polygon(graphics, ground, 0x708c6e, 0.24);
  polygon(graphics, [ground[0], ground[1], upper[1], upper[0]], 0x73966d);
  polygon(graphics, [ground[1], ground[2], upper[2], upper[1]], 0x648b62);
  polygon(graphics, upper, 0x85ad76, 1, 0x608362);

  const path = new Graphics();
  const a = iso(building.x + 1.6, building.y + 0.7);
  const b = iso(building.x + 2.4, building.y + 3.3);
  path.moveTo(a.x, a.y - 5).lineTo(b.x, b.y - 5).stroke({ color: 0xdccba2, width: 5, alpha: 0.9 });
  for (const [dx, dy] of [[0.65, 0.75], [3.15, 0.75], [0.8, 3.1], [3.15, 3.1]] as const) {
    const tree = iso(building.x + dx, building.y + dy);
    path.rect(tree.x - 1.3, tree.y - 15, 2.6, 13).fill(0x725640);
    path.circle(tree.x, tree.y - 18, 8).fill(0x3e7958);
    path.circle(tree.x - 4, tree.y - 16, 4).fill(0x568d61);
  }
  graphics.addChild(path);
}

function drawClubhouse(graphics: Graphics, building: Building) {
  const spec = BUILDINGS.clubhouse;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const top = ground.map((point) => ({ x: point.x, y: point.y - 40 }));
  polygon(graphics, ground, 0x647768, 0.25);
  polygon(graphics, [ground[0], ground[1], top[1], top[0]], 0xe4c096);
  polygon(graphics, [ground[1], ground[2], top[2], top[1]], 0xc99463);
  polygon(graphics, top, 0xd98e62, 1, 0x9f6445);
  const front = iso(building.x + 1.5, building.y + 3);
  graphics.roundRect(front.x - 5, front.y - 24, 10, 18, 2).fill(0x425861);
  graphics.rect(front.x - 13, front.y - 34, 26, 4).fill(0xf4d08f);
}

function drawBlock(graphics: Graphics, building: Building, progress: number, options: {
  roof: number; sideA: number; sideB: number; window: number; floors?: number; glass?: boolean;
}) {
  const spec = BUILDINGS[building.kind];
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const lift = buildingLift(building, progress);
  const top = ground.map((point) => ({ x: point.x, y: point.y - lift }));
  polygon(graphics, ground, 0x657669, 0.24);
  polygon(graphics, [ground[0], ground[1], top[1], top[0]], options.sideA);
  polygon(graphics, [ground[1], ground[2], top[2], top[1]], options.sideB);
  polygon(graphics, top, options.roof, 1, 0x665d49);

  const floors = options.floors ?? 2;
  const center = iso(building.x + spec.width / 2, building.y + spec.height / 2);
  const rowGap = Math.max(8, lift / (floors + 1));
  const columns = Math.max(2, Math.min(5, Math.floor(spec.width * 1.25)));
  const windows = new Graphics();
  for (let row = 0; row < floors; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const offsetX = (column - (columns - 1) / 2) * Math.min(11, 32 / columns);
      const offsetY = row * rowGap;
      windows.roundRect(center.x + offsetX - 2.6, center.y - lift + 9 + offsetY, 5.2, Math.min(7, rowGap * 0.58), 1)
        .fill(options.window);
    }
  }
  if (options.glass) {
    windows.moveTo(center.x - 17, center.y - lift + 7).lineTo(center.x + 17, center.y - lift + 7)
      .stroke({ color: 0xe9f6ef, width: 2, alpha: 0.58 });
  }
  graphics.addChild(windows);
}

function drawPool(graphics: Graphics, building: Building) {
  const spec = BUILDINGS.pool;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const upper = ground.map((point) => ({ x: point.x, y: point.y - 5 }));
  polygon(graphics, ground, 0x677669, 0.25);
  polygon(graphics, [ground[0], ground[1], upper[1], upper[0]], 0xd8d3b8);
  polygon(graphics, [ground[1], ground[2], upper[2], upper[1]], 0xbeb89e);
  polygon(graphics, upper, 0x56aeb8, 1, 0xf4f0d9);
  const water = new Graphics();
  const center = iso(building.x + spec.width / 2, building.y + spec.height / 2);
  water.moveTo(center.x - 24, center.y - 4).quadraticCurveTo(center.x, center.y - 10, center.x + 24, center.y - 3)
    .stroke({ color: 0xd8f4ea, width: 2, alpha: 0.8 });
  water.moveTo(center.x - 20, center.y + 5).quadraticCurveTo(center.x, center.y, center.x + 20, center.y + 6)
    .stroke({ color: 0xd8f4ea, width: 1.4, alpha: 0.7 });
  graphics.addChild(water);
}

function drawBuildingArt(graphics: Graphics, building: Building, progress: number) {
  switch (building.kind) {
    case 'villa': drawVilla(graphics, building, progress); break;
    case 'duplex': drawBlock(graphics, building, progress, { roof: 0xc58b5c, sideA: 0xe0c9a2, sideB: 0xc4a57d, window: 0xa7d1ca, floors: 2 }); break;
    case 'townhouse': drawBlock(graphics, building, progress, { roof: 0xa96d54, sideA: 0xdfc6a1, sideB: 0xc6a47d, window: 0xa7d1ca, floors: 3 }); break;
    case 'apartment': drawBlock(graphics, building, progress, { roof: 0x7c9a9a, sideA: 0xb6c7ba, sideB: 0x8fa8a3, window: 0x83b7bd, floors: 6, glass: true }); break;
    case 'park': drawPark(graphics, building); break;
    case 'clubhouse': drawClubhouse(graphics, building); break;
    case 'pool': drawPool(graphics, building); break;
    case 'mall': drawBlock(graphics, building, progress, { roof: 0xd4d8c9, sideA: 0xc0d2cc, sideB: 0x94b6b3, window: 0x78aeb1, floors: 2, glass: true }); break;
    case 'office': drawBlock(graphics, building, progress, { roof: 0x7e9bac, sideA: 0xa9c3c7, sideB: 0x7899a4, window: 0x5d8fa0, floors: 7, glass: true }); break;
  }
}

function drawBuilding(layer: Container, building: Building, selected: boolean, progress: number) {
  const item = new Container();
  const spec = BUILDINGS[building.kind];
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const base = new Graphics();
  polygon(base, ground, selected ? 0xe2bd63 : 0x495d4b, selected ? 0.46 : 0.17, selected ? 0xffe1a0 : undefined);
  item.addChild(base);

  const sprite = new Graphics();
  drawBuildingArt(sprite, building, progress);
  item.addChild(sprite);

  if (progress < 1) {
    const center = iso(building.x + spec.width / 2, building.y + spec.height / 2);
    const scaffold = new Graphics();
    scaffold.moveTo(center.x + 14, center.y - 40).lineTo(center.x + 14, center.y - 74)
      .lineTo(center.x + 43, center.y - 74).stroke({ color: 0xd69f51, width: 2.5, alpha: 0.9 });
    scaffold.moveTo(center.x + 14, center.y - 70).lineTo(center.x + 35, center.y - 70)
      .stroke({ color: 0xffd27f, width: 2, alpha: 0.85 });
    item.addChild(scaffold);
    item.alpha = 0.74 + Math.min(0.26, progress * 0.26);
  }

  const labelPoint = iso(building.x + spec.width / 2, building.y + spec.height / 2);
  const name = new Text({
    text: building.name,
    style: { fontFamily: 'Inter, sans-serif', fontSize: 9, fill: '#f6f2e9', stroke: { color: '#34433c', width: 3 }, align: 'center' },
  });
  name.anchor.set(0.5);
  name.x = labelPoint.x;
  name.y = labelPoint.y - (building.kind === 'office' ? 100 : building.kind === 'apartment' ? 85 :
    building.kind === 'mall' ? 43 : building.kind === 'clubhouse' ? 48 : building.kind === 'villa' ? 36 : 18);
  item.addChild(name);
  item.eventMode = 'none';
  layer.addChild(item);
}

function redrawCity(terrain: Container, roads: Container, buildings: Container, city: CityState, plan: CityPlan, selectedId: string | null, includeTerrain: boolean) {
  if (includeTerrain) {
    terrain.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    drawTerrain(terrain, plan.width);
  }
  roads.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
  buildings.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
  drawRoads(roads, city);
  getRenderBuildings(city, plan).sort((a, b) => a.x + a.y - (b.x + b.y)).forEach((building) => {
    const age = Date.now() - building.createdAt;
    drawBuilding(buildings, building, building.id === selectedId, Math.min(1, age / 5200));
  });
}

function buildingAt(city: CityState, x: number, y: number): Building | undefined {
  return [...city.buildings].reverse().find((building) =>
    occupiedCells(building).some((cell) => cell.x === x && cell.y === y));
}

const blockHeights: Partial<Record<BuildingKind, number>> = {
  duplex: 35,
  townhouse: 40,
  apartment: 82,
  mall: 34,
  office: 96,
};

function buildingLift(building: Building, progress: number): number {
  switch (building.kind) {
    case 'villa': return Math.min(30, 9 + progress * 21);
    case 'duplex': return 5 + 35 * Math.max(0.08, progress);
    case 'townhouse': return 5 + 40 * Math.max(0.08, progress);
    case 'apartment': return 5 + 82 * Math.max(0.08, progress);
    case 'park':
    case 'pool': return 5;
    case 'clubhouse': return 40;
    default: return 5 + (blockHeights[building.kind] ?? 0) * Math.max(0.08, progress);
  }
}

function containsPoint(point: Point, polygonPoints: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i, i += 1) {
    const current = polygonPoints[i];
    const previous = polygonPoints[j];
    const crosses = (current.y > point.y) !== (previous.y > point.y) &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function buildingAtPoint(city: CityState, point: Point): Building | undefined {
  const byDrawOrder = [...city.buildings].sort((a, b) => a.x + a.y - b.x - b.y).reverse();
  for (const building of byDrawOrder) {
    const spec = BUILDINGS[building.kind];
    const ground = footprint(building.x, building.y, spec.width, spec.height);
    const progress = Math.min(1, (Date.now() - building.createdAt) / 5200);
    const lift = buildingLift(building, progress);
    const top = ground.map((vertex) => ({ x: vertex.x, y: vertex.y - lift }));
    const visibleFaces = [
      top,
      [ground[0], ground[1], top[1], top[0]],
      [ground[1], ground[2], top[2], top[1]],
      ground,
    ];
    if (visibleFaces.some((face) => containsPoint(point, face))) return building;
  }
  const cell = toCell(point);
  return buildingAt(city, cell.x, cell.y);
}

function toCell(worldPoint: Point): Cell {
  const a = (worldPoint.x - MAP_OFFSET_X) / HALF_W;
  const b = worldPoint.y / HALF_H;
  return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) };
}

export default function CityViewport(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const terrainRef = useRef<Container | null>(null);
  const roadsRef = useRef<Container | null>(null);
  const buildingsRef = useRef<Container | null>(null);
  const propsRef = useRef(props);

  useEffect(() => { propsRef.current = props; }, [props]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const app = new Application();

    void (async () => {
      await app.init({
        backgroundColor: 0xb9d0c1,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        resizeTo: host,
      });
      if (disposed) { app.destroy(true); return; }
      appRef.current = app;
      app.canvas.className = 'city-canvas';
      host.appendChild(app.canvas);

      const world = new Container();
      const terrain = new Container();
      const roads = new Container();
      const buildings = new Container();
      const ghost = new Container();
      const ghostShape = new Graphics();
      ghost.addChild(ghostShape);
      world.addChild(terrain, roads, buildings, ghost);
      app.stage.addChild(world);
      world.eventMode = 'static';
      world.hitArea = new Rectangle(-10_000, -10_000, 20_000, 20_000);
      terrainRef.current = terrain;
      roadsRef.current = roads;
      buildingsRef.current = buildings;
      redrawCity(terrain, roads, buildings, propsRef.current.city, propsRef.current.world.plan, propsRef.current.selectedBuildingId, true);

      const view = { x: 0, y: 0, scale: 0.86 };
      const center = iso(18, 20);
      const updateCamera = () => {
        world.scale.set(view.scale);
        world.position.set(app.screen.width / 2 - center.x * view.scale + view.x, app.screen.height / 2 - center.y * view.scale + view.y);
        const screenCorners = [
          { x: 0, y: 0 },
          { x: app.screen.width, y: 0 },
          { x: app.screen.width, y: app.screen.height },
          { x: 0, y: app.screen.height },
        ];
        const footprintPoints = screenCorners.map((corner) => {
          const localX = (corner.x - world.position.x) / view.scale;
          const localY = (corner.y - world.position.y) / view.scale;
          const a = (localX - MAP_OFFSET_X) / HALF_W;
          const b = localY / HALF_H;
          return { x: (a + b) / 2, y: (b - a) / 2 };
        });
        propsRef.current.onCameraFootprintChange(footprintPoints);
      };
      updateCamera();

      let pointerAction: 'paint' | 'bulldoze' | 'pan' | null = null;
      let lastPointer = { x: 0, y: 0 };
      let shiftPressed = false;
      const updateShift = (event: KeyboardEvent) => { shiftPressed = event.shiftKey; };
      window.addEventListener('keydown', updateShift);
      window.addEventListener('keyup', updateShift);
      const getLocalPoint = (event: { global: Point }) => world.toLocal(event.global);
      const handleCell = (cell: Cell, localPoint: Point) => {
        const current = propsRef.current;
        if (pointerAction === 'bulldoze') {
          const building = buildingAtPoint(current.city, localPoint);
          if (building) {
            current.onBulldoze({ x: building.x, y: building.y });
            return;
          }
        }
        if (!isLandCell(cell.x, cell.y, current.city.size)) return;
        if (pointerAction === 'paint') {
          current.onAddRoad(cell);
        } else if (pointerAction === 'bulldoze') {
          current.onBulldoze(cell);
        }
      };

      app.stage.on('pointerdown', (event) => {
        const localPoint = getLocalPoint(event);
        const cell = toCell(localPoint);
        lastPointer = { x: event.global.x, y: event.global.y };
        const current = propsRef.current;
        if (event.button === 1 || event.button === 2 || shiftPressed) {
          pointerAction = 'pan';
          return;
        }
        if (current.tool === 'road') {
          pointerAction = 'paint';
          handleCell(cell, localPoint);
        } else if (current.tool === 'bulldoze') {
          pointerAction = 'bulldoze';
          handleCell(cell, localPoint);
        } else if (current.tool === 'move') {
          if (current.movingBuildingId) current.onMoveBuilding(current.movingBuildingId, cell.x, cell.y);
          else {
            const building = buildingAtPoint(current.city, localPoint);
            if (building) current.onBeginMoveBuilding(building.id);
            else current.onSelectBuilding(null);
          }
        } else if (current.tool === 'select') {
          current.onSelectBuilding(buildingAtPoint(current.city, localPoint)?.id ?? null);
        } else {
          const kind = current.tool as BuildingKind;
          current.onPlaceBuilding(kind, cell.x, cell.y);
        }
      });
      app.stage.on('globalpointermove', (event) => {
        const localPoint = getLocalPoint(event);
        const cell = toCell(localPoint);
        const current = propsRef.current;
        if (pointerAction === 'pan') {
          view.x += event.global.x - lastPointer.x;
          view.y += event.global.y - lastPointer.y;
          lastPointer = { x: event.global.x, y: event.global.y };
          updateCamera();
        } else if (pointerAction === 'paint' || pointerAction === 'bulldoze') {
          handleCell(cell, localPoint);
        }
        ghostShape.clear();
        if (current.tool === 'road' && isLandCell(cell.x, cell.y, current.city.size)) {
          const validation = validateRoadPlacement(current.world, cell);
          if (validation.valid || validation.reason !== 'road-already-exists') {
            const invalid = !validation.valid;
            polygon(ghostShape, tileDiamond(cell.x, cell.y), invalid ? 0xd97962 : 0x8ba8ac, 0.72, invalid ? 0xb84c43 : 0xe9f0d5);
          }
        } else if (current.tool === 'road') {
          polygon(ghostShape, tileDiamond(cell.x, cell.y), 0xd97962, 0.64, 0xb84c43);
        } else if (Object.hasOwn(BUILDINGS, current.tool)) {
          const kind = current.tool as BuildingKind;
          const spec = BUILDINGS[kind];
          const valid = validateBuildingPlacement(current.world, kind, cell).valid;
          polygon(ghostShape, footprint(cell.x, cell.y, spec.width, spec.height), valid ? 0xf3da98 : 0xd97962, 0.58, valid ? 0xf9f2d5 : 0xb84c43);
        } else if (current.tool === 'move' && current.movingBuildingId) {
          const building = current.city.buildings.find((entry) => entry.id === current.movingBuildingId);
          if (building) {
            const spec = BUILDINGS[building.kind];
            const valid = validateBuildingMove(current.world, building.id, cell).valid;
            polygon(ghostShape, footprint(cell.x, cell.y, spec.width, spec.height), valid ? 0xb9e8c2 : 0xd97962,
              0.62, valid ? 0x4d9662 : 0xb84c43);
          }
        } else if (current.tool === 'move') {
          const building = buildingAtPoint(current.city, localPoint);
          if (building) {
            const spec = BUILDINGS[building.kind];
            polygon(ghostShape, footprint(building.x, building.y, spec.width, spec.height), 0xb9e8c2, 0.34, 0x4d9662);
          } else polygon(ghostShape, tileDiamond(cell.x, cell.y), 0xffe8a2, 0.18, 0xfff4d5);
        } else if (current.tool === 'bulldoze') {
          const building = buildingAtPoint(current.city, localPoint);
          if (building) {
            const spec = BUILDINGS[building.kind];
            polygon(ghostShape, footprint(building.x, building.y, spec.width, spec.height), 0xd97962, 0.5, 0xb84c43);
          } else {
            const road = current.city.roads.some((entry) => entry.x === cell.x && entry.y === cell.y);
            polygon(ghostShape, tileDiamond(cell.x, cell.y), road ? 0xd97962 : 0xffe8a2,
              road ? 0.55 : 0.18, road ? 0xb84c43 : 0xfff4d5);
          }
        } else {
          polygon(ghostShape, tileDiamond(cell.x, cell.y), 0xffe8a2, 0.24, 0xfff4d5);
        }
      });
      app.stage.on('pointerup', () => { pointerAction = null; });
      app.stage.on('pointerupoutside', () => { pointerAction = null; });

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const bounds = app.canvas.getBoundingClientRect();
        const mouse = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        const oldScale = view.scale;
        const nextScale = Math.max(0.38, Math.min(1.55, oldScale * (event.deltaY < 0 ? 1.1 : 0.91)));
        const worldX = (mouse.x - world.x) / oldScale;
        const worldY = (mouse.y - world.y) / oldScale;
        view.scale = nextScale;
        view.x = mouse.x - worldX * nextScale - (app.screen.width / 2 - center.x * nextScale);
        view.y = mouse.y - worldY * nextScale - (app.screen.height / 2 - center.y * nextScale);
        updateCamera();
      };
      app.canvas.addEventListener('wheel', onWheel, { passive: false });
      const resizeObserver = new ResizeObserver(updateCamera);
      resizeObserver.observe(host);
      const disconnectSimulation = connectSimulationTicker(app.ticker, (elapsedMs) => propsRef.current.onSimulationFrame(elapsedMs));
      app.ticker.add(() => {
        const now = Date.now();
        const orderedBuildings = getRenderBuildings(propsRef.current.city, propsRef.current.world.plan).sort((a, b) => a.x + a.y - (b.x + b.y));
        buildings.children.forEach((item, index) => {
          const building = orderedBuildings[index];
          if (!building) return;
          const age = now - building.createdAt;
          if (age < 5200) item.alpha = 0.72 + Math.min(0.28, age / 5200 * 0.28);
          else item.alpha = 1;
        });
      });

      (app as Application & { __cleanup?: () => void }).__cleanup = () => {
        disconnectSimulation();
        app.canvas.removeEventListener('wheel', onWheel);
        window.removeEventListener('keydown', updateShift);
        window.removeEventListener('keyup', updateShift);
        resizeObserver.disconnect();
      };
    })();

    return () => {
      disposed = true;
      const running = appRef.current;
      if (running) {
        (running as Application & { __cleanup?: () => void }).__cleanup?.();
        running.destroy(true, true);
        appRef.current = null;
      }
      host.replaceChildren();
      terrainRef.current = null;
      roadsRef.current = null;
      buildingsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terrain = terrainRef.current;
    const roads = roadsRef.current;
    const buildings = buildingsRef.current;
    if (!terrain || !roads || !buildings) return;
    redrawCity(terrain, roads, buildings, props.city, props.world.plan, props.selectedBuildingId, false);
  }, [props.city, props.world.plan, props.selectedBuildingId]);

  return <div ref={hostRef} className={`city-viewport ${props.tool === 'move' ? 'is-moving' : ''} ${props.tool === 'bulldoze' ? 'is-demolishing' : ''}`}
    aria-label="Isometric 64 by 64 city map" />;
}
