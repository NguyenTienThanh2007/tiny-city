import { BUILDING_CATALOG } from '@tiny-city/simulation';
import type { BuildingType, Position } from '@tiny-city/simulation';
import type { ArchitectIntent, BuildDesignRequest, MoveTarget, TargetRelative, TargetSelector } from './contracts.js';
import { architectureCollection, architectureModel, findArchitectureMentions } from './architecture.js';

const GENERIC_MODERN = /(hiện đại|đương đại)|\b(modern|contemporary)\b/u;

/**
 * Deterministic offline interpreter for common Vietnamese and English city commands. Used by the explicit
 * `local` provider mode (and tests) so ordinary development and CI never need paid AI calls. It only extracts
 * structured intent; target resolution, legality, cost and housing stay in the deterministic planner.
 * Anything it does not understand is reported, never replaced with a guess.
 */

const ALIASES: readonly (readonly [string, BuildingType])[] = ([
  ['trung tâm thương mại', 'mall'], ['shopping mall', 'mall'], ['siêu thị', 'mall'], ['malls', 'mall'], ['mall', 'mall'],
  ['tòa văn phòng', 'office'], ['cao ốc', 'office'], ['văn phòng', 'office'], ['office towers', 'office'], ['office tower', 'office'], ['offices', 'office'], ['office', 'office'],
  ['tòa chung cư', 'apartment'], ['chung cư', 'apartment'], ['căn hộ', 'apartment'], ['apartment buildings', 'apartment'], ['apartment building', 'apartment'], ['apartments', 'apartment'], ['apartment', 'apartment'], ['flats', 'apartment'],
  ['biệt thự', 'villa'], ['villas', 'villa'], ['villa', 'villa'],
  ['nhà song lập', 'duplex'], ['song lập', 'duplex'], ['semi-detached homes', 'duplex'], ['semi-detached home', 'duplex'], ['duplexes', 'duplex'], ['duplex', 'duplex'],
  ['nhà phố', 'townhouse'], ['townhouses', 'townhouse'], ['townhouse', 'townhouse'],
  ['công viên', 'park'], ['parks', 'park'], ['park', 'park'],
  ['nhà câu lạc bộ', 'clubhouse'], ['câu lạc bộ', 'clubhouse'], ['clubhouses', 'clubhouse'], ['clubhouse', 'clubhouse'],
  ['hồ bơi', 'pool'], ['bể bơi', 'pool'], ['swimming pools', 'pool'], ['swimming pool', 'pool'], ['pools', 'pool'], ['pool', 'pool'],
] as const).slice().sort((a, b) => b[0].length - a[0].length);
/** "A residential area" without building types: one apartment building (Phase 5). */
const DISTRICT = /(khu dân cư|khu nhà ở|khu ở)|\b(residential (area|district|neighbou?rhood|quarter)|housing (area|district|estate))\b/u;
/** "…with enough jobs": add office towers until the new homes' residents could all be employed (Phase 5). */
const ENOUGH_JOBS = /((có )?đủ (việc làm|chỗ làm|công việc)|kèm (việc làm|chỗ làm))|\b((with )?enough jobs|jobs for (everyone|all|them|its residents|the residents)|with (its own )?jobs)\b/u;
const PLURAL_EN = new Set(['malls', 'offices', 'office towers', 'apartments', 'apartment buildings', 'flats', 'villas', 'duplexes', 'semi-detached homes', 'townhouses', 'parks', 'clubhouses', 'pools', 'swimming pools']);
const UNSUPPORTED = ['bệnh viện', 'hospital', 'trường học', 'school', 'nhà máy', 'factory', 'sân bay', 'airport', 'cây cầu', 'bridge', 'nhà ga', 'station', 'khách sạn', 'hotel', 'sân vận động', 'stadium'];
const NUMBERS: Record<string, number> = {
  một: 1, hai: 2, ba: 3, bốn: 4, tư: 4, năm: 5, sáu: 6, bảy: 7, tám: 8, chín: 9, mười: 10, 'mười một': 11, 'mười hai': 12, 'mười lăm': 15, 'hai mươi': 20,
  a: 1, an: 1, one: 1, single: 1, two: 2, both: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const ALL = ['tất cả', 'toàn bộ', 'mọi', 'hết', 'all', 'every', 'each'];
const FILLERS = ['căn', 'tòa', 'toà', 'ngôi', 'cái', 'khu', 'các', 'những', 'mới', 'the', 'new', 'more', 'of', 'nữa'];
// Vietnamese words use Unicode letter boundaries (JS \b only understands ASCII letters).
const L = '(?<![\\p{L}])', R = '(?![\\p{L}])';
const VERBS: readonly (readonly [RegExp, Verb])[] = [
  [new RegExp(`${L}(giữ nguyên|giữ lại|giữ|bảo tồn|không phá|preserve|keep|protect)${R}`, 'gu'), 'preserve'],
  [new RegExp(`${L}(di chuyển|dời|move|relocate)${R}`, 'gu'), 'move'],
  [new RegExp(`${L}(phá bỏ|phá dỡ|phá|dỡ bỏ|xóa bỏ|xoá bỏ|xóa|xoá|demolish|remove|tear down|delete|destroy|knock down|bulldoze)${R}`, 'gu'), 'demolish'],
  [new RegExp(`${L}(xây dựng|xây|thêm|tạo|build|add|create|construct|place)${R}`, 'gu'), 'build'],
];
/** Splits a clause at every verb so "phá chung cư và xây biệt thự" becomes two actions in order. */
function verbSegments(clause: string): { verb: Verb | null; text: string }[] {
  const hits: { at: number; verb: Verb }[] = [];
  for (const [pattern, verb] of VERBS) for (const m of clause.matchAll(pattern)) hits.push({ at: m.index!, verb });
  hits.sort((a, b) => a.at - b.at);
  // "không phá" is preserve, not demolish: drop a verb that starts inside an earlier, longer match.
  const kept = hits.filter((h, i) => !hits.slice(0, i).some((p) => p.verb === 'preserve' && h.at > p.at && h.at <= p.at + 9 && h.verb === 'demolish'));
  if (!kept.length) return [{ verb: null, text: clause }];
  const segments: { verb: Verb | null; text: string }[] = [];
  if (kept[0]!.at > 0 && clause.slice(0, kept[0]!.at).trim()) segments.push({ verb: null, text: clause.slice(0, kept[0]!.at) });
  kept.forEach((h, i) => segments.push({ verb: h.verb, text: clause.slice(h.at, kept[i + 1]?.at ?? clause.length) }));
  return segments;
}
type Verb = 'build' | 'demolish' | 'move' | 'preserve';

const has = (text: string, words: readonly string[]) => words.some((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(text));
function relativeOf(text: string): TargetRelative | null {
  if (/(bên trái|phía trái|góc trái|\btrái\b)|\b(left|leftmost|western)\b/u.test(text)) return 'left';
  if (/(bên phải|phía phải|góc phải|\bphải\b)|\b(right|rightmost|eastern)\b/u.test(text)) return 'right';
  if (/(phía trên|phía sau|phía bắc|bên trên)|\b(top|back|north|northern|upper)\b/u.test(text)) return 'back';
  if (/(phía dưới|phía trước|phía nam|bên dưới)|\b(bottom|front|south|southern|lower)\b/u.test(text)) return 'front';
  return null;
}
function nearOf(text: string): ArchitectIntent['near'] | null {
  if (/(gần|cạnh|bên cạnh|quanh|xung quanh) (các |những )?công viên|\b(near|next to|around|beside|by) (the |a )?parks?\b/u.test(text)) return 'park';
  if (/(gần|cạnh|bên cạnh|sát|ven) (các |những )?(con )?đường|\b(near|next to|beside|along|by) (the |a )?(main )?roads?\b|\broadside\b/u.test(text)) return 'road';
  if (/(trung tâm|ở giữa)|\b(center|centre|middle|downtown)\b/u.test(text)) return 'center';
  return null;
}
function quantityBefore(text: string, index: number): number | 'all' | null {
  let words = text.slice(0, index).trim().split(/\s+/).filter(Boolean);
  while (words.length && FILLERS.includes(words.at(-1)!)) words = words.slice(0, -1);
  const last = words.at(-1) ?? '', two = words.slice(-2).join(' ');
  if (/^\d+$/.test(last)) return Number(last);
  if (two in NUMBERS) return NUMBERS[two]!;
  if (last in NUMBERS) return NUMBERS[last]!;
  if (ALL.includes(last) || ALL.includes(two)) return 'all';
  return null;
}
const point = (match: RegExpMatchArray): Position => ({ x: Number(match[1]), y: Number(match[2]) });
const NAMES_VI: Record<BuildingType, string> = { villa: 'biệt thự', duplex: 'nhà song lập', townhouse: 'nhà phố', apartment: 'chung cư', park: 'công viên', clubhouse: 'câu lạc bộ', pool: 'hồ bơi', mall: 'trung tâm thương mại', office: 'văn phòng' };
const NAMES_EN: Record<BuildingType, [string, string]> = { villa: ['villa', 'villas'], duplex: ['duplex', 'duplexes'], townhouse: ['townhouse', 'townhouses'], apartment: ['apartment building', 'apartment buildings'],
  park: ['park', 'parks'], clubhouse: ['clubhouse', 'clubhouses'], pool: ['pool', 'pools'], mall: ['mall', 'malls'], office: ['office tower', 'office towers'] };

export interface InterpretContext { readonly buildings?: readonly { readonly id: string; readonly name: string }[] }

export function interpretLocally(prompt: string, context: InterpretContext = {}): ArchitectIntent {
  const text = prompt.normalize('NFC').toLowerCase().replace(/[“”"!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const vi = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/u.test(text);
  const intent: ArchitectIntent = { summary: '', language: vi ? 'vi' : 'en', style: 'compact', near: 'existing', region: null, budgetLimit: null,
    connectRoads: true, builds: [], moves: [], demolish: [], roadAdd: [], roadRemove: [], preserveBuildingIds: [], unsupportedRequests: [], ambiguities: [],
    demolishTargets: [], moveTargets: [], preserveRoads: false, preserveTypes: [] };
  const names = [...(context.buildings ?? [])].sort((a, b) => b.name.length - a.name.length);
  const label = (type: BuildingType, count: number | 'all' | null) => vi ? NAMES_VI[type] : NAMES_EN[type][count === 1 || count === null ? 0 : 1];
  const clauses = text.split(/[;.]|,(?!\s*\d)|\b(?:but|then|and then|after that)\b|\b(?:nhưng|rồi|sau đó)\b/u).map((c) => c.trim()).filter(Boolean);
  let verb: Verb | null = null;
  const summary: string[] = [];
  for (const segment of clauses.flatMap(verbSegments)) {
    const raw = segment.text.trim();
    if (segment.verb) verb = segment.verb;
    let clause = raw;
    // Roads by tile coordinates: "road at 30,20" / "đường tại 30,20".
    for (const m of clause.matchAll(/(?:đường|road)s?\s*(?:at|tại|ở)\s*(\d+)\s*,\s*(\d+)/gu)) {
      if (verb === 'demolish') intent.roadRemove.push(point(m)); else intent.roadAdd.push(point(m));
    }
    const mentionsRoad = /(con đường|đường|\broads?\b|\bstreets?\b)/u.test(clause) && !/(gần|cạnh|sát|ven|near|next to|beside|along|by) (the |a |các |những |con )?(main )?(đường|roads?)/u.test(clause);
    if (verb === 'preserve' && mentionsRoad) { intent.preserveRoads = true; summary.push(vi ? 'giữ nguyên đường' : 'keep the roads'); }
    else if ((verb === 'build') && mentionsRoad && /(kết nối|nối|connect|link)/u.test(clause)) { intent.connectRoads = true; summary.push(vi ? 'nối đường' : 'connect roads'); }
    else if (verb === 'demolish' && mentionsRoad && !intent.roadRemove.length && !ALIASES.some(([alias]) => clause.includes(alias))) {
      intent.unsupportedRequests.push(vi ? 'Xóa đường cần tọa độ ô cụ thể (ví dụ "xóa đường tại 30,20") hoặc dùng công cụ Phá dỡ.' : 'Removing roads needs exact tiles (e.g. "remove road at 30,20") or the Bulldoze tool.');
    }
    const near = nearOf(clause);
    if (near && verb === 'build') intent.near = near;
    // Named buildings from the city context ("Villa 03", "Garden Clubhouse").
    const named: string[] = [];
    for (const b of names) {
      const at = clause.indexOf(b.name.toLowerCase());
      if (at >= 0) { named.push(b.id); clause = clause.slice(0, at) + ' '.repeat(b.name.length) + clause.slice(at + b.name.length); }
    }
    const mentions: { type: BuildingType; quantity: number | 'all' | null; plural: boolean; at: number }[] = [];
    let scan = clause;
    for (const [alias, type] of ALIASES) {
      let at = scan.indexOf(alias);
      while (at >= 0) {
        const before = at === 0 || !/\p{L}/u.test(scan[at - 1]!), after = at + alias.length >= scan.length || !/\p{L}/u.test(scan[at + alias.length]!);
        if (before && after) {
          // Skip "gần công viên" style location phrases: they are not targets or builds.
          const locative = /(gần|cạnh|bên cạnh|quanh|xung quanh|near|next to|around|beside|by)\s+(the\s+|a\s+|các\s+|những\s+)?$/u.test(scan.slice(0, at));
          if (!locative) mentions.push({ type, quantity: quantityBefore(scan, at), plural: PLURAL_EN.has(alias), at });
          scan = scan.slice(0, at) + ' '.repeat(alias.length) + scan.slice(at + alias.length);
        }
        at = scan.indexOf(alias, at + 1);
      }
    }
    mentions.sort((a, b) => a.at - b.at);
    for (const word of UNSUPPORTED) if (has(clause, [word])) intent.unsupportedRequests.push(vi ? `“${word}” không có trong danh mục công trình.` : `“${word}” is not in the building catalog.`);
    const relative = relativeOf(clause);
    const selector = (type: BuildingType | null, quantity: number | 'all' | null, plural: boolean, ids: string[] = []): TargetSelector => ({
      buildingType: type, ids, all: quantity === 'all' || (quantity === null && plural && !ids.length), relative: ids.length ? null : relative,
      quantity: typeof quantity === 'number' ? Math.max(1, Math.min(32, quantity)) : 1,
    });
    if (verb === 'build') {
      // Visual World 3.1: named collections and models in this clause. A model applies to builds of its type, a
      // collection to every build; a generic "modern"/"hiện đại" means the Luxury Minimalist collection (said so in
      // the summary). The planner validates everything and refuses, never substitutes, unknown models.
      const arch = findArchitectureMentions(raw);
      const models = arch.filter((a) => a.model);
      const style = arch.find((a) => !a.model)?.collection ?? (!arch.length && GENERIC_MODERN.test(raw) ? 'luxury-minimalist' : null);
      if (style && !arch.length) summary.push(vi ? 'phong cách hiện đại = Luxury Minimalist' : 'modern style = Luxury Minimalist');
      const designFor = (type: BuildingType): BuildDesignRequest | null => {
        const model = models.find((a) => a.model!.buildingType === type)?.model;
        return model ? { collection: model.collection, model: model.id } : style ? { collection: style, model: null } : null;
      };
      // "three Glass Pavilion Villas" / "5 Luxury Minimalist villas": the count stands before the style phrase that
      // contains or directly precedes the building word.
      const countOf = (m: typeof mentions[number]) => {
        if (m.quantity !== null) return m.quantity;
        const phrase = arch.find((a) => a.at <= m.at && a.at + a.phrase.length >= m.at - 1);
        return phrase ? quantityBefore(clause, phrase.at) : null;
      };
      const builds: { type: BuildingType; quantity: number | 'all' | null; design: BuildDesignRequest | null }[] = mentions.map((m) => ({ type: m.type, quantity: countOf(m), design: designFor(m.type) }));
      // A model named without its building word ("a Premium Glass Residence") is a build of that model's type.
      for (const a of models) if (!mentions.some((m) => m.type === a.model!.buildingType)) builds.push({ type: a.model!.buildingType, quantity: quantityBefore(raw, a.at), design: { collection: a.model!.collection, model: a.model!.id } });
      if (arch.length && !builds.length) intent.ambiguities.push(vi ? 'Hãy nêu số lượng và loại công trình cho phong cách đã chọn (ví dụ “xây 3 biệt thự Luxury Minimalist”).' : 'Name how many of which buildings to build in that style (e.g. “build 3 Luxury Minimalist villas”).');
      // Phase 5: a residential area, and homes "with enough jobs", in terms the planner already validates.
      if (DISTRICT.test(raw) && !builds.some((m) => BUILDING_CATALOG[m.type].kind === 'home')) {
        builds.push({ type: 'apartment', quantity: 1, design: designFor('apartment') });
        summary.push(vi ? 'khu dân cư = 1 chung cư' : 'residential area = 1 apartment building');
      }
      if (ENOUGH_JOBS.test(raw) && !builds.some((m) => m.type === 'office' || m.type === 'mall')) {
        const rooms = builds.reduce((sum, m) => sum + (BUILDING_CATALOG[m.type].kind === 'home' && typeof m.quantity !== 'string' ? BUILDING_CATALOG[m.type].capacity * (m.quantity ?? 1) : 0), 0);
        const offices = Math.ceil(rooms / BUILDING_CATALOG.office.capacity);
        if (offices > 0) {
          builds.push({ type: 'office', quantity: offices, design: designFor('office') });
          summary.push(vi ? `đủ việc làm = ${offices} văn phòng cho ${rooms} cư dân mới` : `enough jobs = ${offices} office tower${offices === 1 ? '' : 's'} for ${rooms} new residents`);
        }
      }
      for (const m of builds) {
        if (m.quantity === 'all') { intent.ambiguities.push(vi ? 'Không rõ cần xây bao nhiêu công trình.' : 'It is unclear how many buildings to build.'); continue; }
        const quantity = m.quantity ?? 1;
        intent.builds.push({ buildingType: m.type, quantity: Math.min(32, quantity), preferredPosition: null, ...(m.design ? { design: m.design } : {}) });
        if (quantity > 32) intent.unsupportedRequests.push(vi ? 'Mỗi kế hoạch xây tối đa 32 công trình.' : 'A plan can build at most 32 buildings.');
        const look = m.design?.model ? architectureModel(m.design.model)!.name : m.design?.collection ? architectureCollection(m.design.collection)!.name : null;
        summary.push(`${vi ? 'xây' : 'build'} ${quantity} ${label(m.type, quantity)}${look ? ` (${look})` : ''}`);
      }
    } else if (verb === 'demolish') {
      if (named.length) { intent.demolishTargets.push(selector(null, null, false, named)); summary.push(`${vi ? 'phá' : 'demolish'} ${named.join(', ')}`); }
      const side: Record<TargetRelative, [string, string]> = { left: ['bên trái', 'on the left'], right: ['bên phải', 'on the right'], back: ['phía trên', 'at the back'], front: ['phía dưới', 'at the front'] };
      for (const m of mentions) { intent.demolishTargets.push(selector(m.type, m.quantity, m.plural)); summary.push(`${vi ? 'phá' : 'demolish'} ${m.quantity === 'all' ? (vi ? 'tất cả' : 'all') : m.quantity ?? 1} ${label(m.type, m.quantity === 'all' ? 2 : m.quantity)}${relative ? ` ${side[relative][vi ? 0 : 1]}` : ''}`); }
    } else if (verb === 'move') {
      const destination: MoveTarget['near'] = near ?? 'existing';
      const targets = named.length ? [selector(null, null, false, named)] : mentions.slice(0, 1).map((m) => selector(m.type, m.quantity, m.plural));
      for (const target of targets) { intent.moveTargets.push({ target, near: destination, position: null }); summary.push(`${vi ? 'di chuyển' : 'move'} ${target.ids.join(', ') || (target.buildingType ? label(target.buildingType, 1) : '')}${destination === 'road' ? (vi ? ' đến lô trống gần đường' : ' to an empty lot by a road') : ''}`); }
    } else if (verb === 'preserve') {
      intent.preserveBuildingIds.push(...named);
      for (const m of mentions) if (!intent.preserveTypes.includes(m.type)) intent.preserveTypes.push(m.type);
      if (named.length || mentions.length) summary.push(vi ? 'giữ nguyên công trình được chỉ định' : 'keep the named buildings');
    } else if (mentions.length || named.length) {
      intent.ambiguities.push(vi ? `Không rõ cần làm gì với: “${raw}”.` : `It is unclear what to do with: “${raw}”.`);
    }
  }
  const actions = intent.builds.length + intent.demolishTargets.length + intent.moveTargets.length + intent.roadAdd.length + intent.roadRemove.length;
  if (!actions && !intent.unsupportedRequests.length && !intent.ambiguities.length) {
    intent.ambiguities.push(vi ? 'Không hiểu yêu cầu. Hãy nêu hành động (xây, phá, di chuyển) và loại công trình.' : 'I could not understand the request. Name an action (build, demolish, move) and a building type.');
  }
  intent.summary = `${vi ? 'Trình diễn giải ngoại tuyến' : 'Offline rules interpreter'}: ${summary.join('; ') || (vi ? 'không có thay đổi rõ ràng' : 'no clear change')}`.slice(0, 512);
  intent.unsupportedRequests = [...new Set(intent.unsupportedRequests)].slice(0, 32);
  intent.ambiguities = [...new Set(intent.ambiguities)].slice(0, 32);
  return intent;
}
