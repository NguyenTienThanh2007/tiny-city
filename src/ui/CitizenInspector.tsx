import type { Citizen, CitizenActivity, WorldState } from '@tiny-city/simulation';
import { activityLabels, describeCitizen, scheduleRows } from '../simulation/citizenView';
import { CitizenAvatar } from './CitizenAvatar';
import { Icon } from './Icon';

export const activityIcons: Record<CitizenActivity, string> = {
  sleep: 'bed', home: 'home', work: 'briefcase', leisure: 'leaf', idle: 'clock', travel: 'walk',
};

export function CitizenInspector({ citizen, world, minuteOfDay, following, onFocus, onFollow, onClose, onSelectBuilding }: {
  citizen: Citizen;
  world: WorldState;
  minuteOfDay: number;
  following: boolean;
  onFocus: () => void;
  onFollow: () => void;
  onClose: () => void;
  onSelectBuilding: (id: string) => void;
}) {
  const details = describeCitizen(citizen, world);
  const rows = scheduleRows(citizen, world, minuteOfDay);
  const age = citizen.attributes?.age;
  const pace = citizen.attributes?.walkingSpeed;
  return <section className="citizen-inspector" aria-labelledby="citizen-name">
    <div className="panel-topline"><span>RESIDENT</span>
      <button className="panel-close" aria-label="Close resident profile" onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
    <div className="citizen-hero">
      <CitizenAvatar citizenId={citizen.id} size={64} />
      <div>
        <h2 id="citizen-name">{citizen.name}</h2>
        <p className="citizen-meta"><span className="id-chip">{citizen.id}</span>{age !== undefined && <span>Age {age}</span>}</p>
        <span className={`activity-pill activity-${citizen.activity}`}><Icon name={activityIcons[citizen.activity]} size={13} />{activityLabels[citizen.activity]}</span>
      </div>
    </div>
    <div className="citizen-actions">
      <button className="outline-action" onClick={onFocus}><Icon name="target" size={15} /> Focus</button>
      <button className={`outline-action ${following ? 'is-active' : ''}`} aria-pressed={following} onClick={onFollow}>
        <Icon name="follow" size={15} /> {following ? 'Following' : 'Follow'}</button>
    </div>
    <dl className="fact-list">
      <div><dt><Icon name="pin" size={14} /> Location</dt><dd>{details.location}</dd></div>
      <div><dt><Icon name="route" size={14} /> Travel</dt><dd>{details.travelStatus}{details.remainingTiles !== null ? ` · ${details.remainingTiles} tiles left` : ''}</dd></div>
      <div><dt><Icon name="home" size={14} /> Home</dt><dd><button className="link-button" onClick={() => onSelectBuilding(citizen.homeBuildingId)}>{details.home}</button></dd></div>
      <div><dt><Icon name="briefcase" size={14} /> Workplace</dt><dd>{citizen.workBuildingId && details.workplace
        ? <button className="link-button" onClick={() => onSelectBuilding(citizen.workBuildingId!)}>{details.workplace}</button>
        : <span className="muted">Looking for work · no open jobs</span>}</dd></div>
      <div><dt><Icon name="target" size={14} /> Destination</dt><dd>{details.destination ?? <span className="muted">None right now</span>}</dd></div>
      {pace !== undefined && <div><dt><Icon name="walk" size={14} /> Walking pace</dt><dd>{(pace * 60).toFixed(0)} tiles per game hour</dd></div>}
    </dl>
    <div className="schedule">
      <div className="section-heading"><span>DAILY ROUTINE</span><small>{citizen.scheduleMode === 'custom' ? 'Custom schedule' : 'Generated from home & job'}</small></div>
      <div className="schedule-bar" aria-hidden="true">
        {rows.map((row) => <i key={row.startMinute} className={`activity-${row.activity}`} style={{ left: `${row.startMinute / 14.4}%`, width: `${(row.endMinute - row.startMinute) / 14.4}%` }} />)}
        <b style={{ left: `${minuteOfDay / 14.4}%` }} />
      </div>
      <ol className="schedule-list">
        {rows.map((row) => <li key={row.startMinute} className={row.current ? 'is-current' : ''} aria-current={row.current ? 'step' : undefined}>
          <time>{row.time}</time>
          <span className={`schedule-dot activity-${row.activity}`}><Icon name={activityIcons[row.activity]} size={12} /></span>
          <span><strong>{row.label}</strong>{row.place && <small>{row.place}</small>}</span>
        </li>)}
      </ol>
    </div>
  </section>;
}
