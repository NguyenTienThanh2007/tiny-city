import { getGameTime, PLAYER_BALANCE } from '@tiny-city/simulation';
import type {
  Building, Citizen, LifeRejectionReason, PlayerActivityKind, PlayerCharacter, PlayerFailureReason, PlayerNeed, PlayerNeedLevel,
  PlayerSocialTopic, SimulationEvent, WorldState,
} from '@tiny-city/simulation';
import { formatMinute } from './citizenView';

/** Read-only presentation of the authoritative player. Every value shown comes from the world snapshot. */

export const NEED_LABELS: Record<PlayerNeed, string> = { energy: 'Energy', hunger: 'Hunger', social: 'Social', mood: 'Mood' };
const LEVEL_WORDS: Record<PlayerNeed, Record<PlayerNeedLevel, string>> = {
  energy: { good: 'Rested', fair: 'A bit tired', low: 'Tired', critical: 'Exhausted' },
  hunger: { good: 'Well fed', fair: 'Peckish', low: 'Hungry', critical: 'Starving' },
  social: { good: 'Connected', fair: 'Content', low: 'Lonely', critical: 'Isolated' },
  mood: { good: 'Happy', fair: 'Okay', low: 'Down', critical: 'Gloomy' },
};
export function needWord(need: PlayerNeed, level: PlayerNeedLevel): string { return LEVEL_WORDS[need][level]; }

export const rejectionText: Record<LifeRejectionReason, string> = {
  'invalid-command': 'That action is not available.',
  'player-exists': 'You already live in this city.',
  'player-not-found': 'Create your character first.',
  'invalid-name': 'Use 1–24 letters, numbers, spaces, apostrophes, dots or hyphens.',
  'invalid-appearance': 'Choose an appearance from the options.',
  'home-not-found': 'That home no longer exists.',
  'not-a-home': 'Only houses, townhouses and apartments can be your home.',
  'home-full': 'Every room in that home is taken. Residents are never evicted for you.',
  'already-home': 'You already live here.',
  'no-home': 'You need a home first. Choose one in Life mode.',
  'invalid-destination': 'You can only walk on roads and paths.',
  'unreachable': 'No road connects you to that place.',
  'stranded': 'There is no road near you. Build a road, or move into a home.',
  'building-not-found': 'That place no longer exists.',
  'not-leisure': 'Only parks, pools and the clubhouse can be visited.',
  'no-venue': 'There is no park, pool or clubhouse yet. Build one in Build mode.',
  'venue-full': 'That place is full right now. Try again later.',
  'citizen-not-found': 'That resident has left the city.',
  'citizen-unavailable': 'They are inside a home or workplace. Catch them on the street or at a park.',
  'too-tired': 'You are exhausted. Rest at home first.',
  'nothing-to-cancel': 'You are not doing anything right now.',
  'not-placed': 'Choose a home first — your life starts when you move in.',
};

export const failureText: Record<PlayerFailureReason, string> = {
  'unreachable': 'the road there was cut',
  'home-lost': 'your home is gone',
  'venue-removed': 'that place was removed',
  'venue-full': 'it was full when you arrived',
  'citizen-left': 'they had to go',
  'citizen-unavailable': 'they went indoors',
  'too-tired': 'you were too tired',
  'route-lost': 'there is no road near you',
};

export const activityNames: Record<PlayerActivityKind, string> = {
  idle: 'Free time', move: 'Walking', rest: 'Resting', eat: 'Eating', visit: 'Visiting', greet: 'Greeting', socialize: 'Chatting',
};
const pastTense: Record<PlayerActivityKind, string> = {
  idle: 'Relaxed', move: 'Arrived', rest: 'Rested', eat: 'Ate a meal', visit: 'Enjoyed a visit', greet: 'Said hello', socialize: 'Had a good chat',
};

function lookup(world: WorldState) {
  const buildings = new Map(world.plan.buildings.map((b) => [b.id, b]));
  const citizens = new Map(world.citizens.map((c) => [c.id, c]));
  return { building: (id: string | null) => (id ? buildings.get(id) : undefined), citizen: (id: string | null) => (id ? citizens.get(id) : undefined) };
}

