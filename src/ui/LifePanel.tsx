import type { ReactNode } from 'react';
import { needLevel, PLAYER_BALANCE } from '@tiny-city/simulation';
import type { Citizen, HomeOption, HousingSummary, LifeRejectionReason, PlayerActionAvailability, PlayerCharacter, PlayerNeed, WorldState } from '@tiny-city/simulation';
import { activityLabels } from '../simulation/citizenView';
import { CitizenAvatar } from './CitizenAvatar';
import { describePlayer, NEED_LABELS, needWord, rejectionText, type PlayerLogEntry } from '../simulation/playerView';
import { DEFAULT_APPEARANCE } from '../game/playerLook';
import type { BuildingKind } from '../types';
import { BuildingThumb } from './BuildingThumb';
import { Icon } from './Icon';
import { PlayerFigure, PlayerPortrait } from './PlayerFigure';

const NEED_ICONS: Record<PlayerNeed, string> = { energy: 'bed', hunger: 'leaf', social: 'people', mood: 'sun' };
const NEEDS: PlayerNeed[] = ['energy', 'hunger', 'social', 'mood'];

export function NeedBars({ player, compact = false }: { player: PlayerCharacter; compact?: boolean }) {
  return <div className={`need-bars ${compact ? 'is-compact' : ''}`} role="group" aria-label="Needs">
    {NEEDS.map((need) => {
      const value = player.needs[need];
      const level = needLevel(value);
      return <div key={need} className={`need need-${need} level-${level}`}>
        <span className="need-label"><Icon name={NEED_ICONS[need]} size={compact ? 12 : 14} />{!compact && <b>{NEED_LABELS[need]}</b>}</span>
        <span className="need-track" role="meter" aria-label={NEED_LABELS[need]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}
          aria-valuetext={`${Math.round(value)} of 100, ${needWord(need, level)}`}><i style={{ width: `${value}%` }} /></span>
        {!compact && <span className="need-value"><strong>{Math.round(value)}</strong><small>{needWord(need, level)}</small></span>}
      </div>;
    })}
  </div>;
}

type ActionId = PlayerActionAvailability['action'];
const ACTION_META: Record<Exclude<ActionId, 'cancel' | 'greet' | 'socialize'>, { label: string; icon: string; hint: string }> = {
  'go-home': { label: 'Go home', icon: 'home', hint: 'Walk back home' },
  rest: { label: 'Rest', icon: 'bed', hint: `${PLAYER_BALANCE.activities.rest.minutes} min · restores energy` },
  eat: { label: 'Eat', icon: 'leaf', hint: `${PLAYER_BALANCE.activities.eat.minutes} min · fills hunger` },
  visit: { label: 'Visit a park', icon: 'park', hint: `${PLAYER_BALANCE.activities.visit.minutes} min · nearest park or club` },
};
const SHORT_REASON: Partial<Record<LifeRejectionReason, string>> = {
  'already-home': 'Already home', 'no-home': 'Need a home', 'unreachable': 'No road there', 'stranded': 'No road nearby',
  'too-tired': 'Too tired', 'venue-full': 'Full right now', 'no-venue': 'No park yet', 'citizen-unavailable': 'Indoors right now', 'not-placed': 'Move in first',
};

export function ActionButton({ label, icon, hint, availability, onClick }: { label: string; icon: string; hint: string; availability: PlayerActionAvailability | undefined; onClick: () => void }) {
  const available = availability?.available ?? false;
  const reason = availability?.reason ?? null;
  return <button type="button" className={`life-action ${available ? '' : 'is-unavailable'}`} onClick={onClick} aria-disabled={!available}
    title={available ? hint : reason ? rejectionText[reason] : hint}>
    <span className="life-action-icon"><Icon name={icon} size={17} /></span>
    <span className="life-action-copy"><strong>{label}</strong><small>{available ? hint : reason ? SHORT_REASON[reason] ?? rejectionText[reason] : hint}</small></span>
  </button>;
}

