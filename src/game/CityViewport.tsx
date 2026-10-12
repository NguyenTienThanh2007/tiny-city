import { Application, Container, Graphics, Text } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import type { CityPlan, Position, WorldState } from '@tiny-city/simulation';
import type { PlanProposal } from '@tiny-city/ai-architect';
import { validateBuildingMove, validateBuildingPlacement, validateRoadPlacement } from '@tiny-city/simulation';
import { getRenderBuildings } from '../simulation/cityAdapter';
import { connectSimulationTicker } from '../simulation/tickerAdapter';
import { BUILDINGS, cellKey, occupiedCells, type Building, type BuildingKind, type CityState, type Cell, type Tool } from '../types';
import { buildingLift, drawBuildingArt, polygon, roofCapHeight } from './buildingArt';
import { NpcLayer, type LocalBounds } from './npcLayer';
import { buildingDepth } from './npcMotion';
import { cityView, footprint, iso, MAX_SCALE, MIN_SCALE, proposalOverlayGeometry, tileStroke, toCell, toGrid, type Point } from './mapGeometry';
import { rejectionFeedback } from '../simulation/feedback';

export { buildingLift } from './buildingArt';

/** `cell` may be fractional (a resident's position). `zoom` multiplies the scale around the visible center. */
export type CameraRequest = { id: number; cell?: Position; zoom?: number; scale?: number };
export type SafeArea = { left: number; right: number; top: number; bottom: number };
export type RendererStats = { fps: number; frameMs: number; residents: number; visibleResidents: number };

type Props = {
  city: CityState;
  world: WorldState;
  /** Live snapshot reader; residents are drawn from it every frame without React renders. */
  getWorld?: () => WorldState;
  proposal?: PlanProposal | null;
  onSimulationFrame: (elapsedMs: number) => void;
  tool: Tool;
  selectedBuildingId: string | null;
  movingBuildingId: string | null;
  selectedCitizenId?: string | null;
  followCitizenId?: string | null;
  onSelectBuilding: (id: string | null) => void;
  onSelectCitizen?: (id: string | null) => void;
  onFollowEnd?: () => void;
  onPlaceBuilding: (kind: BuildingKind, x: number, y: number) => void;
  onBeginMoveBuilding: (id: string) => void;
  onMoveBuilding: (id: string, x: number, y: number) => void;
  onAddRoad: (cell: Cell) => void;
  onBulldoze: (cell: Cell) => void;
  onCameraFootprintChange: (points: Point[]) => void;
  cameraRequest?: CameraRequest;
  safeArea?: SafeArea;
  onBeginGesture?: () => void;
  onEndGesture?: () => void;
};

const SEA = 0x8fc3c0;
const NO_SAFE_AREA: SafeArea = { left: 0, right: 0, top: 0, bottom: 0 };

function tileDiamond(x: number, y: number): Point[] {
  return [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)];
}

