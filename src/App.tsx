import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { getGameTime } from '@tiny-city/simulation';
import CityViewport from './game/CityViewport';
import { loadCitySave, saveCity } from './simulation/citySave';
import { useCitySimulation } from './simulation/useCitySimulation';
import { BUILDINGS, canPlace, createBuilding, isLandCell, type BuildingKind, type CityState, type Cell, type Tool } from './types';

const tools: { id: Tool; label: string; shortcut: string; cost?: number }[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'road', label: 'Road', shortcut: 'R', cost: 8 },
  { id: 'villa', label: 'Villa', shortcut: '1', cost: BUILDINGS.villa.cost },
  { id: 'park', label: 'Park', shortcut: '2', cost: BUILDINGS.park.cost },
  { id: 'clubhouse', label: 'Clubhouse', shortcut: '3', cost: BUILDINGS.clubhouse.cost },
  { id: 'bulldoze', label: 'Bulldoze', shortcut: 'X' },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, ReactNode> = {
    select: <><path d="m5 3 13 10-6 1.2L9 20 5 3Z" /><path d="m12 14 4 5" /></>,
    road: <><path d="m7 3-3 18M17 3l3 18" /><path d="M12 4v3m0 4v3m0 4v3" /></>,
    villa: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-7h6v7" /></>,
    park: <><path d="M12 21v-8" /><path d="M8 14a4 4 0 1 1 7.6-1.7A3.2 3.2 0 1 1 16 18H8a2 2 0 0 1 0-4Z" /></>,
    clubhouse: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /><path d="M9 9h.01M15 9h.01" /></>,
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

function MiniMap({ city }: { city: CityState }) {
  const buildingMarks = city.buildings.map((building) => {
    const color = building.kind === 'villa' ? '#e6ad73' : building.kind === 'park' ? '#d8edaa' : '#f4d18d';
    return <circle key={building.id} cx={`${((building.x + 1) / 64) * 100}%`} cy={`${((building.y + 1) / 64) * 100}%`} r="2.2" fill={color} />;
  });
  return <div className="minimap"><div className="minimap-grid" />
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Neighborhood overview">
      <g fill="#d9e2c8">{city.roads.map(({ x, y }, index) => <circle key={`${x}-${y}-${index}`} cx={(x / 64) * 100} cy={(y / 64) * 100} r="0.9" />)}</g>
      <g>{buildingMarks}</g>
      <rect x="23" y="19" width="38" height="38" rx="2" fill="none" stroke="#f6e5af" strokeWidth="1.3" />
    </svg>
    <span>VILLA GARDENS</span>
  </div>;
}

function App() {
  const [loaded] = useState(() => loadCitySave());
  const [city, setCity] = useState<CityState>(loaded.city);
  const { world, lastEvent, advance, syncCity, togglePause, step, getSnapshot } = useCitySimulation(loaded.city, loaded.world);
  const cityRef = useRef(city);
  cityRef.current = city;
  const [history, setHistory] = useState<CityState[]>([]);
  const [redoHistory, setRedoHistory] = useState<CityState[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);
  const [constructionClock, setConstructionClock] = useState(Date.now());
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

  const commit = useCallback((next: CityState) => {
    const previous = cityRef.current;
    syncCity(next);
    setHistory((current) => [...current.slice(-39), previous]);
    setRedoHistory([]);
    cityRef.current = next;
    setCity(next);
    setSaved(false);
  }, [syncCity]);

  const addRoad = useCallback((cell: Cell) => {
    const current = cityRef.current;
    if (!isLandCell(cell.x, cell.y, current.size)) return;
    if (current.funds < 8) { showNotice('You need $8 to build a road tile.'); return; }
    if (current.roads.some((road) => road.x === cell.x && road.y === cell.y)) return;
    if (current.buildings.some((building) => {
      const spec = BUILDINGS[building.kind];
      return cell.x >= building.x && cell.x < building.x + spec.width && cell.y >= building.y && cell.y < building.y + spec.height;
    })) { showNotice('Roads cannot overlap a building.'); return; }
    commit({ ...current, roads: [...current.roads, cell], funds: current.funds - 8 });
  }, [commit, showNotice]);

  const placeBuilding = useCallback((kind: BuildingKind, x: number, y: number) => {
    const current = cityRef.current;
    const cost = BUILDINGS[kind].cost;
    if (!canPlace(current, kind, x, y)) { showNotice('That lot is occupied or outside the buildable area.'); return; }
    if (current.funds < cost) { showNotice(`You need $${cost} to build a ${BUILDINGS[kind].label.toLowerCase()}.`); return; }
    const building = createBuilding(kind, x, y, current.buildings.filter((entry) => entry.kind === kind).length + 1);
    commit({ ...current, buildings: [...current.buildings, building], funds: current.funds - cost });
    setSelectedBuildingId(building.id);
    setTool('select');
  }, [commit, showNotice]);

  const bulldoze = useCallback((cell: Cell) => {
    const current = cityRef.current;
    const building = [...current.buildings].reverse().find((entry) => {
      const spec = BUILDINGS[entry.kind];
      return cell.x >= entry.x && cell.x < entry.x + spec.width && cell.y >= entry.y && cell.y < entry.y + spec.height;
    });
    if (building) {
      commit({ ...current, buildings: current.buildings.filter((entry) => entry.id !== building.id) });
      if (selectedBuildingId === building.id) setSelectedBuildingId(null);
      return;
    }
    const roads = current.roads.filter((road) => road.x !== cell.x || road.y !== cell.y);
    if (roads.length !== current.roads.length) commit({ ...current, roads });
  }, [commit, selectedBuildingId]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    const currentCity = cityRef.current;
    syncCity(previous);
    setRedoHistory((current) => [...current, currentCity]);
    setHistory((current) => current.slice(0, -1));
    cityRef.current = previous;
    setCity(previous);
    setSaved(false);
    setSelectedBuildingId(null);
  }, [history, syncCity]);

  const redo = useCallback(() => {
    const next = redoHistory.at(-1);
    if (!next) return;
    const currentCity = cityRef.current;
    syncCity(next);
    setHistory((current) => [...current.slice(-39), currentCity]);
    setRedoHistory((current) => current.slice(0, -1));
    cityRef.current = next;
    setCity(next);
    setSaved(false);
    setSelectedBuildingId(null);
  }, [redoHistory, syncCity]);

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
      const shortcuts: Record<string, Tool> = { v: 'select', r: 'road', '1': 'villa', '2': 'park', '3': 'clubhouse', x: 'bulldoze' };
      const next = shortcuts[key];
      if (next) setTool(next);
      if (event.key === 'Escape') { setTool('select'); setSelectedBuildingId(null); }
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
  const villas = city.buildings.filter((building) => building.kind === 'villa').length;
  const parks = city.buildings.filter((building) => building.kind === 'park').length;
  const selectedBuilding = city.buildings.find((building) => building.id === selectedBuildingId) ?? null;
  const selectedSpec = selectedBuilding ? BUILDINGS[selectedBuilding.kind] : null;
  const selectedTool = tools.find((item) => item.id === tool);
  const gameTime = getGameTime(world.clock);
  const gameDay = String(gameTime.day + 1).padStart(2, '0');
  const gameClock = `${String(Math.floor(gameTime.minuteOfDay / 60)).padStart(2, '0')}:${String(gameTime.minuteOfDay % 60).padStart(2, '0')}`;

  useEffect(() => {
    if (!selectedBuilding) return;
    const delay = Math.max(0, selectedBuilding.createdAt + 5200 - Date.now() + 25);
    const timer = window.setTimeout(() => setConstructionClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [selectedBuilding?.id, selectedBuilding?.createdAt]);

  const plannerSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = command.trim();
    if (!text) return;
    const match = text.match(/(\d+)?\s*(?:căn\s+|những\s+)?(villas?|homes?|biệt\s*thự|nhà|parks?|công\s*viên|clubhouses?|roads?|đường)/i);
    if (!match) {
      showNotice('Planner demo understands villas, parks, clubhouses, and roads.');
      return;
    }
    const count = Math.max(1, Math.min(12, Number(match[1] ?? 1)));
    const subject = match[2].toLowerCase();
    if (subject.startsWith('road') || subject.startsWith('đường')) {
      let added = 0;
      let current = cityRef.current;
      const nextRoads = [...current.roads];
      for (let y = 30; y < 42 && added < count; y += 1) {
        const cell = { x: 18, y };
        if (current.funds - added * 8 < 8) break;
        if (nextRoads.some((road) => road.x === cell.x && road.y === cell.y)) continue;
        const blocked = current.buildings.some((building) => {
          const spec = BUILDINGS[building.kind];
          return cell.x >= building.x && cell.x < building.x + spec.width && cell.y >= building.y && cell.y < building.y + spec.height;
        });
        if (blocked || !isLandCell(cell.x, cell.y, current.size)) continue;
        nextRoads.push(cell);
        added += 1;
      }
      if (added) commit({ ...current, roads: nextRoads, funds: current.funds - added * 8 });
      showNotice(added ? `Built ${added} road tile${added === 1 ? '' : 's'}.` : 'No clear road lots were available for that plan.');
      setCommand('');
      return;
    }
    const kind: BuildingKind = subject.startsWith('park') || subject.startsWith('công') ? 'park' : subject.startsWith('club') ? 'clubhouse' : 'villa';
    let placed = 0;
    let current = cityRef.current;
    for (let y = 8; y <= 55 && placed < count; y += 1) {
      for (let x = 7; x <= 55 && placed < count; x += 1) {
        if (!canPlace(current, kind, x, y)) continue;
        if (current.funds < BUILDINGS[kind].cost) break;
        const building = createBuilding(kind, x, y, current.buildings.filter((entry) => entry.kind === kind).length + 1);
        current = { ...current, buildings: [...current.buildings, building], funds: current.funds - BUILDINGS[kind].cost };
        placed += 1;
      }
    }
    if (placed) commit(current);
    setTool('select');
    showNotice(placed ? `Built ${placed} ${kind}${placed === 1 ? '' : 's'}.` : 'No open lots or funds were available for that plan.');
    setCommand('');
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
              <button key={item.id} className={`tool-button ${tool === item.id ? 'active' : ''}`} aria-pressed={tool === item.id} onClick={() => setTool(item.id)} title={`${item.label} · ${item.shortcut}`}>
              <span className={`tool-icon tool-${item.id}`}><Icon name={item.id === 'bulldoze' ? 'bulldoze' : item.id} size={19} /></span>
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
            onSimulationFrame={advanceSimulation}
            tool={tool}
            selectedBuildingId={selectedBuildingId}
            onSelectBuilding={setSelectedBuildingId}
            onPlaceBuilding={placeBuilding}
            onAddRoad={addRoad}
            onBulldoze={bulldoze}
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
          <MiniMap city={city} />
          <form className="planner-bar" onSubmit={plannerSubmit}>
            <div className="planner-sparkle"><Icon name="sparkle" size={19} /></div>
            <div className="planner-copy"><strong>Build with a prompt</strong><span>Try “build 3 villas” · “thêm 5 đường”</span></div>
            <input value={command} onChange={(event) => setCommand(event.target.value)} aria-label="Describe a city change" placeholder="Describe what you want to build…" />
            <button className="planner-submit" type="submit" aria-label="Apply city plan" title="Build from prompt" disabled={!command.trim()}><Icon name="arrow" size={18} /></button>
          </form>
          {notice && <div className="toast" role="status" aria-label="City notice" aria-live="polite"><span className="toast-check">✓</span>{notice}</div>}
        </section>

        <aside className="inspector">
          <div className="inspector-topline"><span>NEIGHBORHOOD</span><button className="more-button" aria-label="Neighborhood information" title="Neighborhood information" onClick={() => showNotice('Villa Gardens is a locally saved coastal district.')}>•••</button></div>
          <h2>{selectedBuilding ? selectedBuilding.name : 'Build something lovely.'}</h2>
          <p className="inspector-subtitle">{selectedBuilding ? 'BUILDING INSPECTOR' : 'YOUR CITY, YOUR STORY'}</p>
          <div className={`inspector-scene ${selectedBuilding ? `is-${selectedBuilding.kind}` : ''}`}>
            <div className="scene-sun" /><div className="scene-cloud cloud-one" /><div className="scene-cloud cloud-two" />
            <div className="scene-ground" />
            {selectedBuilding?.kind !== 'park' && <div className={`scene-house ${selectedBuilding?.kind === 'clubhouse' ? 'is-clubhouse' : ''}`}><span className="house-roof" /><span className="house-wall" /><span className="house-window one" /><span className="house-window two" /><span className="house-door" /></div>}
            <div className="scene-tree tree-one"><i /><b /></div><div className="scene-tree tree-two"><i /><b /></div>
            {selectedBuilding?.kind === 'park' && <div className="scene-path" />}
            <div className="scene-caption"><span>{selectedBuilding?.name ?? 'VILLA GARDENS'}</span><b>{selectedBuilding ? `${selectedBuilding.x} · ${selectedBuilding.y}` : `${villas} HOMES`}</b></div>
          </div>
          {selectedBuilding && selectedSpec ? (
            <div className="building-details">
              <div className="detail-line"><span>Type</span><strong>{selectedSpec.label}</strong></div>
              <div className="detail-line"><span>Footprint</span><strong>{selectedSpec.width} × {selectedSpec.height} tiles</strong></div>
              <div className="detail-line"><span>Map location</span><strong>{selectedBuilding.x}, {selectedBuilding.y}</strong></div>
              <div className="detail-line"><span>Condition</span><strong className="condition"><i /> {constructionClock < selectedBuilding.createdAt + 5200 ? 'Under construction' : 'New'}</strong></div>
              <div className="inspector-buttons">
                <button className="outline-action" onClick={() => {
                  const building = world.plan.buildings.find((entry) => entry.id === selectedBuilding.id);
                  if (building) showNotice(`${building.name} · ${building.kind} · capacity ${building.capacity}`);
                }}>Building details <Icon name="arrow" size={15} /></button>
                <button className="small-destruct" aria-label="Bulldoze selected building" onClick={() => bulldoze({ x: selectedBuilding.x, y: selectedBuilding.y })}><Icon name="bulldoze" size={16} /></button>
              </div>
            </div>
          ) : (
            <>
              <div className="goal-card"><div className="goal-icon"><Icon name="sparkle" size={17} /></div><div><strong>One street at a time</strong><p>Connect homes to roads, then make room for parks and places to gather.</p></div></div>
              <div className="quick-heading"><span>QUICK BUILD</span><span>SELECT A TOOL</span></div>
              <div className="quick-build-list">
                <button onClick={() => setTool('villa')}><span className="quick-thumb villa-thumb"><i /></span><span><strong>Coastal villa</strong><small>2 × 2 tiles</small></span><b>$120</b></button>
                <button onClick={() => setTool('park')}><span className="quick-thumb park-thumb"><i /><i /><i /></span><span><strong>Garden park</strong><small>4 × 4 tiles</small></span><b>$80</b></button>
                <button onClick={() => setTool('clubhouse')}><span className="quick-thumb club-thumb"><i /></span><span><strong>Clubhouse</strong><small>3 × 3 tiles</small></span><b>$220</b></button>
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
