import type { VehicleView } from '../simulation/transportView';
import { Icon } from './Icon';

/** Phase 6: a selected vehicle, straight from the simulation (type, journey, state, riders). */
export function VehicleInspector({ view, following, onFollow, onFocus, onClose }: {
  view: VehicleView;
  following: boolean;
  onFollow: () => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  return <section className="vehicle-inspector" aria-labelledby="vehicle-name">
    <div className="panel-topline"><span>VEHICLE</span>
      <button className="panel-close" aria-label="Close vehicle details" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
    <div className="economy-heading-row">
      <span className="economy-coin transport-badge" aria-hidden="true"><Icon name={view.line ? 'bus' : 'car'} size={18} /></span>
      <div><h2 id="vehicle-name">{view.title}</h2><p>{view.model} · <span data-testid="vehicle-state">{view.state}</span></p></div>
    </div>
    <div className="citizen-actions">
      <button className="outline-action" onClick={onFocus}><Icon name="target" size={15} /> Focus</button>
      <button className={`outline-action ${following ? 'is-active' : ''}`} aria-pressed={following} onClick={onFollow}>
        <Icon name="follow" size={15} /> {following ? 'Following' : 'Follow'}</button>
    </div>
    <dl className="vehicle-facts">
      {view.line ? <>
        <div><dt>Line</dt><dd>{view.line}</dd></div>
        <div><dt>{view.dwelling ? 'At stop' : 'Next stop'}</dt><dd>{view.nextStop ?? '—'}</dd></div>
        <div><dt>Passengers</dt><dd data-testid="vehicle-passengers">{view.passengers} / {view.capacity}</dd></div>
      </> : <>
        <div><dt>Journey</dt><dd>{view.from} → {view.to}</dd></div>
        {view.driver && <div><dt>Driver</dt><dd>{view.driver}</dd></div>}
      </>}
      <div><dt>Speed</dt><dd>{(view.speed * 60 / 100).toFixed(0)} tiles / hour</dd></div>
      <div><dt>{view.line ? 'In service' : 'On the road'}</dt><dd>{view.minutes} min</dd></div>
      <div><dt>Route left</dt><dd>{view.remainingTiles} tiles</dd></div>
    </dl>
  </section>;
}
