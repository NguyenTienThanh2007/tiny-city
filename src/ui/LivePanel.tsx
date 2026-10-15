import type { ReactNode } from 'react';
import type { Citizen, CitizenActivity } from '@tiny-city/simulation';
import type { ActivitySummary } from '../simulation/citizenView';
import type { LifeFeedEntry } from '../simulation/lifeFeed';
import { CitizenAvatar } from './CitizenAvatar';
import { activityIcons } from './CitizenInspector';
import { Icon } from './Icon';

const order: CitizenActivity[] = ['travel', 'work', 'leisure', 'home', 'sleep', 'idle'];
const tileLabels: Record<CitizenActivity, string> = { travel: 'Walking', work: 'Working', leisure: 'Leisure', home: 'At home', sleep: 'Asleep', idle: 'Idle' };
const feedIcons: Record<LifeFeedEntry['kind'], string> = {
  commute: 'briefcase', return: 'home', leisure: 'leaf', 'arrived-home': 'home', population: 'people', blocked: 'warning', jobs: 'briefcase',
  friendship: 'heart', event: 'calendar', group: 'people', full: 'warning',
};

export function LivePanel({ populationEnabled, homes, capacity, citizens, summary, jobless, feed, paused, selectedCitizenId,
  onWelcome, onResume, onSelectCitizen, society }: {
  populationEnabled: boolean;
  homes: number;
  capacity: number;
  citizens: readonly Citizen[];
  summary: ActivitySummary;
  jobless: number;
  feed: readonly LifeFeedEntry[];
  paused: boolean;
  selectedCitizenId: string | null;
  onWelcome: () => void;
  onResume: () => void;
  onSelectCitizen: (id: string) => void;
  /** Phase 7: the society overview and event calendar. */
  society?: ReactNode;
}) {
  if (!populationEnabled) {
    return <section className="live-panel" aria-labelledby="live-heading">
      <div className="panel-topline"><span>LIVING WORLD</span></div>
      <div className="welcome-card">
        <div className="welcome-art" aria-hidden="true">
          {['npc-1', 'npc-2', 'npc-3', 'npc-4'].map((id) => <CitizenAvatar key={id} citizenId={id} size={44} />)}
        </div>
        <h2 id="live-heading">Bring the city to life</h2>
        <p>Residents move into your homes, find jobs at offices and malls, and walk the roads on their own daily routines.</p>
        <ul className="welcome-facts">
          <li><Icon name="home" size={14} /> {homes > 0 ? `Room for ${capacity} residents across ${homes} homes` : 'Build a home first so residents have somewhere to live'}</li>
          <li><Icon name="clock" size={14} /> Commutes around 07:00; evenings and weekends are their own: cafés, events, friends</li>
          <li><Icon name="save" size={14} /> Residents are saved with your city. Nothing changes until you choose to welcome them.</li>
        </ul>
        <button className="primary-action" onClick={onWelcome}><Icon name="people" size={16} /> Welcome residents</button>
      </div>
    </section>;
  }
  const total = citizens.length;
  const outdoors = citizens.filter((citizen) => citizen.activity === 'travel').slice(0, 6);
  return <section className="live-panel" aria-labelledby="live-heading">
    <div className="panel-topline"><span>LIVING WORLD</span><span className="live-dot">{paused ? 'Paused' : 'Live'}</span></div>
    <h2 id="live-heading">{total} {total === 1 ? 'resident' : 'residents'}</h2>
    <p className="panel-lede">{total === 0 ? 'Build homes next to a road and residents will move in automatically.'
      : 'Click anyone walking on the map to open their profile.'}</p>
    {paused && total > 0 && <button className="primary-action subtle" onClick={onResume}><Icon name="play" size={14} /> Resume time to watch them</button>}
    <div className="activity-grid" aria-label="Current activity summary">
      {order.map((activity) => <div key={activity} className={`activity-tile activity-${activity}`}>
        <Icon name={activityIcons[activity]} size={15} />
        <strong>{summary[activity]}</strong>
        <small>{tileLabels[activity]}</small>
      </div>)}
    </div>
    {jobless > 0 && <p className="hint-banner"><Icon name="briefcase" size={14} /> {jobless} {jobless === 1 ? 'resident has' : 'residents have'} no job. Offices and malls add jobs.</p>}
    {outdoors.length > 0 && <div className="walkers">
      <div className="section-heading"><span>ON THE MOVE</span><small>Click to follow</small></div>
      <ul>{outdoors.map((citizen) => <li key={citizen.id}>
        <button className={`walker ${citizen.id === selectedCitizenId ? 'is-selected' : ''}`} onClick={() => onSelectCitizen(citizen.id)}>
          <CitizenAvatar citizenId={citizen.id} size={30} /><span>{citizen.name}</span><Icon name="chevron" size={14} />
        </button></li>)}</ul>
    </div>}
    {society}
    <div className="life-feed">
      <div className="section-heading"><span>CITY LIFE</span><small>Latest moments</small></div>
      {feed.length === 0 ? <p className="muted small">Nothing has happened yet. Time is {paused ? 'paused' : 'moving'}.</p>
        : <ol>{feed.map((entry) => <li key={entry.id} className={`feed-${entry.kind}`}>
          <span className="feed-icon"><Icon name={feedIcons[entry.kind]} size={13} /></span>
          <span>{entry.text}</span><time>{entry.time}</time>
        </li>)}</ol>}
    </div>
  </section>;
}
