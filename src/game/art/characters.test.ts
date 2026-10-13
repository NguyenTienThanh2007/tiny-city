import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import { createWorld, type PlayerAppearance, type WorldState } from '@tiny-city/simulation';
import { HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES } from '../playerLook';
import { CHARACTER_ORDER, characterLayers, citizenLook, facingFor, frameName, lookFromAppearance, POSE_FRAMES, selectPose, type CharacterPose } from './characterLook';
import { CharacterRig } from './characterRig';
import { indexManifest, validateManifest, type ArtManifest } from './artManifest';
import { resetArtForTests, type ArtLibrary } from './artLibrary';
import { NpcLayer, RIG_LOCAL_SCALE, interactionsOf, liftTint, npcSpriteScale } from '../npcLayer';
import { figureDepth, lotDepths } from '../npcMotion';

const dir = resolve(__dirname, '../../../public/art/vw3');
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as ArtManifest;
const characterFrames = new Set<string>();
for (const sheet of manifest.characters!.sheets) for (const name of Object.keys(JSON.parse(readFileSync(resolve(dir, sheet.file), 'utf8')).frames)) characterFrames.add(name);

const HAIR = ['short', 'long', 'bun', 'curly', 'cap', 'buzz'] as const;
const OUTFIT = ['tee', 'dress', 'jacket', 'overalls', 'hoodie'] as const;
const ACCESSORY = ['none', 'glasses', 'backpack', 'scarf', 'sunhat'] as const;
function* everyAppearance(): Generator<PlayerAppearance> {
  for (const hairStyle of HAIR) for (const outfit of OUTFIT) for (const accessory of ACCESSORY) {
    yield { skinTone: 2, hairStyle, hairColor: 3, outfit, outfitColor: 4, accessory };
  }
}

/** Library whose frames are present exactly when the baked atlas has them. */
function atlasLibrary(): ArtLibrary {
  return { index: indexManifest(manifest), textureBytes: 0, hit: () => null, source: () => null,
    frame: (name) => (name && (characterFrames.has(name) || !name.startsWith('ch:')) ? Texture.WHITE : null) };
}
afterEach(() => resetArtForTests(null));