function noise(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function drawTerrain(layer: Container, size: number) {
  const terrain = new Graphics();
  // Island skirt: soil and cliff faces under the front edges give the map physical depth.
  const depth = 26;
  const edgeLeft = [iso(0, size), iso(size, size)];
  const edgeRight = [iso(size, size), iso(size, 0)];
  polygon(terrain, [edgeLeft[0], edgeLeft[1], { x: edgeLeft[1].x, y: edgeLeft[1].y + depth }, { x: edgeLeft[0].x, y: edgeLeft[0].y + depth }], 0x6f8f86);
  polygon(terrain, [edgeRight[0], edgeRight[1], { x: edgeRight[1].x, y: edgeRight[1].y + depth }, { x: edgeRight[0].x, y: edgeRight[0].y + depth }], 0x5f807a);
  const grass = [0x93ba8b, 0x97be8e, 0x8eb486, 0x9bc392, 0x90b889];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coast = x + y;
      const n = noise(x, y);
      let color = grass[Math.floor(n * grass.length)]!;
      if (coast >= size * 2 - 8) color = coast >= size * 2 - 5 ? 0x6fb1b4 : 0x7fbdbb;
      else if (coast >= size * 2 - 10) color = 0xe6d7a8;
      else if (coast >= size * 2 - 13) color = n > 0.5 ? 0xd9cd96 : 0xcfd69b;
      polygon(terrain, tileDiamond(x, y), color, 1, coast >= size * 2 - 8 ? 0x5f9fa1 : 0x7da47a, 0.18);
    }
  }
  // Flat decals: flowers and grass tufts never block placement, and a few wave crests on the water.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = noise(x + 31, y + 17);
      const coast = x + y;
      const center = iso(x + 0.5, y + 0.5);
      if (coast >= size * 2 - 8) {
        if (n > 0.82) terrain.moveTo(center.x - 8, center.y).quadraticCurveTo(center.x, center.y - 3, center.x + 8, center.y)
          .stroke({ color: 0xe4f5ef, width: 1.2, alpha: 0.55 });
      } else if (coast < size * 2 - 13) {
        if (n > 0.93) terrain.circle(center.x - 4, center.y, 1.3).fill(0xf2d16b).circle(center.x + 3, center.y + 2, 1.2).fill(0xf4efe2);
        else if (n < 0.05) terrain.circle(center.x, center.y, 1.4).fill(0xe58f7a);
        else if (n > 0.6 && n < 0.64) terrain.ellipse(center.x, center.y, 7, 3).fill({ color: 0x7ea873, alpha: 0.5 });
      }
    }
  }
  layer.addChild(terrain);
}

function drawRoads(layer: Container, city: CityState) {
  const roadSet = new Set(city.roads.map(({ x, y }) => cellKey(x, y)));
  const roadGraphics = new Graphics();
  for (const { x, y } of city.roads) {
    // Pale curb, then asphalt inset.
    polygon(roadGraphics, tileDiamond(x, y), 0xd9d1bd, 1);
    const inset = [iso(x + 0.1, y + 0.1), iso(x + 0.9, y + 0.1), iso(x + 0.9, y + 0.9), iso(x + 0.1, y + 0.9)];
    polygon(roadGraphics, inset, 0x5b676c, 1);
    const extend = (dx: number, dy: number) => {
      if (!roadSet.has(cellKey(x + dx, y + dy))) return;
      const strip = dx !== 0
        ? [iso(dx > 0 ? x + 0.9 : x, y + 0.1), iso(dx > 0 ? x + 1 : x + 0.1, y + 0.1), iso(dx > 0 ? x + 1 : x + 0.1, y + 0.9), iso(dx > 0 ? x + 0.9 : x, y + 0.9)]
        : [iso(x + 0.1, dy > 0 ? y + 0.9 : y), iso(x + 0.9, dy > 0 ? y + 0.9 : y), iso(x + 0.9, dy > 0 ? y + 1 : y + 0.1), iso(x + 0.1, dy > 0 ? y + 1 : y + 0.1)];
      polygon(roadGraphics, strip, 0x5b676c, 1);
    };
    extend(1, 0); extend(-1, 0); extend(0, 1); extend(0, -1);
    const center = iso(x + 0.5, y + 0.5);
    const hasX = roadSet.has(cellKey(x - 1, y)) || roadSet.has(cellKey(x + 1, y));
    const hasY = roadSet.has(cellKey(x, y - 1)) || roadSet.has(cellKey(x, y + 1));
    if (hasX && !hasY) roadGraphics.moveTo(center.x - 8, center.y - 4).lineTo(center.x + 8, center.y + 4).stroke({ color: 0xf3e3b0, width: 1.4, alpha: 0.85 });
    if (hasY && !hasX) roadGraphics.moveTo(center.x + 8, center.y - 4).lineTo(center.x - 8, center.y + 4).stroke({ color: 0xf3e3b0, width: 1.4, alpha: 0.85 });
    if (hasX && hasY) roadGraphics.circle(center.x, center.y, 2).fill({ color: 0xf3e3b0, alpha: 0.5 });
  }
  layer.addChild(roadGraphics);
}