export function LifeEntry({ populationEnabled, onCreate }: { populationEnabled: boolean; onCreate: () => void }) {
  return <section className="life-panel" aria-labelledby="life-heading">
    <div className="panel-topline"><span>LIFE MODE</span></div>
    <div className="life-intro">
      <div className="life-intro-art" aria-hidden="true">
        <PlayerFigure appearance={DEFAULT_APPEARANCE} size={118} />
        <PlayerFigure appearance={{ skinTone: 3, hairStyle: 'curly', hairColor: 0, outfit: 'overalls', outfitColor: 1, accessory: 'backpack' }} size={104} />
        <PlayerFigure appearance={{ skinTone: 0, hairStyle: 'bun', hairColor: 4, outfit: 'dress', outfitColor: 2, accessory: 'sunhat' }} size={110} />
      </div>
      <h2 id="life-heading">Live in your city</h2>
      <p>Create a character, move into a home you built, and walk the same streets as your residents.</p>
      <ul className="welcome-facts">
        <li><Icon name="walk" size={14} /> Click roads to walk; routes follow the real street network.</li>
        <li><Icon name="bed" size={14} /> Look after energy, hunger, social life and mood.</li>
        <li><Icon name="people" size={14} /> {populationEnabled ? 'Greet and chat with residents you meet.' : 'Welcome residents to have neighbours to meet.'}</li>
      </ul>
      <button className="primary-action" onClick={onCreate}><Icon name="person" size={16} /> Create character</button>
      <small className="life-note">Live mode still lets you watch residents without a character.</small>
    </div>
  </section>;
}

export function HomePicker({ options, selectedId, purpose, populationEnabled, welcome, onWelcomeChange, onSelect, onConfirm, onBack, onBuildHome, kindOf,
  housing, fresh, playerName }: {
  options: readonly HomeOption[];
  housing: HousingSummary;
  fresh: ReadonlySet<string>;
  playerName: string | null;
  selectedId: string | null;
  purpose: 'create' | 'move';
  populationEnabled: boolean;
  welcome: boolean;
  onWelcomeChange: (value: boolean) => void;
  onSelect: (id: string) => void;
  onConfirm: () => void;
  onBack: () => void;
  onBuildHome: () => void;
  kindOf: (id: string) => BuildingKind | undefined;
}) {
  const available = options.filter((o) => o.available);
  const selected = options.find((o) => o.buildingId === selectedId) ?? null;
  // Free and newly built homes first, then the rest in city order.
  const ordered = [...options].sort((a, b) => Number(b.available) - Number(a.available) || Number(fresh.has(b.buildingId)) - Number(fresh.has(a.buildingId)));
  return <section className="life-panel home-picker" aria-labelledby="home-heading">
    <div className="panel-topline"><span>{purpose === 'create' ? 'LIFE MODE · STEP 2 OF 2' : 'LIFE MODE · MOVE HOME'}</span>
      <button className="panel-close" aria-label="Back" onClick={onBack}><Icon name="close" size={16} /></button></div>
    <h2 id="home-heading">Choose your home</h2>
    <p className="panel-lede">Green homes have a free room. You take one room; residents are never moved out for you.</p>
    {available.length === 0 && <div className="housing-recovery" role="region" aria-label="No free home">
      <div className="housing-recovery-head"><Icon name="home" size={18} />
        <strong>{options.length === 0 ? 'There are no homes yet' : 'Every home is full right now'}</strong></div>
      {options.length > 0 && <div className="housing-meter" aria-label={`${housing.residents} of ${housing.rooms} rooms taken`}>
        <span><b>{housing.residents}</b> of {housing.rooms} rooms taken in {housing.homes} home{housing.homes === 1 ? '' : 's'}</span>
        <span className="meter"><i style={{ width: `${housing.rooms ? Math.min(100, housing.residents / housing.rooms * 100) : 0}%` }} /></span>
      </div>}
      <p>Residents are never moved out to make room for you. Build a villa, townhouse or apartment beside a road
        {playerName ? <> and one room is kept free for <b>{playerName}</b></> : null} — new residents will not take it.</p>
      {playerName && <p className="housing-saved"><Icon name="check" size={13} /> {playerName} is saved and waiting. You can come back here any time from the Life tab.</p>}
      <button className="primary-action" onClick={onBuildHome}><Icon name="villa" size={15} /> Build a home</button>
    </div>}
    {available.length > 0 && fresh.size > 0 && <div className="hint-banner fresh-banner" role="status"><Icon name="sparkle" size={14} />
      <span>New housing is ready{playerName ? ` — a room is waiting for ${playerName}` : ''}. Choose a highlighted home.</span></div>}
    <ul className="home-list" aria-label="Homes">
      {ordered.map((o) => {
        const kind = kindOf(o.buildingId);
        const state = o.current ? 'Your home' : o.available ? (o.roadConnected ? 'Free room' : 'Free room · no road') : 'Full';
        return <li key={o.buildingId}>
          <button type="button" className={`home-option ${o.available ? 'is-available' : 'is-full'} ${selectedId === o.buildingId ? 'is-selected' : ''} ${fresh.has(o.buildingId) ? 'is-fresh' : ''}`}
            aria-pressed={selectedId === o.buildingId} disabled={!o.available} onClick={() => onSelect(o.buildingId)}>
            {kind && <BuildingThumb kind={kind} />}
            <span className="home-copy"><strong>{o.name}{fresh.has(o.buildingId) && <em className="new-chip">New</em>}</strong><small>{o.residents} of {o.capacity} rooms taken</small></span>
            <span className={`home-chip ${o.available ? 'ok' : ''}`}>{state}</span>
          </button>
        </li>;
      })}
    </ul>
    {selected && <div className="home-confirm" role="region" aria-label="Confirm home">
      <strong>Move into {selected.name}?</strong>
      <p>{selected.residents} of {selected.capacity} rooms are taken; you will take one. {selected.roadConnected ? 'It touches a road, so you can walk anywhere connected.' : 'It does not touch a road yet, so you will not be able to walk out until one is built.'}</p>
      {purpose === 'create' && !populationEnabled && <label className="check-line"><input type="checkbox" checked={welcome} onChange={(e) => onWelcomeChange(e.target.checked)} /> Also welcome residents so you have neighbours</label>}
      <div className="home-confirm-actions">
        <button className="approve-plan" onClick={onConfirm}>{purpose === 'create' ? 'Move in & start' : 'Move here'}</button>
        <button className="reject-plan" onClick={onBack}>{purpose === 'create' ? 'Back' : 'Cancel'}</button>
      </div>
    </div>}
  </section>;
}

