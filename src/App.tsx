import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { applyLifeCommand, CONSTRUCTION_COSTS, getGameTime, housingSummary, isPlayerPlaced, OccupancyGrid, playerActionAvailability, playerHomeOptions, RoadGraph, validateRoadPlacement } from '@tiny-city/simulation';
import type { LifeCommand, PlayerActionAvailability, SimulationEvent, WorldState } from '@tiny-city/simulation';
import type { CityCommand, CitySnapshot } from '@tiny-city/simulation';
import { PlanError, PlanReview } from '@tiny-city/ai-architect';
import type { PlanProposal, PlanningConstraints, PlanningHost } from '@tiny-city/ai-architect';
import CityViewport from './game/CityViewport';
import type { CameraRequest, HomeHighlight, LifeFeedback, LifeTarget, SafeArea } from './game/CityViewport';
import { CharacterCreator, type CharacterDraft } from './ui/CharacterCreator';
import { ActionButton, HomePicker, LifeEntry, LifePanel, LifeStrip, PlaceCard } from './ui/LifePanel';
import { activityNames, emptyPlayerLog, failureText, isLeisure, reducePlayerLog, rejectionText, type PlayerLogState } from './simulation/playerView';
import { DEFAULT_APPEARANCE } from './game/playerLook';
import { Icon } from './ui/Icon';
import { MiniMap } from './ui/MiniMap';
import { SimulationDock } from './ui/SimulationDock';
import { CitizenInspector } from './ui/CitizenInspector';
import { BuildingInspector } from './ui/BuildingInspector';
import { BuildPanel, type OnboardingStep } from './ui/BuildPanel';
import { LivePanel } from './ui/LivePanel';
import { BuildingThumb } from './ui/BuildingThumb';
import { residentsWithoutJobs, summarizeActivities } from './simulation/citizenView';
import { emptyLifeFeed, reduceLifeFeed, type LifeFeedState } from './simulation/lifeFeed';
import { ArchitectClientError, checkPlannerConnection, createPlanningRequest, requestCityPlan } from './aiArchitect/client';
import { ConnectionBadge, isRecoverablePlannerError, PlannerRecovery, type ConnectionView } from './ui/PlannerConnection';
import { rejectionFeedback } from './simulation/feedback';
import { loadCitySave, saveCity } from './simulation/citySave';
import { useCitySimulation } from './simulation/useCitySimulation';
import { projectCity } from './simulation/cityAdapter';
import { BUILDINGS, type BuildingKind, type CityState, type Cell, type Tool } from './types';

type HistoryEntry = { snapshot: CitySnapshot; city: CityState };
type BaseMode = 'build' | 'live' | 'life';
/** Life Mode onboarding: look & name in the creator, then a home chosen on the map. */
type LifeFlow = { step: 'identity'; draft: CharacterDraft; editing: boolean } |
  { step: 'home'; draft: CharacterDraft | null; purpose: 'create' | 'move'; selectedId: string | null };
const GUIDE_KEY = 'tiny-city-guide-hidden';
const promptSuggestions = [
  'Build three villas around a small park',
  'Add an office tower so residents have jobs',
  'Xây 2 biệt thự gần công viên',
  'Create a pool and clubhouse corner for evenings',
];

const PANEL_KEY = 'tiny-city-panel-collapsed';
function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeFlag(key: string, value: boolean) {
  try { if (value) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* Layout preferences are conveniences only. */ }
}

function readGuideHidden(): boolean {
  try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch { return false; }
}
function writeGuideHidden(hidden: boolean) {
  try { if (hidden) localStorage.setItem(GUIDE_KEY, '1'); else localStorage.removeItem(GUIDE_KEY); } catch { /* Guide visibility is a convenience only. */ }
}

