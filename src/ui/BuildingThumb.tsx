import type { BuildingKind } from '../types';

type Palette = { wall: string; side: string; roof: string; accent?: string };
const palettes: Record<BuildingKind, Palette> = {
  villa: { wall: '#f1e3c6', side: '#d9c6a2', roof: '#c8714f' },
  duplex: { wall: '#e9d7b4', side: '#cdb790', roof: '#b45f45' },
  townhouse: { wall: '#e3cfae', side: '#c8b28d', roof: '#9c5a46' },
  apartment: { wall: '#dfe3d6', side: '#c4cabc', roof: '#c9cdbf', accent: '#8fbcc0' },
  park: { wall: '#8dbb76', side: '#6e8f5f', roof: '#3e7a56', accent: '#6fb6bf' },
  clubhouse: { wall: '#eedcbc', side: '#d3bf9b', roof: '#c8714f' },
  pool: { wall: '#eee2c6', side: '#d8ccb0', roof: '#4fb3c2' },
  mall: { wall: '#e9e2d2', side: '#cfc7b4', roof: '#d8d4c6', accent: '#7fb7bb' },
  office: { wall: '#c9d6d8', side: '#a9babd', roof: '#aebfc3', accent: '#5d93a6' },
};
const heights: Record<BuildingKind, number> = { villa: 10, duplex: 12, townhouse: 15, apartment: 22, park: 3, clubhouse: 11, pool: 3, mall: 11, office: 27 };

/** Tiny isometric glyph echoing the in-world art, used on catalog cards. */
export function BuildingThumb({ kind }: { kind: BuildingKind }) {
  const p = palettes[kind];
  const h = heights[kind];
  const base = 40;
  const pitched = kind === 'villa' || kind === 'duplex' || kind === 'townhouse';
  const flat = kind === 'park' || kind === 'pool';
  const left = `M8 ${base - 8} L24 ${base} L24 ${base - h} L8 ${base - 8 - h} Z`;
  const right = `M24 ${base} L40 ${base - 8} L40 ${base - 8 - h} L24 ${base - h} Z`;
  const top = `M8 ${base - 8 - h} L24 ${base - 16 - h} L40 ${base - 8 - h} L24 ${base - h} Z`;
  return <svg className="building-thumb" viewBox="0 0 48 48" aria-hidden="true">
    <ellipse cx="24" cy={base - 2} rx="19" ry="6" fill="#2a3d30" opacity=".12" />
    <path d={left} fill={p.wall} /><path d={right} fill={p.side} />
    {pitched
      ? <><path d={`M8 ${base - 8 - h} L24 ${base - h} L24 ${base - h - 12} Z`} fill={p.roof} />
        <path d={`M24 ${base - h} L40 ${base - 8 - h} L24 ${base - h - 12} Z`} fill={p.roof} opacity=".78" />
        <path d={`M8 ${base - 8 - h} L24 ${base - 16 - h} L24 ${base - h - 12} Z`} fill={p.roof} opacity=".92" /></>
      : <path d={top} fill={p.roof} />}
    {!flat && !pitched && p.accent && Array.from({ length: Math.max(1, Math.floor(h / 6)) }, (_, i) =>
      <path key={i} d={`M11 ${base - 10 - i * 6} L22 ${base - 4 - i * 6} L22 ${base - 7 - i * 6} L11 ${base - 13 - i * 6} Z`} fill={p.accent} />)}
    {pitched && <><path d={`M11 ${base - 9 - h / 2} L14 ${base - 7.5 - h / 2} L14 ${base - 11.5 - h / 2} L11 ${base - 13 - h / 2} Z`} fill="#9fc9c6" />
      <path d={`M17 ${base - 3} L21 ${base - 1} L21 ${base - 8} L17 ${base - 10} Z`} fill="#8a6248" /></>}
    {kind === 'park' && <><circle cx="18" cy={base - 18} r="5" fill="#3e7a56" /><circle cx="29" cy={base - 15} r="4" fill="#4f8d61" />
      <ellipse cx="27" cy={base - 9} rx="5" ry="2.2" fill={p.accent} /></>}
    {kind === 'pool' && <path d={`M14 ${base - 11} L24 ${base - 16} L34 ${base - 11} L24 ${base - 6} Z`} fill="#4fb3c2" stroke="#f7f2e2" strokeWidth="1" />}
    {kind === 'clubhouse' && <path d={`M8 ${base - 8 - h - 5} L24 ${base - 16 - h - 5} L40 ${base - 8 - h - 5} L24 ${base - h - 5} Z`} fill="none" stroke={p.roof} strokeWidth="1.6" />}
    {kind === 'mall' && <path d={`M10 ${base - 13} L22 ${base - 7} L22 ${base - 10} L10 ${base - 16} Z`} fill="#c8714f" />}
  </svg>;
}
