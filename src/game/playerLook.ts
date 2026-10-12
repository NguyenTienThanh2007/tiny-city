import type { PlayerAppearance } from '@tiny-city/simulation';

/**
 * One description of the player character, drawn by both the Pixi world layer and the React/SVG creator, portrait and
 * HUD. Shapes are in local units with the feet at (0, 0), so every view shows exactly the same person.
 */

export const SKIN_TONES = [0xf6d7bd, 0xeec19b, 0xd9a174, 0xb87a50, 0x8c5a3a, 0x5e3b26] as const;
export const HAIR_COLORS = [0x2b1f1a, 0x5a3a28, 0x8a5a34, 0xc58b4a, 0xe3c27a, 0xb14a3a, 0x9a9a96, 0x3f5d7a] as const;
export const OUTFIT_COLORS = [0xc8714f, 0x5fa7a8, 0x7f9f6f, 0xd5a33f, 0x3f5d7a, 0xe58f7a, 0x9a88b8, 0x4f7f62, 0xefe6d2, 0xa2475e] as const;

export const SKIN_TONE_NAMES = ['Porcelain', 'Light', 'Honey', 'Tan', 'Brown', 'Deep'] as const;
export const HAIR_COLOR_NAMES = ['Black', 'Brown', 'Chestnut', 'Caramel', 'Blonde', 'Auburn', 'Silver', 'Ink blue'] as const;
export const OUTFIT_COLOR_NAMES = ['Terracotta', 'Sea glass', 'Sage', 'Mustard', 'Harbor blue', 'Coral', 'Lavender', 'Forest', 'Cream', 'Berry'] as const;
export const HAIR_STYLE_NAMES = { short: 'Short', long: 'Long', bun: 'Bun', curly: 'Curly', cap: 'Cap', buzz: 'Buzz cut' } as const;
export const OUTFIT_NAMES = { tee: 'T-shirt', dress: 'Sundress', jacket: 'Jacket', overalls: 'Overalls', hoodie: 'Hoodie' } as const;
export const ACCESSORY_NAMES = { none: 'None', glasses: 'Glasses', backpack: 'Backpack', scarf: 'Scarf', sunhat: 'Sun hat' } as const;

export const DEFAULT_APPEARANCE: PlayerAppearance = { skinTone: 1, hairStyle: 'short', hairColor: 1, outfit: 'tee', outfitColor: 0, accessory: 'none' };

export type Shape =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number; readonly fill: number; readonly alpha?: number }
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number; readonly fill: number; readonly alpha?: number }
  | { readonly kind: 'ellipse'; readonly x: number; readonly y: number; readonly rx: number; readonly ry: number; readonly fill: number; readonly alpha?: number }
  | { readonly kind: 'poly'; readonly points: readonly number[]; readonly fill: number; readonly alpha?: number }
  | { readonly kind: 'line'; readonly points: readonly number[]; readonly color: number; readonly width: number; readonly alpha?: number };

/** Figure parts. Legs rotate around their pivot; face and front hair hide when walking away from the camera. */
export interface PlayerFigure {
  readonly shadow: readonly Shape[];
  readonly back: readonly Shape[];
  readonly legLeft: readonly Shape[];
  readonly legRight: readonly Shape[];
  readonly legPivot: { readonly left: readonly [number, number]; readonly right: readonly [number, number] };
  readonly body: readonly Shape[];
  readonly head: readonly Shape[];
  readonly face: readonly Shape[];
  readonly hairBack: readonly Shape[];
  readonly hairFront: readonly Shape[];
  readonly hairAway: readonly Shape[];
  readonly front: readonly Shape[];
  readonly colors: { readonly skin: number; readonly hair: number; readonly outfit: number };
}

export function shade(color: number, amount: number): number {
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 0xff) * amount)));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
export function mix(a: number, b: number, t: number): number {
  const channel = (shift: number) => Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
export const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 14): number[] {
  const points: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + (to - from) * (i / steps);
    points.push(Math.round((cx + Math.cos(a) * rx) * 100) / 100, Math.round((cy + Math.sin(a) * ry) * 100) / 100);
  }
  return points;
}

const HEAD_Y = -18.6, HEAD_R = 4.6;
const INK = 0x2a2420;

