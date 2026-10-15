import { TRANSPORT } from '@tiny-city/simulation';
import type { Position } from '@tiny-city/simulation';
import { lineColorCss } from '../game/vehicleMotion';
import type { TrafficOverlay } from '../game/transportLayer';
import { CONGESTION_LABELS, type LineView, type TransportOverview } from '../simulation/transportView';
import { Icon } from './Icon';

export interface LineDraft {
  readonly stops: readonly Position[];
  readonly buses: number;
  readonly problem: string | null;
}

const minutes = (value: number | null) => value === null ? '—' : `${value} min`;

/**
 * Phase 6 Transport panel: live traffic and transit figures straight from the simulation, the map overlays, and bus
 * line management. Stops are picked on the map while the line editor is open.
 */
export function TransportPanel({ overview, lines, overlay, draft, onOverlay, onStartLine, onCancelLine, onRemoveDraftStop, onDraftBuses, onCreateLine,
  onSetBuses, onDeleteLine, onFocusStop, onClose }: {
  overview: TransportOverview;
  lines: readonly LineView[];
  overlay: TrafficOverlay;
  draft: LineDraft | null;
  onOverlay: (mode: TrafficOverlay) => void;
  onStartLine: () => void;
  onCancelLine: () => void;
  onRemoveDraftStop: (index: number) => void;
  onDraftBuses: (buses: number) => void;
  onCreateLine: () => void;
  onSetBuses: (lineId: string, buses: number) => void;
  onDeleteLine: (lineId: string) => void;
  onFocusStop: (tile: Position) => void;
  onClose: () => void;
}) {
  const s = overview.stats;
  const c = overview.congestion;
  return <section className="transport-panel" aria-labelledby="transport-heading">
    <div className="panel-topline"><span>CITY TRANSPORT</span>
      <button className="panel-close" aria-label="Close city transport" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
    <div className="economy-heading-row">
      <span className="economy-coin transport-badge" aria-hidden="true"><Icon name="car" size={18} /></span>
      <div><h2 id="transport-heading">Transportation</h2><p>Live from the simulation · {CONGESTION_LABELS[c.status]} traffic</p></div>
    </div>

    <dl className="economy-kpis transport-kpis">
      <div><dt>Vehicles on the street</dt><dd data-testid="transport-vehicles">{overview.onStreet}
        <small>{overview.cars} cars · {overview.buses} buses · {overview.vans} vans{overview.pullingOut ? ` · ${overview.pullingOut} pulling out` : ''}</small></dd></div>
      <div><dt>Journeys now</dt><dd data-testid="transport-journeys">{overview.journeys.driving + overview.journeys.waiting + overview.journeys.riding + overview.journeys.toStop}
        <small>{overview.journeys.driving} driving · {overview.journeys.waiting} at stops · {overview.journeys.riding} on buses</small></dd></div>
      <div><dt>Average drive · {overview.statsLabel}</dt><dd data-testid="transport-avg-car">{minutes(overview.avgCar)}<small>{s.carCompleted} trips completed</small></dd></div>
      <div><dt>Average bus journey · {overview.statsLabel}</dt><dd>{minutes(overview.avgBus)}<small>{s.boardings} boardings{s.fullBuses ? ` · ${s.fullBuses} left by full buses` : ''}</small></dd></div>
    </dl>

    {overview.modeShare && <div className="mode-share" role="group" aria-label={`Trips ${overview.statsLabel}: ${overview.modeShare.walk}% walking, ${overview.modeShare.car}% by car, ${overview.modeShare.bus}% by bus`}>
      <div className="mode-share-bar" aria-hidden="true">
        <i className="is-walk" style={{ width: `${overview.modeShare.walk}%` }} /><i className="is-car" style={{ width: `${overview.modeShare.car}%` }} /><i className="is-bus" style={{ width: `${overview.modeShare.bus}%` }} />
      </div>
      <div className="mode-share-keys"><span><i className="is-walk" />Walk {overview.modeShare.walk}%</span><span><i className="is-car" />Car {overview.modeShare.car}%</span><span><i className="is-bus" />Bus {overview.modeShare.bus}%</span></div>
    </div>}

    <div className="overlay-switch" role="group" aria-label="Map overlay">
      {([['off', 'No overlay', 'Off'], ['traffic', 'Traffic overlay', 'Traffic'], ['transit', 'Bus lines overlay', 'Bus lines']] as const).map(([mode, label, text]) =>
        <button key={mode} aria-label={label} aria-pressed={overlay === mode} className={overlay === mode ? 'is-active' : ''} onClick={() => onOverlay(mode)}>{text}</button>)}
    </div>
    {overlay === 'traffic' && <div className="congestion-legend" aria-label="Congestion legend">
      {CONGESTION_LABELS.map((label, i) => <span key={label}><i className={`level-${i}`} />{label}</span>)}
    </div>}

    <div className="transport-health" role="group" aria-label="Road network health">
      <div><span>Traffic</span><strong className={`level-text-${c.status}`}>{CONGESTION_LABELS[c.status]}</strong>
        <small>{c.slow + c.heavy + c.jammed === 0 ? 'No delays recorded' : `${c.slow} slow · ${c.heavy} heavy · ${c.jammed} jammed lanes`}</small></div>
      <div><span>Road network</span><strong>{overview.network.components <= 1 ? 'Connected' : `${overview.network.components} separate parts`}</strong>
        <small>{overview.network.roads} road tiles{overview.network.isolatedBuildings ? ` · ${overview.network.isolatedBuildings} buildings without road access` : ''}</small></div>
      {(overview.experience.car > 110 || overview.experience.bus > 110) && <p className="small muted">Residents remember slow trips: driving feels {overview.experience.car}% as long as planned{overview.experience.bus > 110 ? `, the bus ${overview.experience.bus}%` : ''}, so some choose other ways.</p>}
    </div>

    <div className="transport-lines">
      <div className="section-head"><h3>Bus lines</h3><span>{overview.busesInService} buses · ${overview.dailyBusCost}/day</span></div>
      {lines.length === 0 && !draft && <p className="muted small">No buses yet. Create a line between homes and workplaces; residents ride when it beats walking or driving.</p>}
      <ul className="line-list">{lines.map((view) => <li key={view.line.id} className={`line-card is-${view.line.status}`} aria-label={`${view.line.name}`}>
        <div className="line-title"><i style={{ background: lineColorCss(view.line.color) }} aria-hidden="true" /><strong>{view.line.name}</strong>
          <em>{view.line.status === 'active' ? `${view.onStreet} of ${view.line.buses} buses running` : view.line.suspendedReason === 'stop-removed' ? 'Suspended · a stop was removed' : 'Suspended · roads cannot connect its stops'}</em></div>
        <ol className="line-stops">{view.stops.map((stop) => <li key={stop.id}><button onClick={() => onFocusStop(stop.tile)} aria-label={`Show ${stop.name}`} title={`Show ${stop.name} on the map`}>{stop.name}</button>{stop.waiting > 0 && <small>{stop.waiting} waiting</small>}</li>)}</ol>
        <dl className="line-stats">
          <div><dt>Riders</dt><dd>{view.riders} / {view.capacity}</dd></div>
          <div><dt>Waiting</dt><dd>{view.waiting}</dd></div>
          <div><dt>Loop</dt><dd>{minutes(view.loopMinutes)}</dd></div>
          <div><dt>Every</dt><dd>{minutes(view.headway)}</dd></div>
          <div><dt>Cost</dt><dd>${view.dailyCost}/day</dd></div>
        </dl>
        <div className="line-actions">
          <div className="stepper" role="group" aria-label={`Buses on ${view.line.name}`}>
            <button aria-label={`Remove a bus from ${view.line.name}`} disabled={view.line.buses <= TRANSPORT.minBusesPerLine} onClick={() => onSetBuses(view.line.id, view.line.buses - 1)}><Icon name="minus" size={14} /></button>
            <span>{view.line.buses} buses</span>
            <button aria-label={`Add a bus to ${view.line.name}`} disabled={view.line.buses >= TRANSPORT.maxBusesPerLine} onClick={() => onSetBuses(view.line.id, view.line.buses + 1)}><Icon name="plus" size={14} /></button>
          </div>
          <button className="text-button danger" onClick={() => onDeleteLine(view.line.id)} aria-label={`Delete ${view.line.name}`}>Delete</button>
        </div>
      </li>)}</ul>

      {draft ? <div className="line-editor" role="group" aria-label="New bus line">
        <p><strong>Click road tiles on the map</strong> to add stops in the order buses serve them (straight streets, not intersections). The loop returns to the first stop.</p>
        <ol className="draft-stops" aria-label="New line stops">{draft.stops.map((tile, i) => <li key={`${tile.x},${tile.y}`}>
          <span>Stop {i + 1} · {tile.x}, {tile.y}</span>
          <button aria-label={`Remove stop ${i + 1}`} onClick={() => onRemoveDraftStop(i)}><Icon name="close" size={12} /></button></li>)}</ol>
        {draft.problem && <p className="line-problem" role="alert">{draft.problem}</p>}
        <div className="stepper" role="group" aria-label="Buses on the new line">
          <button aria-label="Fewer buses" disabled={draft.buses <= TRANSPORT.minBusesPerLine} onClick={() => onDraftBuses(draft.buses - 1)}><Icon name="minus" size={14} /></button>
          <span>{draft.buses} buses · ${draft.buses * TRANSPORT.busDailyCost}/day</span>
          <button aria-label="More buses" disabled={draft.buses >= TRANSPORT.maxBusesPerLine} onClick={() => onDraftBuses(draft.buses + 1)}><Icon name="plus" size={14} /></button>
        </div>
        <div className="line-actions">
          <button className="primary-action" onClick={onCreateLine} disabled={draft.stops.length < TRANSPORT.minStopsPerLine}>Create line</button>
          <button className="text-button" onClick={onCancelLine}>Cancel</button>
        </div>
      </div> : <button className="primary-action subtle new-line" onClick={onStartLine} disabled={lines.length >= TRANSPORT.maxLines}><Icon name="bus" size={16} />New bus line</button>}
    </div>
    <p className="muted small transport-note">Buses cost ${TRANSPORT.busDailyCost} each per day; riders pay ${TRANSPORT.fare} to the city per boarding. Residents pay ${TRANSPORT.carTripCost} per car trip. All settle at midnight.</p>
  </section>;
}
