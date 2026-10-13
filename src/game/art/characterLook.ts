import type { PlayerAppearance } from '@tiny-city/simulation';
import { HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES } from '../playerLook';
import { hashString } from '../npcMotion';

/**
 * Visual World 3.0C character composition. A character is drawn from baked layer frames (see
 * scripts/art/characters/rig.js), each tinted at runtime. This module is pure: it maps an appearance to layers and
 * picks animation frames, so the Pixi rig, the Character Creator preview and the tests all agree.
 */

export type CharacterFacing = 'front' | 'back';
export type CharacterPose = 'walk' | 'idle' | 'wave' | 'talk' | 'sit';
export const POSE_FRAMES: Readonly<Record<CharacterPose, number>> = { walk: 8, idle: 4, wave: 4, talk: 4, sit: 2 };

/** Everything that decides how a character looks; players derive it from their saved appearance. */
export interface CharacterLook {
  readonly appearance: PlayerAppearance;
  readonly skin: number;
  readonly hair: number;
  readonly outfit: number;
  readonly legs: number;
  readonly shoes: number;
  readonly cap: number;
  readonly scarf: number;
}

const DENIM = 0x3d4f66, CHARCOAL = 0x4a4440, CREAM = 0xf4ecdc;
const PANTS = [0x34495e, 0x5b4636, 0x3c4a3f, 0x6c7a89, 0x2f3437, 0x8a6f52, DENIM] as const;
const SHOES = [0xf3efe6, 0x3a3532, 0x8a5a3c, 0xe8e2d6, 0x5f7f86] as const;

/** Maps a saved appearance (Life Mode schema) to colours, exactly like the 2.0 figure did. */
export function lookFromAppearance(look: PlayerAppearance, extra: { pants?: number; shoes?: number } = {}): CharacterLook {
  const skin = SKIN_TONES[look.skinTone] ?? SKIN_TONES[0];
  const hair = HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0];
  const outfit = OUTFIT_COLORS[look.outfitColor] ?? OUTFIT_COLORS[0];
  const legs = look.outfit === 'dress' ? skin : look.outfit === 'overalls' ? outfit : look.outfit === 'jacket' ? (extra.pants ?? CHARCOAL) : (extra.pants ?? DENIM);
  return { appearance: look, skin, hair, outfit, legs, shoes: look.outfit === 'dress' ? 0xc8714f : (extra.shoes ?? 0xf3efe6),
    cap: look.outfitColor === 0 ? 0x3f5d7a : 0xc8714f, scarf: look.outfitColor === 3 ? 0x5fa7a8 : 0xe0b45a };
}

const HAIR_STYLES = ['short', 'long', 'bun', 'curly', 'cap', 'buzz'] as const;
const OUTFITS = ['tee', 'dress', 'jacket', 'overalls', 'hoodie', 'tee', 'jacket'] as const;
const ACCESSORIES = ['none', 'none', 'none', 'glasses', 'backpack', 'scarf', 'sunhat', 'none'] as const;
function pick<T>(items: readonly T[], seed: number, salt: number): T {
  const mixed = Math.imul(seed ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b) >>> 0;
  return items[((mixed ^ (mixed >>> 13)) >>> 0) % items.length]!;
}

/**
 * A resident's look, derived only from their stable ID: identical across reloads, undo and devices, and never
 * stored. Uses the same option sets as the player, so residents and the player share one visual language.
 */
export function citizenLook(citizenId: string): CharacterLook {
  const seed = hashString(`look:${citizenId}`);
  const appearance: PlayerAppearance = {
    skinTone: seed % SKIN_TONES.length,
    hairStyle: pick(HAIR_STYLES, seed, 2),
    hairColor: pick([0, 1, 1, 2, 3, 4, 5, 6, 0, 1], seed, 3) % HAIR_COLORS.length,
    outfit: pick(OUTFITS, seed, 4),
    outfitColor: pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], seed, 5),
    accessory: pick(ACCESSORIES, seed, 6),
  };
  return lookFromAppearance(appearance, { pants: pick(PANTS, seed, 7), shoes: pick(SHOES, seed, 8) });
}

export interface LayerRef { readonly layer: string; readonly variant: string; readonly side: 'L' | 'R' | '-'; readonly tint: number | null }

