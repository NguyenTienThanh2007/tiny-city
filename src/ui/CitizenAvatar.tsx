import { citizenAppearance, toCss } from '../game/npcMotion';

/** Portrait drawn from the same stable appearance seed as the resident's map sprite. */
export function CitizenAvatar({ citizenId, size = 56 }: { citizenId: string; size?: number }) {
  const look = citizenAppearance(citizenId);
  const hair = toCss(look.hairStyle === 'cap' ? 0xc8714f : look.hair);
  const skin = toCss(look.skin);
  const shirt = toCss(look.shirt);
  return <svg className="citizen-avatar" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id={`sky-${citizenId}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#cfe5df" /><stop offset="1" stopColor="#f3e8cf" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="18" fill={`url(#sky-${citizenId})`} />
    {look.hairStyle === 'long' && <path d="M19 30c0-11 6-17 13-17s13 6 13 17v14H19Z" fill={hair} />}
    <path d={look.silhouette === 'dress' ? 'M14 64c2-13 9-19 18-19s16 6 18 19Z' : 'M12 64c1-12 9-18 20-18s19 6 20 18Z'} fill={shirt} />
    {look.silhouette === 'jacket' && <path d="M31 46h2v18h-2z" fill="#f6f0e2" />}
    {look.accessory === 'scarf' && <path d="M22 46c4 3 16 3 20 0l1 4c-5 3-17 3-22 0Z" fill={look.shirt === 0xe0c27a ? '#5fa7a8' : '#e0c27a'} />}
    <rect x="28" y="38" width="8" height="9" rx="3" fill={skin} opacity=".9" />
    <circle cx="32" cy="29" r="12" fill={skin} />
    <circle cx="27.5" cy="30" r="1.5" fill="#2a2420" /><circle cx="36.5" cy="30" r="1.5" fill="#2a2420" />
    <path d="M28.5 35.5c2 1.6 5 1.6 7 0" stroke="#7d4c32" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    <ellipse cx="24" cy="34" rx="2.2" ry="1.3" fill="#e58f7a" opacity=".45" /><ellipse cx="40" cy="34" rx="2.2" ry="1.3" fill="#e58f7a" opacity=".45" />
    {look.hairStyle === 'cap'
      ? <><path d="M19.5 26a12.5 12.5 0 0 1 25 0Z" fill={hair} /><rect x="31" y="23.5" width="17" height="4" rx="2" fill="#a65a3d" /></>
      : <path d="M20 28c0-9 5.5-13.5 12-13.5S44 19 44 28c-4-1-8-4.5-9.5-7.5C32 24 26 27 20 28Z" fill={hair} />}
    {look.hairStyle === 'bun' && <circle cx="32" cy="13" r="5" fill={hair} />}
  </svg>;
}
