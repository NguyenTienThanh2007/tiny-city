import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { CONSTRUCTION_COSTS, getGameTime, OccupancyGrid, RoadGraph, validateRoadPlacement } from '@tiny-city/simulation';
import type { CityCommand, CitySnapshot } from '@tiny-city/simulation';
import { PlanError, PlanReview } from '@tiny-city/ai-architect';
import type { PlanProposal, PlanningConstraints, PlanningHost } from '@tiny-city/ai-architect';
import CityViewport from './game/CityViewport';
import type { CameraRequest } from './game/CityViewport';
import { ArchitectClientError, createPlanningRequest, requestCityPlan } from './aiArchitect/client';
import { rejectionFeedback } from './simulation/feedback';
import { loadCitySave, saveCity } from './simulation/citySave';
import { useCitySimulation } from './simulation/useCitySimulation';
import { projectCity } from './simulation/cityAdapter';
import { BUILDINGS, type BuildingKind, type CityState, type Cell, type Tool } from './types';

type HistoryEntry = { snapshot: CitySnapshot; city: CityState };
type CameraFootprintPoint = { x: number; y: number };
type ArchitectStatus = 'idle' | 'requesting' | 'validating' | 'preview-ready' | 'applying' | 'applied' | 'rejected' | 'cancelled' | 'error' | 'stale';
type ArchitectState = {
  status: ArchitectStatus;
  proposal?: PlanProposal;
  requestId?: string;
  message?: string;
  errorCode?: string;
};
type PromptHistoryEntry = { id: number; prompt: string; status: string; requestId?: string; errorCode?: string; summary?: string };
type PendingArchitectRequest = {
  token: number;
  historyId: number;
  sourceRevision: number;
  controller: AbortController;
  timeoutId: number | null;
  timedOut: boolean;
};

const MAX_PROMPT_HISTORY = 20;
const MAX_PLANNING_ALLOWLIST = 128;
const AI_REQUEST_DEADLINE_MS = 75_000;

const buildingKinds = Object.keys(BUILDINGS) as BuildingKind[];
const toolLabels: Record<BuildingKind, string> = {
  villa: 'Villa', duplex: 'Duplex', townhouse: 'Townhouse', apartment: 'Apt',
  park: 'Park', clubhouse: 'Clubhouse', pool: 'Pool', mall: 'Mall', office: 'Office',
};
const tools: { id: Tool; label: string; shortcut: string; cost?: number }[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'road', label: 'Road', shortcut: 'R', cost: CONSTRUCTION_COSTS.road },
  { id: 'move', label: 'Move', shortcut: 'M' },
  ...buildingKinds.map((kind, index) => ({ id: kind, label: toolLabels[kind], shortcut: String(index + 1), cost: BUILDINGS[kind].cost })),
  { id: 'bulldoze', label: 'Bulldoze', shortcut: 'X' },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, ReactNode> = {
    select: <><path d="m5 3 13 10-6 1.2L9 20 5 3Z" /><path d="m12 14 4 5" /></>,
    road: <><path d="m7 3-3 18M17 3l3 18" /><path d="M12 4v3m0 4v3m0 4v3" /></>,
    move: <><path d="M12 3v18M3 12h18" /><path d="m9 6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3" /></>,
    villa: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-7h6v7" /></>,
    duplex: <><path d="m2 10 10-7 10 7" /><path d="M4 9v11h16V9M8 20v-7h3v7m2-7h3v7" /></>,
    townhouse: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M8 12h2m4 0h2m-8 3h2m4 0h2" /></>,
    apartment: <><path d="M5 21V4h14v17M3 21h18" /><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2m-4 6v-4" /></>,
    park: <><path d="M12 21v-8" /><path d="M8 14a4 4 0 1 1 7.6-1.7A3.2 3.2 0 1 1 16 18H8a2 2 0 0 1 0-4Z" /></>,
    clubhouse: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /><path d="M9 9h.01M15 9h.01" /></>,
    pool: <><path d="M3 15c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 2-2" /><path d="M3 19c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 2-2M7 5v6m5-8v8m5-6v6" /></>,
    mall: <><path d="M3 9h18v12H3zM2 9l2-5h16l2 5" /><path d="M8 21v-7h8v7M7 7h.01M12 7h.01M17 7h.01" /></>,
    office: <><path d="M5 21V4h14v17M3 21h18" /><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2" /></>,
    bulldoze: <><path d="M3 16h18M6 16l2-7h7l3 7" /><path d="M8 9V5h7l3 4" /><circle cx="8" cy="18" r="1" /><circle cx="17" cy="18" r="1" /></>,
    save: <><path d="M5 3h12l4 4v14H3V3h2Z" /><path d="M7 3v6h10V3M7 21v-8h10v8" /></>,
    undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a6 6 0 0 1 0 12h-2" /></>,
    redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9h-9a6 6 0 0 0 0 12h2" /></>,
    sparkle: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    roadStat: <><path d="m7 3-3 18M17 3l3 18" /><path d="M12 4v3m0 4v3m0 4v3" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 6" /></>,
    coin: <><circle cx="12" cy="12" r="9" /><path d="M15 8.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2.2 0 3.4 6 1.2 6 4.6 0 1.3-1.3 2.2-3 2.2a3.8 3.8 0 0 1-3.3-1.6M12 5v14" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>{paths[name] ?? paths.sparkle}</svg>;
}

