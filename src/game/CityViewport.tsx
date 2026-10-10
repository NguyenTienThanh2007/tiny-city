import { Application, Container, Graphics, Text } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import type { CityPlan, WorldState } from '@tiny-city/simulation';
import { validateBuildingMove, validateBuildingPlacement, validateRoadPlacement } from '@tiny-city/simulation';
import { getRenderBuildings } from '../simulation/cityAdapter';
import { connectSimulationTicker } from '../simulation/tickerAdapter';
import { BUILDINGS, cellKey, occupiedCells, type Building, type BuildingKind, type CityState, type Cell, type Tool } from '../types';

import { cityView, footprint, iso, MAX_SCALE, MIN_SCALE, tileStroke, toCell, toGrid, type Point } from './mapGeometry';
import { rejectionFeedback } from '../simulation/feedback';

export type CameraRequest = { id: number; cell?: Cell };

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
  cameraRequest?: CameraRequest;
  onBeginGesture?: () => void;
  onEndGesture?: () => void;
};

function polygon(graphics: Graphics, points: Point[], color: number, alpha = 1, stroke?: number) {
  graphics.poly(points.flatMap((point) => [point.x, point.y])).fill({ color, alpha });
  if (stroke !== undefined) graphics.poly(points.flatMap((point) => [point.x, point.y])).stroke({ color: stroke, width: 1, alpha: 0.28 });
}

function tileDiamond(x: number, y: number): Point[] {
  return [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)];
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
  const window = graphics;
  window.roundRect(center.x - 7, center.y - 23, 5, 7, 1).fill(0xa7d1ca);
  window.roundRect(center.x + 3, center.y - 23, 5, 7, 1).fill(0xa7d1ca);
  const tree = graphics;
  tree.rect(center.x + 16, center.y - 11, 2, 8).fill(0x765a3f);
  tree.circle(center.x + 17, center.y - 15, 6).fill(0x4f8d63);
}

function drawPark(graphics: Graphics, building: Building) {
  const spec = BUILDINGS.park;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const upper = ground.map((point) => ({ x: point.x, y: point.y - 5 }));
  polygon(graphics, ground, 0x708c6e, 0.24);
  polygon(graphics, [ground[0], ground[1], upper[1], upper[0]], 0x73966d);
  polygon(graphics, [ground[1], ground[2], upper[2], upper[1]], 0x648b62);
  polygon(graphics, upper, 0x85ad76, 1, 0x608362);

  const path = graphics;
  const a = iso(building.x + 1.6, building.y + 0.7);
  const b = iso(building.x + 2.4, building.y + 3.3);
  path.moveTo(a.x, a.y - 5).lineTo(b.x, b.y - 5).stroke({ color: 0xdccba2, width: 5, alpha: 0.9 });
  for (const [dx, dy] of [[0.65, 0.75], [3.15, 0.75], [0.8, 3.1], [3.15, 3.1]] as const) {
    const tree = iso(building.x + dx, building.y + dy);
    path.rect(tree.x - 1.3, tree.y - 15, 2.6, 13).fill(0x725640);
    path.circle(tree.x, tree.y - 18, 8).fill(0x3e7958);
    path.circle(tree.x - 4, tree.y - 16, 4).fill(0x568d61);
  }
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
  const windows = graphics;
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
}

function drawPool(graphics: Graphics, building: Building) {
  const spec = BUILDINGS.pool;
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const upper = ground.map((point) => ({ x: point.x, y: point.y - 5 }));
  polygon(graphics, ground, 0x677669, 0.25);
  polygon(graphics, [ground[0], ground[1], upper[1], upper[0]], 0xd8d3b8);
  polygon(graphics, [ground[1], ground[2], upper[2], upper[1]], 0xbeb89e);
  polygon(graphics, upper, 0x56aeb8, 1, 0xf4f0d9);
  const water = graphics;
  const center = iso(building.x + spec.width / 2, building.y + spec.height / 2);
  water.moveTo(center.x - 24, center.y - 4).quadraticCurveTo(center.x, center.y - 10, center.x + 24, center.y - 3)
    .stroke({ color: 0xd8f4ea, width: 2, alpha: 0.8 });
  water.moveTo(center.x - 20, center.y + 5).quadraticCurveTo(center.x, center.y, center.x + 20, center.y + 6)
    .stroke({ color: 0xd8f4ea, width: 1.4, alpha: 0.7 });
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
  drawRoads(roads, city);
  redrawBuildings(buildings, city, plan, selectedId);
}