/** Screen regions covered by floating HUD panels; the camera centers content in what remains visible. */
function useSafeArea(): { safeArea: SafeArea; compact: boolean } {
  const read = () => {
    const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
    if (width < 760) return { compact: true, safeArea: { left: 64, right: 0, top: 112, bottom: 150 } };
    if (width < 1100) return { compact: false, safeArea: { left: 88, right: 330, top: 72, bottom: 104 } };
    return { compact: false, safeArea: { left: 92, right: 384, top: 72, bottom: 104 } };
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    const onResize = () => setValue((current) => {
      const next = read();
      return current.compact === next.compact && current.safeArea.left === next.safeArea.left &&
        current.safeArea.right === next.safeArea.right && current.safeArea.top === next.safeArea.top &&
        current.safeArea.bottom === next.safeArea.bottom ? current : next;
    });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return value;
}
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

function App() {
  const [loaded] = useState(() => loadCitySave());
  const [city, setCity] = useState<CityState>(loaded.city);
  const { world, lastEvent, advance, executeBatch, restoreCity, getCitySnapshot, togglePause, resume, step, getSnapshot,
    enablePopulation, speed, setSpeed, subscribe, getBuildingOccupancy, executeLife, getNavigator } = useCitySimulation(loaded.city, loaded.world);
  const [baseMode, setBaseMode] = useState<BaseMode>('build');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedCitizenId, setSelectedCitizenId] = useState<string | null>(null);
  const [followCitizenId, setFollowCitizenId] = useState<string | null>(null);
  const [feed, setFeed] = useState<LifeFeedState>(emptyLifeFeed);
  const feedRef = useRef<LifeFeedState>(emptyLifeFeed);
  const [unseenFeed, setUnseenFeed] = useState(0);
  const [guideHidden, setGuideHidden] = useState(readGuideHidden);
  const [metResident, setMetResident] = useState(false);
  const { safeArea, compact } = useSafeArea();
  const [panelCollapsed, setPanelCollapsed] = useState(() => readFlag(PANEL_KEY));
  const [connection, setConnection] = useState<ConnectionView>({ state: 'idle' });
  const connectionCheckedAt = useRef(0);
  const plannerFormRef = useRef<HTMLFormElement>(null);
  const [fundsDelta, setFundsDelta] = useState<{ id: number; amount: number } | null>(null);
  const [lifeFlow, setLifeFlow] = useState<LifeFlow | null>(null);
  const [welcomeWithPlayer, setWelcomeWithPlayer] = useState(true);
  const [followPlayer, setFollowPlayer] = useState(true);
  const [lifePlaceId, setLifePlaceId] = useState<string | null>(null);
  const [lifeFeedback, setLifeFeedback] = useState<LifeFeedback | null>(null);
  const [lifeEdits, setLifeEdits] = useState(0);
  const [playerLog, setPlayerLog] = useState<PlayerLogState>(emptyPlayerLog);
  const playerLogRef = useRef<PlayerLogState>(emptyPlayerLog);
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
  const [noticeTone, setNoticeTone] = useState<'info' | 'warn'>('info');
  const panelRef = useRef<HTMLElement>(null);
  const [saved, setSaved] = useState(false);
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

  const showNotice = useCallback((message: string, tone: 'info' | 'warn' = 'info') => {
    setNotice(message);
    setNoticeTone(tone);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice('');
      noticeTimerRef.current = null;
    }, 4500);
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
      if (event.key === 'Escape') setLifePlaceId(null);
      // Build shortcuts never change tools while you control your character.
      if (baseModeRef.current === 'life' && event.key !== 'Escape' && event.key !== ' ') return;
      const shortcuts: Record<string, Tool> = { v: 'select', r: 'road', m: 'move', x: 'bulldoze',
        ...Object.fromEntries(buildingKinds.map((kind, index) => [String(index + 1), kind])) };
      const next = shortcuts[key];
      if (next) { setTool(next); if (next !== 'move') setMovingBuildingId(null); }
      if (event.key === 'Escape') { setTool('select'); setSelectedBuildingId(null); setMovingBuildingId(null); setSelectedCitizenId(null); setFollowCitizenId(null); }
      if (event.key === ' ' && target?.tagName !== 'BUTTON') { event.preventDefault(); togglePause(); setSaved(false); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo, togglePause]);

  const checkConnection = useCallback(() => {
    connectionCheckedAt.current = Date.now();
    setConnection({ state: 'checking' });
    void checkPlannerConnection().then((result) => setConnection(result));
  }, []);
  // Checked only when the planner is opened (at most every 15 s) or after a failed request; never polled.
  useEffect(() => {
    if (!architectPanelOpen) return;
    if (connection.state === 'checking') return;
    if (connection.state === 'idle' || Date.now() - connectionCheckedAt.current > 15_000) checkConnection();
  }, [architectPanelOpen, checkConnection, connection.state]);
  useEffect(() => {
    if (architectState.status === 'error' && isRecoverablePlannerError(architectState.errorCode)) checkConnection();
  }, [architectState.status, architectState.errorCode, checkConnection]);

  const fundsRef = useRef(city.funds);
  useEffect(() => {
    const amount = city.funds - fundsRef.current;
    fundsRef.current = city.funds;
    if (amount !== 0) setFundsDelta((current) => ({ id: (current?.id ?? 0) + 1, amount }));
  }, [city.funds]);
  useEffect(() => {
    if (!fundsDelta) return;
    const timer = window.setTimeout(() => setFundsDelta(null), 1400);
    return () => window.clearTimeout(timer);
  }, [fundsDelta]);

  const save = () => {
    try {
      saveCity(localStorage, cityRef.current, getSnapshot());
      setSaved(true);
      showNotice('Villa Gardens saved on this device');
    } catch {
      showNotice('Could not save this city in browser storage.');
    }
  };

  const villas = city.buildings.filter((building) => BUILDINGS[building.kind].role === 'home').length;
  const selectedBuilding = city.buildings.find((building) => building.id === selectedBuildingId) ?? null;
  const roadGraph = useMemo(() => new RoadGraph(world.plan.roads), [world.plan.roads]);
  const selectedWorldBuilding = world.plan.buildings.find((building) => building.id === selectedBuildingId);
  const roadConnected = selectedWorldBuilding ? roadGraph.getAdjacentComponents(selectedWorldBuilding).length > 0 : false;
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


  const plannerSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = command.trim();
    if (!prompt || ['requesting', 'validating', 'applying'].includes(architectState.status)) return;
    setArchitectPanelOpen(true);
    setSelectedBuildingId(null);
    setSelectedCitizenId(null);
    setFollowCitizenId(null);
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
      // A planning response proves the server is reachable; refresh a stale "unreachable" badge.
      setConnection((current) => current.state === 'unavailable' ? { state: 'reachable', reason: 'The last planning request reached the server.' } : current);
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

  const populationEnabled = world.population !== undefined;
  const citizens = world.citizens;
  const citizenMap = useMemo(() => new Map(citizens.map((citizen) => [citizen.id, citizen])), [citizens]);
  const selectedCitizen = selectedCitizenId ? citizenMap.get(selectedCitizenId) ?? null : null;
  const activitySummary = useMemo(() => summarizeActivities(citizens), [citizens]);
  const jobless = useMemo(() => residentsWithoutJobs(citizens), [citizens]);
  const homeCapacity = city.buildings.reduce((sum, building) => sum + (BUILDINGS[building.kind].role === 'home' ? BUILDINGS[building.kind].capacity : 0), 0);
  const workplaces = city.buildings.filter((building) => building.kind === 'office' || building.kind === 'mall').length;
  const mode = architectPanelOpen ? 'plan' : baseMode;
  const baseModeRef = useRef(baseMode);
  baseModeRef.current = baseMode;

  // Residents can leave (housing lost); drop a stale selection rather than showing invented data.
  useEffect(() => {
    if (selectedCitizenId && !citizenMap.has(selectedCitizenId)) { setSelectedCitizenId(null); setFollowCitizenId(null); }
  }, [citizenMap, selectedCitizenId]);

  useEffect(() => subscribe((events: readonly SimulationEvent[], state: WorldState) => {
    const next = reduceLifeFeed(feedRef.current, events, state);
    if (next === feedRef.current) return;
    const added = next.nextId - feedRef.current.nextId;
    feedRef.current = next;
    setFeed(next);
    if (added > 0 && baseModeRef.current !== 'live') setUnseenFeed((count) => Math.min(9, count + added));
  }), [subscribe]);

  const selectBuilding = useCallback((id: string | null) => {
    setSelectedBuildingId(id);
    if (id !== null) { setSelectedCitizenId(null); setFollowCitizenId(null); }
  }, []);
  const selectCitizen = useCallback((id: string | null) => {
    setSelectedCitizenId(id);
    if (id !== null) { setSelectedBuildingId(null); setMovingBuildingId(null); setMetResident(true); }
    setFollowCitizenId((current) => current === id ? current : null);
  }, []);
  const focusCitizen = (id: string) => {
    const citizen = getSnapshot().citizens.find((entry) => entry.id === id);
    if (citizen) setCameraRequest((current) => ({ id: (current?.id ?? 0) + 1, cell: citizen.position, scale: 1.15 }));
  };
  const zoomCamera = (zoom: number) => setCameraRequest((current) => ({ id: (current?.id ?? 0) + 1, zoom }));

  const chooseMode = (next: 'build' | 'plan' | 'live' | 'life') => {
    setSelectedBuildingId(null); setSelectedCitizenId(null); setFollowCitizenId(null); setMovingBuildingId(null); setLifePlaceId(null);
    if (next === 'plan') {
      setArchitectPanelOpen((open) => compact ? !open : true);
      setSheetOpen(false);
      return;
    }
    setArchitectPanelOpen(false);
    if (next !== 'life' && lifeFlow?.step === 'home') setLifeFlow(null);
    if (compact) setSheetOpen((open) => baseMode === next && mode === next ? !open : true);
    setBaseMode(next);
    if (next === 'live') { setTool('select'); setUnseenFeed(0); }
    if (next === 'life') { setTool('select'); setFollowPlayer(true); }
  };

  // ---------- Phase 4 Life Mode ----------
  const player = world.player ?? null;
  /** A character who has not moved in yet (no free room when created) waits in home selection. */
  const playerWaiting = !!player && !isPlayerPlaced(player);
  const lifeActive = mode === 'life';
  const runLife = useCallback((command: LifeCommand, success?: string) => {
    const result = executeLife(command);
    if (!result.applied) { if (result.reason) showNotice(rejectionText[result.reason], 'warn'); return result; }
    setSaved(false);
    setLifeEdits((count) => count + 1);
    if (success) showNotice(success);
    else if (getSnapshot().clock.paused && (command.type === 'player.move-to' || command.type === 'player.start-activity')) showNotice('Time is paused. Press Resume (Space) to set off.');
    return result;
  }, [executeLife, showNotice, getSnapshot]);
  const focusPlayer = useCallback(() => {
    const current = getSnapshot().player;
    if (current) setCameraRequest((request) => ({ id: (request?.id ?? 0) + 1, cell: current.position, scale: 1.2 }));
  }, [getSnapshot]);
  useEffect(() => subscribe((events: readonly SimulationEvent[], state: WorldState) => {
    const next = reducePlayerLog(playerLogRef.current, events, state);
    if (next !== playerLogRef.current) { playerLogRef.current = next; setPlayerLog(next); }
    if (events.some((event) => event.type === 'player.home-lost')) { showNotice('Your home was removed. Choose a new home in Life mode.', 'warn'); return; }
    const failed = events.find((event) => event.type === 'player.activity-ended' && event.outcome.result === 'failed');
    if (failed?.type === 'player.activity-ended' && failed.outcome.reason) showNotice(`${activityNames[failed.outcome.kind]} stopped: ${failureText[failed.outcome.reason]}.`, 'warn');
  }), [subscribe, showNotice]);
  const lifeActions: readonly PlayerActionAvailability[] = useMemo(() => player && (lifeActive || selectedCitizenId) && !lifeFlow
    ? playerActionAvailability(world, getNavigator(), selectedCitizenId ?? undefined) : [], [player, lifeActive, lifeFlow, world, getNavigator, selectedCitizenId]);
  // Residents close to the player (on the street within six tiles, or in the same venue), nearest first.
  const nearby = useMemo(() => {
    if (!player || !lifeActive) return [];
    const venue = player.movement.status === 'inside' ? player.movement.currentBuildingId : null;
    const names = new Map(world.plan.buildings.map((b) => [b.id, b.name]));
    return world.citizens.flatMap((citizen) => {
      const m = citizen.movement;
      if (venue && m?.status === 'inside' && m.currentBuildingId === venue) return [{ citizen, distance: 0, where: `here at ${names.get(venue) ?? 'this place'}` }];
      if (!m || m.status === 'inside' || m.currentBuildingId !== null) return [];
      const distance = Math.hypot(citizen.position.x - player.position.x, citizen.position.y - player.position.y);
      return distance <= 6 ? [{ citizen, distance, where: `${Math.max(1, Math.round(distance))} tile${Math.round(distance) === 1 ? '' : 's'} away` }] : [];
    }).sort((a, b) => a.distance - b.distance || (a.citizen.id < b.citizen.id ? -1 : 1)).slice(0, 4);
  }, [player, lifeActive, world.citizens, world.plan.buildings]);
  const dryRun = (command: LifeCommand): PlayerActionAvailability => {
    const result = applyLifeCommand(world, command, getNavigator());
    return { action: 'cancel', available: result.reason === null, reason: result.reason };
  };
  const homeOptions = useMemo(() => lifeFlow?.step === 'home' || playerWaiting ? playerHomeOptions(world, getNavigator()) : [],
    // Vacancies change only with the plan, residents or the player's home.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lifeFlow?.step, playerWaiting, world.plan, world.citizens.length, world.player?.homeBuildingId, getNavigator]);
  const housing = useMemo(() => housingSummary(world),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [world.plan, world.citizens.length, world.player?.homeBuildingId, world.population]);
  // Homes that existed when the player first found every room taken; anything built since is highlighted as new.
  const homeBaselineRef = useRef<Set<string> | null>(null);
  if (playerWaiting && homeBaselineRef.current === null && homeOptions.length > 0 && homeOptions.every((option) => !option.available)) {
    homeBaselineRef.current = new Set(homeOptions.map((option) => option.buildingId));
  }
  if (!playerWaiting && lifeFlow?.step !== 'home') homeBaselineRef.current = null;
  const freshHomes = useMemo(() => new Set(homeBaselineRef.current ? homeOptions.filter((o) => !homeBaselineRef.current!.has(o.buildingId)).map((o) => o.buildingId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [homeOptions, playerWaiting]);
  // A waiting character always resumes home selection in Life mode.
  useEffect(() => {
    if (lifeActive && playerWaiting && !lifeFlow) setLifeFlow({ step: 'home', draft: null, purpose: 'create', selectedId: null });
  }, [lifeActive, playerWaiting, lifeFlow]);
  // Tell a waiting player as soon as a city change frees a room for them.
  const freeRoomsRef = useRef(housing.freeRooms);
  useEffect(() => {
    if (playerWaiting && freeRoomsRef.current === 0 && housing.freeRooms > 0 && player) {
      const free = homeOptions.find((option) => option.available);
      showNotice(`${free ? free.name : 'A home'} has a free room for ${player.name}. Return to Life to move in.`);
    }
    freeRoomsRef.current = housing.freeRooms;
  }, [housing.freeRooms, playerWaiting, player, homeOptions, showNotice]);
  const homeSelectedId = lifeFlow?.step === 'home' ? lifeFlow.selectedId : null;
  const homeHighlights: HomeHighlight[] | null = useMemo(() => lifeFlow?.step === 'home' ? homeOptions.flatMap((option) => {
    const building = world.plan.buildings.find((entry) => entry.id === option.buildingId);
    return building ? [{ id: building.id, x: building.position.x, y: building.position.y, width: building.footprint.width, height: building.footprint.height,
      available: option.available, selected: option.buildingId === homeSelectedId, fresh: freshHomes.has(option.buildingId) }] : [];
  }) : null, [lifeFlow?.step, homeOptions, homeSelectedId, world.plan, freshHomes]);
  const openCreator = () => { setLifeFlow({ step: 'identity', draft: { name: '', appearance: DEFAULT_APPEARANCE }, editing: false }); setSelectedCitizenId(null); };
  const selectHome = (id: string) => {
    if (lifeFlow?.step !== 'home') return;
    setLifeFlow({ ...lifeFlow, selectedId: id });
    const building = getSnapshot().plan.buildings.find((entry) => entry.id === id);
    if (building) setCameraRequest((request) => ({ id: (request?.id ?? 0) + 1, cell: { x: building.position.x + building.footprint.width / 2, y: building.position.y + building.footprint.height / 2 } }));
  };
  const confirmHome = () => {
    if (lifeFlow?.step !== 'home' || !lifeFlow.selectedId) return;
    if (lifeFlow.purpose === 'move') {
      const result = runLife({ type: 'player.move-in', homeBuildingId: lifeFlow.selectedId }, 'You moved into your new home.');
      if (result.applied) { setLifeFlow(null); focusPlayer(); }
      return;
    }
    const waiting = getSnapshot().player;
    if (!waiting) return;
    // The character already exists (unplaced); moving in is their spawn.
    const result = runLife({ type: 'player.move-in', homeBuildingId: lifeFlow.selectedId });
    if (!result.applied) return;
    if (welcomeWithPlayer && !getSnapshot().population) enablePopulation({ maxCitizens: 1000 });
    resume();
    setLifeFlow(null); setFollowPlayer(true); setBaseMode('life'); setSheetOpen(false); focusPlayer();
    showNotice(`Welcome home, ${waiting.name}! Click a road to walk, or choose an action.`);
  };
  const onLifeTarget = (target: LifeTarget) => {
    if (lifeFlow?.step === 'home') {
      if (target.type !== 'building') return;
      const option = homeOptions.find((entry) => entry.buildingId === target.id);
      if (option?.available) selectHome(target.id);
      else showNotice(option ? rejectionText[option.current ? 'already-home' : 'home-full'] : 'Choose one of the highlighted homes.', 'warn');
      return;
    }
    if (!player) { if (target.type === 'citizen' && populationEnabled) selectCitizen(target.id); return; }
    if (target.type === 'player') { setSelectedCitizenId(null); setLifePlaceId(null); if (compact) setSheetOpen(true); return; }
    if (target.type === 'citizen') { selectCitizen(target.id); return; }
    if (target.type === 'building') { setSelectedCitizenId(null); setLifePlaceId(target.id); if (compact) setSheetOpen(true); return; }
    const result = runLife({ type: 'player.move-to', destination: { type: 'tile', position: target.cell } });
    setLifeFeedback((current) => ({ id: (current?.id ?? 0) + 1, cell: target.cell, ok: result.applied }));
    if (result.applied) { setLifePlaceId(null); setSelectedCitizenId(null); }
  };
  // A different panel view always starts at its top (the phone sheet reuses one scroll container).
  const panelVisible = !compact || sheetOpen || !!selectedCitizenId || !!selectedBuildingId || architectPanelOpen || lifeFlow?.step === 'home' || !!lifePlaceId;
  useEffect(() => { panelRef.current?.scrollTo?.({ top: 0 }); }, [mode, selectedCitizenId, selectedBuildingId, lifePlaceId, lifeFlow?.step, panelVisible]);
  const lifePlace = lifeActive && player && lifePlaceId ? world.plan.buildings.find((entry) => entry.id === lifePlaceId) ?? null : null;
  const placeCard = (() => {
    if (!lifePlace || !player) return null;
    const runLifeAction = (command: LifeCommand) => { if (runLife(command).applied) setLifePlaceId(null); };
    const kind = city.buildings.find((entry) => entry.id === lifePlace.id)?.kind ?? 'villa';
    const occupancy = getBuildingOccupancy(lifePlace.id);
    const own = lifePlace.id === player.homeBuildingId;
    const vacancy = lifePlace.kind === 'home' ? lifePlace.capacity - world.citizens.filter((c) => c.homeBuildingId === lifePlace.id).length - (own ? 1 : 0) : 0;
    const detail = own ? `Your home · ${occupancy.residentIds.length + 1} of ${lifePlace.capacity} rooms taken`
      : lifePlace.kind === 'home' ? `${BUILDINGS[kind].label} · ${vacancy > 0 ? `${vacancy} free room${vacancy === 1 ? '' : 's'}` : 'no free rooms'}`
      : isLeisure(lifePlace) ? `${BUILDINGS[kind].label} · ${occupancy.visitorIds.length} of ${lifePlace.capacity} visitors now`
      : `${BUILDINGS[kind].label} · ${occupancy.workerIds.length} working here · not open to visit`;
    const walk = <ActionButton key="walk" label="Walk here" icon="walk" hint={own ? 'Go inside' : 'Stop at the entrance'}
      availability={dryRun({ type: 'player.move-to', destination: { type: 'building', buildingId: lifePlace.id } })}
      onClick={() => runLifeAction({ type: 'player.move-to', destination: { type: 'building', buildingId: lifePlace.id } })} />;
    const actions = own ? [walk,
      <ActionButton key="rest" label="Rest" icon="bed" hint="120 min · restores energy" availability={dryRun({ type: 'player.start-activity', activity: 'rest' })} onClick={() => runLifeAction({ type: 'player.start-activity', activity: 'rest' })} />,
      <ActionButton key="eat" label="Eat" icon="leaf" hint="30 min · fills hunger" availability={dryRun({ type: 'player.start-activity', activity: 'eat' })} onClick={() => runLifeAction({ type: 'player.start-activity', activity: 'eat' })} />]
      : isLeisure(lifePlace) ? [<ActionButton key="visit" label="Visit" icon="park" hint="60 min · lifts mood" availability={dryRun({ type: 'player.start-activity', activity: 'visit', buildingId: lifePlace.id })}
        onClick={() => runLifeAction({ type: 'player.start-activity', activity: 'visit', buildingId: lifePlace.id })} />, walk]
      : lifePlace.kind === 'home' && vacancy > 0 ? [walk, <ActionButton key="move-in" label="Move in here" icon="home" hint="Take a free room" availability={{ action: 'cancel', available: true, reason: null }}
        onClick={() => { setLifeFlow({ step: 'home', draft: null, purpose: 'move', selectedId: lifePlace.id }); setLifePlaceId(null); }} />]
      : [walk];
    return <PlaceCard name={lifePlace.name} kind={kind} detail={detail} actions={actions} />;
  })();
  // Interacting from any mode hands control to Life mode, keeping the resident's profile open.
  const interact = (activity: 'greet' | 'socialize', citizenId: string) => {
    if (runLife({ type: 'player.start-activity', activity, citizenId }).applied && mode !== 'life') {
      setArchitectPanelOpen(false); setBaseMode('life'); setTool('select'); setFollowPlayer(true);
    }
  };
  const citizenLifeActions = player && selectedCitizen ? (() => {
    const met = player.acquaintances.includes(selectedCitizen.id);
    const talking = player.activity.citizenId === selectedCitizen.id && (player.activity.kind === 'greet' || player.activity.kind === 'socialize');
    const byAction = new Map(lifeActions.map((entry) => [entry.action, entry]));
    return <div className="life-interact" role="region" aria-label="Interact">
      <div className="section-heading"><span>INTERACT</span><small>{met ? 'You have met' : 'Not met yet'}</small></div>
      {talking && <p className="life-talking">{player.activity.phase === 'performing' ? `${activityNames[player.activity.kind]} · ${Math.floor(player.activity.elapsedMinutes)} of ${player.activity.durationMinutes} min` : 'Walking over…'}</p>}
      <div className="life-actions">
        <ActionButton label="Greet" icon="people" hint="5 min · a quick hello" availability={byAction.get('greet')} onClick={() => interact('greet', selectedCitizen.id)} />
        <ActionButton label="Chat" icon="sparkle" hint="30 min · lifts social" availability={byAction.get('socialize')} onClick={() => interact('socialize', selectedCitizen.id)} />
      </div>
    </div>;
  })() : null;

  const welcomeResidents = () => {
    if (getSnapshot().population) return;
    enablePopulation({ maxCitizens: 1000 });
    setSaved(false);
    const count = getSnapshot().citizens.length;
    if (count > 0) resume();
    setBaseMode('live'); setArchitectPanelOpen(false); setTool('select'); setUnseenFeed(0);
    if (compact) setSheetOpen(true);
    showNotice(count > 0 ? `${count} residents moved in. Time is running; click someone walking to meet them.`
      : 'Residents will move in as soon as you build homes beside a road.');
  };

  const guideSteps: OnboardingStep[] = [
    { id: 'road', label: 'Pave a road', hint: 'Choose Road (R) and drag across open grass.', done: city.roads.length > 0 },
    { id: 'home', label: 'Build a home beside the road', hint: 'Homes must touch a road along one edge.', done: villas > 0 },
    { id: 'work', label: 'Add a workplace', hint: 'An office tower or mall gives residents a commute.', done: workplaces > 0 },
    { id: 'residents', label: 'Welcome residents', hint: 'They move into homes and follow daily routines.', done: populationEnabled },
    { id: 'ai', label: 'Ask the AI Architect', hint: 'Describe a change below. Nothing is built until you approve.', done: promptHistory.length > 0 },
    { id: 'meet', label: 'Meet a resident', hint: 'Click someone walking on the map to see their routine.', done: metResident },
  ];

  const dirty = history.length > 0 || redoHistory.length > 0 || world.clock.tick !== loaded.world.clock.tick || populationEnabled !== (loaded.world.population !== undefined) || lifeEdits > 0;
  const view = selectedCitizen ? 'citizen' : selectedBuilding && !movingBuildingId && mode !== 'life' ? 'building' : mode;
  const lifeSheet = view === 'life' && (lifeFlow?.step === 'home' || !!lifePlace);
  const sheetVisible = compact && (view === 'citizen' || view === 'building' || architectPanelOpen || sheetOpen || lifeSheet);
  // Collapsing hides only the Build/Live/Life overview; inspectors, the AI panel and home selection still open when relevant.
  const panelHidden = !compact && panelCollapsed && (view === 'build' || view === 'live' || view === 'life' && !lifeSheet);
  const togglePanel = (collapsed: boolean) => { setPanelCollapsed(collapsed); writeFlag(PANEL_KEY, collapsed); };
  const selectedFootprint = selectedBuilding ? { x: selectedBuilding.x, y: selectedBuilding.y, width: BUILDINGS[selectedBuilding.kind].width, height: BUILDINGS[selectedBuilding.kind].height } : null;
  const proposalBreakdown = currentProposal ? Object.entries(currentProposal.placements
    .filter((placement) => placement.operation === 'build')
    .reduce<Record<string, number>>((counts, placement) => ({ ...counts, [placement.buildingType]: (counts[placement.buildingType] ?? 0) + 1 }), {}))
    .map(([type, count]) => ({ type: type as BuildingKind, count, cost: count * BUILDINGS[type as BuildingKind].cost })) : [];
  const toolHint = tool === 'select' ? (populationEnabled ? 'Click a resident or building to inspect it' : 'Click a building to inspect it')
    : tool === 'road' ? 'Click or drag to pave road tiles · $8 each'
    : tool === 'move' ? (movingBuildingId ? 'Choose an open destination for the building' : 'Click a building to move it')
    : tool === 'bulldoze' ? 'Click a building or road to demolish it'
    : `Click an open lot to place a ${BUILDINGS[tool].label.toLowerCase()}`;

  return (
    <main className={`app-shell mode-${mode} ${compact ? 'is-compact' : ''} ${panelHidden ? 'panel-collapsed' : ''}`}>
      <section className="map-stage">
        <CityViewport
          city={city}
          world={world}
          getWorld={getSnapshot}
          proposal={overlayProposal}
          onSimulationFrame={advanceSimulation}
          tool={tool}
          selectedBuildingId={selectedBuildingId}
          movingBuildingId={movingBuildingId}
          selectedCitizenId={selectedCitizenId}
          followCitizenId={followCitizenId}
          onSelectBuilding={selectBuilding}
          onSelectCitizen={populationEnabled ? selectCitizen : undefined}
          onFollowEnd={() => { setFollowCitizenId(null); setFollowPlayer(false); }}
          onPlaceBuilding={placeBuilding}
          onBeginMoveBuilding={beginMoveBuilding}
          onMoveBuilding={moveBuilding}
          onAddRoad={addRoad}
          onBulldoze={bulldoze}
          onCameraFootprintChange={setCameraFootprint}
          cameraRequest={cameraRequest}
          safeArea={safeArea}
          onBeginGesture={beginGesture}
          onEndGesture={endGesture}
          lifeMode={lifeActive}
          onLifeTarget={onLifeTarget}
          onSelectPlayer={player ? () => chooseMode('life') : undefined}
          followPlayer={lifeActive && followPlayer && !!player && !followCitizenId && !lifeFlow}
          lifeFeedback={lifeFeedback}
          homeHighlights={homeHighlights}
        />
        {overlayProposal && <div className="preview-ribbon" role="note"><Icon name="sparkle" size={14} /> AI preview · not built yet</div>}
      </section>

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="brand-copy">
            <div className="brand-name">Tiny City</div>
            <div className="city-line"><span>Villa Gardens</span><span className={`save-state ${saved ? 'is-saved' : dirty ? 'is-dirty' : ''}`}>{saved ? 'Saved on this device' : dirty ? 'Unsaved changes' : 'Local city'}</span></div>
          </div>
        </div>
        <nav className="mode-switch" aria-label="Game mode" data-mode={mode}>
          <span className="mode-indicator" aria-hidden="true" />
          <button className={`mode-tab ${mode === 'build' ? 'active' : ''}`} aria-pressed={mode === 'build'} onClick={() => chooseMode('build')} title="Build roads and buildings">
            <Icon name="layers" size={16} /><span>Build</span></button>
          <button className={`mode-tab ${mode === 'plan' ? 'active' : ''}`} aria-pressed={mode === 'plan'} onClick={() => chooseMode('plan')} title="Plan with the AI Architect">
            <Icon name="sparkle" size={16} /><span>Plan</span></button>
          <button className={`mode-tab ${mode === 'live' ? 'active' : ''}`} aria-pressed={mode === 'live'} onClick={() => chooseMode('live')} title="Watch residents live their day">
            <Icon name="people" size={16} /><span>Live</span>{unseenFeed > 0 && <b className="tab-badge" aria-label={`${unseenFeed} new city life updates`}>{unseenFeed}</b>}</button>
          <button className={`mode-tab ${mode === 'life' ? 'active' : ''}`} aria-pressed={mode === 'life'} onClick={() => chooseMode('life')} title={player ? (playerWaiting ? `Choose a home for ${player.name}` : `Continue life as ${player.name}`) : 'Create a character and live in the city'}>
            <Icon name="person" size={16} /><span>Life</span></button>
        </nav>
        <div className="hud-stats">
          <div className="hud-stat cash" title="Funds available for construction"><Icon name="coin" size={15} /><strong>${city.funds.toLocaleString()}</strong><small>Funds</small>
            {fundsDelta && <span key={fundsDelta.id} className={`funds-delta ${fundsDelta.amount < 0 ? 'is-spend' : 'is-gain'}`} aria-hidden="true">{fundsDelta.amount < 0 ? '−' : '+'}${Math.abs(fundsDelta.amount).toLocaleString()}</span>}</div>
          <div className="hud-stat" title={populationEnabled ? 'Residents living in the city' : 'Residents have not moved in yet'}><Icon name="people" size={15} /><strong>{populationEnabled ? citizens.length : '—'}</strong><small>Residents</small></div>
          <div className="hud-stat" title="Home buildings"><Icon name="home" size={15} /><strong>{villas}</strong><small>Homes</small></div>
        </div>
        <div className="top-actions">
          <button className="icon-button" aria-label="Undo" title="Undo (⌘Z)" onClick={undo} disabled={!history.length}><Icon name="undo" /></button>
          <button className="icon-button" aria-label="Redo" title="Redo (⌘⇧Z)" onClick={redo} disabled={!redoHistory.length}><Icon name="redo" /></button>
          <button className={`save-button ${saved ? 'is-saved' : ''}`} onClick={save}><Icon name="save" size={16} />{saved ? 'Saved' : 'Save'}</button>
        </div>
      </header>

      <nav className="tool-rail" aria-label="Build tools">
        {tools.map((item, index) => <div key={item.id} className="tool-slot">
          {(index === 3 || index === tools.length - 1) && <span className="rail-divider" aria-hidden="true" />}
          <button className={`tool-button tool-${item.id} ${tool === item.id ? 'active' : ''}`} aria-pressed={tool === item.id} onClick={() => {
            if (item.id !== 'move') setMovingBuildingId(null);
            setTool(item.id);
          }} title={`${item.label} · ${item.shortcut}`}>
            <span className="tool-icon"><Icon name={item.id} size={19} /></span>
            <span className="tool-label">{item.label}</span>
            {item.cost !== undefined && <span className="tool-cost">${item.cost}</span>}
            <kbd aria-hidden="true">{item.shortcut}</kbd>
          </button>
        </div>)}
      </nav>

      <SimulationDock day={gameDay} clock={gameClock} minuteOfDay={gameTime.minuteOfDay} paused={world.clock.paused} speed={speed} lastEvent={lastEvent}
        onTogglePause={() => { togglePause(); setSaved(false); }} onStep={() => { step(); setSaved(false); }} onSpeed={setSpeed} />

      <div className="map-tools">
        <div className="zoom-controls" role="group" aria-label="Camera">
          <button className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomCamera(1.25)}><Icon name="plus" size={16} /></button>
          <button className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomCamera(0.8)}><Icon name="minus" size={16} /></button>
          <button className="icon-button camera-home" aria-label="Center neighborhood" title="Return to the built neighborhood" onClick={() => { setFollowCitizenId(null); setFollowPlayer(false); navigateCamera(); }}><Icon name="center" size={16} /></button>
        </div>
        <MiniMap city={city} citizens={citizens} cameraFootprint={cameraFootprint} selectedCitizenId={selectedCitizenId} selectedFootprint={selectedFootprint} onNavigate={(cell) => { setFollowCitizenId(null); setFollowPlayer(false); navigateCamera(cell); }} />
      </div>

      <div className="tool-hint" aria-hidden="true"><span className="control-dot" />{toolHint}<span className="control-separator">·</span>Scroll to zoom<span className="control-separator">·</span>Shift + drag to pan</div>

      <form ref={plannerFormRef} className={`planner-bar ${architectBusy ? 'is-busy' : ''}`} onSubmit={plannerSubmit} aria-busy={architectBusy}>
        <button type="button" className="architect-panel-toggle" aria-controls="architect-panel"
          aria-expanded={architectPanelOpen} aria-label={architectPanelOpen ? 'Hide AI Architect panel' : 'Show AI Architect panel'}
          onClick={() => { const opening = !architectPanelOpen; setArchitectPanelOpen(opening); if (opening) { setSelectedBuildingId(null); setSelectedCitizenId(null); setSheetOpen(false); } }}>
          <Icon name="sparkle" size={17} /><span>AI options</span>
          {connection.state !== 'idle' && <i className={`composer-dot ${connection.state === 'connected' || connection.state === 'reachable' ? 'is-online' : connection.state === 'checking' ? 'is-checking' : 'is-offline'}`} aria-hidden="true" />}</button>
        <div className="planner-copy"><strong>AI Architect</strong><span id="architect-prompt-help">Preview first, then approve</span></div>
        <textarea value={command} onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} aria-label="Describe a city change" aria-describedby="architect-prompt-help"
          placeholder="Describe a change, e.g. Xây 3 biệt thự gần công viên…"
          rows={1} disabled={architectBusy} />
        {planningRequestActive
          ? <button key="cancel-request" className="planner-submit cancel-planning" type="button" onClick={(event) => {
            event.preventDefault();
            cancelArchitectRequest();
          }}
            aria-label="Cancel planning request" title="Cancel request"><Icon name="close" size={17} /></button>
          : <button key="generate-request" className="planner-submit" type="submit" aria-label={architectState.status === 'applying' ? 'Applying approved plan' : 'Generate AI plan'}
            title={architectState.status === 'applying' ? 'Applying approved plan' : 'Generate plan'}
            disabled={!command.trim() || architectState.status === 'applying'}><Icon name="arrow" size={18} /></button>}
      </form>
      {notice && <div className={`toast tone-${noticeTone}`} role="status" aria-label="City notice" aria-live="polite"><span className="toast-check"><Icon name={noticeTone === 'warn' ? 'warning' : 'check'} size={12} /></span>{notice}</div>}

      {panelHidden && <button className="panel-handle" aria-label="Show side panel" title="Show side panel" onClick={() => togglePanel(false)}>
        <Icon name="chevron" size={16} className="is-flipped" /><span>{mode === 'live' ? 'Live' : mode === 'life' ? 'Life' : 'Build'}</span></button>}
      <aside ref={panelRef} className={`inspector side-panel view-${view} ${architectPanelOpen ? 'architect-open' : ''} ${sheetOpen ? 'sheet-open' : ''} ${sheetVisible ? 'sheet-visible' : ''} ${selectedBuilding && !movingBuildingId ? 'has-selection' : ''} ${panelHidden ? 'is-collapsed' : ''}`}>
        {!compact && (view === 'build' || view === 'live' || view === 'life' && !lifeSheet) && <button className="panel-collapse" aria-label="Collapse side panel" title="Collapse side panel" onClick={() => togglePanel(true)}><Icon name="chevron" size={16} /></button>}
        {compact && sheetVisible && (view === 'build' || view === 'live' || view === 'life' && !lifeSheet) && !architectPanelOpen && <button className="sheet-close" aria-label="Close panel" onClick={() => setSheetOpen(false)}><Icon name="close" size={16} /></button>}
        <section id="architect-panel" className={`architect-panel ${architectPanelOpen ? 'is-open' : ''}`} aria-labelledby="architect-heading">
          <div className="panel-topline"><span>AI ARCHITECT</span><span className={`architect-chip state-${architectState.status}`}>{architectStatusLabel[architectState.status]}</span></div>
          <div className="architect-heading-row"><span className="architect-sparkle"><Icon name="sparkle" size={18} /></span>
            <div><h2 id="architect-heading">AI Architect</h2><p>Your idea, safely planned</p></div>
          </div>
          <p className="architect-intro">Describe a change in the prompt bar. Plans appear as a blueprint on the map; the city only changes after you approve a valid plan.</p>
          <ConnectionBadge connection={connection} onRetry={checkConnection} />
          {!currentProposal && !architectBusy && <div className="prompt-suggestions" aria-label="Example prompts">
            {promptSuggestions.map((suggestion) => <button key={suggestion} type="button" className="suggestion-chip" onClick={() => setCommand(suggestion)}>{suggestion}</button>)}
          </div>}
          <div className={`architect-state state-${architectState.status}`} role="status" aria-live="polite">
            <span className="architect-state-dot" />
            <span>{architectState.message ?? architectStatusLabel[architectState.status]}</span>
            {architectState.requestId && <small>Request {architectState.requestId}</small>}
            {architectState.status === 'stale' && <small className="recovery">Your manual edit is kept. Send the prompt again to plan against the current city.</small>}
            {architectState.status === 'error' && !isRecoverablePlannerError(architectState.errorCode) && <small className="recovery">Nothing was changed. Adjust the prompt or options, then press the arrow to retry.</small>}
          </div>
          {architectState.status === 'error' && isRecoverablePlannerError(architectState.errorCode) && <PlannerRecovery code={architectState.errorCode!}
            connection={connection} prompt={command} dev={import.meta.env.DEV}
            onRetry={() => plannerFormRef.current?.requestSubmit()} onCheck={checkConnection} />}

          {currentProposal && <div className={`proposal-card ${architectState.status === 'stale' ? 'is-stale' : ''}`}>
            <div className="proposal-card-heading"><strong>{currentProposal.summary}</strong>
              <span className={currentProposal.validation.fulfilled ? 'full' : 'partial'}>{currentProposal.validation.fulfilled ? 'FULL' : 'PARTIAL'}</span></div>
            <p>{currentProposal.explanation}</p>
            <div className="proposal-metrics">
              <div><small>EST. COST</small><strong>${currentProposal.estimatedCost.toLocaleString()}</strong></div>
              <div><small>AFTER PLAN</small><strong>${currentProposal.projectedBudget.toLocaleString()}</strong></div>
            </div>
            {(proposalBreakdown.length > 0 || currentProposal.roads.add.length > 0) && <ul className="cost-breakdown" aria-label="Cost breakdown">
              {proposalBreakdown.map((line) => <li key={line.type}><BuildingThumb kind={line.type} /><span>{line.count} × {BUILDINGS[line.type].label}</span><b>${line.cost.toLocaleString()}</b></li>)}
              {currentProposal.roads.add.length > 0 && <li><span className="road-swatch" /><span>{currentProposal.roads.add.length} × Road tile</span><b>${(currentProposal.roads.add.length * CONSTRUCTION_COSTS.road).toLocaleString()}</b></li>}
            </ul>}
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
              {currentProposal.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}><Icon name="warning" size={13} />{warning.message}</li>)}
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

        {view === 'citizen' && selectedCitizen && <CitizenInspector citizen={selectedCitizen} world={world} minuteOfDay={gameTime.minuteOfDay}
          following={followCitizenId === selectedCitizen.id}
          onFocus={() => focusCitizen(selectedCitizen.id)}
          onFollow={() => setFollowCitizenId((current) => current === selectedCitizen.id ? null : selectedCitizen.id)}
          onClose={() => { setSelectedCitizenId(null); setFollowCitizenId(null); }}
          onSelectBuilding={(id) => { if (lifeActive) { setSelectedCitizenId(null); setLifePlaceId(id); } else selectBuilding(id); }}
          lifeActions={citizenLifeActions} />}

        {view === 'building' && selectedBuilding && <BuildingInspector building={selectedBuilding} roadConnected={roadConnected}
          occupancy={populationEnabled ? getBuildingOccupancy(selectedBuilding.id) : null}
          citizens={citizenMap} populationEnabled={populationEnabled}
          onClose={() => { setSelectedBuildingId(null); setMovingBuildingId(null); setTool('select'); }}
          onDetails={() => {
            const building = world.plan.buildings.find((entry) => entry.id === selectedBuilding.id);
            if (building) showNotice(`${building.name} · ${building.kind} · capacity ${building.capacity}`);
          }}
          onMove={() => beginMoveBuilding(selectedBuilding.id)}
          onBulldoze={() => bulldoze({ x: selectedBuilding.x, y: selectedBuilding.y })}
          onSelectCitizen={selectCitizen} />}

        {view === 'build' && <BuildPanel tool={tool} funds={city.funds} steps={guideSteps} guideVisible={!guideHidden}
          onHideGuide={() => { setGuideHidden(true); writeGuideHidden(true); }}
          onShowGuide={() => { setGuideHidden(false); writeGuideHidden(false); }}
          onChoose={(kind) => { setMovingBuildingId(null); setTool(kind); if (compact) setSheetOpen(false); }}
          onWelcome={welcomeResidents} populationEnabled={populationEnabled} />}

        {view === 'live' && <LivePanel populationEnabled={populationEnabled} homes={villas} capacity={homeCapacity} citizens={citizens}
          summary={activitySummary} jobless={jobless} feed={feed.entries} paused={world.clock.paused} selectedCitizenId={selectedCitizenId}
          onWelcome={welcomeResidents} onResume={() => { resume(); setSaved(false); }} onSelectCitizen={(id) => { selectCitizen(id); focusCitizen(id); }} />}

        {view === 'life' && lifeFlow?.step === 'home' && <HomePicker options={homeOptions} selectedId={lifeFlow.selectedId} purpose={lifeFlow.purpose}
          populationEnabled={populationEnabled} welcome={welcomeWithPlayer} onWelcomeChange={setWelcomeWithPlayer} onSelect={selectHome} onConfirm={confirmHome}
          housing={housing} fresh={freshHomes} playerName={player?.name ?? null}
          onBack={() => setLifeFlow(playerWaiting && player ? { step: 'identity', draft: { name: player.name, appearance: player.appearance }, editing: true } : null)}
          onBuildHome={() => {
            if (playerWaiting && homeBaselineRef.current === null) homeBaselineRef.current = new Set(homeOptions.map((option) => option.buildingId));
            setLifeFlow(null); chooseMode('build'); setTool('villa');
            // Keep the map visible on phones so the player can pick a lot right away.
            if (compact) setSheetOpen(false);
            showNotice(player ? `Build a home beside a road. One room will be kept free for ${player.name}.` : 'Build a home beside a road.');
          }}
          kindOf={(id) => city.buildings.find((entry) => entry.id === id)?.kind} />}
        {view === 'life' && lifeFlow?.step !== 'home' && !player && <LifeEntry populationEnabled={populationEnabled} onCreate={openCreator} />}
        {view === 'life' && lifeFlow?.step !== 'home' && player && !playerWaiting && <LifePanel player={player} world={world} actions={lifeActions} log={playerLog.entries}
          paused={world.clock.paused} following={followPlayer && !followCitizenId} place={placeCard}
          nearby={nearby} onSelectCitizen={(id) => { selectCitizen(id); if (compact) setSheetOpen(true); }}
          onAction={(action) => runLife(action === 'go-home' ? { type: 'player.move-to', destination: { type: 'building', buildingId: player.homeBuildingId ?? '' } }
            : action === 'visit' ? { type: 'player.start-activity', activity: 'visit' } : { type: 'player.start-activity', activity: action })}
          onCancel={() => runLife({ type: 'player.cancel' })} onFocus={focusPlayer}
          onFollow={() => { setFollowCitizenId(null); setFollowPlayer((value) => !value); }}
          onEdit={() => setLifeFlow({ step: 'identity', draft: { name: player.name, appearance: player.appearance }, editing: true })}
          onChangeHome={() => setLifeFlow({ step: 'home', draft: null, purpose: 'move', selectedId: null })}
          onResume={() => { resume(); setSaved(false); }} onClosePlace={() => setLifePlaceId(null)} />}
      </aside>
      {playerWaiting && player && !lifeActive && <button className="home-return" onClick={() => chooseMode('life')} aria-label="Back to home selection">
        <Icon name="home" size={15} /><span><strong>{player.name} needs a home</strong><small>{housing.freeRooms > 0 ? `${housing.freeRooms} free room${housing.freeRooms === 1 ? '' : 's'} · choose one` : 'Build a home beside a road'}</small></span>
        <Icon name="chevron" size={14} /></button>}
      {lifeActive && player && !playerWaiting && !lifeFlow && <LifeStrip player={player} world={world} following={followPlayer && !followCitizenId}
        onOpen={() => { setSelectedCitizenId(null); setLifePlaceId(null); if (compact) setSheetOpen(true); else if (panelCollapsed) togglePanel(false); }}
        onFollow={() => { setFollowCitizenId(null); setFollowPlayer((value) => !value); }} onCancel={() => runLife({ type: 'player.cancel' })} />}
      {lifeFlow?.step === 'identity' && <CharacterCreator initial={lifeFlow.draft} editing={lifeFlow.editing} onCancel={() => setLifeFlow(null)}
        onSubmit={(draft) => {
          if (lifeFlow.editing) { const result = runLife({ type: 'player.customize', name: draft.name, appearance: draft.appearance }, 'Look saved.'); if (result.applied) setLifeFlow(null); return; }
          // The character is created now (unplaced), so it is kept while the player finds or builds a home.
          const created = runLife({ type: 'player.create', name: draft.name, appearance: draft.appearance });
          if (!created.applied) return;
          setLifeFlow({ step: 'home', draft: null, purpose: 'create', selectedId: null });
          setBaseMode('life'); setArchitectPanelOpen(false); setSelectedCitizenId(null);
          if (panelCollapsed) togglePanel(false);
        }} />}
    </main>
  );
}

export default App;