export interface NearbyResident { readonly citizen: Citizen; readonly where: string }

export function LifePanel({ player, world, actions, log, paused, following, place, nearby, onSelectCitizen, onAction, onCancel, onFocus, onFollow, onEdit, onChangeHome, onResume, onClosePlace }: {
  player: PlayerCharacter;
  world: WorldState;
  actions: readonly PlayerActionAvailability[];
  log: readonly PlayerLogEntry[];
  paused: boolean;
  following: boolean;
  place: ReactNode;
  nearby: readonly NearbyResident[];
  onSelectCitizen: (id: string) => void;
  onAction: (action: Exclude<ActionId, 'cancel' | 'greet' | 'socialize'>) => void;
  onCancel: () => void;
  onFocus: () => void;
  onFollow: () => void;
  onEdit: () => void;
  onChangeHome: () => void;
  onResume: () => void;
  onClosePlace: () => void;
}) {
  const status = describePlayer(player, world);
  const home = world.plan.buildings.find((b) => b.id === player.homeBuildingId);
  const byAction = new Map(actions.map((a) => [a.action, a]));
  const busy = byAction.get('cancel')?.available ?? false;
  return <section className="life-panel" aria-labelledby="player-name">
    <div className="panel-topline"><span>LIFE MODE · YOU</span></div>
    <div className="player-hero">
      <PlayerPortrait appearance={player.appearance} size={64} />
      <div>
        <h2 id="player-name">{player.name}</h2>
        <p className="citizen-meta">{home ? <><Icon name="home" size={13} /> {home.name}</> : <span className="warn-text">No home · choose one</span>}</p>
        <div className="player-hero-actions">
          <button className="text-button" onClick={onEdit}>Edit look</button>
          <button className="text-button" onClick={onChangeHome}>{home ? 'Change home' : 'Choose home'}</button>
        </div>
      </div>
    </div>
    <div className={`life-status phase-${status.phase}`} role="status" aria-label="Current activity">
      <span className="life-status-dot" aria-hidden="true" />
      <div><strong>{status.headline}</strong><small>{status.detail}</small>
        {status.progress !== null && <span className="life-progress" aria-hidden="true"><i style={{ width: `${Math.round(status.progress * 100)}%` }} /></span>}</div>
      {busy && <button className="outline-action" onClick={onCancel}>Cancel</button>}
    </div>
    {paused && <div className="hint-banner"><Icon name="clock" size={14} /><span>Time is paused, so you and your needs stand still.</span>
      <button className="text-button" onClick={onResume}>Resume time</button></div>}
    {place}
    {!place && <>
      <div className="section-heading"><span>NEEDS</span><small>100 is fully satisfied</small></div>
      <NeedBars player={player} />
      <div className="section-heading"><span>ACTIONS</span><small>Click a road to walk</small></div>
      <div className="life-actions">
        {(['go-home', 'rest', 'eat', 'visit'] as const).map((id) => <ActionButton key={id} {...ACTION_META[id]} availability={byAction.get(id)} onClick={() => onAction(id)} />)}
      </div>
    </>}
    {!place && <div className="citizen-actions">
      <button className="outline-action" onClick={onFocus}><Icon name="target" size={15} /> Focus</button>
      <button className={`outline-action ${following ? 'is-active' : ''}`} aria-pressed={following} onClick={onFollow}><Icon name="follow" size={15} /> {following ? 'Following' : 'Follow'}</button>
    </div>}
    {!place && <div className="walkers nearby">
      <div className="section-heading"><span>NEARBY RESIDENTS</span><small>{nearby.length ? 'Click to meet' : 'Nobody close by'}</small></div>
      {nearby.length > 0 ? <ul aria-label="Nearby residents">{nearby.map(({ citizen, where }) => <li key={citizen.id}>
        <button className="walker" onClick={() => onSelectCitizen(citizen.id)}>
          <CitizenAvatar citizenId={citizen.id} size={30} />
          <span>{citizen.name}<small className="walker-meta">{activityLabels[citizen.activity]} · {where}{player.acquaintances.includes(citizen.id) ? ' · met' : ''}</small></span>
          <Icon name="chevron" size={14} /></button></li>)}</ul>
        : <p className="muted small">Residents walk the streets around 07:00 and 17:00, and relax in parks in the evening.</p>}
    </div>}
    {place && <button className="text-button back-to-needs" onClick={onClosePlace}><Icon name="chevron" size={13} className="is-flipped" /> Back to needs &amp; actions</button>}
    <div className="life-feed player-log">
      <div className="section-heading"><span>DIARY</span><small>{player.acquaintances.length} neighbour{player.acquaintances.length === 1 ? '' : 's'} met</small></div>
      {log.length === 0 ? <p className="muted small">Your day starts here. Walk somewhere or say hello to a resident.</p>
        : <ol>{log.map((entry) => <li key={entry.id} className={`log-${entry.tone}`}><span className="feed-icon"><Icon name={entry.icon} size={13} /></span><span>{entry.text}</span><time>{entry.time}</time></li>)}</ol>}
    </div>
  </section>;
}

