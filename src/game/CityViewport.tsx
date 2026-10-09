import { Application, Container, Graphics, Rectangle, Text } from 'pixi.js';
import { useEffect, useRef } from 'react';
import { BUILDINGS, canPlace, cellKey, isLandCell, occupiedCells, type Building, type BuildingKind, type CityState, type Cell, type Tool } from '../types';

const TILE_W = 56;
const TILE_H = 28;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
const MAP_OFFSET_X = 32 * TILE_W;

type Props = {
  city: CityState;
  tool: Tool;
  selectedBuildingId: string | null;
  onSelectBuilding: (id: string | null) => void;
  onPlaceBuilding: (kind: BuildingKind, x: number, y: number) => void;
  onAddRoad: (cell: Cell) => void;
  onBulldoze: (cell: Cell) => void;
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
  const lift = Math.min(30, 9 + progress * 21);
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

function drawBuilding(layer: Container, building: Building, selected: boolean, progress: number) {
  const item = new Container();
  const spec = BUILDINGS[building.kind];
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const base = new Graphics();
  polygon(base, ground, selected ? 0xe2bd63 : 0x495d4b, selected ? 0.46 : 0.17, selected ? 0xffe1a0 : undefined);
  item.addChild(base);

  const sprite = new Graphics();
  if (building.kind === 'villa') drawVilla(sprite, building, progress);
  else if (building.kind === 'park') drawPark(sprite, building);
  else drawClubhouse(sprite, building);
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
  name.y = labelPoint.y - (building.kind === 'clubhouse' ? 48 : building.kind === 'villa' ? 36 : 8);
  item.addChild(name);
  item.eventMode = 'none';
  layer.addChild(item);
}

function redrawCity(terrain: Container, roads: Container, buildings: Container, city: CityState, selectedId: string | null, includeTerrain: boolean) {
  if (includeTerrain) {
    terrain.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    drawTerrain(terrain, city.size);
  }
  roads.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
  buildings.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
  drawRoads(roads, city);
  [...city.buildings].sort((a, b) => a.x + a.y - (b.x + b.y)).forEach((building) => {
    const age = Date.now() - building.createdAt;
    drawBuilding(buildings, building, building.id === selectedId, Math.min(1, age / 5200));
  });
}

function buildingAt(city: CityState, x: number, y: number): Building | undefined {
  return [...city.buildings].reverse().find((building) =>
    occupiedCells(building).some((cell) => cell.x === x && cell.y === y));
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
      redrawCity(terrain, roads, buildings, propsRef.current.city, propsRef.current.selectedBuildingId, true);

      const view = { x: 0, y: 0, scale: 0.86 };
      const center = iso(18, 20);
      const updateCamera = () => {
        world.scale.set(view.scale);
        world.position.set(app.screen.width / 2 - center.x * view.scale + view.x, app.screen.height / 2 - center.y * view.scale + view.y);
      };
      updateCamera();

      let pointerAction: 'paint' | 'bulldoze' | 'pan' | null = null;
      let lastPointer = { x: 0, y: 0 };
      let shiftPressed = false;
      const updateShift = (event: KeyboardEvent) => { shiftPressed = event.shiftKey; };
      window.addEventListener('keydown', updateShift);
      window.addEventListener('keyup', updateShift);
      const getCell = (event: { global: Point }) => {
        const local = world.toLocal(event.global);
        return toCell(local);
      };
      const handleCell = (cell: Cell) => {
        const current = propsRef.current;
        if (!isLandCell(cell.x, cell.y, current.city.size)) return;
        if (pointerAction === 'paint' && !current.city.buildings.some((building) => occupiedCells(building).some((at) => at.x === cell.x && at.y === cell.y))) {
          current.onAddRoad(cell);
        } else if (pointerAction === 'bulldoze') {
          current.onBulldoze(cell);
        }
      };

      app.stage.on('pointerdown', (event) => {
        const cell = getCell(event);
        lastPointer = { x: event.global.x, y: event.global.y };
        const current = propsRef.current;
        if (event.button === 1 || event.button === 2 || shiftPressed) {
          pointerAction = 'pan';
          return;
        }
        if (current.tool === 'road') {
          pointerAction = 'paint';
          handleCell(cell);
        } else if (current.tool === 'bulldoze') {
          pointerAction = 'bulldoze';
          handleCell(cell);
        } else if (current.tool === 'select') {
          current.onSelectBuilding(buildingAt(current.city, cell.x, cell.y)?.id ?? null);
        } else {
          const kind = current.tool as BuildingKind;
          if (canPlace(current.city, kind, cell.x, cell.y)) current.onPlaceBuilding(kind, cell.x, cell.y);
        }
      });
      app.stage.on('globalpointermove', (event) => {
        const cell = getCell(event);
        const current = propsRef.current;
        if (pointerAction === 'pan') {
          view.x += event.global.x - lastPointer.x;
          view.y += event.global.y - lastPointer.y;
          lastPointer = { x: event.global.x, y: event.global.y };
          updateCamera();
        } else if (pointerAction === 'paint' || pointerAction === 'bulldoze') {
          handleCell(cell);
        }
        ghostShape.clear();
        if (current.tool === 'road' && isLandCell(cell.x, cell.y, current.city.size)) {
          const blocked = current.city.buildings.some((building) => occupiedCells(building).some((at) => at.x === cell.x && at.y === cell.y));
          const road = new Set(current.city.roads.map((at) => cellKey(at.x, at.y))).has(cellKey(cell.x, cell.y));
          if (!road) polygon(ghostShape, tileDiamond(cell.x, cell.y), blocked ? 0xd97962 : 0x8ba8ac, 0.72, blocked ? 0xb84c43 : 0xe9f0d5);
        } else if (current.tool === 'road') {
          polygon(ghostShape, tileDiamond(cell.x, cell.y), 0xd97962, 0.64, 0xb84c43);
        } else if (current.tool === 'villa' || current.tool === 'park' || current.tool === 'clubhouse') {
          const kind = current.tool;
          const spec = BUILDINGS[kind];
          const valid = canPlace(current.city, kind, cell.x, cell.y);
          polygon(ghostShape, footprint(cell.x, cell.y, spec.width, spec.height), valid ? 0xf3da98 : 0xd97962, 0.58, valid ? 0xf9f2d5 : 0xb84c43);
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
      app.ticker.add(() => {
        const now = Date.now();
        const orderedBuildings = [...propsRef.current.city.buildings].sort((a, b) => a.x + a.y - (b.x + b.y));
        buildings.children.forEach((item, index) => {
          const building = orderedBuildings[index];
          if (!building) return;
          const age = now - building.createdAt;
          if (age < 5200) item.alpha = 0.72 + Math.min(0.28, age / 5200 * 0.28);
          else item.alpha = 1;
        });
      });

      (app as Application & { __cleanup?: () => void }).__cleanup = () => {
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
    redrawCity(terrain, roads, buildings, props.city, props.selectedBuildingId, false);
  }, [props.city, props.selectedBuildingId]);

  return <div ref={hostRef} className="city-viewport" aria-label="Isometric 64 by 64 city map" />;
}