describe('character atlas (3.0C)', () => {
  it('is described by a valid manifest with every pose', () => {
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.characters!.poses).toEqual(POSE_FRAMES);
    expect(characterFrames.size).toBe(manifest.characters!.frames);
  });

  it('has a baked frame for every layer of every appearance choice, facing, pose and frame', () => {
    const missing = new Set<string>();
    for (const appearance of everyAppearance()) {
      const look = lookFromAppearance(appearance);
      for (const facing of ['front', 'back'] as const) for (const pose of Object.keys(POSE_FRAMES) as CharacterPose[]) {
        for (let frame = 0; frame < POSE_FRAMES[pose]; frame += 1) for (const ref of characterLayers(look, facing, pose)) {
          const name = frameName(ref, facing, pose, frame);
          if (!characterFrames.has(name)) missing.add(name);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('draws the saved appearance faithfully: colours and layers follow every choice', () => {
    for (let skin = 0; skin < SKIN_TONES.length; skin += 1) for (let hair = 0; hair < HAIR_COLORS.length; hair += 1) {
      const look = lookFromAppearance({ skinTone: skin, hairStyle: 'short', hairColor: hair, outfit: 'tee', outfitColor: skin % OUTFIT_COLORS.length, accessory: 'none' });
      const layers = characterLayers(look, 'front');
      expect(layers.find((l) => l.layer === 'head')!.tint).toBe(SKIN_TONES[skin]);
      expect(layers.find((l) => l.layer === 'hair')!.tint).toBe(HAIR_COLORS[hair]);
      expect(layers.find((l) => l.layer === 'torso')!.tint).toBe(OUTFIT_COLORS[skin % OUTFIT_COLORS.length]);
    }
    const has = (a: PlayerAppearance, layer: string, variant?: string) => characterLayers(lookFromAppearance(a), 'front').some((l) => l.layer === layer && (!variant || l.variant === variant));
    const base: PlayerAppearance = { skinTone: 0, hairStyle: 'short', hairColor: 0, outfit: 'tee', outfitColor: 0, accessory: 'none' };
    for (const hairStyle of HAIR) expect(has({ ...base, hairStyle }, 'hair', hairStyle)).toBe(true);
    expect(has({ ...base, hairStyle: 'long' }, 'hairLong')).toBe(true);
    expect(has({ ...base, hairStyle: 'cap' }, 'cap')).toBe(true);
    expect(has({ ...base, outfit: 'dress' }, 'legs', 'bare')).toBe(true);
    expect(has({ ...base, outfit: 'dress' }, 'sleeve')).toBe(false);
    expect(has({ ...base, outfit: 'jacket' }, 'torso', 'jacket')).toBe(true);
    expect(has({ ...base, outfit: 'overalls' }, 'torso', 'overalls')).toBe(true);
    for (const accessory of ['glasses', 'backpack', 'scarf', 'sunhat'] as const) expect(has({ ...base, accessory }, accessory)).toBe(true);
    // The face and glasses only exist facing the camera.
    expect(characterLayers(lookFromAppearance({ ...base, accessory: 'glasses' }), 'back').some((l) => l.layer === 'face' || l.layer === 'glasses')).toBe(false);
  });

  it('keeps layer order: right (near) limbs after the torso facing the camera; long hair and backpack swap sides facing away', () => {
    const front = CHARACTER_ORDER.front, back = CHARACTER_ORDER.back;
    expect(front.indexOf('armSkin:R')).toBeGreaterThan(front.indexOf('torso'));
    expect(front.indexOf('armSkin:L')).toBeLessThan(front.indexOf('torso'));
    expect(front.indexOf('hairLong')).toBeLessThan(front.indexOf('torso'));
    expect(back.indexOf('hairLong')).toBeGreaterThan(back.indexOf('head'));
    expect(back.indexOf('backpack')).toBe(back.length - 1);
    expect(CHARACTER_ORDER.sitFront.indexOf('legs:R')).toBeGreaterThan(CHARACTER_ORDER.sitFront.indexOf('torso'));
  });
});

describe('resident identities', () => {
  it('are deterministic per ID and stable across reloads (never stored)', () => {
    for (let i = 0; i < 100; i += 1) expect(citizenLook(`npc-${i}`)).toEqual(citizenLook(`npc-${i}`));
    const json = JSON.parse(JSON.stringify(citizenLook('npc-7')));
    expect(json).toEqual(citizenLook('npc-7'));
  });

  it('are varied across a population', () => {
    const looks = Array.from({ length: 200 }, (_, i) => citizenLook(`npc-${i}`));
    expect(new Set(looks.map((l) => l.appearance.hairStyle)).size).toBe(6);
    expect(new Set(looks.map((l) => l.appearance.outfit)).size).toBe(5);
    expect(new Set(looks.map((l) => l.skin)).size).toBe(SKIN_TONES.length);
    expect(new Set(looks.map((l) => `${l.appearance.hairStyle}:${l.outfit}:${l.hair}:${l.skin}`)).size).toBeGreaterThan(150);
  });
});

describe('animation state selection', () => {
  const base = { moving: false, walkPhase: 0, action: 'none' as const, seed: 11, timeMs: 0, reducedMotion: false };
  it('walks with the stride (8 frames over one phase cycle) and never slides', () => {
    const frames = Array.from({ length: 8 }, (_, i) => selectPose({ ...base, moving: true, walkPhase: (i + 0.5) / 8 * Math.PI * 2 }));
    expect(frames.map((f) => f.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(frames.every((f) => f.pose === 'walk')).toBe(true);
    // The frame depends on displacement (phase), not time: same phase, any time → same frame.
    expect(selectPose({ ...base, moving: true, walkPhase: 1, timeMs: 99_999 })).toEqual(selectPose({ ...base, moving: true, walkPhase: 1 }));
  });

  it('idles out of sync between residents and glances around now and then', () => {
    const timeline = (seed: number) => Array.from({ length: 120 }, (_, i) => selectPose({ ...base, seed, timeMs: i * 250 }).frame).join('');
    expect(timeline(1)).not.toBe(timeline(2));
    const frames = new Set(Array.from({ length: 400 }, (_, i) => selectPose({ ...base, seed: 3, timeMs: i * 100 }).frame));
    expect([...frames].sort()).toEqual([0, 1, 2, 3]);
  });

  it('shows real activities as poses and holds still under reduced motion', () => {
    expect(selectPose({ ...base, action: 'wave' }).pose).toBe('wave');
    expect(selectPose({ ...base, action: 'talk' }).pose).toBe('talk');
    expect(selectPose({ ...base, action: 'sit' }).pose).toBe('sit');
    for (let t = 0; t < 20_000; t += 777) expect(selectPose({ ...base, timeMs: t, reducedMotion: true })).toEqual({ pose: 'idle', frame: 0 });
    expect(selectPose({ ...base, action: 'talk', timeMs: 5000, reducedMotion: true })).toEqual({ pose: 'talk', frame: 0 });
  });

  it('picks the baked facing and mirror for all four grid headings', () => {
    const start = { facing: 'front' as const, mirror: false };
    expect(facingFor({ x: 1, y: 0 }, start)).toEqual({ facing: 'front', mirror: false });
    expect(facingFor({ x: 0, y: 1 }, start)).toEqual({ facing: 'front', mirror: true });
    expect(facingFor({ x: 0, y: -1 }, start)).toEqual({ facing: 'back', mirror: false });
    expect(facingFor({ x: -1, y: 0 }, start)).toEqual({ facing: 'back', mirror: true });
    expect(facingFor({ x: 0, y: 0 }, { facing: 'back', mirror: true })).toEqual({ facing: 'back', mirror: true });
  });
});

describe('character rig and resident layer', () => {
  it('stacks one tinted sprite per layer and hides layers whose frames are missing (graceful fallback)', () => {
    const look = lookFromAppearance({ skinTone: 1, hairStyle: 'long', hairColor: 2, outfit: 'jacket', outfitColor: 3, accessory: 'scarf' });
    const rig = new CharacterRig(atlasLibrary(), look);
    rig.show('front', 'walk', 3);
    const sprites = rig.root.children as Sprite[];
    expect(sprites.length).toBe(characterLayers(look, 'front').length);
    expect(sprites.every((s) => s.visible)).toBe(true);
    expect(rig.missingFrames('front', 'walk', 3)).toEqual([]);
    const broken = new CharacterRig({ ...atlasLibrary(), frame: (name) => (name?.includes(':hair:') ? null : Texture.WHITE) }, look);
    broken.show('front', 'idle', 0);
    expect((broken.root.children as Sprite[]).filter((s) => !s.visible).length).toBe(1);
  });

  function populatedWorld(): WorldState {
    const roads = Array.from({ length: 12 }, (_, i) => ({ x: 4 + i, y: 10 }));
    const plan = { id: 'p', name: 'p', width: 32, height: 32, roads, blockedTiles: [], buildings: [
      { id: 'h1', name: 'H', kind: 'home' as const, type: 'apartment' as const, position: { x: 4, y: 6 }, footprint: { width: 4, height: 4 }, capacity: 24 },
      { id: 'park', name: 'P', kind: 'park' as const, type: 'park' as const, position: { x: 10, y: 6 }, footprint: { width: 4, height: 4 }, capacity: 20 },
    ] };
    return createWorld({ id: 'w', seed: 's', plan, population: { maxCitizens: 12 } });
  }

  it('builds baked residents when the atlas is loaded and vector figures when it is not', () => {
    const world = populatedWorld();
    resetArtForTests(atlasLibrary());
    const scene = new Container();
    const layer = new NpcLayer(scene, new Container(), { reducedMotion: true });
    layer.sync(world, 16, 0.9, null);
    expect(layer.count).toBe(world.citizens.length);
    const npc = scene.children.find((c) => c.label === 'npc') as Container;
    const figure = npc.children[2] as Container;
    const body = figure.children[1] as Container;
    expect((body.children[0] as Container).scale.x).toBeCloseTo(RIG_LOCAL_SCALE);
    layer.destroy();

    resetArtForTests(null);
    const vectorScene = new Container();
    const vector = new NpcLayer(vectorScene, new Container(), { reducedMotion: true });
    vector.sync(world, 16, 0.9, null);
    expect(vector.count).toBe(world.citizens.length);
    vector.destroy();
  });

  it('keeps residents pickable and correctly sized after zooming in and out', () => {
    expect(npcSpriteScale(1.55)).toBe(npcSpriteScale(1.2));
    expect(npcSpriteScale(0.1)).toBeGreaterThan(npcSpriteScale(0.9));
    const world = populatedWorld();
    resetArtForTests(atlasLibrary());
    const layer = new NpcLayer(new Container(), new Container(), { reducedMotion: true });
    for (const scale of [0.9, 1.55, 0.3, 0.9]) layer.sync(world, 16, scale, null);
    layer.destroy();
  });

  it('lifts night tints so residents stay readable, and maps player interactions to real residents only', () => {
    expect(liftTint(0xffffff)).toBe(0xffffff);
    const night = 0x8590c2, lifted = liftTint(night);
    expect(lifted & 0xff).toBeGreaterThan(night & 0xff);
    const world = populatedWorld();
    expect(interactionsOf(world).size).toBe(0);
    const citizen = world.citizens[0]!;
    const withPlayer = { ...world, player: { position: { x: 5, y: 10 }, activity: { kind: 'greet', phase: 'performing', citizenId: citizen.id } } } as unknown as WorldState;
    expect(interactionsOf(withPlayer).get(citizen.id)?.action).toBe('wave');
  });

  it('sorts figures inside a lot above that lot, and by iso depth elsewhere', () => {
    const lots = lotDepths({ buildings: [{ position: { x: 4, y: 6 }, footprint: { width: 2, height: 2 } }] });
    expect(figureDepth({ x: 4.2, y: 6.3 }, lots)).toBeGreaterThan(4 + 6 + 2);
    expect(figureDepth({ x: 8.5, y: 2.5 }, lots)).toBe(11);
  });
});

describe('animation performance', () => {
  it('updates 300 baked residents per frame within budget', () => {
    const roads = Array.from({ length: 56 }, (_, i) => ({ x: 2 + i, y: 20 }));
    const buildings = Array.from({ length: 13 }, (_, i) => ({ id: `a${i}`, name: 'A', kind: 'home' as const, type: 'apartment' as const, position: { x: 2 + i * 4, y: 16 }, footprint: { width: 4, height: 4 }, capacity: 24 }));
    const world = createWorld({ id: 'w', seed: 's', plan: { id: 'p', name: 'p', width: 64, height: 64, roads, blockedTiles: [], buildings }, population: { maxCitizens: 300 } });
    resetArtForTests(atlasLibrary());
    const layer = new NpcLayer(new Container(), new Container(), { reducedMotion: false });
    layer.sync(world, 0, 0.9, null);
    const started = performance.now();
    for (let frame = 1; frame <= 30; frame += 1) layer.sync(world, frame * 16, 0.9, null);
    const perFrame = (performance.now() - started) / 30;
    expect(layer.count).toBeGreaterThan(250);
    // Generous for CI under jsdom; real browsers measure ~0.3 ms (docs/visual-world-3/performance-3.0c.md).
    expect(perFrame).toBeLessThan(25);
    layer.destroy();
  });
});