/** The slots of one look in draw order for a facing (back to front). Pure; tested against the bake metadata. */
export function characterLayers(look: CharacterLook, facing: CharacterFacing, pose: CharacterPose = 'idle'): LayerRef[] {
  const a = look.appearance;
  const sleeve = a.outfit === 'tee' ? 'short' : a.outfit === 'overalls' ? 'short' : a.outfit === 'jacket' || a.outfit === 'hoodie' ? 'long' : null;
  const sleeveTint = a.outfit === 'overalls' ? CREAM : look.outfit;
  const torso = a.outfit === 'overalls' || a.outfit === 'jacket' ? 'shirt' : a.outfit;
  const torsoTint = torso === 'shirt' ? CREAM : look.outfit;
  const overlay = a.outfit === 'overalls' ? 'overalls' : a.outfit === 'jacket' ? 'jacket' : null;
  const legs = a.outfit === 'dress' ? 'bare' : 'pants';
  const order = pose === 'sit' && facing === 'front' ? SIT_FRONT : facing === 'front' ? FRONT : BACK;
  const out: LayerRef[] = [];
  for (const slot of order) {
    const [name, side = '-'] = slot.split(':') as [string, ('L' | 'R')?];
    const s = side as 'L' | 'R' | '-';
    switch (name) {
      case 'armSkin': out.push({ layer: 'armSkin', variant: 'base', side: s, tint: look.skin }); break;
      case 'sleeve': if (sleeve) out.push({ layer: 'sleeve', variant: sleeve, side: s, tint: sleeveTint }); break;
      case 'legs': out.push({ layer: 'legs', variant: legs, side: s, tint: look.legs }); break;
      case 'shoes': out.push({ layer: 'shoes', variant: 'sneaker', side: s, tint: look.shoes }); break;
      case 'torso': out.push({ layer: 'torso', variant: torso, side: '-', tint: torsoTint }); break;
      case 'overlay': if (overlay) out.push({ layer: 'torso', variant: overlay, side: '-', tint: look.outfit }); break;
      case 'head': out.push({ layer: 'head', variant: 'base', side: '-', tint: look.skin }); break;
      case 'face': out.push({ layer: 'face', variant: 'base', side: '-', tint: null }); break;
      case 'hair': out.push({ layer: 'hair', variant: a.hairStyle, side: '-', tint: look.hair }); break;
      case 'hairLong': if (a.hairStyle === 'long') out.push({ layer: 'hairLong', variant: 'long', side: '-', tint: look.hair }); break;
      case 'cap': if (a.hairStyle === 'cap') out.push({ layer: 'cap', variant: 'base', side: '-', tint: look.cap }); break;
      case 'glasses': if (a.accessory === 'glasses') out.push({ layer: 'glasses', variant: 'base', side: '-', tint: null }); break;
      case 'sunhat': if (a.accessory === 'sunhat') out.push({ layer: 'sunhat', variant: 'base', side: '-', tint: null }); break;
      case 'scarf': if (a.accessory === 'scarf') out.push({ layer: 'scarf', variant: 'base', side: '-', tint: look.scarf }); break;
      case 'backpack': if (a.accessory === 'backpack') out.push({ layer: 'backpack', variant: 'base', side: '-', tint: null }); break;
    }
  }
  return out;
}
const FRONT = ['backpack', 'hairLong', 'armSkin:L', 'sleeve:L', 'legs:L', 'shoes:L', 'legs:R', 'shoes:R', 'torso', 'overlay', 'scarf', 'armSkin:R', 'sleeve:R', 'head', 'face', 'hair', 'cap', 'glasses', 'sunhat'];
const BACK = ['armSkin:L', 'sleeve:L', 'legs:L', 'shoes:L', 'legs:R', 'shoes:R', 'torso', 'overlay', 'armSkin:R', 'sleeve:R', 'head', 'hair', 'hairLong', 'cap', 'scarf', 'sunhat', 'backpack'];
const SIT_FRONT = ['backpack', 'hairLong', 'armSkin:L', 'sleeve:L', 'torso', 'overlay', 'legs:L', 'shoes:L', 'legs:R', 'shoes:R', 'scarf', 'armSkin:R', 'sleeve:R', 'head', 'face', 'hair', 'cap', 'glasses', 'sunhat'];
export const CHARACTER_ORDER = { front: FRONT, back: BACK, sitFront: SIT_FRONT } as const;

export function frameName(ref: LayerRef, facing: CharacterFacing, pose: CharacterPose, frame: number): string {
  return `ch:${ref.layer}:${ref.variant}:${ref.side}:${facing}:${pose}:${frame}`;
}

/** Screen facing from a grid heading: which baked facing to use and whether to mirror it. */
export function facingFor(heading: { x: number; y: number }, previous: { facing: CharacterFacing; mirror: boolean }): { facing: CharacterFacing; mirror: boolean } {
  const dx = heading.x - heading.y, dy = heading.x + heading.y;
  if (dx === 0 && dy === 0) return previous;
  return { facing: dy < 0 ? 'back' : 'front', mirror: dx < 0 ? true : dx > 0 ? false : previous.mirror };
}

export interface PoseInput {
  readonly moving: boolean;
  /** Walk phase in radians (advanced by real displacement, so pausing freezes mid-stride). */
  readonly walkPhase: number;
  /** Activity overlay from real simulation state. */
  readonly action: 'none' | 'wave' | 'talk' | 'sit';
  readonly seed: number;
  readonly timeMs: number;
  readonly reducedMotion: boolean;
}

/**
 * Animation frame for a character. Walking follows displacement; idles breathe at a per-character rate and offset,
 * with an occasional look-around, so neighbours never loop in sync. Reduced motion holds a still pose.
 */
export function selectPose(input: PoseInput): { pose: CharacterPose; frame: number } {
  if (input.moving) return { pose: 'walk', frame: Math.floor(((input.walkPhase / (Math.PI * 2)) % 1 + 1) % 1 * POSE_FRAMES.walk) % POSE_FRAMES.walk };
  if (input.reducedMotion) return { pose: input.action === 'none' ? 'idle' : input.action, frame: 0 };
  const period = 1400 + (input.seed % 700);
  const t = input.timeMs + (input.seed % 5000);
  if (input.action === 'wave') return { pose: 'wave', frame: Math.floor(t / 150) % 4 };
  if (input.action === 'talk') return { pose: 'talk', frame: Math.floor(t / (260 + (input.seed % 90))) % 4 };
  if (input.action === 'sit') return { pose: 'sit', frame: Math.floor(t / period) % 2 };
  // Idle: breathe (0/1); every ~7–11 s glance left or right for a moment.
  const cycle = 7000 + (input.seed % 4000);
  const inCycle = t % cycle;
  if (inCycle < 900) return { pose: 'idle', frame: (Math.floor(t / cycle) + input.seed) % 2 === 0 ? 2 : 3 };
  return { pose: 'idle', frame: Math.floor(t / period) % 2 };
}