/** Contextual card for a building clicked in Life mode. */
export function PlaceCard({ name, kind, detail, actions }: { name: string; kind: BuildingKind; detail: string; actions: ReactNode }) {
  return <div className="place-card" role="region" aria-label={`Place: ${name}`}>
    <div className="place-head"><BuildingThumb kind={kind} /><div><strong>{name}</strong><small>{detail}</small></div></div>
    <div className="life-actions">{actions}</div>
  </div>;
}

/** Compact always-visible HUD: who you are, what you're doing, and how you feel. */
export function LifeStrip({ player, world, following, onOpen, onFollow, onCancel }: {
  player: PlayerCharacter; world: WorldState; following: boolean; onOpen: () => void; onFollow: () => void; onCancel: () => void;
}) {
  const status = describePlayer(player, world);
  const busy = player.activity.kind !== 'idle' || player.movement.status === 'travelling';
  return <div className="life-strip" role="region" aria-label="Life HUD">
    <button className="life-strip-id" onClick={onOpen} aria-label={`Open ${player.name}'s profile`}>
      <PlayerPortrait appearance={player.appearance} size={40} />
      <span><strong>{player.name}</strong><small>{status.headline}</small></span>
    </button>
    <NeedBars player={player} compact />
    <div className="life-strip-actions">
      {busy && <button className="icon-button" aria-label="Cancel current action" title="Cancel" onClick={onCancel}><Icon name="close" size={16} /></button>}
      <button className={`icon-button ${following ? 'is-on' : ''}`} aria-label={following ? 'Stop following your character' : 'Follow your character'} aria-pressed={following} title="Follow camera" onClick={onFollow}><Icon name="follow" size={16} /></button>
    </div>
  </div>;
}
