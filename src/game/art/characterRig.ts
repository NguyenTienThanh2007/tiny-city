import { Container, Sprite, Texture } from 'pixi.js';
import type { ArtLibrary } from './artLibrary';
import { characterLayers, frameName, type CharacterFacing, type CharacterLook, type CharacterPose, type LayerRef } from './characterLook';

/**
 * A baked character on the map: one sprite per layer, all from the character atlas (so hundreds of residents batch
 * into a handful of draw calls). Textures only change when the frame changes. Feet are at the container origin;
 * one local unit is one world pixel at scale 1 (the baked figure is about 26 px tall).
 */
const ZERO = { x: 0, y: 0 };

export class CharacterRig {
  readonly root = new Container();
  private readonly sprites: Sprite[] = [];
  private layers: { front: LayerRef[]; back: LayerRef[]; sitFront: LayerRef[] };
  private key = '';
  /** Textures per frame key, so a frame change does not rebuild frame names or hit the atlas map. */
  private frames = new Map<string, (Texture | null)[]>();

  constructor(private readonly art: ArtLibrary, look: CharacterLook) {
    this.root.eventMode = 'none';
    this.layers = CharacterRig.layersFor(look);
  }

  private static layersFor(look: CharacterLook) {
    return { front: characterLayers(look, 'front'), back: characterLayers(look, 'back'), sitFront: characterLayers(look, 'front', 'sit') };
  }

  setLook(look: CharacterLook): void {
    this.layers = CharacterRig.layersFor(look);
    this.key = '';
    this.frames.clear();
  }

  /** Shows one animation frame. Mirroring is done by the caller (the whole resident flips, badges included). */
  show(facing: CharacterFacing, pose: CharacterPose, frame: number): void {
    const key = `${facing}:${pose}:${frame}`;
    if (key === this.key) return;
    this.key = key;
    const list = pose === 'sit' && facing === 'front' ? this.layers.sitFront : this.layers[facing];
    let textures = this.frames.get(key);
    if (!textures) { textures = list.map((ref) => this.art.frame(frameName(ref, facing, pose, frame))); this.frames.set(key, textures); }
    while (this.sprites.length < list.length) { const sprite = new Sprite(Texture.EMPTY); sprite.eventMode = 'none'; this.sprites.push(sprite); this.root.addChild(sprite); }
    for (let i = 0; i < this.sprites.length; i += 1) {
      const sprite = this.sprites[i]!;
      const ref = list[i];
      const texture = ref ? textures[i] ?? null : null;
      if (!ref || !texture) { if (sprite.visible) sprite.visible = false; continue; }
      if (!sprite.visible) sprite.visible = true;
      // Setters invalidate Pixi's batch data, so only touch what changed (hundreds of walkers swap frames per frame).
      if (sprite.texture !== texture) {
        sprite.texture = texture;
        const anchor = texture.defaultAnchor ?? ZERO;
        if (sprite.anchor.x !== anchor.x || sprite.anchor.y !== anchor.y) sprite.anchor.set(anchor.x, anchor.y);
      }
      const tint = ref.tint ?? 0xffffff;
      if (sprite.tint !== tint) sprite.tint = tint;
    }
  }

  /** Frames this look needs that the atlas lacks (for diagnostics and tests). */
  missingFrames(facing: CharacterFacing, pose: CharacterPose, frame: number): string[] {
    const list = pose === 'sit' && facing === 'front' ? this.layers.sitFront : this.layers[facing];
    return list.map((ref) => frameName(ref, facing, pose, frame)).filter((name) => !this.art.frame(name));
  }

  destroy(): void { this.root.destroy({ children: true }); this.sprites.length = 0; }
}

/** True when the loaded art carries the 3.0C character atlas. */
export function hasCharacterArt(art: ArtLibrary | null): art is ArtLibrary {
  return !!art && !!art.index.manifest.characters;
}