function drawBuilding(layer: Container, building: Building, selected: boolean, progress: number) {
  const item = new Container();
  item.label = 'building';
  const spec = BUILDINGS[building.kind];
  const ground = footprint(building.x, building.y, spec.width, spec.height);
  const base = new Graphics();
  polygon(base, ground, selected ? 0xffd36e : 0x3c5242, selected ? 0.5 : 0.16, selected ? 0xfff1c4 : undefined, selected ? 0.95 : 0.28);
  if (selected) {
    base.poly(ground.flatMap((point) => [point.x, point.y])).stroke({ color: 0xffd36e, width: 2.5, alpha: 0.9 });
  }
  item.addChild(base);

  const sprite = new Graphics();
  drawBuildingArt(sprite, building, progress);
  item.addChild(sprite);

  if (progress < 1) {
    const center = iso(building.x + spec.width / 2, building.y + spec.height / 2);
    const scaffold = new Graphics();
    const height = buildingLift(building, progress);
    scaffold.moveTo(center.x + 14, center.y - height + 4).lineTo(center.x + 14, center.y - height - 30)
      .lineTo(center.x + 43, center.y - height - 30).stroke({ color: 0xd69f51, width: 2.5, alpha: 0.9 });
    scaffold.moveTo(center.x + 14, center.y - height - 26).lineTo(center.x + 35, center.y - height - 26)
      .stroke({ color: 0xffd27f, width: 2, alpha: 0.85 });
    scaffold.moveTo(center.x + 40, center.y - height - 30).lineTo(center.x + 40, center.y - height - 18)
      .stroke({ color: 0x4a4a4a, width: 0.8 });
    item.addChild(scaffold);
    item.alpha = 0.74 + Math.min(0.26, progress * 0.26);
  }
  item.eventMode = 'none';
  item.zIndex = buildingDepth(building.x, building.y, spec.width, spec.height);
  layer.addChild(item);
}

function clearBuildings(buildings: Container) {
  for (const child of [...buildings.children]) {
    if (child.label !== 'building') continue;
    buildings.removeChild(child);
    child.destroy({ children: true, context: true });
  }
}

function redrawBuildings(buildings: Container, city: CityState, plan: CityPlan, selectedId: string | null) {
  clearBuildings(buildings);
  for (const building of getRenderBuildings(city, plan)) {
    const age = Date.now() - building.createdAt;
    drawBuilding(buildings, building, building.id === selectedId, Math.max(0, Math.min(1, age / 5200)));
  }
}

function redrawCity(terrain: Container, roads: Container, buildings: Container, city: CityState, plan: CityPlan, selectedId: string | null, includeTerrain: boolean) {
  if (includeTerrain) {
    terrain.cacheAsTexture(false);
    terrain.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    drawTerrain(terrain, plan.width);
    // ~8k static triangles become one textured quad; redrawn only when the map itself changes.
    terrain.cacheAsTexture({ resolution: 1, antialias: true });
  }
  roads.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
  drawRoads(roads, city);
  redrawBuildings(buildings, city, plan, selectedId);
}

