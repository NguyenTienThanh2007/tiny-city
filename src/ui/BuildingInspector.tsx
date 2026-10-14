import type { ReactNode } from 'react';
import type { BuildingOccupancy, Citizen, PlayerCharacter } from '@tiny-city/simulation';
import { homeOccupancy, residentWhereabouts } from '../simulation/housingView';
import { BUILDINGS, type Building } from '../types';
import { architectureCollection, architectureModel } from '@tiny-city/ai-architect';
import { designOf } from '../game/architecture';
import { ModelThumb } from './ArchitecturePicker';
import { Icon } from './Icon';

const roleLabels = { home: 'Residential', workplace: 'Workplace', park: 'Leisure' } as const;

export function BuildingInspector({ building, roadConnected, occupancy, citizens, populationEnabled, player, economy,
  onClose, onDetails, onMove, onBulldoze, onSelectCitizen, onSelectPlayer }: {
  building: Building;
  roadConnected: boolean;
  occupancy: BuildingOccupancy | null;
  citizens: ReadonlyMap<string, Citizen>;
  populationEnabled: boolean;
  /** The Life Mode character; their room in their own home counts exactly once. */
  player: PlayerCharacter | null;
  /** Phase 5: the building's economic activity (businesses and public amenities). */
  economy?: ReactNode;
  onSelectPlayer: () => void;
  onClose: () => void;
  onDetails: () => void;
  onMove: () => void;
  onBulldoze: () => void;
  onSelectCitizen: (id: string) => void;
}) {
  const spec = BUILDINGS[building.kind];
  const design = designOf(building);
  const model = architectureModel(design.model);
  const leisure = spec.role === 'park' || building.kind === 'clubhouse';
  const jobs = spec.role === 'workplace' && building.kind !== 'clubhouse';
  const home = spec.role === 'home';
  // Residents are assigned (wherever they are now); workers hold jobs; visitors are inside a venue right now.
  const people = occupancy ? [
    ...occupancy.residentIds.map((id) => { const c = citizens.get(id); return { id, role: c ? `Resident · ${residentWhereabouts(c, building.id)}` : 'Resident' }; }),
    ...occupancy.workerIds.map((id) => ({ id, role: 'Works here' })),
    ...occupancy.visitorIds.map((id) => ({ id, role: 'Visiting' })),
  ] : [];
  const rooms = home ? homeOccupancy(spec.capacity, occupancy, player ?? undefined, building.id) : null;
  const used = rooms ? rooms.occupied : occupancy ? jobs ? occupancy.workerIds.length : occupancy.visitorIds.length : 0;
  const usage = home ? 'rooms taken' : jobs ? 'jobs filled' : 'visitors now';
  const showCard = (populationEnabled && occupancy !== null && (home || jobs || leisure)) || rooms?.player === true;
  return <section className="building-inspector" aria-labelledby="building-name">
    <div className="panel-topline"><span>{roleLabels[spec.role].toUpperCase()} · BUILDING</span>
      <button className="inspector-close panel-close" aria-label="Close building inspector" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
    <div className={`building-hero is-${building.kind}`}>
      <ModelThumb model={model ?? null} kind={building.kind} size={64} />
      <div>
        <h2 id="building-name">{building.name}</h2>
        <p className="inspector-subtitle">{spec.label}</p>
        <p className="building-design" aria-label="Architecture">{architectureCollection(design.collection)?.name ?? design.collection} · {model?.name ?? design.model}</p>
        <span className="status-pill is-ready">Open</span>
      </div>
    </div>
    {showCard && <div className="occupancy-card" role="group" aria-label={home ? 'Residents' : jobs ? 'Workers' : 'Visitors'}>
      <div className="occupancy-numbers"><strong>{used}</strong><span>/ {spec.capacity} {usage}</span></div>
      <div className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, used / Math.max(1, spec.capacity) * 100)}%` }} /></div>
      {rooms && <p className="muted small occupancy-breakdown">{rooms.residents} resident{rooms.residents === 1 ? '' : 's'}{rooms.player ? ' + you' : ''} · {rooms.freeRooms} free room{rooms.freeRooms === 1 ? '' : 's'}</p>}
      {rooms?.player && player && <ul className="people-list" aria-label="You live here"><li><button className="link-button" onClick={onSelectPlayer}>{player.name}</button><small>You · Resident</small></li></ul>}
      {people.length > 0 ? <ul className="people-list" aria-label="People linked to this building">
        {people.slice(0, 8).map((person) => {
          const citizen = citizens.get(person.id);
          return citizen ? <li key={`${person.role}-${person.id}`}><button className="link-button" onClick={() => onSelectCitizen(person.id)}>{citizen.name}</button><small>{person.role}</small></li> : null;
        })}
        {people.length > 8 && <li className="muted">+{people.length - 8} more</li>}
      </ul> : rooms?.player ? null : <p className="muted small">{home ? 'No residents yet.' : jobs ? 'No workers assigned yet.' : 'Nobody is visiting right now.'}</p>}
    </div>}
    {economy}
    <div className="building-details">
      <div className="detail-line"><span>Type</span><strong>{spec.label}</strong></div>
      <div className="detail-line"><span>Footprint</span><strong>{spec.width} × {spec.height} tiles</strong></div>
      <div className="detail-line"><span>Capacity</span><strong>{spec.capacity} places</strong></div>
      <div className="detail-line"><span>Map location</span><strong>{building.x}, {building.y}</strong></div>
      <div className="detail-line"><span>Build cost</span><strong>${spec.cost.toLocaleString()}</strong></div>
      <div className="detail-line"><span>Road access</span><strong>{spec.requiresRoad ? 'Required' : 'Optional'}</strong></div>
      <div className="detail-line"><span>Road connection</span><strong className={roadConnected ? 'ok' : spec.requiresRoad ? 'warn' : ''}>{roadConnected ? 'Connected' : spec.requiresRoad ? 'Disconnected' : 'Optional'}</strong></div>
      <div className="detail-line"><span>Condition</span><strong className="condition"><i /> Ready</strong></div>
      <div className="inspector-buttons">
        <button className="outline-action details-action" aria-label="Building details" onClick={onDetails}>Details</button>
        <button className="outline-action" onClick={onMove}><Icon name="move" size={15} /> Move</button>
        <button className="small-destruct" aria-label="Bulldoze selected building" title="Demolish building" onClick={onBulldoze}><Icon name="bulldoze" size={16} /></button>
      </div>
    </div>
  </section>;
}
