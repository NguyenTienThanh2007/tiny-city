import { useEffect, useRef, useState } from 'react';
import type { BuildingDesign } from '@tiny-city/ai-architect';
import type { Position, RoadNavigator, WorldState } from '@tiny-city/simulation';
import { describePlayer } from '../simulation/playerView';
import { Icon } from '../ui/Icon';
import { NeedBars } from '../ui/LifePanel';
import { ORBIT } from './orbitCamera';
import { readSettings, writeSettings, type ImmersiveSettings } from './settings';
import { ImmersiveEngine, type HudState } from './three/engine';
import type { Quality } from './three/neighbourhood';

/**
 * Phase 8A Character View: a full-screen Three.js view of the real neighbourhood around the player's character,
 * with a light HUD. It mounts one engine (one renderer, one loop) and tears everything down on close. The City View
 * keeps its state underneath (its ticker stopped) and returns exactly where it was.
 */

export interface ImmersiveViewProps {
  readonly world: WorldState;
  readonly getWorld: () => WorldState;
  readonly getNavigator: () => RoadNavigator;
  readonly designs: ReadonlyMap<string, BuildingDesign>;
  readonly advance: (elapsedMs: number) => void;
  readonly walk: (position: Position) => boolean;
  readonly initialYaw: number | null;
  readonly day: string;
  readonly clock: string;
  readonly paused: boolean;
  readonly saved: boolean;
  readonly reducedMotion: boolean;
  readonly onTogglePause: () => void;
  readonly onSave: () => void;
  readonly onExit: (yaw: number | null) => void;
  readonly onFailure: (message: string) => void;
}

const MOTION_TEXT: Record<HudState['motion'], string> = {
  standing: 'Standing', walking: 'Walking', running: 'Running', inside: 'Indoors · move to step outside', travelling: 'Walking a route · move to take over',
};

export default function ImmersiveView(props: ImmersiveViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ImmersiveEngine | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>({ done: 0, total: 4, label: 'Preparing the 3D world' });
  const [hud, setHud] = useState<HudState | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settings, setSettings] = useState<ImmersiveSettings>(() => readSettings());
  const exitingRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: ImmersiveEngine | null = null;
    engine = new ImmersiveEngine(host, {
      getWorld: () => propsRef.current.getWorld(),
      getNavigator: () => propsRef.current.getNavigator(),
      advance: (ms) => propsRef.current.advance(ms),
      walk: (p) => propsRef.current.walk(p),
      designs: propsRef.current.designs,
      initialYaw: propsRef.current.initialYaw,
      reducedMotion: propsRef.current.reducedMotion,
      onProgress: (done, total, label) => setProgress(done >= total ? null : { done, total, label }),
      onReady: ({ quality: q }) => { setProgress(null); setQuality(q); engine?.canvas.focus({ preventScroll: true }); },
      onFailure: (_kind, message) => { if (!exitingRef.current) { exitingRef.current = true; propsRef.current.onFailure(message); } },
      onHud: setHud,
      onEscape: () => setMenuOpen((open) => !open),
      onTogglePause: () => propsRef.current.onTogglePause(),
    }, readSettings());
    engineRef.current = engine;
    void engine.start();
    return () => { engine?.dispose(); engineRef.current = null; };
  }, []);

  useEffect(() => { engineRef.current?.setSettings(settings); writeSettings(settings); }, [settings]);
  useEffect(() => { engineRef.current?.setInputBlocked(menuOpen); }, [menuOpen]);

  const exit = () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    const engine = engineRef.current;
    engine?.flush();
    props.onExit(engine?.yaw ?? null);
  };

  const player = props.world.player;
  const status = player ? describePlayer(player, props.world) : null;
  const loading = progress !== null;
  return <div className="immersive" role="region" aria-label="Character View" data-ready={loading ? 'loading' : 'ready'} data-quality={quality ?? ''}>
    <div ref={hostRef} className="immersive-stage" />
    {loading && <div className="immersive-loading" role="status" aria-live="polite">
      <div className="immersive-loading-card">
        <Icon name="cube" size={22} />
        <strong>Entering the world</strong>
        <span>{progress.label}…</span>
        <span className="immersive-progress" aria-hidden="true"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></span>
      </div>
    </div>}
    {player && !loading && <>
      <header className="immersive-top">
        <div className="immersive-card immersive-identity" aria-label="Your character">
          <span className="immersive-name">{player.name}</span>
          <span className="immersive-status">{status?.headline}</span>
          {hud && <span className={`immersive-motion is-${hud.motion}`} data-testid="immersive-motion">{props.paused ? 'Paused' : MOTION_TEXT[hud.motion]}</span>}
        </div>
        <div className="immersive-card immersive-clock" aria-label="Simulation clock in the Character View">
          <span>{props.day} · {props.clock}</span>
          <button type="button" className="icon-button" aria-label={props.paused ? 'Resume' : 'Pause'} title={props.paused ? 'Resume (Space)' : 'Pause (Space)'} onClick={props.onTogglePause}>
            <Icon name={props.paused ? 'play' : 'pause'} size={15} /></button>
        </div>
        <div className="immersive-actions">
          <button type="button" className={`immersive-save ${props.saved ? 'is-saved' : ''}`} onClick={props.onSave}><Icon name="save" size={15} />{props.saved ? 'Saved' : 'Save'}</button>
          <button type="button" className="icon-button immersive-gear" aria-label="Character View settings" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Icon name="gear" size={16} /></button>
          <button type="button" className="immersive-return" onClick={exit}><Icon name="layers" size={16} />Return to City</button>
        </div>
      </header>
      <div className="immersive-card immersive-needs"><NeedBars player={player} /></div>
      {props.paused && <div className="immersive-paused" role="status">Time is paused · press Space or Resume to move</div>}
      <div className="immersive-hints" aria-hidden="true">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
        <span><kbd>Shift</kbd> run</span>
        <span><Icon name="mouse" size={13} /> {hud?.pointerLocked ? 'look · Esc frees the mouse' : 'drag or click to look'}</span>
        <span>scroll zoom</span>
        <span><kbd>Esc</kbd> menu</span>
      </div>
    </>}
    {menuOpen && <div className="immersive-menu" role="dialog" aria-modal="true" aria-label="Character View menu">
      <div className="immersive-menu-card">
        <h2>Character View</h2>
        <label className="immersive-field"><span>Mouse sensitivity</span>
          <input type="range" aria-label="Mouse sensitivity" min={ORBIT.sensitivity.min} max={ORBIT.sensitivity.max} step={0.0002} value={settings.sensitivity}
            onChange={(event) => setSettings({ ...settings, sensitivity: Number(event.target.value) })} /></label>
        <label className="immersive-check"><input type="checkbox" checked={settings.invertY} onChange={(event) => setSettings({ ...settings, invertY: event.target.checked })} />
          <span>Invert vertical look</span></label>
        <label className="immersive-field"><span>Graphics quality <small>(next time you enter)</small></span>
          <select aria-label="Graphics quality" value={settings.quality} onChange={(event) => setSettings({ ...settings, quality: event.target.value as ImmersiveSettings['quality'] })}>
            <option value="auto">Automatic{quality ? ` (now ${quality})` : ''}</option><option value="high">High · soft shadows</option><option value="low">Light · no shadows</option>
          </select></label>
        <div className="immersive-menu-actions">
          <button type="button" className="approve-plan" onClick={() => setMenuOpen(false)}>Back to the world</button>
          <button type="button" onClick={exit}>Leave to the City View</button>
        </div>
      </div>
    </div>}
  </div>;
}