function redrawProposalOverlay(layer: Container, proposal: PlanProposal | null | undefined, sourcePlan: CityPlan) {
  layer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
  layer.eventMode = 'none';
  if (!proposal || proposal.status === 'REJECTED') return;

  const geometry = proposalOverlayGeometry(proposal, sourcePlan);
  const roads = new Graphics();
  for (const points of geometry.roadAdds) polygon(roads, points, 0x50c8a3, 0.62, 0x16785f);
  for (const points of geometry.roadRemovals) {
    polygon(roads, points, 0xe36f73, 0.58, 0xa33449);
    const center = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
    roads.moveTo(center.x - 7, center.y - 4).lineTo(center.x + 7, center.y + 4)
      .moveTo(center.x + 7, center.y - 4).lineTo(center.x - 7, center.y + 4)
      .stroke({ color: 0x8f263c, width: 2.4, alpha: 0.95 });
  }
  layer.addChild(roads);

  const buildings = new Graphics();
  for (const demolition of geometry.demolitions) polygon(buildings, demolition.points, 0xe36f73, 0.5, 0xa33449);
  for (const placement of geometry.placements) {
    if (placement.from) polygon(buildings, placement.from, 0xe7a66f, 0.4, 0xb2633f);
    polygon(buildings, placement.points, placement.operation === 'move' ? 0x64b8d1 : 0x62c797,
      0.56, placement.operation === 'move' ? 0x287d99 : 0x287a50);
    // Dashed blueprint outline keeps AI previews visibly distinct from built geometry.
    const pts = placement.points;
    for (let index = 0; index < pts.length; index += 1) {
      const a = pts[index]!, b = pts[(index + 1) % pts.length]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const dashes = Math.max(2, Math.floor(length / 7));
      for (let dash = 0; dash < dashes; dash += 2) {
        const t1 = dash / dashes, t2 = Math.min(1, (dash + 1) / dashes);
        buildings.moveTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1).lineTo(a.x + (b.x - a.x) * t2, a.y + (b.y - a.y) * t2);
      }
    }
    buildings.stroke({ color: 0xffffff, width: 1.6, alpha: 0.9 });
  }
  layer.addChild(buildings);
}

function buildingAt(city: CityState, x: number, y: number): Building | undefined {
  return [...city.buildings].reverse().find((building) =>
    occupiedCells(building).some((cell) => cell.x === x && cell.y === y));
}