export function playerFigure(look: PlayerAppearance): PlayerFigure {
  const skin = SKIN_TONES[look.skinTone] ?? SKIN_TONES[0];
  const hair = HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0];
  const outfit = OUTFIT_COLORS[look.outfitColor] ?? OUTFIT_COLORS[0];
  const dark = shade(outfit, 0.78);
  const light = mix(outfit, 0xffffff, 0.22);
  const cream = 0xf4ecdc;
  const denim = 0x3d4f66;
  const back: Shape[] = [], body: Shape[] = [], front: Shape[] = [];

  // Legs: trousers, bare legs under a dress, overalls in the outfit color.
  const legColor = look.outfit === 'dress' ? skin : look.outfit === 'overalls' ? outfit : look.outfit === 'jacket' ? 0x4a4440 : denim;
  const shoe = look.outfit === 'dress' ? 0xc8714f : 0xf3efe6;
  const leg = (): Shape[] => [
    { kind: 'rect', x: -1.05, y: 0, w: 2.1, h: 6.3, r: 1, fill: legColor },
    { kind: 'rect', x: -1.35, y: 5.3, w: 2.9, h: 1.55, r: 0.75, fill: shoe },
    { kind: 'rect', x: -1.35, y: 6.35, w: 2.9, h: 0.5, r: 0.25, fill: shade(shoe, 0.7) },
  ];

  // Backpack and hood sit behind the torso.
  if (look.accessory === 'backpack') back.push({ kind: 'rect', x: -4.4, y: -14.2, w: 8.8, h: 7.6, r: 2.4, fill: 0x8a6f52 }, { kind: 'rect', x: -3.4, y: -9.6, w: 6.8, h: 2.6, r: 1.2, fill: 0x6f5841 });
  if (look.outfit === 'hoodie') back.push({ kind: 'ellipse', x: 0, y: -14.6, rx: 4.4, ry: 2.4, fill: dark });

  // Arms behind the torso edge, hands in skin tone.
  const sleeve = look.outfit === 'tee' || look.outfit === 'dress' ? skin : look.outfit === 'overalls' ? cream : outfit;
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? -5.2 : 3.5;
    body.push({ kind: 'rect', x, y: -13.6, w: 1.7, h: 6.1, r: 0.85, fill: shade(sleeve, 0.92) });
    if (look.outfit === 'tee') body.push({ kind: 'rect', x: x - 0.15, y: -13.9, w: 2, h: 2.6, r: 1, fill: dark });
    body.push({ kind: 'circle', x: x + 0.85, y: -7.3, r: 1.05, fill: skin });
  }

  // Torso by outfit.
  switch (look.outfit) {
    case 'dress':
      body.push({ kind: 'poly', points: [-3.2, -14.2, 3.2, -14.2, 4.9, -5.2, -4.9, -5.2], fill: outfit });
      body.push({ kind: 'poly', points: [0.9, -14.2, 3.2, -14.2, 4.9, -5.2, 1.6, -5.2], fill: dark, alpha: 0.45 });
      body.push({ kind: 'rect', x: -3.4, y: -11.2, w: 6.8, h: 1, r: 0.5, fill: light });
      body.push({ kind: 'line', points: [-2, -14.2, -1.6, -15.6], color: dark, width: 0.6 }, { kind: 'line', points: [2, -14.2, 1.6, -15.6], color: dark, width: 0.6 });
      break;
    case 'overalls':
      body.push({ kind: 'rect', x: -3.7, y: -14.4, w: 7.4, h: 7.8, r: 2.3, fill: cream });
      body.push({ kind: 'rect', x: -3.1, y: -11.6, w: 6.2, h: 5.4, r: 1.2, fill: outfit });
      body.push({ kind: 'rect', x: -3.6, y: -8, w: 7.2, h: 2.2, r: 1, fill: outfit });
      body.push({ kind: 'line', points: [-2.4, -11.6, -2.6, -14.3], color: outfit, width: 1 }, { kind: 'line', points: [2.4, -11.6, 2.6, -14.3], color: outfit, width: 1 });
      body.push({ kind: 'circle', x: -2.2, y: -11.1, r: 0.45, fill: 0xf2d16b }, { kind: 'circle', x: 2.2, y: -11.1, r: 0.45, fill: 0xf2d16b });
      body.push({ kind: 'rect', x: -1.4, y: -10.2, w: 2.8, h: 1.8, r: 0.5, fill: dark, alpha: 0.6 });
      break;
    case 'jacket':
      body.push({ kind: 'rect', x: -3.8, y: -14.4, w: 7.6, h: 8.2, r: 2.3, fill: outfit });
      body.push({ kind: 'poly', points: [-1.3, -14.4, 1.3, -14.4, 0.5, -6.4, -0.5, -6.4], fill: cream });
      body.push({ kind: 'poly', points: [-2.6, -14.4, -0.6, -14.4, -1.2, -11.6], fill: dark }, { kind: 'poly', points: [2.6, -14.4, 0.6, -14.4, 1.2, -11.6], fill: dark });
      body.push({ kind: 'rect', x: 1.2, y: -14.4, w: 2.6, h: 8.2, r: 1.6, fill: dark, alpha: 0.35 });
      break;
    case 'hoodie':
      body.push({ kind: 'rect', x: -3.9, y: -14.4, w: 7.8, h: 8.3, r: 2.6, fill: outfit });
      body.push({ kind: 'rect', x: -2.6, y: -9.8, w: 5.2, h: 2.4, r: 1, fill: dark, alpha: 0.55 });
      body.push({ kind: 'line', points: [-1, -14, -1.1, -11.8], color: cream, width: 0.5 }, { kind: 'line', points: [1, -14, 1.1, -11.8], color: cream, width: 0.5 });
      body.push({ kind: 'rect', x: 1.3, y: -14.4, w: 2.6, h: 8.3, r: 1.6, fill: dark, alpha: 0.3 });
      break;
    default:
      body.push({ kind: 'rect', x: -3.7, y: -14.4, w: 7.4, h: 8, r: 2.3, fill: outfit });
      body.push({ kind: 'rect', x: 1.2, y: -14.4, w: 2.5, h: 8, r: 1.5, fill: dark, alpha: 0.4 });
      body.push({ kind: 'poly', points: arc(0, -14.4, 1.6, 1.1, 0, Math.PI, 8), fill: dark, alpha: 0.5 });
  }
  if (look.accessory === 'backpack') front.push({ kind: 'line', points: [-2.6, -14.2, -2.9, -8.4], color: 0x6f5841, width: 0.9 }, { kind: 'line', points: [2.6, -14.2, 2.9, -8.4], color: 0x6f5841, width: 0.9 });
  if (look.accessory === 'scarf') {
    const scarf = look.outfitColor === 3 ? 0x5fa7a8 : 0xe0b45a;
    front.push({ kind: 'rect', x: -3.3, y: -15.2, w: 6.6, h: 2, r: 1, fill: scarf }, { kind: 'rect', x: 1, y: -14.2, w: 1.7, h: 3.6, r: 0.8, fill: shade(scarf, 0.85) });
  }

  // Head: neck, face circle, ears.
  const head: Shape[] = [
    { kind: 'rect', x: -1.1, y: -15.6, w: 2.2, h: 2, r: 0.6, fill: shade(skin, 0.86) },
    { kind: 'circle', x: -HEAD_R + 0.1, y: HEAD_Y + 0.6, r: 1, fill: shade(skin, 0.94) },
    { kind: 'circle', x: HEAD_R - 0.1, y: HEAD_Y + 0.6, r: 1, fill: shade(skin, 0.94) },
    { kind: 'circle', x: 0, y: HEAD_Y, r: HEAD_R, fill: skin },
  ];
  const face: Shape[] = [
    { kind: 'ellipse', x: -1.6, y: HEAD_Y + 0.5, rx: 0.62, ry: 0.82, fill: INK },
    { kind: 'ellipse', x: 1.6, y: HEAD_Y + 0.5, rx: 0.62, ry: 0.82, fill: INK },
    { kind: 'circle', x: -1.4, y: HEAD_Y + 0.2, r: 0.22, fill: 0xffffff },
    { kind: 'circle', x: 1.8, y: HEAD_Y + 0.2, r: 0.22, fill: 0xffffff },
    { kind: 'ellipse', x: -2.7, y: HEAD_Y + 1.9, rx: 0.9, ry: 0.5, fill: 0xe58f7a, alpha: 0.5 },
    { kind: 'ellipse', x: 2.7, y: HEAD_Y + 1.9, rx: 0.9, ry: 0.5, fill: 0xe58f7a, alpha: 0.5 },
    { kind: 'line', points: [-0.8, HEAD_Y + 2.4, 0, HEAD_Y + 2.85, 0.8, HEAD_Y + 2.4], color: shade(skin, 0.55), width: 0.45 },
  ];
  if (look.accessory === 'glasses') {
    const frame = 0x2f3437;
    face.push({ kind: 'line', points: arc(-1.6, HEAD_Y + 0.5, 1.35, 1.2, 0, Math.PI * 2, 16), color: frame, width: 0.45 },
      { kind: 'line', points: arc(1.6, HEAD_Y + 0.5, 1.35, 1.2, 0, Math.PI * 2, 16), color: frame, width: 0.45 },
      { kind: 'line', points: [-0.25, HEAD_Y + 0.3, 0.25, HEAD_Y + 0.3], color: frame, width: 0.45 });
  }

  // Hair, by style. Front pieces frame the face; back pieces show behind the head and when facing away.
  const hairBack: Shape[] = [], hairFront: Shape[] = [], hairAway: Shape[] = [];
  const top = arc(0, HEAD_Y, HEAD_R + 0.35, HEAD_R + 0.45, Math.PI, Math.PI * 2, 16);
  switch (look.hairStyle) {
    case 'long':
      hairBack.push({ kind: 'rect', x: -HEAD_R - 0.5, y: HEAD_Y - 1, w: (HEAD_R + 0.5) * 2, h: 8.4, r: 2.6, fill: hair });
      hairFront.push({ kind: 'poly', points: [...top, HEAD_R + 0.3, HEAD_Y + 0.4, 1.4, HEAD_Y - 2.2, -1.2, HEAD_Y - 1.4, -HEAD_R - 0.3, HEAD_Y + 0.6], fill: hair });
      hairFront.push({ kind: 'rect', x: -HEAD_R - 0.5, y: HEAD_Y - 0.6, w: 1.7, h: 7, r: 0.85, fill: hair }, { kind: 'rect', x: HEAD_R - 1.2, y: HEAD_Y - 0.6, w: 1.7, h: 7, r: 0.85, fill: hair });
      hairAway.push({ kind: 'circle', x: 0, y: HEAD_Y, r: HEAD_R + 0.35, fill: hair }, { kind: 'rect', x: -HEAD_R - 0.5, y: HEAD_Y - 1, w: (HEAD_R + 0.5) * 2, h: 8.4, r: 2.6, fill: hair });
      break;
    case 'bun':
      hairFront.push({ kind: 'poly', points: [...top, HEAD_R + 0.2, HEAD_Y - 0.4, 0.6, HEAD_Y - 2.6, -HEAD_R - 0.2, HEAD_Y - 0.2], fill: hair });
      hairFront.push({ kind: 'circle', x: 0.4, y: HEAD_Y - HEAD_R - 1.4, r: 2.1, fill: hair }, { kind: 'circle', x: 0.9, y: HEAD_Y - HEAD_R - 1.9, r: 0.7, fill: mix(hair, 0xffffff, 0.2) });
      hairAway.push({ kind: 'circle', x: 0, y: HEAD_Y, r: HEAD_R + 0.3, fill: hair }, { kind: 'circle', x: 0.4, y: HEAD_Y - HEAD_R - 1.4, r: 2.1, fill: hair });
      break;
    case 'curly': {
      const puffs: Shape[] = [];
      for (let i = 0; i < 9; i += 1) {
        const a = Math.PI + (Math.PI * i) / 8;
        puffs.push({ kind: 'circle', x: Math.round(Math.cos(a) * (HEAD_R + 0.4) * 100) / 100, y: Math.round((HEAD_Y + Math.sin(a) * (HEAD_R + 0.5)) * 100) / 100, r: 1.75, fill: hair });
      }
      hairFront.push(...puffs, { kind: 'circle', x: -1.6, y: HEAD_Y - 2.6, r: 1.5, fill: hair }, { kind: 'circle', x: 1.4, y: HEAD_Y - 2.9, r: 1.5, fill: hair });
      hairBack.push({ kind: 'circle', x: -HEAD_R + 0.2, y: HEAD_Y + 1.6, r: 1.6, fill: hair }, { kind: 'circle', x: HEAD_R - 0.2, y: HEAD_Y + 1.6, r: 1.6, fill: hair });
      hairAway.push({ kind: 'circle', x: 0, y: HEAD_Y, r: HEAD_R + 1, fill: hair }, ...puffs);
      break;
    }
    case 'cap': {
      const capColor = look.outfitColor === 0 ? 0x3f5d7a : 0xc8714f;
      hairFront.push({ kind: 'rect', x: -HEAD_R - 0.1, y: HEAD_Y - 0.2, w: 1.4, h: 2.6, r: 0.6, fill: hair }, { kind: 'rect', x: HEAD_R - 1.3, y: HEAD_Y - 0.2, w: 1.4, h: 2.6, r: 0.6, fill: hair });
      hairFront.push({ kind: 'poly', points: [...arc(0, HEAD_Y - 0.4, HEAD_R + 0.5, HEAD_R + 0.4, Math.PI, Math.PI * 2, 16)], fill: capColor });
      hairFront.push({ kind: 'rect', x: -HEAD_R - 1.4, y: HEAD_Y - 1, w: (HEAD_R + 1.4) * 2, h: 1.3, r: 0.65, fill: shade(capColor, 0.8) });
      hairFront.push({ kind: 'circle', x: 0, y: HEAD_Y - HEAD_R - 0.6, r: 0.5, fill: shade(capColor, 0.75) });
      hairAway.push({ kind: 'circle', x: 0, y: HEAD_Y + 0.6, r: HEAD_R, fill: hair }, { kind: 'poly', points: arc(0, HEAD_Y - 0.4, HEAD_R + 0.5, HEAD_R + 0.4, Math.PI, Math.PI * 2, 16), fill: capColor });
      break;
    }
    case 'buzz':
      hairFront.push({ kind: 'poly', points: [...arc(0, HEAD_Y, HEAD_R + 0.15, HEAD_R + 0.2, Math.PI * 1.05, Math.PI * 1.95, 14), HEAD_R - 0.6, HEAD_Y - 1.2, -HEAD_R + 0.6, HEAD_Y - 1.2], fill: hair, alpha: 0.9 });
      hairAway.push({ kind: 'circle', x: 0, y: HEAD_Y, r: HEAD_R + 0.15, fill: hair, alpha: 0.9 });
      break;
    default:
      hairFront.push({ kind: 'poly', points: [...top, HEAD_R + 0.35, HEAD_Y + 0.6, HEAD_R - 0.7, HEAD_Y - 1, 1.8, HEAD_Y - 2.3, -0.6, HEAD_Y - 1.5, -2.6, HEAD_Y - 2.1, -HEAD_R - 0.35, HEAD_Y + 0.6], fill: hair });
      hairAway.push({ kind: 'circle', x: 0, y: HEAD_Y, r: HEAD_R + 0.35, fill: hair });
  }
  if (look.accessory === 'sunhat') {
    const straw = 0xe8cf8f;
    const hat: Shape[] = [
      { kind: 'ellipse', x: 0, y: HEAD_Y - 2.4, rx: HEAD_R + 3.4, ry: 1.9, fill: straw },
      { kind: 'poly', points: [...arc(0, HEAD_Y - 2.6, HEAD_R - 0.4, HEAD_R - 0.6, Math.PI, Math.PI * 2, 12)], fill: shade(straw, 0.95) },
      { kind: 'rect', x: -HEAD_R + 0.4, y: HEAD_Y - 3.6, w: (HEAD_R - 0.4) * 2, h: 1.1, r: 0.5, fill: outfit },
    ];
    hairFront.push(...hat);
    hairAway.push(...hat);
  }
  return {
    shadow: [{ kind: 'ellipse', x: 0, y: 0, rx: 6.6, ry: 2.9, fill: 0x14221a, alpha: 0.36 }],
    back, legLeft: leg(), legRight: leg(), legPivot: { left: [-1.6, -6.6], right: [1.6, -6.6] },
    body, head, face, hairBack, hairFront, hairAway, front, colors: { skin, hair, outfit },
  };
}

/** Layer order facing the camera, and walking away (hair and backpack over the head and body). */
export const FIGURE_ORDER = ['shadow', 'back', 'hairBack', 'legs', 'body', 'front', 'head', 'face', 'hairFront'] as const;
export const FIGURE_ORDER_AWAY = ['shadow', 'legs', 'body', 'head', 'hairAway', 'back'] as const;