function MiniMap({ city, cameraFootprint, onNavigate }: { city: CityState; cameraFootprint: CameraFootprintPoint[] | null; onNavigate: (cell: Cell) => void }) {
  const buildingMarks = city.buildings.map((building) => {
    const spec = BUILDINGS[building.kind];
    const role = spec.role;
    const color = role === 'home' ? '#e6ad73' : role === 'park' ? '#d8edaa' : '#9bbfc1';
    const x = ((building.x + spec.width / 2) / city.size) * 100;
    const y = ((building.y + spec.height / 2) / city.size) * 100;
    return <circle key={building.id} data-testid={`minimap-building-${building.id}`} cx={x} cy={y} r="1.45" fill={color} />;
  });
  return <div className="minimap" role="button" tabIndex={0} aria-label="Navigate neighborhood overview"
    title="Click to center the camera on a map location"
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNavigate({ x: city.size / 2, y: city.size / 2 }); } }}
    onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      onNavigate({ x: Math.max(0, Math.min(city.size, (event.clientX - bounds.left) / bounds.width * city.size)),
        y: Math.max(0, Math.min(city.size, (event.clientY - bounds.top) / bounds.height * city.size)) });
    }}><div className="minimap-grid" />
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Neighborhood overview">
      <g fill="#d9e2c8">{city.roads.map(({ x, y }, index) => <circle key={`${x}-${y}-${index}`} data-testid={index === 0 ? 'minimap-road-first' : undefined} cx={((x + 0.5) / city.size) * 100} cy={((y + 0.5) / city.size) * 100} r="0.72" />)}</g>
      <g>{buildingMarks}</g>
      {cameraFootprint && <polygon
        data-testid="minimap-camera"
        points={cameraFootprint.map(({ x, y }) => `${(x / city.size) * 100},${(y / city.size) * 100}`).join(' ')}
        fill="#f6e5af"
        fillOpacity="0.13"
        stroke="#f6e5af"
        strokeWidth="1.15"
        vectorEffect="non-scaling-stroke"
      />}
    </svg>
    <span>VILLA GARDENS</span>
  </div>;
}

