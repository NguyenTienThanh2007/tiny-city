import type { BuildingOccupancy, Citizen } from '@tiny-city/simulation';
import { BUILDINGS, type Building } from '../types';
import { BuildingThumb } from './BuildingThumb';
import { Icon } from './Icon';

const roleLabels = { home: 'Residential', workplace: 'Workplace', park: 'Leisure' } as const;

export function BuildingInspector({ building, roadConnected, underConstruction, occupancy, citizens, populationEnabled,
  onClose, onDetails, onMove, onBulldoze, onSelectCitizen }: {
  building: Building;
  roadConnected: boolean;
  underConstruction: boolean;
  occupancy: BuildingOccupancy | null;
  citizens: ReadonlyMap<string, Citizen>;
  populationEnabled: boolean;
  onClose: () => void;
  onDetails: () => void;
  onMove: () => void;
  onBulldoze: () => void;
  onSelectCitizen: (id: string) => void;
}) {
  const spec = BUILDINGS[building.kind];
  const leisure = spec.role === 'park' || building.kind === 'clubhouse';
  const jobs = spec.role === 'workplace' && building.kind !== 'clubhouse';
  const people = occupancy ? [
    ...occupancy.residentIds.map((id) => ({ id, role: 'Resident' })),
    ...occupancy.workerIds.map((id) => ({ id, role: 'Works here' })),
    ...occupancy.visitorIds.map((id) => ({ id, role: 'Visiting' })),
  ] : [];
  const used = occupancy ? spec.role === 'home' ? occupancy.residentIds.length : jobs ? occupancy.workerIds.length : occupancy.visitorIds.length : 0;
  const usage = spec.role === 'home' ? 'residents' : jobs ? 'jobs filled' : 'visitors now';
  return <section className="building-inspector" aria-labelledby="building-name">
    <div className="panel-topline"><span>{roleLabels[spec.role].toUpperCase()} · BUILDING</span>
      <button className="inspector-close panel-close" aria-label="Close building inspector" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
    <div className={`building-hero is-${building.kind}`}>
      <BuildingThumb kind={building.kind} />
      <div>
        <h2 id="building-name">{building.name}</h2>
        <p className="inspector-subtitle">{spec.label}</p>
        <span className={`status-pill ${underConstruction ? 'is-building' : 'is-ready'}`}>{underConstruction ? 'Under construction' : 'Open'}</span>
      </div>
    </div>
    {populationEnabled && occupancy && (spec.role === 'home' || jobs || leisure) && <div className="occupancy-card">
      <div className="occupancy-numbers"><strong>{used}</strong><span>/ {spec.capacity} {usage}</span></div>
      <div className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, used / Math.max(1, spec.capacity) * 100)}%` }} /></div>
      {people.length > 0 ? <ul className="people-list" aria-label="People linked to this building">
        {people.slice(0, 8).map((person) => {
          const citizen = citizens.get(person.id);
          return citizen ? <li key={`${person.role}-${person.id}`}><button className="link-button" onClick={() => onSelectCitizen(person.id)}>{citizen.name}</button><small>{person.role}</small></li> : null;
        })}
        {people.length > 8 && <li className="muted">+{people.length - 8} more</li>}
      </ul> : <p className="muted small">{spec.role === 'home' ? 'No residents yet.' : jobs ? 'No workers assigned yet.' : 'Nobody is visiting right now.'}</p>}
    </div>}
    <div className="building-details">
      <div className="detail-line"><span>Type</span><strong>{spec.label}</strong></div>
      <div className="detail-line"><span>Footprint</span><strong>{spec.width} × {spec.height} tiles</strong></div>
      <div className="detail-line"><span>Capacity</span><strong>{spec.capacity} places</strong></div>
      <div className="detail-line"><span>Map location</span><strong>{building.x}, {building.y}</strong></div>
      <div className="detail-line"><span>Build cost</span><strong>${spec.cost.toLocaleString()}</strong></div>
      <div className="detail-line"><span>Road access</span><strong>{spec.requiresRoad ? 'Required' : 'Optional'}</strong></div>
      <div className="detail-line"><span>Road connection</span><strong className={roadConnected ? 'ok' : spec.requiresRoad ? 'warn' : ''}>{roadConnected ? 'Connected' : spec.requiresRoad ? 'Disconnected' : 'Optional'}</strong></div>
      <div className="detail-line"><span>Condition</span><strong className="condition"><i /> {underConstruction ? 'Under construction' : 'Ready'}</strong></div>
      <div className="inspector-buttons">
        <button className="outline-action details-action" aria-label="Building details" onClick={onDetails}>Details</button>
        <button className="outline-action" onClick={onMove}><Icon name="move" size={15} /> Move</button>
        <button className="small-destruct" aria-label="Bulldoze selected building" title="Demolish building" onClick={onBulldoze}><Icon name="bulldoze" size={16} /></button>
      </div>
    </div>
  </section>;
}
