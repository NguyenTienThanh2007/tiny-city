import type { SimulationEvent } from '@tiny-city/simulation';
import { Icon } from './Icon';
import { SIMULATION_SPEEDS, type SimulationSpeed } from '../simulation/useCitySimulation';

export function SimulationDock({ day, clock, minuteOfDay, paused, speed, lastEvent, onTogglePause, onStep, onSpeed }: {
  day: string;
  clock: string;
  minuteOfDay: number;
  paused: boolean;
  speed: SimulationSpeed;
  lastEvent: SimulationEvent | null;
  onTogglePause: () => void;
  onStep: () => void;
  onSpeed: (speed: SimulationSpeed) => void;
}) {
  const night = minuteOfDay < 360 || minuteOfDay >= 1170;
  const progress = (minuteOfDay / 1440) * 100;
  return <section className={`sim-dock ${paused ? 'is-paused' : 'is-running'}`} role="group" aria-label="Simulation controls">
    <div className="sim-time">
      <span className={`sim-sky ${night ? 'is-night' : 'is-day'}`}><Icon name={night ? 'moon' : 'sun'} size={16} /></span>
      <output aria-label="Simulation clock"><span className="sim-day">DAY {day}</span><span className="sim-sep"> · </span><span className="sim-clock">{clock}</span></output>
      <span className="sim-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></span>
    </div>
    <div className="sim-buttons">
      <button className="sim-play" onClick={onTogglePause} aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume time (Space)' : 'Pause time (Space)'}>
        <Icon name={paused ? 'play' : 'pause'} size={15} />
      </button>
      <div className="speed-switch" role="group" aria-label="Simulation speed">
        {SIMULATION_SPEEDS.map((value) => <button key={value} className={speed === value ? 'active' : ''} aria-pressed={speed === value}
          aria-label={`Speed ${value}x`} title={`${value}× speed`} onClick={() => onSpeed(value)}>{value}×</button>)}
      </div>
      <button className="sim-step" onClick={onStep} disabled={!paused} aria-label="Step" title="Advance one game minute while paused"><Icon name="step" size={14} /></button>
    </div>
    <output className="simulation-event" aria-label="Latest simulation event">{lastEvent ? `${lastEvent.type} · tick ${lastEvent.tick}` : 'No simulation events yet'}</output>
  </section>;
}
