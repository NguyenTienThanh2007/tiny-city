import { useState } from 'react';
import type { Building, CityEventKind, SocietyRejectionReason, WorldState } from '@tiny-city/simulation';
import {
  choiceView, eventLabel, eventSlots, eventViews, friendsOf, INTEREST_LABELS, outingView, personalitySummary, societyOverview, traitRows, venueView, wellbeing,
} from '../simulation/societyView';
import type { EventView } from '../simulation/societyView';
import { Icon } from './Icon';

const needRows = [['energy', 'Energy', 'bolt'], ['hunger', 'Hunger', 'food'], ['social', 'Social', 'people'], ['fun', 'Fun', 'sparkle']] as const;

/** Resident profile (Phase 7): personality, interests, wellbeing, the current outing and why, and friends. */
export function SocialCard({ world, citizenId, onSelectCitizen, onSelectBuilding }: {
  world: WorldState; citizenId: string; onSelectCitizen: (id: string) => void; onSelectBuilding: (id: string) => void;
}) {
  const profile = world.society?.residents[citizenId];
  if (!profile) return null;
  const outing = outingView(world, citizenId);
  const choice = choiceView(world, citizenId);
  const friends = friendsOf(world, citizenId);
  const mood = wellbeing(profile.needs);
  return <div className="social-card" role="group" aria-label="Social life">
    <div className="social-head"><span>PERSONALITY</span><em>{personalitySummary(profile.traits).join(' · ')}</em></div>
    <ul className="interest-chips" aria-label="Interests">{profile.interests.map((i) => <li key={i}>{INTEREST_LABELS[i]}</li>)}</ul>
    <details className="trait-details">
      <summary>Traits</summary>
      <dl className="trait-list">{traitRows(profile.traits).map((t) => <div key={t.label}>
        <dt>{t.label}</dt><dd><span className="trait-track" role="meter" aria-label={t.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.value}><i style={{ width: `${t.value}%` }} /></span><small>{t.value >= 65 ? t.high : t.value <= 35 ? t.low : 'Balanced'}</small></dd>
      </div>)}</dl>
    </details>
    <div className="social-head"><span>WELLBEING</span><em className={`wellbeing-${mood.label.toLowerCase()}`}>{mood.label} · {mood.value}</em></div>
    <div className="need-bars is-compact social-needs">{needRows.map(([key, label, icon]) => <div key={key} className={`need need-${key === 'fun' ? 'mood' : key}`} title={`${label} ${profile.needs[key]}`}>
      <Icon name={icon} size={13} /><span className="need-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={profile.needs[key]}><i style={{ width: `${profile.needs[key]}%` }} /></span>
    </div>)}</div>
    <div className="social-head"><span>RIGHT NOW</span></div>
    {outing ? <div className="outing-line" aria-label="Current outing">
      <strong>{outing.title}</strong>
      <span>{outing.kind === 'visit' ? outing.place : <button className="link-button" onClick={() => onSelectBuilding(outing.venueId)}>{outing.place}</button>}
        {outing.companions.length > 0 && <> with {outing.companions.map((c, i) => <span key={c.id}>{i > 0 ? ', ' : ''}<button className="link-button" onClick={() => onSelectCitizen(c.id)}>{c.name}</button></span>)}</>}</span>
      <small>{outing.timeText}</small>
    </div> : <p className="muted small">No outing planned.</p>}
    {choice && <div className="choice-line" aria-label="Why">
      <span>{choice.headline}</span>
      {choice.reasons.length > 0 && <ul>{choice.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {choice.options > 1 && <small>Weighed {choice.options} options</small>}
    </div>}
    <div className="social-head"><span>FRIENDS</span><em>{friends.filter((f) => f.level !== 'Acquaintance').length} friends · {friends.length} known</em></div>
    {friends.length ? <ul className="people-list friend-list" aria-label="Friends">{friends.slice(0, 6).map((f) => <li key={f.id}>
      <button className="link-button" onClick={() => onSelectCitizen(f.id)}>{f.name}</button><small>{f.level}</small>
      <span className="bond" role="meter" aria-label={`Bond with ${f.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={f.strength}><i style={{ width: `${f.strength}%` }} /></span>
    </li>)}</ul> : <p className="muted small">Hasn't met anyone yet. Friendships grow from time spent together.</p>}
  </div>;
}

const rejection: Partial<Record<SocietyRejectionReason, string>> = {
  'venue-busy': 'Another event is already booked then.', 'event-limit': 'You already have four events booked.', 'insufficient-funds': 'The treasury cannot afford it.',
  'invalid-time': 'Pick a time at least an hour from now, within a week.', 'unsupported-event': 'This venue cannot host that event.',
};

/** Venue inspector (Phase 7): opening hours, visitors against capacity, price, events, and organizing one. */
export function VenueCard({ world, building, onSchedule, onCancel }: {
  world: WorldState; building: Building;
  onSchedule: (kind: CityEventKind, day: number, startMinute: number) => SocietyRejectionReason | null;
  onCancel: (eventId: string) => void;
}) {
  const view = venueView(world, building);
  const [kind, setKind] = useState<CityEventKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!view) return null;
  const chosen = kind ?? view.hosts[0] ?? null;
  const slots = chosen ? eventSlots(world, building, chosen) : [];
  return <div className="venue-card" role="group" aria-label="Venue">
    <div className="economy-card-head"><span>{view.activity}</span><em className={view.openNow ? 'is-open' : 'is-closed'}>{view.openNow ? 'Open now' : 'Closed now'}</em></div>
    <div className="occupancy-numbers"><strong>{view.visitors}</strong><span>/ {view.serving} visitors now{view.serving < view.capacity ? ` (${view.capacity} when fully staffed)` : ''}</span></div>
    <div className="meter" aria-hidden="true"><i style={{ width: `${Math.min(100, view.visitors / Math.max(1, view.serving) * 100)}%` }} /></div>
    <dl>
      <div><dt>Hours</dt><dd>{view.hours}</dd></div>
      <div><dt>Price</dt><dd>{view.price}</dd></div>
      <div><dt>Visits today</dt><dd>{view.visitsToday}</dd></div>
      {!view.staffed && <div><dt>Staff</dt><dd className="warn">No workers yet · the owner keeps a few tables open</dd></div>}
    </dl>
    {view.events.length > 0 && <EventList events={view.events} onCancel={onCancel} label="Events here" />}
    {view.hosts.length > 0 && <div className="organize" role="group" aria-label="Organize an event">
      <div className="section-heading"><span>ORGANIZE AN EVENT</span><small>Paid by the city</small></div>
      <div className="segmented">{view.hosts.map((k) => <button key={k} aria-pressed={chosen === k} onClick={() => { setKind(k); setMessage(null); }}>{eventLabel(k)}</button>)}</div>
      {slots.length ? <div className="slot-buttons">{slots.map((slot) => <button key={`${slot.day}-${slot.startMinute}`} className="outline-action"
        onClick={() => { const reason = onSchedule(chosen!, slot.day, slot.startMinute); setMessage(reason ? rejection[reason] ?? 'That event could not be booked.' : `Booked: ${eventLabel(chosen!)} ${slot.label}`); }}>
        <Icon name="clock" size={14} /> {slot.label}</button>)}</div> : <p className="muted small">No free evening this week.</p>}
      {message && <p className="small organize-message" role="status">{message}</p>}
    </div>}
  </div>;
}

function EventList({ events, onCancel, label }: { events: readonly EventView[]; onCancel?: (id: string) => void; label: string }) {
  return <ol className="event-list" aria-label={label}>{events.map((e) => <li key={e.id} className={`event-${e.status}`}>
    <span className="event-when"><b>{e.day}</b><small>{e.time}</small></span>
    <span className="event-what"><strong>{e.name}</strong><small>{e.status === 'running' ? `On now · ${e.attended} here` : `${e.going} going`} · {e.capacity} places · {e.price > 0 ? `$${e.price}` : 'Free'}{e.organizer === 'player' ? ' · yours' : ''}</small></span>
    {onCancel && e.organizer === 'player' && e.status === 'scheduled' && <button className="text-button" onClick={() => onCancel(e.id)}>Cancel</button>}
  </li>)}</ol>;
}

/** Live panel (Phase 7): the society at a glance and the event calendar. */
export function SocietyOverviewCard({ world, onSelectBuilding, onCancelEvent }: {
  world: WorldState; onSelectBuilding: (id: string) => void; onCancelEvent: (id: string) => void;
}) {
  const overview = societyOverview(world);
  const [calendar, setCalendar] = useState(false);
  if (!overview) return null;
  const events = eventViews(world);
  return <div className="society-card" role="group" aria-label="Living society">
    <div className="section-heading"><span>LIVING SOCIETY</span><small>Today</small></div>
    <div className="society-stats">
      <div><strong>{overview.outNow}</strong><small>Out now</small></div>
      <div><strong>{overview.outingsToday}</strong><small>Outings</small></div>
      <div><strong>{overview.eventAttendanceToday}</strong><small>At events</small></div>
      <div><strong>{overview.wellbeing}</strong><small>Wellbeing</small></div>
    </div>
    <p className="muted small">{overview.friendships} friendships · {overview.withFriends} of {overview.residents} residents have a friend{overview.groupOutingsToday ? ` · ${overview.groupOutingsToday} group outings today` : ''}{overview.turnedAwayToday ? ` · ${overview.turnedAwayToday} turned away from full venues` : ''}</p>
    {overview.popular.length > 0 && <ul className="popular-list" aria-label="Popular now">{overview.popular.map((p) => <li key={p.id}>
      <button className="link-button" onClick={() => onSelectBuilding(p.id)}>{p.name}</button><small>{p.visitors} here</small></li>)}</ul>}
    <div className="section-heading"><span>EVENTS</span><button className="text-button" aria-expanded={calendar} onClick={() => setCalendar((open) => !open)}>{calendar ? 'Hide calendar' : 'Event calendar'}</button></div>
    {events.length === 0 ? <p className="muted small">No events planned. Build a concert stage, a performance plaza or a night market, or organize one from a venue.</p>
      : <EventList events={calendar ? events : events.slice(0, 2)} onCancel={onCancelEvent} label={calendar ? 'Event calendar' : 'Next events'} />}
  </div>;
}
