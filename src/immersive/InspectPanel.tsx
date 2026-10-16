import type { BuildingOccupancy, LifeCommand, LifeRejectionReason, RoadNavigator, WorldState } from '@tiny-city/simulation';
import { playerActionAvailability } from '@tiny-city/simulation';
import { activityLabels, describeCitizen } from '../simulation/citizenView';
import { buildingEconomy } from '../simulation/economyView';
import { rejectionText } from '../simulation/playerView';
import { friendsOf, outingView, venueView } from '../simulation/societyView';
import { stopView } from '../simulation/transportView';
import { BUILDINGS, type BuildingKind } from '../types';
import { Icon } from '../ui/Icon';
import type { InteractionTarget } from './world/sceneModel';

/**
 * Phase 8B inspection: what the character is looking at, read live from the authoritative world through the same
 * view models the City View panels use. Opening it changes nothing. The only actions are existing Life Mode commands
 * (greet, chat, visit, eat out), validated by the simulation exactly as in the City View.
 */
export function InspectPanel({ target, world, nav, occupancy, onLife, onClose }: {
  target: InteractionTarget;
  world: WorldState;
  nav: RoadNavigator;
  occupancy: (buildingId: string) => BuildingOccupancy;
  onLife: (command: LifeCommand) => { applied: boolean; reason: LifeRejectionReason | null };
  onClose: () => void;
}) {
  return <aside className="inspect-panel immersive-card" role="dialog" aria-label={`Inspect ${target.label}`}>
    <header>
      <span className="inspect-kind">{target.kind === 'resident' ? 'Resident' : target.kind === 'stop' ? 'Bus stop' : 'Building'}</span>
      <button type="button" className="icon-button" aria-label="Close inspector" onClick={onClose}><Icon name="close" size={14} /></button>
    </header>
    {target.kind === 'resident' && <ResidentBody id={target.id} world={world} nav={nav} onLife={onLife} />}
    {target.kind === 'building' && <BuildingBody id={target.id} world={world} occupancy={occupancy} onLife={onLife} />}
    {target.kind === 'stop' && <StopBody id={target.id} world={world} />}
  </aside>;
}

function Row({ label, value }: { label: string; value: string | number }) {
  return <div className="inspect-row"><span>{label}</span><strong>{value}</strong></div>;
}

function Actions({ items }: { items: { label: string; run: () => { applied: boolean; reason: LifeRejectionReason | null }; available: boolean; reason: LifeRejectionReason | null }[] }) {
  return <div className="inspect-actions">
    {items.map((item) => <button key={item.label} type="button" disabled={!item.available} title={item.reason ? rejectionText[item.reason] : undefined} onClick={item.run}>{item.label}</button>)}
  </div>;
}

function ResidentBody({ id, world, nav, onLife }: { id: string; world: WorldState; nav: RoadNavigator; onLife: (command: LifeCommand) => { applied: boolean; reason: LifeRejectionReason | null } }) {
  const citizen = world.citizens.find((c) => c.id === id);
  if (!citizen) return <p className="inspect-note">This resident has left the city.</p>;
  const details = describeCitizen(citizen, world);
  const outing = outingView(world, id);
  const friends = friendsOf(world, id).slice(0, 4);
  const known = world.player?.acquaintances.includes(id) ?? false;
  const actions = world.player ? playerActionAvailability(world, nav, id).filter((a) => a.action === 'greet' || a.action === 'socialize') : [];
  return <>
    <h2>{citizen.name}</h2>
    <p className="inspect-sub">{activityLabels[citizen.activity]} · {details.location}</p>
    <Row label="Doing" value={details.travelStatus} />
    <Row label="Home" value={details.home} />
    {details.workplace && <Row label="Works at" value={details.workplace} />}
    {outing && <Row label={outing.title} value={`${outing.place} · ${outing.timeText}`} />}
    {outing && outing.companions.length > 0 && <Row label="With" value={outing.companions.map((c) => c.name).join(', ')} />}
    <Row label="You" value={known ? 'You have met' : 'Not met yet'} />
    {friends.length > 0 && <Row label="Friends" value={friends.map((f) => `${f.name} (${f.level.toLowerCase()})`).join(', ')} />}
    {actions.length > 0 && <Actions items={actions.map((a) => ({ label: a.action === 'greet' ? 'Greet' : 'Chat', available: a.available, reason: a.reason,
      run: () => onLife({ type: 'player.start-activity', activity: a.action as 'greet' | 'socialize', citizenId: id }) }))} />}
    <p className="inspect-note">Greet and Chat are the Life Mode actions: you walk over and they count. Just looking changes nothing.</p>
  </>;
}