function containsPoint(point: Point, polygonPoints: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i, i += 1) {
    const current = polygonPoints[i]!;
    const previous = polygonPoints[j]!;
    const crosses = (current.y > point.y) !== (previous.y > point.y) &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function buildingAtPoint(city: CityState, point: Point): Building | undefined {
  const byDrawOrder = [...city.buildings].sort((a, b) => {
    const sa = BUILDINGS[a.kind], sb = BUILDINGS[b.kind];
    return buildingDepth(a.x, a.y, sa.width, sa.height) - buildingDepth(b.x, b.y, sb.width, sb.height);
  }).reverse();
  for (const building of byDrawOrder) {
    const spec = BUILDINGS[building.kind];
    const ground = footprint(building.x, building.y, spec.width, spec.height);
    const progress = Math.max(0, Math.min(1, (Date.now() - building.createdAt) / 5200));
    const lift = buildingLift(building, progress);
    const top = ground.map((vertex) => ({ x: vertex.x, y: vertex.y - lift }));
    const cap = top.map((vertex) => ({ x: vertex.x, y: vertex.y - roofCapHeight(building.kind) }));
    const visibleFaces = [
      top, cap,
      [ground[3]!, ground[2]!, top[2]!, top[3]!],
      [ground[1]!, ground[2]!, top[2]!, top[1]!],
      [ground[0]!, ground[1]!, top[1]!, top[0]!],
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
  const proposalOverlayRef = useRef<Container | null>(null);
  const propsRef = useRef(props);
  const refreshRef = useRef<(() => void) | null>(null);
  const cameraRef = useRef<((request: CameraRequest) => void) | null>(null);
  const safeAreaRef = useRef<(() => void) | null>(null);
  const nameplateRef = useRef<(() => void) | null>(null);
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

  const safe = props.safeArea ?? NO_SAFE_AREA;
  useEffect(() => { safeAreaRef.current?.(); }, [safe.left, safe.right, safe.top, safe.bottom]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const app = new Application();
    let cleanup = () => {};

    void (async () => {
      await app.init({
        backgroundColor: SEA,
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
      const groundOverlay = new Container();
      // Buildings and residents share one depth-sorted container so walkers pass behind and in front correctly.
      const buildings = new Container();
      buildings.sortableChildren = true;
      const proposalOverlay = new Container();
      const ghost = new Container();
      const ghostShape = new Graphics();
      const ghostArt = new Graphics();
      ghostArt.alpha = 0.62;
      ghost.addChild(ghostShape, ghostArt);
      const labels = new Container();
      const nameplateBg = new Graphics();
      const nameplate = new Text({ text: '', style: { fontFamily: 'Manrope, Inter, sans-serif', fontSize: 11, fontWeight: '700', fill: '#24382c' } });
      nameplate.anchor.set(0.5, 1);
      labels.addChild(nameplateBg, nameplate);
      labels.visible = false;
      world.addChild(terrain, roads, groundOverlay, buildings, proposalOverlay, ghost, labels);
      app.stage.addChild(world);
      // Pixi v8 skips listeners on passive containers, including the default stage.
      app.stage.eventMode = 'static';
      app.stage.hitArea = app.screen;
      world.eventMode = 'none';
      terrainRef.current = terrain;
      roadsRef.current = roads;
      buildingsRef.current = buildings;
      proposalOverlayRef.current = proposalOverlay;
      redrawCity(terrain, roads, buildings, propsRef.current.city, propsRef.current.world.plan, propsRef.current.selectedBuildingId, true);
      redrawProposalOverlay(proposalOverlay, propsRef.current.proposal, propsRef.current.world.plan);
      const npcs = new NpcLayer(buildings, groundOverlay);

      const safeBox = () => {
        const area = propsRef.current.safeArea ?? NO_SAFE_AREA;
        const width = Math.max(120, app.screen.width - area.left - area.right);
        const height = Math.max(120, app.screen.height - area.top - area.bottom);
        return { width, height, cx: area.left + width / 2, cy: area.top + height / 2 };
      };
      const home = (() => { const box = safeBox(); return cityView(propsRef.current.city, box.width, box.height); })();
      const view = { x: 0, y: -25, scale: home.scale };
      let center = home.center;
      let lastFootprint = 0;
      let following = false;
      const updateCamera = (throttle = false) => {
        const box = safeBox();
        world.scale.set(view.scale);
        world.position.set(box.cx - center.x * view.scale + view.x, box.cy - center.y * view.scale + view.y);
        const now = performance.now();
        if (throttle && now - lastFootprint < 120) return;
        lastFootprint = now;
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
      const zoomAround = (screenPoint: Point, nextScale: number) => {
        const box = safeBox();
        const oldScale = view.scale;
        const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
        const worldX = (screenPoint.x - world.x) / oldScale;
        const worldY = (screenPoint.y - world.y) / oldScale;
        view.scale = clamped;
        view.x = screenPoint.x - worldX * clamped - (box.cx - center.x * clamped);
        view.y = screenPoint.y - worldY * clamped - (box.cy - center.y * clamped);
      };
      cameraRef.current = (request) => {
        if (request.zoom !== undefined && !request.cell) {
          const box = safeBox();
          zoomAround({ x: box.cx, y: box.cy }, view.scale * request.zoom);
        } else if (request.cell) {
          center = iso(request.cell.x, request.cell.y);
          if (request.scale !== undefined) view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, request.scale));
          view.x = 0; view.y = request.scale !== undefined ? 0 : -25;
        } else {
          const box = safeBox();
          const next = cityView(propsRef.current.city, box.width, box.height);
          center = next.center; view.scale = next.scale;
          view.x = 0; view.y = -25;
        }
        updateCamera();
        refreshRef.current?.();
      };
      safeAreaRef.current = () => updateCamera();
      if (propsRef.current.cameraRequest) cameraRef.current(propsRef.current.cameraRequest);
      else updateCamera();

      let pointerAction: 'paint' | 'bulldoze' | 'pan' | null = null;
      let lastPointer = { x: 0, y: 0 };
      let lastCell: Cell | null = null;
      let hoverPoint: Point | null = null;
      let hoverBuildingId: string | null = null;
      let hoverCitizenId: string | null = null;
      let gestureTool = propsRef.current.tool;
      const endGesture = () => {
        pointerAction = null; lastCell = null;
        propsRef.current.onEndGesture?.();
      };
      const leave = () => {
        endGesture(); hoverPoint = null; hoverBuildingId = null; hoverCitizenId = null;
        ghostShape.clear(); ghostArt.clear(); setPreview('');
        host.style.cursor = '';
        nameplateRef.current?.();
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

      const drawNameplate = () => {
        const current = propsRef.current;
        const live = current.getWorld?.() ?? current.world;
        nameplateBg.clear();
        let text = '';
        let anchor: Point | null = null;
        const citizenId = hoverCitizenId ?? current.selectedCitizenId ?? null;
        if (citizenId) {
          const citizen = live.citizens.find((entry) => entry.id === citizenId);
          const position = npcs.getRenderedPosition(citizenId);
          if (citizen && position) { text = citizen.name; const point = iso(position.x, position.y); anchor = { x: point.x, y: point.y - 26 }; }
        }
        const buildingId = !text ? hoverBuildingId ?? current.selectedBuildingId : null;
        if (buildingId) {
          const building = current.city.buildings.find((entry) => entry.id === buildingId);
          if (building) {
            const spec = BUILDINGS[building.kind];
            const point = iso(building.x + spec.width / 2, building.y + spec.height / 2);
            text = building.name;
            anchor = { x: point.x, y: point.y - buildingLift(building, 1) - roofCapHeight(building.kind) - 10 };
          }
        }
        if (!text || !anchor) { labels.visible = false; return; }
        nameplate.text = text;
        const inverse = 1 / Math.max(0.35, Math.min(1.4, view.scale));
        labels.scale.set(1);
        nameplate.scale.set(inverse);
        nameplate.position.set(anchor.x, anchor.y);
        const width = nameplate.width + 14 * inverse, height = nameplate.height + 7 * inverse;
        nameplateBg.roundRect(anchor.x - width / 2, anchor.y - height + 1 * inverse, width, height, 7 * inverse)
          .fill({ color: 0xfbf7ee, alpha: 0.95 }).stroke({ color: 0x24382c, width: 1 * inverse, alpha: 0.12 });
        nameplateBg.poly([anchor.x - 4 * inverse, anchor.y + 1 * inverse, anchor.x + 4 * inverse, anchor.y + 1 * inverse, anchor.x, anchor.y + 5 * inverse])
          .fill({ color: 0xfbf7ee, alpha: 0.95 });
        labels.visible = true;
      };
      nameplateRef.current = drawNameplate;

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
          const citizenId = current.onSelectCitizen ? npcs.pick(localPoint, view.scale) : null;
          if (citizenId) current.onSelectCitizen?.(citizenId);
          else current.onSelectBuilding(buildingAtPoint(current.city, localPoint)?.id ?? null);
        } else {
          const kind = current.tool as BuildingKind;
          current.onPlaceBuilding(kind, cell.x, cell.y);
        }
      });
      const refreshPreview = () => {
        ghostShape.clear();
        ghostArt.clear();
        if (!hoverPoint) { nameplateRef.current?.(); return; }
        const localPoint = world.toLocal(hoverPoint);
        const cell = toCell(localPoint);
        const current = propsRef.current;
        if (gestureTool !== current.tool) endGesture();
        let label = '';
        hoverBuildingId = null;
        hoverCitizenId = null;
        if (current.tool === 'road') {
          const validation = validateRoadPlacement(current.world, cell);
          label = validation.valid ? 'Road · Ready to build · $8' : rejectionFeedback[validation.reason];
          polygon(ghostShape, tileDiamond(cell.x, cell.y), validation.valid ? 0x8ba8ac : 0xd97962,
            0.64, validation.valid ? 0xe9f0d5 : 0xb84c43, 0.8);
        } else if (Object.hasOwn(BUILDINGS, current.tool)) {
          const kind = current.tool as BuildingKind;
          const spec = BUILDINGS[kind];
          const validation = validateBuildingPlacement(current.world, kind, cell);
          label = `${spec.label} · ${spec.width} × ${spec.height} · ${validation.valid ? `Ready to build · $${spec.cost}` : rejectionFeedback[validation.reason]}`;
          polygon(ghostShape, footprint(cell.x, cell.y, spec.width, spec.height), validation.valid ? 0xf3da98 : 0xd97962,
            0.58, validation.valid ? 0xf9f2d5 : 0xb84c43, 0.9);
          if (validation.valid) drawBuildingArt(ghostArt, { id: 'ghost', kind, x: cell.x, y: cell.y, name: '', createdAt: 0 }, 1);
        } else if (current.tool === 'move' && current.movingBuildingId) {
          const building = current.city.buildings.find((entry) => entry.id === current.movingBuildingId);
          if (building) {
            const spec = BUILDINGS[building.kind];
            const validation = validateBuildingMove(current.world, building.id, cell);
            label = validation.valid ? 'Ready to move · No cost' : rejectionFeedback[validation.reason];
            polygon(ghostShape, footprint(cell.x, cell.y, spec.width, spec.height), validation.valid ? 0xb9e8c2 : 0xd97962,
              0.62, validation.valid ? 0x4d9662 : 0xb84c43, 0.9);
            if (validation.valid) drawBuildingArt(ghostArt, { ...building, x: cell.x, y: cell.y, createdAt: 0 }, 1);
          }
        } else if (current.tool === 'move' || current.tool === 'bulldoze') {
          const building = buildingAtPoint(current.city, localPoint);
          if (building) {
            const spec = BUILDINGS[building.kind];
            label = `${current.tool === 'move' ? 'Move' : 'Demolish'} ${building.name}`;
            hoverBuildingId = building.id;
            polygon(ghostShape, footprint(building.x, building.y, spec.width, spec.height),
              current.tool === 'move' ? 0xb9e8c2 : 0xd97962, 0.5);
          } else {
            label = current.tool === 'move' ? 'Choose a building to move.' : 'Choose a building or road to demolish.';
            polygon(ghostShape, tileDiamond(cell.x, cell.y), 0xffe8a2, 0.18, 0xfff4d5);
          }
        } else if (current.tool === 'select') {
          hoverCitizenId = current.onSelectCitizen ? npcs.pick(localPoint, view.scale) : null;
          if (!hoverCitizenId) hoverBuildingId = buildingAtPoint(current.city, localPoint)?.id ?? null;
        }
        host.style.cursor = current.tool === 'select' && (hoverCitizenId || hoverBuildingId) ? 'pointer' : '';
        setPreview(label);
        drawNameplate();
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
          if (following) { following = false; current.onFollowEnd?.(); }
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
        zoomAround(mouse, view.scale * (event.deltaY < 0 ? 1.1 : 0.91));
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
      let frames = 0, frameWindowStart = performance.now(), frameCost = 0;
      app.ticker.add(() => {
        const frameStart = performance.now();
        const now = Date.now();
        const current = propsRef.current;
        const constructing = current.city.buildings.some((building) => now - building.createdAt < 5200);
        if ((constructing && now - lastConstructionDraw >= 100) || (wasConstructing && !constructing)) {
          redrawBuildings(buildings, current.city, current.world.plan, current.selectedBuildingId);
          lastConstructionDraw = now;
        }
        wasConstructing = constructing;

        // Residents: read the authoritative snapshot after this frame's simulation advance.
        const live = current.getWorld?.() ?? current.world;
        const inverse = 1 / view.scale;
        const margin = 60 * inverse;
        const bounds: LocalBounds | null = live.citizens.length > 60 ? (() => {
          const corners = [world.toLocal({ x: 0, y: 0 }), world.toLocal({ x: app.screen.width, y: app.screen.height })];
          const a = toGrid({ x: corners[0]!.x - margin, y: corners[0]!.y - margin });
          const b = toGrid({ x: corners[1]!.x + margin, y: corners[1]!.y + margin });
          const c = toGrid({ x: corners[0]!.x - margin, y: corners[1]!.y + margin });
          const d = toGrid({ x: corners[1]!.x + margin, y: corners[0]!.y - margin });
          return { left: Math.min(a.x, b.x, c.x, d.x), right: Math.max(a.x, b.x, c.x, d.x),
            top: Math.min(a.y, b.y, c.y, d.y), bottom: Math.max(a.y, b.y, c.y, d.y) };
        })() : null;
        npcs.setSelected(current.selectedCitizenId ?? null);
        npcs.sync(live, frameStart, view.scale, bounds);

        const followId = current.followCitizenId ?? null;
        if (followId) {
          const citizen = live.citizens.find((entry) => entry.id === followId);
          const rendered = npcs.getRenderedPosition(followId);
          const target = citizen ? (citizen.movement?.status === 'inside' || !rendered ? citizen.position : rendered) : null;
          if (target) {
            const goal = iso(target.x, target.y);
            if (!following) { following = true; view.x = 0; view.y = 0; }
            center = { x: center.x + (goal.x - center.x) * 0.18, y: center.y + (goal.y - center.y) * 0.18 };
            updateCamera(true);
          }
        } else following = false;
        if (hoverCitizenId || current.selectedCitizenId) drawNameplate();

        frames += 1;
        frameCost += performance.now() - frameStart;
        if (frameStart - frameWindowStart >= 1000) {
          const stats: RendererStats = { fps: Math.round(frames * 1000 / (frameStart - frameWindowStart)),
            frameMs: Math.round(frameCost / frames * 100) / 100, residents: npcs.count,
            visibleResidents: buildings.children.filter((child) => child.label === 'npc' && child.visible).length };
          (window as unknown as { __tinyCityRenderer?: RendererStats }).__tinyCityRenderer = stats;
          frames = 0; frameCost = 0; frameWindowStart = frameStart;
        }
      });

      cleanup = () => {
        disconnectSimulation();
        npcs.destroy();
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
      safeAreaRef.current = null;
      nameplateRef.current = null;
      host.replaceChildren();
      terrainRef.current = null;
      roadsRef.current = null;
      buildingsRef.current = null;
      proposalOverlayRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terrain = terrainRef.current;
    const roads = roadsRef.current;
    const buildings = buildingsRef.current;
    const proposalOverlay = proposalOverlayRef.current;
    if (!terrain || !roads || !buildings) return;
    redrawCity(terrain, roads, buildings, props.city, props.world.plan, props.selectedBuildingId, false);
    if (proposalOverlay) redrawProposalOverlay(proposalOverlay, props.proposal, props.world.plan);
    nameplateRef.current?.();
  }, [props.city, props.world.plan, props.selectedBuildingId, props.proposal]);

  return <><div ref={hostRef} className={`city-viewport ${props.tool === 'move' ? 'is-moving' : ''} ${props.tool === 'bulldoze' ? 'is-demolishing' : ''}`}
    aria-label="Isometric 64 by 64 city map" />
    {preview && <output className="placement-feedback" aria-label="Placement preview">{preview}</output>}
    {renderError && <div className="render-error" role="alert">The city renderer could not start. Reload to retry; your saved city is still on this device.</div>}
  </>;
}