export function remainingTiles(player: PlayerCharacter): number {
  const m = player.movement;
  if (m.status !== 'travelling') return 0;
  let total = 0, previous = player.position;
  for (let i = m.nextWaypoint; i < m.route.length; i += 1) {
    const p = m.route[i]!;
    total += Math.abs(p.x - previous.x) + Math.abs(p.y - previous.y);
    previous = p;
  }
  return Math.round(total);
}

export interface PlayerStatus {
  readonly headline: string;
  readonly detail: string;
  readonly phase: 'idle' | 'travelling' | 'performing';
  readonly progress: number | null;
  readonly location: string;
}

export function describePlayer(player: PlayerCharacter, world: WorldState): PlayerStatus {
  const { building, citizen } = lookup(world);
  const a = player.activity, m = player.movement;
  const inside = m.status === 'inside' ? building(m.currentBuildingId) : undefined;
  const location = inside ? (inside.id === player.homeBuildingId ? `At home · ${inside.name}` : `At ${inside.name}`) : m.status === 'travelling' ? 'On the street' : 'On the street';
  const target = a.citizenId ? citizen(a.citizenId)?.name ?? 'a resident' : building(a.buildingId)?.name ?? (a.tile ? `the street at ${a.tile.x}, ${a.tile.y}` : 'your destination');
  if (a.phase === 'travelling') {
    const tiles = remainingTiles(player);
    const verb = a.kind === 'move' ? `Walking to ${target}` : a.kind === 'rest' || a.kind === 'eat' ? `Heading home to ${a.kind}` :
      a.kind === 'visit' ? `Walking to ${target}` : `Walking over to ${target}`;
    return { headline: verb, detail: m.status === 'travelling' ? `${tiles} tile${tiles === 1 ? '' : 's'} to go` : 'Finding a route…', phase: 'travelling', progress: null, location };
  }
  if (a.phase === 'performing') {
    const verb = a.kind === 'greet' || a.kind === 'socialize' ? `${activityNames[a.kind]} with ${target}` : a.kind === 'visit' ? `Enjoying ${target}` : `${activityNames[a.kind]} at home`;
    return { headline: verb, detail: `${Math.floor(a.elapsedMinutes)} of ${a.durationMinutes} min`, phase: 'performing', progress: a.durationMinutes ? a.elapsedMinutes / a.durationMinutes : null, location };
  }
  return { headline: inside ? location : 'Free to explore', detail: inside ? 'Choose an action, or click a road to walk.' : 'Click a road to walk, or a building or resident to interact.', phase: 'idle', progress: null, location };
}

/** Honest, template-based lines built from the resident's real state; there is no free-form AI dialogue. */
export function interactionLine(topic: PlayerSocialTopic, citizen: Citizen | undefined, world: WorldState): string {
  if (!citizen) return 'You chatted for a moment.';
  const { building } = lookup(world);
  const first = citizen.name.split(' ')[0] ?? citizen.name;
  const home = building(citizen.homeBuildingId)?.name;
  const work = building(citizen.workBuildingId)?.name;
  const destination = building(citizen.movement?.destinationBuildingId ?? citizen.targetBuildingId)?.name;
  switch (topic) {
    case 'introduction': return `You met ${citizen.name}. “Hi! I live at ${home ?? 'nearby'}${work ? ` and work at ${work}` : ''}.”`;
    case 'commute': return `${first} is on the way${destination ? ` to ${destination}` : ''}. “Can’t stop long — see you around!”`;
    case 'leisure': return `${first} is relaxing${destination ? ` at ${destination}` : ''}. “Perfect weather for it.”`;
    case 'rest': return `${first} is taking it easy near ${home ?? 'home'}. “Quiet day today.”`;
    case 'neighbourhood': return `You caught up with ${first}${work ? `, who works at ${work}` : ''}.`;
  }
}

export type LogTone = 'good' | 'info' | 'warn';
export interface PlayerLogEntry { readonly id: number; readonly tone: LogTone; readonly icon: string; readonly text: string; readonly time: string }
export interface PlayerLogState { readonly entries: readonly PlayerLogEntry[]; readonly nextId: number }
export const emptyPlayerLog: PlayerLogState = { entries: [], nextId: 1 };
const MAX_LOG = 8;