function BuildingBody({ id, world, occupancy, onLife }: { id: string; world: WorldState; occupancy: (id: string) => BuildingOccupancy; onLife: (command: LifeCommand) => { applied: boolean; reason: LifeRejectionReason | null } }) {
  const building = world.plan.buildings.find((b) => b.id === id);
  if (!building) return <p className="inspect-note">This building has been demolished.</p>;
  const spec = building.type ? BUILDINGS[building.type as BuildingKind] : undefined;
  const occ = occupancy(id);
  const venue = venueView(world, building);
  const finance = buildingEconomy(world, id)?.finance;
  const isHome = world.player?.homeBuildingId === id;
  const canEat = building.type === 'cafe' || building.type === 'market';
  const visit = venue ? { label: 'Visit', run: () => onLife({ type: 'player.start-activity', activity: 'visit', buildingId: id }) } : null;
  const eat = canEat ? { label: 'Eat here', run: () => onLife({ type: 'player.start-activity', activity: 'eat', buildingId: id }) } : null;
  return <>
    <h2>{building.name}</h2>
    <p className="inspect-sub">{spec?.label ?? building.type}{isHome ? ' · your home' : ''}</p>
    {building.kind === 'home' && <Row label="Residents" value={`${occ.residentIds.length + (isHome ? 1 : 0)} of ${building.capacity}`} />}
    {building.kind === 'workplace' && <Row label="Staff" value={`${occ.workerIds.length} of ${building.capacity} jobs`} />}
    {occ.visitorIds.length > 0 && <Row label="Visitors" value={occ.visitorIds.length} />}
    {venue && <><Row label={venue.label} value={`${venue.openNow ? 'Open' : 'Closed'} · ${venue.hours}`} /><Row label="Inside now" value={`${venue.visitors} of ${venue.capacity}`} />
      <Row label="Price" value={venue.price} />{venue.events.slice(0, 2).map((e) => <Row key={e.id} label={e.status === 'running' ? 'Now' : `${e.day} ${e.time}`} value={`${e.name} · ${e.status === 'running' ? `${e.attended} attending` : `${e.going} going`}`} />)}</>}
    {finance && <Row label="Yesterday" value={`${finance.revenue ? `$${finance.revenue} revenue · ` : ''}${finance.profit >= 0 ? '+' : '−'}$${Math.abs(finance.profit)}`} />}
    {(visit || eat) && <Actions items={[visit, eat].filter((x): x is NonNullable<typeof x> => x !== null).map((a) => ({ ...a, available: true, reason: null }))} />}
    <p className="inspect-note">Interiors come later; this is the building's live record.</p>
  </>;
}

function StopBody({ id, world }: { id: string; world: WorldState }) {
  const stop = stopView(world, id);
  if (!stop) return <p className="inspect-note">This stop has been removed.</p>;
  return <>
    <h2>{stop.name}</h2>
    <p className="inspect-sub">Bus stop</p>
    <Row label="Lines" value={stop.lines.join(', ') || 'None'} />
    <Row label="Waiting" value={stop.waiting} />
    <Row label="Next bus" value={stop.nextBus === null ? '—' : stop.nextBus === 0 ? 'Arriving' : `${stop.nextBus} min`} />
  </>;
}