function App() {
  const [loaded] = useState(() => loadCitySave());
  const [city, setCity] = useState<CityState>(loaded.city);
  const { world, lastEvent, advance, executeBatch, restoreCity, getCitySnapshot, togglePause, step, getSnapshot } = useCitySimulation(loaded.city, loaded.world);
  const cityRef = useRef(city);
  cityRef.current = city;
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [redoHistory, setRedoHistory] = useState<HistoryEntry[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [movingBuildingId, setMovingBuildingId] = useState<string | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [architectState, setArchitectState] = useState<ArchitectState>({ status: 'idle' });
  const [architectPanelOpen, setArchitectPanelOpen] = useState(false);
  const [promptHistory, setPromptHistory] = useState<PromptHistoryEntry[]>([]);
  const [allowPartial, setAllowPartial] = useState(false);
  const [protectExisting, setProtectExisting] = useState(true);
  const [allowDestructive, setAllowDestructive] = useState(false);
  const [destructiveConfirmation, setDestructiveConfirmation] = useState(false);
  const [notice, setNotice] = useState(loaded.notice ?? '');
  const [saved, setSaved] = useState(false);
  const [constructionClock, setConstructionClock] = useState(Date.now());
  const [cameraFootprint, setCameraFootprint] = useState<CameraFootprintPoint[] | null>(null);
  const [cameraRequest, setCameraRequest] = useState<CameraRequest>();
  const gestureRef = useRef<{ active: boolean; recorded: boolean }>({ active: false, recorded: false });
  const architectHostRef = useRef<PlanningHost | null>(null);
  const latestSnapshotReaderRef = useRef(getSnapshot);
  const latestCommitRef = useRef<(commands: readonly CityCommand[]) => ReturnType<typeof executeBatch>>(() => {
    throw new Error('The city commit boundary is not ready.');
  });
  const activeReviewRef = useRef<PlanReview | null>(null);
  const pendingArchitectRequestRef = useRef<PendingArchitectRequest | null>(null);
  const requestTokenRef = useRef(0);
  const nextHistoryIdRef = useRef(1);
  const beginGesture = useCallback(() => { gestureRef.current = { active: true, recorded: false }; }, []);
  const endGesture = useCallback(() => { gestureRef.current.active = false; }, []);
  const navigateCamera = useCallback((cell?: Cell) => {
    setCameraRequest((current) => ({ id: (current?.id ?? 0) + 1, ...(cell ? { cell } : {}) }));
  }, []);
  const noticeTimerRef = useRef<number | null>(null);

  const advanceSimulation = useCallback((elapsedMs: number) => {
    const tick = getSnapshot().clock.tick;
    advance(elapsedMs);
    if (getSnapshot().clock.tick !== tick) setSaved(false);
  }, [advance, getSnapshot]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice('');
      noticeTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  const commitCommands = useCallback((commands: readonly CityCommand[]) => {
    const previous = { snapshot: getCitySnapshot(), city: cityRef.current };
    const result = executeBatch(commands);
    if (!result.applied) {
      const rejection = result.events.find((event) => event.type === 'city.command-rejected');
      if (rejection?.type === 'city.command-rejected') {
        if (rejection.reason !== 'road-already-exists' && rejection.reason !== 'road-not-found') {
          showNotice(rejectionFeedback[rejection.reason]);
        }
      }
      return result;
    }
    const next = projectCity(result.state, cityRef.current, Date.now());
    if (!gestureRef.current.active || !gestureRef.current.recorded) {
      setHistory((current) => [...current.slice(-39), previous]);
      gestureRef.current.recorded = true;
    }
    setRedoHistory([]);
    cityRef.current = next;
    setCity(next);
    setSaved(false);
    return result;
  }, [executeBatch, getCitySnapshot, showNotice]);

  latestSnapshotReaderRef.current = getSnapshot;
  latestCommitRef.current = commitCommands;
  if (architectHostRef.current === null) {
    architectHostRef.current = {
      getState: () => latestSnapshotReaderRef.current(),
      executeBatch: (commands: readonly CityCommand[]) => latestCommitRef.current(commands),
    };
  }

  const updatePromptHistory = (id: number, update: Partial<PromptHistoryEntry>) => {
    setPromptHistory((entries) => entries.map((entry) => entry.id === id ? { ...entry, ...update } : entry));
  };

  const cancelPlanning = () => {
    const pending = pendingArchitectRequestRef.current;
    if (!pending) return;
    if (pending.timeoutId !== null) window.clearTimeout(pending.timeoutId);
    pendingArchitectRequestRef.current = null;
    requestTokenRef.current += 1;
    pending.controller.abort();
    try { activeReviewRef.current?.reject(); } catch { /* A completed review cannot be cancelled. */ }
    activeReviewRef.current = null;
    setDestructiveConfirmation(false);
    setArchitectState({ status: 'cancelled', message: 'Planning was cancelled. Your city is unchanged.' });
    updatePromptHistory(pending.historyId, { status: 'Cancelled' });
  };

  useEffect(() => {
    const pending = pendingArchitectRequestRef.current;
    if (pending && pending.sourceRevision !== world.revision) {
      if (pending.timeoutId !== null) window.clearTimeout(pending.timeoutId);
      pendingArchitectRequestRef.current = null;
      requestTokenRef.current += 1;
      pending.controller.abort();
      try { activeReviewRef.current?.reject(); } catch { /* The review already reached a terminal state. */ }
      activeReviewRef.current = null;
      setDestructiveConfirmation(false);
      setArchitectState({ status: 'stale', errorCode: 'STALE_WORLD',
        message: 'The city changed while this plan was being prepared. Generate a fresh plan.' });
      updatePromptHistory(pending.historyId, { status: 'Stale', errorCode: 'STALE_WORLD' });
      return;
    }

    const preview = architectState.proposal;
    if (architectState.status === 'preview-ready' && preview && preview.sourceRevision !== world.revision) {
      try { activeReviewRef.current?.reject(); } catch { /* Keep stale plans non-applicable. */ }
      activeReviewRef.current = null;
      setDestructiveConfirmation(false);
      setArchitectState({ status: 'stale', proposal: preview, requestId: architectState.requestId,
        errorCode: 'STALE_WORLD', message: 'The city changed after preview. Generate a fresh plan before applying.' });
      const pendingHistory = promptHistory.find((entry) => entry.requestId === architectState.requestId);
      if (pendingHistory) updatePromptHistory(pendingHistory.id, { status: 'Stale', errorCode: 'STALE_WORLD' });
    }
  }, [world.revision, architectState.status, architectState.proposal, architectState.requestId, promptHistory]);

  useEffect(() => () => {
    requestTokenRef.current += 1;
    const pending = pendingArchitectRequestRef.current;
    pendingArchitectRequestRef.current = null;
    if (pending?.timeoutId !== null && pending?.timeoutId !== undefined) window.clearTimeout(pending.timeoutId);
    pending?.controller.abort();
    try { activeReviewRef.current?.reject(); } catch { /* Unmount only releases any still-pending review. */ }
    activeReviewRef.current = null;
  }, []);

  const addRoad = useCallback((cell: Cell) => {
    const preview = validateRoadPlacement(getSnapshot(), cell);
    if (!preview.valid && preview.reason === 'road-already-exists') return;
    commitCommands([{ type: 'city.edit-roads', add: [cell], remove: [] }]);
  }, [commitCommands, getSnapshot]);

  const placeBuilding = useCallback((kind: BuildingKind, x: number, y: number) => {
    const result = commitCommands([{ type: 'city.build', buildingType: kind, position: { x, y } }]);
    if (!result.applied) return;
    const event = result.events.find((entry) => entry.type === 'city.building-built');
    if (event?.type === 'city.building-built') setSelectedBuildingId(event.building.id);
  }, [commitCommands]);

  const beginMoveBuilding = useCallback((buildingId: string) => {
    setSelectedBuildingId(buildingId);
    setMovingBuildingId(buildingId);
    setTool('move');
    showNotice('Choose an open destination tile for the selected building.');
  }, [showNotice]);

  const moveBuilding = useCallback((buildingId: string, x: number, y: number) => {
    const result = commitCommands([{ type: 'city.move-building', buildingId, position: { x, y } }]);
    if (!result.applied) return;
    setMovingBuildingId(null);
    setSelectedBuildingId(buildingId);
    setTool('select');
    showNotice('Building moved.');
  }, [commitCommands, showNotice]);

  const bulldoze = useCallback((cell: Cell) => {
    const occupant = new OccupancyGrid(getSnapshot().plan).get(cell);
    if (occupant?.type === 'building') {
      const result = commitCommands([{ type: 'city.demolish', buildingId: occupant.buildingId }]);
      if (result.applied) {
        if (selectedBuildingId === occupant.buildingId) setSelectedBuildingId(null);
        if (movingBuildingId === occupant.buildingId) { setMovingBuildingId(null); setTool('select'); }
      }
    } else if (occupant?.type === 'road') commitCommands([{ type: 'city.edit-roads', add: [], remove: [cell] }]);
  }, [commitCommands, getSnapshot, selectedBuildingId, movingBuildingId]);

  const undo = useCallback(() => {
    endGesture(); setMovingBuildingId(null); setTool('select');
    const previous = history.at(-1);
    if (!previous) return;
    const currentCity = { snapshot: getCitySnapshot(), city: cityRef.current };
    restoreCity(previous.snapshot);
    const next = projectCity(getSnapshot(), previous.city);
    setRedoHistory((current) => [...current, currentCity]);
    setHistory((current) => current.slice(0, -1));
    cityRef.current = next;
    setCity(next);
    setSaved(false);
    setSelectedBuildingId(null);
  }, [history, restoreCity, getSnapshot, getCitySnapshot, endGesture]);

  const redo = useCallback(() => {
    endGesture(); setMovingBuildingId(null); setTool('select');
    const next = redoHistory.at(-1);
    if (!next) return;
    const currentCity = { snapshot: getCitySnapshot(), city: cityRef.current };
    restoreCity(next.snapshot);
    const restored = projectCity(getSnapshot(), next.city);
    setHistory((current) => [...current.slice(-39), currentCity]);
    setRedoHistory((current) => current.slice(0, -1));
    cityRef.current = restored;
    setCity(restored);
    setSaved(false);
    setSelectedBuildingId(null);
  }, [redoHistory, restoreCity, getSnapshot, getCitySnapshot, endGesture]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const shortcuts: Record<string, Tool> = { v: 'select', r: 'road', m: 'move', x: 'bulldoze',
        ...Object.fromEntries(buildingKinds.map((kind, index) => [String(index + 1), kind])) };
      const next = shortcuts[key];
      if (next) { setTool(next); if (next !== 'move') setMovingBuildingId(null); }
      if (event.key === 'Escape') { setTool('select'); setSelectedBuildingId(null); setMovingBuildingId(null); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  const save = () => {
    try {
      saveCity(localStorage, cityRef.current, getSnapshot());
      setSaved(true);
      showNotice('Villa Gardens saved on this device');
    } catch {
      showNotice('Could not save this city in browser storage.');
    }
  };

  const roads = city.roads.length;
  const villas = city.buildings.filter((building) => BUILDINGS[building.kind].role === 'home').length;
  const parks = city.buildings.filter((building) => building.kind === 'park').length;
  const selectedBuilding = city.buildings.find((building) => building.id === selectedBuildingId) ?? null;
  const selectedSpec = selectedBuilding ? BUILDINGS[selectedBuilding.kind] : null;
  const roadGraph = useMemo(() => new RoadGraph(world.plan.roads), [world.plan.roads]);
  const selectedWorldBuilding = world.plan.buildings.find((building) => building.id === selectedBuildingId);
  const roadConnected = selectedWorldBuilding ? roadGraph.getAdjacentComponents(selectedWorldBuilding).length > 0 : false;
  const selectedTool = tools.find((item) => item.id === tool);
  const gameTime = getGameTime(world.clock);
  const gameDay = String(gameTime.day + 1).padStart(2, '0');
  const gameClock = `${String(Math.floor(gameTime.minuteOfDay / 60)).padStart(2, '0')}:${String(gameTime.minuteOfDay % 60).padStart(2, '0')}`;
  const architectBusy = ['requesting', 'validating', 'applying'].includes(architectState.status);
  const planningRequestActive = ['requesting', 'validating'].includes(architectState.status);
  const architectOptionsLocked = architectBusy || architectState.status === 'preview-ready' || destructiveConfirmation;
  const overlayProposal = ['preview-ready', 'applying'].includes(architectState.status) ? architectState.proposal ?? null : null;
  const currentProposal = architectState.proposal;
  const proposalHasDestructiveEdits = currentProposal?.commands.some((item) => item.type === 'city.demolish' ||
    item.type === 'city.edit-roads' && item.remove.length > 0) ?? false;
  const destructiveDescriptions = currentProposal?.commands.flatMap((item) => {
    if (item.type === 'city.demolish') {
      const building = world.plan.buildings.find((entry) => entry.id === item.buildingId);
      return [`Demolish ${building?.name ?? item.buildingId}`];
    }
    if (item.type === 'city.edit-roads') return item.remove.map(({ x, y }) => `Remove road tile ${x}, ${y}`);
    return [];
  }) ?? [];
  const architectStatusLabel: Record<ArchitectStatus, string> = {
    idle: 'Ready for a city idea', requesting: 'Planning…', validating: 'Verifying proposal…',
    'preview-ready': 'Preview ready · waiting for approval', applying: 'Applying approved plan…',
    applied: 'Applied', rejected: 'Rejected · city unchanged', cancelled: 'Cancelled · city unchanged',
    error: architectState.errorCode ?? 'Could not plan', stale: 'Plan is stale',
  };

  useEffect(() => {
    if (!selectedBuilding) return;
    const delay = Math.max(0, selectedBuilding.createdAt + 5200 - Date.now() + 25);
    const timer = window.setTimeout(() => setConstructionClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [selectedBuilding?.id, selectedBuilding?.createdAt]);

  const plannerSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = command.trim();
    if (!prompt || ['requesting', 'validating', 'applying'].includes(architectState.status)) return;
    setArchitectPanelOpen(true);
    setSelectedBuildingId(null);
    setMovingBuildingId(null);
    setTool('select');
    endGesture();

    try { activeReviewRef.current?.reject(); } catch { /* The previous review is no longer applicable. */ }
    activeReviewRef.current = null;
    setDestructiveConfirmation(false);

    // This one snapshot supplies both the payload world and its source revision.
    const snapshot = getSnapshot();
    if (protectExisting && snapshot.plan.buildings.length > MAX_PLANNING_ALLOWLIST) {
      setArchitectState({ status: 'error', errorCode: 'CONTEXT_LIMIT',
        message: `This city has more than ${MAX_PLANNING_ALLOWLIST} buildings. The backend contract cannot safely list all of them as protected.` });
      return;
    }
    if (allowDestructive && snapshot.plan.roads.length > MAX_PLANNING_ALLOWLIST) {
      setArchitectState({ status: 'error', errorCode: 'CONTEXT_LIMIT',
        message: `This city has more than ${MAX_PLANNING_ALLOWLIST} road tiles. Turn off destructive proposals or reduce the road network before planning.` });
      return;
    }
    if (allowDestructive && !protectExisting && snapshot.plan.buildings.length > MAX_PLANNING_ALLOWLIST) {
      setArchitectState({ status: 'error', errorCode: 'CONTEXT_LIMIT',
        message: `This city has more than ${MAX_PLANNING_ALLOWLIST} buildings, so destructive approvals cannot be safely scoped.` });
      return;
    }
    const constraints: PlanningConstraints = {
      allowPartial,
      allowDestructive,
      allowedDemolitions: allowDestructive && !protectExisting
        ? snapshot.plan.buildings.map((building) => building.id)
        : [],
      allowedRoadRemovals: allowDestructive ? snapshot.plan.roads.map(({ x, y }) => ({ x, y })) : [],
      preserveBuildingIds: protectExisting ? snapshot.plan.buildings.map((building) => building.id) : [],
      budgetLimit: null,
      maxOperations: 128,
    };
    const request = createPlanningRequest(prompt, snapshot, constraints);
    const historyId = nextHistoryIdRef.current++;
    const token = ++requestTokenRef.current;
    const controller = new AbortController();
    const pending: PendingArchitectRequest = {
      token, historyId, sourceRevision: snapshot.revision, controller, timeoutId: null, timedOut: false,
    };
    pending.timeoutId = window.setTimeout(() => {
      pending.timedOut = true;
      controller.abort();
    }, AI_REQUEST_DEADLINE_MS);
    pendingArchitectRequestRef.current = pending;
    setPromptHistory((entries) => [{ id: historyId, prompt, status: 'Planning' }, ...entries].slice(0, MAX_PROMPT_HISTORY));
    setArchitectState({ status: 'requesting', message: 'Sending your idea to the city planner…' });

    let responseRequestId: string | undefined;
    try {
      const response = await requestCityPlan(request, controller.signal);
      if (token !== requestTokenRef.current) return;
      responseRequestId = response.requestId;
      if (pending.timeoutId !== null) window.clearTimeout(pending.timeoutId);
      pending.timeoutId = null;
      updatePromptHistory(historyId, { requestId: response.requestId });

      if (getSnapshot().revision !== snapshot.revision) {
        throw new PlanError('STALE_WORLD', 'The city changed while AI was planning. Generate a new plan.');
      }
      if (response.proposal.status === 'REJECTED') {
        setArchitectState({ status: 'rejected', proposal: response.proposal, requestId: response.requestId,
          message: response.proposal.explanation || 'The request could not be fulfilled safely.' });
        updatePromptHistory(historyId, { status: 'Rejected', summary: response.proposal.summary });
        return;
      }

      setArchitectState({ status: 'validating', proposal: response.proposal, requestId: response.requestId,
        message: 'Checking this proposal against the current city…' });
      const review = new PlanReview(architectHostRef.current!, response.proposal);
      activeReviewRef.current = review;
      const preview = await review.preview();
      if (token !== requestTokenRef.current) {
        try { review.reject(); } catch { /* Cancelled or stale reviews remain non-applicable. */ }
        return;
      }
      if (getSnapshot().revision !== snapshot.revision) {
        review.reject();
        throw new PlanError('STALE_WORLD', 'The city changed while the proposal was being checked. Generate a new plan.');
      }
      setArchitectState({ status: 'preview-ready', proposal: preview, requestId: response.requestId,
        message: preview.validation.fulfilled ? 'Review the proposal, then approve it to build.' : 'This proposal only partially fulfills your request.' });
      updatePromptHistory(historyId, { status: preview.validation.fulfilled ? 'Preview ready' : 'Partial preview', summary: preview.summary });
    } catch (error) {
      if (token !== requestTokenRef.current) return;
      try { activeReviewRef.current?.reject(); } catch { /* Terminal review state needs no further action. */ }
      activeReviewRef.current = null;
      const code = pending.timedOut ? 'PROVIDER_TIMEOUT'
        : error instanceof PlanError ? error.code
        : error instanceof ArchitectClientError ? error.code
        : controller.signal.aborted ? 'REQUEST_CANCELLED' : 'PROVIDER_UNAVAILABLE';
      const requestId = error instanceof ArchitectClientError ? error.requestId ?? responseRequestId : responseRequestId;
      const message = pending.timedOut ? 'The planner took too long to respond. You can retry when ready.'
        : error instanceof PlanError || error instanceof ArchitectClientError ? error.message
        : code === 'STALE_WORLD' ? 'The city changed while AI was planning. Generate a new plan.'
        : 'Could not prepare a safe plan. Check that the AI backend is running, then retry.';
      const status: ArchitectStatus = code === 'STALE_WORLD' ? 'stale' : 'error';
      setArchitectState({ status, requestId, errorCode: code, message });
      updatePromptHistory(historyId, { status: status === 'stale' ? 'Stale' : 'Error', errorCode: code, requestId });
    } finally {
      if (pending.timeoutId !== null) window.clearTimeout(pending.timeoutId);
      if (pendingArchitectRequestRef.current === pending) pendingArchitectRequestRef.current = null;
    }
  };

  const cancelArchitectRequest = () => cancelPlanning();

  const rejectProposal = () => {
    const review = activeReviewRef.current;
    if (!review || architectState.status !== 'preview-ready') return;
    review.reject();
    activeReviewRef.current = null;
    setArchitectPanelOpen(false);
    setDestructiveConfirmation(false);
    setArchitectState({ status: 'rejected', proposal: architectState.proposal, requestId: architectState.requestId,
      message: 'Proposal rejected. Your city is unchanged.' });
    const historyEntry = promptHistory.find((entry) => entry.requestId === architectState.requestId);
    if (historyEntry) updatePromptHistory(historyEntry.id, { status: 'Rejected' });
  };

  const applyProposal = async (confirmDestructive: boolean) => {
    const proposal = architectState.proposal;
    const review = activeReviewRef.current;
    if (!proposal || !review || architectState.status !== 'preview-ready') return;
    const destructive = proposal.commands.some((item) => item.type === 'city.demolish' ||
      item.type === 'city.edit-roads' && item.remove.length > 0);
    if (destructive && (!confirmDestructive || !proposal.constraints.allowDestructive)) return;

    setArchitectState({ status: 'applying', proposal, requestId: architectState.requestId,
      message: 'Applying the approved batch through the city simulation…' });
    setDestructiveConfirmation(false);
    try {
      review.approve(proposal.planId, destructive ? { allowDestructive: true } : {});
      const result = await review.apply();
      if (!result.applied) throw new PlanError('PLAN_REJECTED', 'The simulation did not apply this proposal.');
      activeReviewRef.current = null;
      setArchitectPanelOpen(false);
      setArchitectState({ status: 'applied', proposal, requestId: architectState.requestId,
        message: 'Proposal applied to your city.' });
      const historyEntry = promptHistory.find((entry) => entry.requestId === architectState.requestId);
      if (historyEntry) updatePromptHistory(historyEntry.id, { status: 'Applied', summary: proposal.summary });
      showNotice('AI city plan applied. Undo is available.');
    } catch (error) {
      try { review.reject(); } catch { /* An applied review stays terminal. */ }
      activeReviewRef.current = null;
      const code = error instanceof PlanError ? error.code : 'PLAN_REJECTED';
      const message = error instanceof PlanError ? error.message : 'The simulation could not apply the complete plan.';
      const status: ArchitectStatus = code === 'STALE_WORLD' ? 'stale' : 'error';
      setArchitectState({ status, proposal, requestId: architectState.requestId, errorCode: code, message });
      const historyEntry = promptHistory.find((entry) => entry.requestId === architectState.requestId);
      if (historyEntry) updatePromptHistory(historyEntry.id, { status: status === 'stale' ? 'Stale' : 'Apply failed', errorCode: code });
    }
  };

  const approveProposal = () => {
    const proposal = architectState.proposal;
    if (!proposal || architectState.status !== 'preview-ready') return;
    const destructive = proposal.commands.some((item) => item.type === 'city.demolish' ||
      item.type === 'city.edit-roads' && item.remove.length > 0);
    if (destructive) setDestructiveConfirmation(true);
    else void applyProposal(false);
  };

  const keyboardHelp = `${selectedTool?.label ?? 'Select'} tool active`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /><span /><span /></div>
          <div><div className="brand-name">TINY CITY</div><div className="brand-tagline">IMAGINE · BUILD · LIVE</div></div>
        </div>
        <div className="project-name"><span className="status-dot" /><span>Villa Gardens</span><span className="project-state">LOCAL CITY</span></div>
        <div className="mode-switch" role="group" aria-label="Game mode">
          <button className="mode-tab active" aria-pressed="true"><span className="mode-tab-index">01</span> Architect</button>
          <button className="mode-tab" aria-pressed="false" onClick={() => showNotice('Life Mode is planned for the next milestone.')}>02&nbsp; Life</button>
          <button className="mode-tab" aria-pressed="false" onClick={() => showNotice('God Mode is planned for the next milestone.')}>03&nbsp; God</button>
        </div>
        <div className="top-actions">
          <button className="icon-button" aria-label="Undo" title="Undo (⌘Z)" onClick={undo} disabled={!history.length}><Icon name="undo" /></button>
          <button className="icon-button" aria-label="Redo" title="Redo (⌘⇧Z)" onClick={redo} disabled={!redoHistory.length}><Icon name="redo" /></button>
          <span className="action-divider" />
          <button className={`save-button ${saved ? 'is-saved' : ''}`} onClick={save}><Icon name="save" size={16} />{saved ? 'Saved' : 'Save'}</button>
          <button className="avatar-button" aria-label="Profile" title="Profile" onClick={() => showNotice('Your city is saved locally on this device.')}>H</button>
        </div>
      </header>

      <section className="workspace">
        <nav className="tool-rail" aria-label="Build tools">
          <div className="rail-label">TOOLS</div>
          {tools.map((item) => (
              <button key={item.id} className={`tool-button ${tool === item.id ? 'active' : ''}`} aria-pressed={tool === item.id} onClick={() => {
                setArchitectPanelOpen(false);
                if (item.id !== 'move') setMovingBuildingId(null);
                setTool(item.id);
              }} title={`${item.label} · ${item.shortcut}`}>
              <span className={`tool-icon tool-${item.id}`}><Icon name={item.id} size={19} /></span>
              <span className="tool-label">{item.label}</span>
              {item.cost !== undefined && <span className="tool-cost">${item.cost}</span>}
            </button>
          ))}
          <div className="rail-foot"><span className="rail-line" /><span>64 × 64</span><span>GRID</span></div>
        </nav>

        <section className="map-stage">
          <CityViewport
            city={city}
            world={world}
            proposal={overlayProposal}
            onSimulationFrame={advanceSimulation}
            tool={tool}
            selectedBuildingId={selectedBuildingId}
            movingBuildingId={movingBuildingId}
            onSelectBuilding={setSelectedBuildingId}
            onPlaceBuilding={placeBuilding}
            onBeginMoveBuilding={beginMoveBuilding}
            onMoveBuilding={moveBuilding}
            onAddRoad={addRoad}
            onBulldoze={bulldoze}
            onCameraFootprintChange={setCameraFootprint}
            cameraRequest={cameraRequest}
            onBeginGesture={beginGesture}
            onEndGesture={endGesture}
          />
          <div className="stage-heading">
            <div className="eyebrow">YOUR NEIGHBORHOOD <span>·</span> COASTAL DISTRICT</div>
            <h1>Villa Gardens <span className="weather-pill">☀&nbsp; 27°</span></h1>
            <p>A quiet coastal neighborhood, ready for your next idea.</p>
          </div>
          <div className="city-stats">
            <div className="city-stat"><span className="stat-icon homes"><Icon name="home" size={15} /></span><span><strong>{villas}</strong><small>HOMES</small></span></div>
            <div className="city-stat"><span className="stat-icon roads"><Icon name="roadStat" size={15} /></span><span><strong>{roads}</strong><small>ROAD TILES</small></span></div>
            <div className="city-stat"><span className="stat-icon park"><Icon name="park" size={15} /></span><span><strong>{parks}</strong><small>PARKS</small></span></div>
            <div className="city-stat cash"><span className="stat-icon cash"><Icon name="coin" size={15} /></span><span><strong>${city.funds.toLocaleString()}</strong><small>FUNDS</small></span></div>
          </div>
          <div className="map-controls"><span className="control-dot" /> {keyboardHelp}<span className="control-separator">·</span> Scroll to zoom <span className="control-separator">·</span> Shift + drag to pan</div>
          <div className="map-coordinate">WORLD GRID <b>64 × 64</b></div>
          <button className="camera-home" aria-label="Center neighborhood" title="Return to the built neighborhood" onClick={() => navigateCamera()}>Center city</button>
          <MiniMap city={city} cameraFootprint={cameraFootprint} onNavigate={navigateCamera} />
          <form className={`planner-bar ${architectBusy ? 'is-busy' : ''}`} onSubmit={plannerSubmit} aria-busy={architectBusy}>
            <button type="button" className="architect-panel-toggle" aria-controls="architect-panel"
              aria-expanded={architectPanelOpen} aria-label={architectPanelOpen ? 'Hide AI Architect panel' : 'Show AI Architect panel'}
              onClick={() => setArchitectPanelOpen((open) => !open)}>AI options</button>
            <div className="planner-sparkle"><Icon name="sparkle" size={19} /></div>
            <div className="planner-copy"><strong>AI Architect</strong><span id="architect-prompt-help">Plan first · approve before building</span></div>
            <textarea value={command} onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }} aria-label="Describe a city change" aria-describedby="architect-prompt-help"
              placeholder="Ask in English or Vietnamese, e.g. Xây 3 biệt thự gần công viên…"
              rows={1} disabled={architectBusy} />
            {planningRequestActive
              ? <button key="cancel-request" className="planner-submit cancel-planning" type="button" onClick={(event) => {
                event.preventDefault();
                cancelArchitectRequest();
              }}
                aria-label="Cancel planning request" title="Cancel request">×</button>
              : <button key="generate-request" className="planner-submit" type="submit" aria-label={architectState.status === 'applying' ? 'Applying approved plan' : 'Generate AI plan'}
                title={architectState.status === 'applying' ? 'Applying approved plan' : 'Generate plan'}
                disabled={!command.trim() || architectState.status === 'applying'}><Icon name="arrow" size={18} /></button>}
          </form>
          {notice && <div className="toast" role="status" aria-label="City notice" aria-live="polite"><span className="toast-check">✓</span>{notice}</div>}
        </section>

        <aside className={`inspector ${selectedBuilding && !movingBuildingId ? 'has-selection' : ''}`}>
          <section id="architect-panel" className={`architect-panel ${architectPanelOpen ? 'is-open' : ''}`} aria-labelledby="architect-heading">
            <div className="architect-heading-row"><span className="architect-sparkle"><Icon name="sparkle" size={15} /></span>
              <div><h2 id="architect-heading">AI Architect</h2><p>YOUR IDEA, SAFELY PLANNED</p></div>
            </div>
            <p className="architect-intro">Preview changes on the map. The city only changes after you approve a valid plan.</p>
            <fieldset className="architect-options" disabled={architectOptionsLocked}>
              <legend>Planning options</legend>
              <label><input type="checkbox" checked={allowPartial} onChange={(event) => setAllowPartial(event.target.checked)} />
                Allow partial fulfillment</label>
              <label><input type="checkbox" checked={protectExisting} onChange={(event) => setProtectExisting(event.target.checked)} />
                Protect existing buildings</label>
              <label><input type="checkbox" checked={allowDestructive} onChange={(event) => setAllowDestructive(event.target.checked)} />
                Allow demolition / road removal proposals</label>
              {allowDestructive && <small>Each destructive proposal still needs a separate confirmation before it can be applied.</small>}
              {architectState.status === 'preview-ready' && <small>Options are locked for this preview. Reject it to change settings and request another plan.</small>}
              <small>Safety allowlists support up to {MAX_PLANNING_ALLOWLIST} existing buildings or road tiles per request.</small>
            </fieldset>

            <div className={`architect-state state-${architectState.status}`} role="status" aria-live="polite">
              <span className="architect-state-dot" />
              <span>{architectState.message ?? architectStatusLabel[architectState.status]}</span>
              {architectState.requestId && <small>Request {architectState.requestId}</small>}
            </div>

            {currentProposal && <div className="proposal-card">
              <div className="proposal-card-heading"><strong>{currentProposal.summary}</strong>
                <span>{currentProposal.validation.fulfilled ? 'FULL' : 'PARTIAL'}</span></div>
              <p>{currentProposal.explanation}</p>
              <div className="proposal-metrics">
                <div><small>EST. COST</small><strong>${currentProposal.estimatedCost.toLocaleString()}</strong></div>
                <div><small>AFTER PLAN</small><strong>${currentProposal.projectedBudget.toLocaleString()}</strong></div>
              </div>
              <div className="proposal-counts">
                <span>{currentProposal.placements.filter((placement) => placement.operation === 'build').length} builds</span>
                <span>{currentProposal.placements.filter((placement) => placement.operation === 'move').length} moves</span>
                <span>+{currentProposal.roads.add.length} / −{currentProposal.roads.remove.length} roads</span>
                <span>{currentProposal.validation.operationCount} operations</span>
              </div>
              {currentProposal.placements.length > 0 && <ul className="proposal-placements" aria-label="Proposed building locations">
                {currentProposal.placements.map((placement) => <li key={`${placement.operation}-${placement.buildingId}`}>
                  <span>{placement.operation === 'move' ? 'Move' : 'Build'} {toolLabels[placement.buildingType]}</span>
                  <small>{placement.position.x}, {placement.position.y} · {placement.footprint.width} × {placement.footprint.height}</small>
                </li>)}
              </ul>}
              {!currentProposal.validation.fulfilled && <p className="proposal-partial">Some requested changes could not be fulfilled. Review the warnings before approval.</p>}
              {currentProposal.warnings.length > 0 && <ul className="proposal-warnings" aria-label="Plan warnings">
                {currentProposal.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}
              </ul>}

              {architectState.status === 'preview-ready' && <div className="proposal-actions">
                <button className="approve-plan" onClick={approveProposal}>
                  {proposalHasDestructiveEdits ? 'Review destructive edits' : currentProposal.validation.fulfilled ? 'Approve & build' : 'Approve partial plan'}
                </button>
                <button className="reject-plan" onClick={rejectProposal}>Reject</button>
              </div>}
              {architectState.status === 'applying' && <div className="proposal-applying" aria-live="polite">Applying one validated simulation batch…</div>}
            </div>}

            {destructiveConfirmation && currentProposal && <div className="destructive-confirmation" role="alertdialog" aria-labelledby="destructive-heading" aria-describedby="destructive-description">
              <strong id="destructive-heading">Confirm destructive changes</strong>
              <p id="destructive-description">These exact items will be removed only if the simulation accepts the full batch:</p>
              <ul>{destructiveDescriptions.map((description, index) => <li key={`${description}-${index}`}>{description}</li>)}</ul>
              <div><button className="approve-plan destructive-approve" onClick={() => void applyProposal(true)}>Confirm & apply</button>
                <button className="reject-plan" onClick={() => setDestructiveConfirmation(false)}>Go back</button></div>
            </div>}

            {promptHistory.length > 0 && <details className="prompt-history">
              <summary>Recent requests <span>{promptHistory.length}</span></summary>
              <ol>{promptHistory.map((entry) => <li key={entry.id}>
                <button type="button" className="history-prompt" onClick={() => setCommand(entry.prompt)} title="Load this prompt to edit and send as a new request">{entry.prompt}</button>
                <span>{entry.status}{entry.errorCode ? ` · ${entry.errorCode}` : ''}</span>
                {entry.summary && <small>{entry.summary}</small>}
                {entry.requestId && <small>Request ID: {entry.requestId}</small>}
              </li>)}</ol>
            </details>}
          </section>
          <div className="inspector-topline"><span>NEIGHBORHOOD</span><button className="more-button" aria-label="Neighborhood information" title="Neighborhood information" onClick={() => showNotice('Villa Gardens is a locally saved coastal district.')}>•••</button></div>
          {selectedBuilding && <button className="inspector-close" aria-label="Close building inspector" onClick={() => { setSelectedBuildingId(null); setMovingBuildingId(null); setTool('select'); }}>×</button>}
          <h2>{selectedBuilding ? selectedBuilding.name : 'Build something lovely.'}</h2>
          <p className="inspector-subtitle">{selectedBuilding ? 'BUILDING INSPECTOR' : 'YOUR CITY, YOUR STORY'}</p>
          <div className={`inspector-scene ${selectedBuilding ? `is-${selectedBuilding.kind}` : ''}`}>
            <div className="scene-sun" /><div className="scene-cloud cloud-one" /><div className="scene-cloud cloud-two" />
            <div className="scene-ground" />
            {selectedBuilding && !['park', 'pool'].includes(selectedBuilding.kind) && <div className={`scene-house is-${selectedBuilding.kind}`}><span className="house-roof" /><span className="house-wall" /><span className="house-window one" /><span className="house-window two" /><span className="house-door" /></div>}
            <div className="scene-tree tree-one"><i /><b /></div><div className="scene-tree tree-two"><i /><b /></div>
            {selectedBuilding?.kind === 'park' && <div className="scene-path" />}
            {selectedBuilding?.kind === 'pool' && <div className="scene-pool" />}
            <div className="scene-caption"><span>{selectedBuilding?.name ?? 'VILLA GARDENS'}</span><b>{selectedBuilding ? `${selectedBuilding.x} · ${selectedBuilding.y}` : `${villas} HOMES`}</b></div>
          </div>
          {selectedBuilding && selectedSpec ? (
            <div className="building-details">
              <div className="detail-line"><span>Type</span><strong>{selectedSpec.label}</strong></div>
              <div className="detail-line"><span>Footprint</span><strong>{selectedSpec.width} × {selectedSpec.height} tiles</strong></div>
              <div className="detail-line"><span>Capacity</span><strong>{selectedSpec.capacity} places</strong></div>
              <div className="detail-line"><span>Map location</span><strong>{selectedBuilding.x}, {selectedBuilding.y}</strong></div>
              <div className="detail-line"><span>Build cost</span><strong>${selectedSpec.cost.toLocaleString()}</strong></div>
              <div className="detail-line"><span>Road access</span><strong>{selectedSpec.requiresRoad ? 'Required' : 'Optional'}</strong></div>
              <div className="detail-line"><span>Road connection</span><strong>{roadConnected ? 'Connected' : selectedSpec.requiresRoad ? 'Disconnected' : 'Optional'}</strong></div>
              <div className="detail-line"><span>Condition</span><strong className="condition"><i /> {constructionClock < selectedBuilding.createdAt + 5200 ? 'Under construction' : 'Ready'}</strong></div>
              <div className="inspector-buttons">
                <button className="outline-action details-action" aria-label="Building details" onClick={() => {
                  const building = world.plan.buildings.find((entry) => entry.id === selectedBuilding.id);
                  if (building) showNotice(`${building.name} · ${building.kind} · capacity ${building.capacity}`);
                }}>Details</button>
                <button className="outline-action" onClick={() => beginMoveBuilding(selectedBuilding.id)}><Icon name="move" size={15} /> Move</button>
                <button className="small-destruct" aria-label="Bulldoze selected building" title="Demolish building" onClick={() => bulldoze({ x: selectedBuilding.x, y: selectedBuilding.y })}><Icon name="bulldoze" size={16} /></button>
              </div>
            </div>
          ) : (
            <>
              <div className="goal-card"><div className="goal-icon"><Icon name="sparkle" size={17} /></div><div><strong>One street at a time</strong><p>Connect homes to roads, then make room for parks and places to gather.</p></div></div>
              <div className="quick-heading"><span>BUILD CATALOG</span><span>SELECT TO PLACE</span></div>
              <div className="quick-build-list">
                {buildingKinds.map((kind) => {
                  const spec = BUILDINGS[kind];
                  return <button key={kind} onClick={() => { setMovingBuildingId(null); setTool(kind); }}>
                    <span className={`quick-thumb ${kind}-thumb`}><i /></span>
                    <span><strong>{spec.label}</strong><small>{spec.width} × {spec.height} tiles</small></span>
                    <b>${spec.cost.toLocaleString()}</b>
                  </button>;
                })}
              </div>
            </>
          )}
          <div className="simulation-controls" role="group" aria-label="Simulation controls">
            <output aria-label="Simulation clock">DAY {gameDay} · {gameClock}</output>
            <div>
              <button className="outline-action" onClick={() => { togglePause(); setSaved(false); }}>{world.clock.paused ? 'Resume' : 'Pause'}</button>
              <button className="outline-action" disabled={!world.clock.paused} onClick={() => { step(); setSaved(false); }}>Step</button>
            </div>
            <output className="simulation-event" aria-label="Latest simulation event">{lastEvent ? `${lastEvent.type} · tick ${lastEvent.tick}` : 'No simulation events yet'}</output>
          </div>
          <div className="inspector-footer"><span className="online-dot" /> CITY SIMULATION <strong>{world.clock.paused ? 'PAUSED' : 'RUNNING'}</strong><span className="footer-sep" /> DAY {gameDay}</div>
        </aside>
      </section>
    </main>
  );
}

export default App;