/** Folds player events into a short diary, newest first. Returns the same object when nothing changed. */
export function reducePlayerLog(state: PlayerLogState, events: readonly SimulationEvent[], world: WorldState): PlayerLogState {
  if (!world.player && !events.some((e) => e.type === 'player.home-lost')) return state;
  const { building, citizen } = lookup(world);
  const time = formatMinute(getGameTime(world.clock).minuteOfDay);
  const added: Omit<PlayerLogEntry, 'id' | 'time'>[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'player.created': added.push(e.player.homeBuildingId
        ? { tone: 'good', icon: 'home', text: `${e.player.name} moved into ${building(e.player.homeBuildingId)?.name ?? 'a new home'}.` }
        : { tone: 'info', icon: 'person', text: `${e.player.name} is ready to move in.` }); break;
      case 'player.moved-in': added.push({ tone: 'good', icon: 'home', text: `Moved into ${building(e.homeBuildingId)?.name ?? 'a new home'}.` }); break;
      case 'player.home-lost': added.push({ tone: 'warn', icon: 'warning', text: 'Your home was removed. Choose a new one to rest and eat.' }); break;
      case 'player.relocated': added.push({ tone: e.stranded ? 'warn' : 'info', icon: 'pin', text: e.stranded ? 'The road under you was removed and none is nearby.' : e.reason === 'building-moved' ? 'You moved along with the building.' : 'You stepped onto the nearest road.' }); break;
      case 'player.interaction': added.push({ tone: 'good', icon: 'people', text: interactionLine(e.topic, citizen(e.citizenId), world) }); break;
      case 'player.activity-ended': {
        const o = e.outcome;
        if (o.kind === 'move' && o.result === 'completed') break;
        const who = o.citizenId ? citizen(o.citizenId)?.name : undefined;
        const where = building(o.buildingId)?.name;
        if (o.result === 'completed') added.push({ tone: 'good', icon: 'check', text: `${pastTense[o.kind]}${who ? ` with ${who}` : o.kind === 'visit' && where ? ` at ${where}` : ''}.` });
        else if (o.result === 'failed') added.push({ tone: 'warn', icon: 'warning', text: `${activityNames[o.kind]} stopped: ${o.reason ? failureText[o.reason] : 'it could not continue'}${o.elapsedMinutes > 0 ? ` (after ${Math.floor(o.elapsedMinutes)} min)` : ''}.` });
        else if (o.kind !== 'move') added.push({ tone: 'info', icon: 'close', text: `${activityNames[o.kind]} cancelled${o.elapsedMinutes > 0 ? ` after ${Math.floor(o.elapsedMinutes)} min` : ''}.` });
        break;
      }
      case 'player.need-changed':
        if (e.level === 'low' || e.level === 'critical') added.push({ tone: 'warn', icon: 'warning', text: `${NEED_LABELS[e.need]}: ${needWord(e.need, e.level).toLowerCase()}. ${needAdvice(e.need)}` });
        break;
      default: break;
    }
  }
  if (!added.length) return state;
  let nextId = state.nextId;
  const fresh = added.reverse().map((entry) => ({ ...entry, id: nextId++, time }));
  return { entries: [...fresh, ...state.entries].slice(0, MAX_LOG), nextId };
}

export function needAdvice(need: PlayerNeed): string {
  switch (need) {
    case 'energy': return 'Rest at home.';
    case 'hunger': return 'Eat at home.';
    case 'social': return 'Greet a resident or visit a park.';
    case 'mood': return 'Look after your other needs.';
  }
}

export const ACTIVITY_MINUTES = Object.fromEntries(Object.entries(PLAYER_BALANCE.activities).map(([k, v]) => [k, v.minutes])) as Record<'rest' | 'eat' | 'visit' | 'greet' | 'socialize', number>;

export function isLeisure(building: Building | undefined): boolean {
  return !!building && (building.kind === 'park' || building.type === 'clubhouse');
}