function redrawBuildings(buildings: Container, city: CityState, plan: CityPlan, selectedId: string | null) {
  buildings.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
  getRenderBuildings(city, plan).sort((a, b) => a.x + a.y - (b.x + b.y)).forEach((building) => {
    const age = Date.now() - building.createdAt;
    drawBuilding(buildings, building, building.id === selectedId, Math.max(0, Math.min(1, age / 5200)));
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
    const progress = Math.max(0, Math.min(1, (Date.now() - building.createdAt) / 5200));
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

export default function CityViewport(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const terrainRef = useRef<Container | null>(null);
  const roadsRef = useRef<Container | null>(null);
  const buildingsRef = useRef<Container | null>(null);
  const propsRef = useRef(props);
  const refreshRef = useRef<(() => void) | null>(null);
  const cameraRef = useRef<((request: CameraRequest) => void) | null>(null);
  const [preview, setPreview] = useState('');
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    const previous = propsRef.current;
    propsRef.current = props;
    if (previous.tool !== props.tool || previous.movingBuildingId !== props.movingBuildingId) {
      props.onEndGesture?.();
    }
    refreshRef.current?.();
  }, [props]);

  useEffect(() => {
    if (props.cameraRequest) cameraRef.current?.(props.cameraRequest);
  }, [props.cameraRequest]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const app = new Application();
    let cleanup = () => {};

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
      // Pixi v8 skips listeners on passive containers, including the default stage.
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;
      world.eventMode = 'none';
      terrainRef.current = terrain;
      roadsRef.current = roads;
      buildingsRef.current = buildings;
      redrawCity(terrain, roads, buildings, propsRef.current.city, propsRef.current.world.plan, propsRef.current.selectedBuildingId, true);

      const home = cityView(propsRef.current.city, app.screen.width, app.screen.height);
      const view = { x: 0, y: -25, scale: home.scale };
      let center = home.center;
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
          return toGrid({ x: localX, y: localY });
        });
        propsRef.current.onCameraFootprintChange(footprintPoints);
      };
      cameraRef.current = (request) => {
        if (request.cell) center = iso(request.cell.x, request.cell.y);
        else {
          const next = cityView(propsRef.current.city, app.screen.width, app.screen.height);
          center = next.center; view.scale = next.scale;
        }
        view.x = 0; view.y = -25;
        updateCamera();
        refreshRef.current?.();
      };
      if (propsRef.current.cameraRequest) cameraRef.current(propsRef.current.cameraRequest);
      else updateCamera();

      let pointerAction: 'paint' | 'bulldoze' | 'pan' | null = null;
      let lastPointer = { x: 0, y: 0 };
      let lastCell: Cell | null = null;
      let hoverPoint: Point | null = null;
      let gestureTool = propsRef.current.tool;
      const endGesture = () => {
        pointerAction = null; lastCell = null;
        propsRef.current.onEndGesture?.();
      };
      const leave = () => {
        endGesture(); hoverPoint = null;
        ghostShape.clear(); setPreview('');
      };
      const getLocalPoint = (event: { global: Point }) => world.toLocal(event.global);
      const handleCell = (cell: Cell, localPoint?: Point) => {
        const current = propsRef.current;
        if (pointerAction === 'bulldoze') {
          const building = localPoint ? buildingAtPoint(current.city, localPoint) : buildingAt(current.city, cell.x, cell.y);
          if (building) {
            current.onBulldoze({ x: building.x, y: building.y });
            return;
          }
        }
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
        gestureTool = current.tool;
        lastCell = cell;
        hoverPoint = { x: event.global.x, y: event.global.y };
        if (event.button === 1 || event.button === 2 || event.shiftKey) {
          pointerAction = 'pan';
          return;
        }
        if (current.tool === 'road') {
          current.onBeginGesture?.();
          pointerAction = 'paint';
          handleCell(cell, localPoint);
        } else if (current.tool === 'bulldoze') {
          current.onBeginGesture?.();
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
      const refreshPreview = () => {
        ghostShape.clear();
        if (!hoverPoint) return;
        const localPoint = world.toLocal(hoverPoint);
        const cell = toCell(localPoint);
        const current = propsRef.current;
        if (gestureTool !== current.tool) endGesture();
        let label = '';
        if (current.tool === 'road') {
          const validation = validateRoadPlacement(current.world, cell);
          label = validation.valid ? 'Road · Ready to build · $8' : rejectionFeedback[validation.reason];
          polygon(ghostShape, tileDiamond(cell.x, cell.y), validation.valid ? 0x8ba8ac : 0xd97962,
            0.64, validation.valid ? 0xe9f0d5 : 0xb84c43);
        } else if (Object.hasOwn(BUILDINGS, current.tool)) {
          const kind = current.tool as BuildingKind;
          const spec = BUILDINGS[kind];
          const validation = validateBuildingPlacement(current.world, kind, cell);
          label = `${spec.label} · ${spec.width} × ${spec.height} · ${validation.valid ? `Ready to build · $${spec.cost}` : rejectionFeedback[validation.reason]}`;
          polygon(ghostShape, footprint(cell.x, cell.y, spec.width, spec.height), validation.valid ? 0xf3da98 : 0xd97962,
            0.58, validation.valid ? 0xf9f2d5 : 0xb84c43);
        } else if (current.tool === 'move' && current.movingBuildingId) {
          const building = current.city.buildings.find((entry) => entry.id === current.movingBuildingId);
          if (building) {
            const spec = BUILDINGS[building.kind];
            const validation = validateBuildingMove(current.world, building.id, cell);
            label = validation.valid ? 'Ready to move · No cost' : rejectionFeedback[validation.reason];
            polygon(ghostShape, footprint(cell.x, cell.y, spec.width, spec.height), validation.valid ? 0xb9e8c2 : 0xd97962,
              0.62, validation.valid ? 0x4d9662 : 0xb84c43);
          }
        } else if (current.tool === 'move' || current.tool === 'bulldoze') {
          const building = buildingAtPoint(current.city, localPoint);
          if (building) {
            const spec = BUILDINGS[building.kind];
            label = `${current.tool === 'move' ? 'Move' : 'Demolish'} ${building.name}`;
            polygon(ghostShape, footprint(building.x, building.y, spec.width, spec.height),
              current.tool === 'move' ? 0xb9e8c2 : 0xd97962, 0.5);
          } else {
            label = current.tool === 'move' ? 'Choose a building to move.' : 'Choose a building or road to demolish.';
            polygon(ghostShape, tileDiamond(cell.x, cell.y), 0xffe8a2, 0.18, 0xfff4d5);
          }
        }
        setPreview(label);
      };
      refreshRef.current = refreshPreview;
      app.stage.on('globalpointermove', (event) => {
        if (event.nativeEvent.target !== app.canvas || event.global.x < 0 || event.global.y < 0 ||
            event.global.x >= app.screen.width || event.global.y >= app.screen.height) {
          leave();
          return;
        }
        hoverPoint = { x: event.global.x, y: event.global.y };
        const localPoint = getLocalPoint(event);
        const cell = toCell(localPoint);
        const current = propsRef.current;
        if (gestureTool !== current.tool) endGesture();
        if (pointerAction === 'pan') {
          view.x += event.global.x - lastPointer.x;
          view.y += event.global.y - lastPointer.y;
          lastPointer = { x: event.global.x, y: event.global.y };
          updateCamera();
        } else if (pointerAction === 'paint' || pointerAction === 'bulldoze') {
          const cells = lastCell ? tileStroke(lastCell, cell, current.city.size) : [cell];
          for (const tile of cells) handleCell(tile, tile.x === cell.x && tile.y === cell.y ? localPoint : undefined);
          lastCell = cell;
        }
        refreshPreview();
      });
      app.stage.on('pointerup', endGesture);
      app.stage.on('pointerupoutside', endGesture);
      app.canvas.addEventListener('pointerleave', leave);
      window.addEventListener('pointerup', endGesture);
      window.addEventListener('blur', leave);
      const preventContextMenu = (event: Event) => event.preventDefault();
      app.canvas.addEventListener('contextmenu', preventContextMenu);

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        const bounds = app.canvas.getBoundingClientRect();
        const mouse = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        const oldScale = view.scale;
        const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * (event.deltaY < 0 ? 1.1 : 0.91)));
        const worldX = (mouse.x - world.x) / oldScale;
        const worldY = (mouse.y - world.y) / oldScale;
        view.scale = nextScale;
        view.x = mouse.x - worldX * nextScale - (app.screen.width / 2 - center.x * nextScale);
        view.y = mouse.y - worldY * nextScale - (app.screen.height / 2 - center.y * nextScale);
        updateCamera();
        refreshPreview();
      };
      app.canvas.addEventListener('wheel', onWheel, { passive: false });
      const resizeObserver = new ResizeObserver(() => {
        // Pixi queues window resize on RAF; update it before deriving pointer/minimap transforms.
        app.resize();
        app.stage.hitArea = app.screen;
        updateCamera();
        refreshPreview();
      });
      resizeObserver.observe(host);
      const disconnectSimulation = connectSimulationTicker(app.ticker, (elapsedMs) => propsRef.current.onSimulationFrame(elapsedMs));
      // Geometry, labels, and scaffolding must finish even while simulation time is paused.
      let wasConstructing = false;
      let lastConstructionDraw = 0;
      app.ticker.add(() => {
        const now = Date.now();
        const current = propsRef.current;
        const constructing = current.city.buildings.some((building) => now - building.createdAt < 5200);
        if ((constructing && now - lastConstructionDraw >= 100) || (wasConstructing && !constructing)) {
          redrawBuildings(buildings, current.city, current.world.plan, current.selectedBuildingId);
          lastConstructionDraw = now;
        }
        wasConstructing = constructing;
      });

      cleanup = () => {
        disconnectSimulation();
        app.canvas.removeEventListener('wheel', onWheel);
        app.canvas.removeEventListener('pointerleave', leave);
        app.canvas.removeEventListener('contextmenu', preventContextMenu);
        window.removeEventListener('pointerup', endGesture);
        window.removeEventListener('blur', leave);
        resizeObserver.disconnect();
      };
    })().catch(() => {
      if (!disposed) setRenderError(true);
    });

    return () => {
      disposed = true;
      cleanup();
      if (appRef.current === app) {
        app.destroy(true, { children: true });
        appRef.current = null;
      }
      refreshRef.current = null;
      cameraRef.current = null;
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

  return <><div ref={hostRef} className={`city-viewport ${props.tool === 'move' ? 'is-moving' : ''} ${props.tool === 'bulldoze' ? 'is-demolishing' : ''}`}
    aria-label="Isometric 64 by 64 city map" />
    {preview && <output className="placement-feedback" aria-label="Placement preview">{preview}</output>}
    {renderError && <div className="render-error" role="alert">The city renderer could not start. Reload to retry; your saved city is still on this device.</div>}
  </>;
}
