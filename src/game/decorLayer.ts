import { Container, Graphics, GraphicsContext, Sprite, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import type { CityPlan } from '@tiny-city/simulation';
import { iso } from './mapGeometry';
import { FLAT_DECOR, planDecor, TALL_DECOR, type Decor } from './worldDecor';
import { tree } from './buildingArt';
import { currentArt } from './art/artLibrary';
import { selectDecorAsset } from './art/artManifest';

/**
 * Landscaping and streetlights. Tall items join the depth-sorted scene (so residents and buildings layer
 * correctly) as sprites of pre-rendered textures — one quad each instead of dozens of vector vertices; flat
 * items are baked into the ground layer. The whole layer is rebuilt only when roads or buildings change.
 */
const DECOR_TEXTURE_RESOLUTION = 3;
/** Below this camera scale small decor and decor shadows are skipped. */
export const LOD_SCALE = 0.32;
const SMALL_DECOR = new Set<Decor['kind']>(['bush', 'bench', 'bin', 'bikes', 'planter']);
export class DecorLayer {
  private readonly contexts = new Map<string, GraphicsContext>();
  private readonly textures = new Map<string, { texture: Texture; anchor: { x: number; y: number } }>();
  private readonly tall = new Map<string, Container[]>();
  private readonly lampGlows: Graphics[] = [];
  private readonly tinted: Array<Graphics | Sprite> = [];
  private ground = new Graphics();
  /** Flat baked sprites (flower patches) inside the cached ground layer, and baked ground shadows. */
  private readonly flat: Sprite[] = [];
  private readonly shadowSprites: Sprite[] = [];
  private hidden: Container[] = [];
  private tint = 0xffffff;
  /** Small street furniture and shrubs that stop rendering when zoomed far out (level of detail). */
  private readonly small: Container[] = [];
  private detailed = true;
  private glow = 0;
  private items: Decor[] = [];

  constructor(private readonly scene: Container, private readonly groundLayer: Container, private readonly renderer: Renderer | null = null,
    private readonly shadowLayer: Container | null = null) {
    groundLayer.addChild(this.ground);
  }

  get decor(): readonly Decor[] { return this.items; }

  private context(key: string, build: (g: GraphicsContext) => void): GraphicsContext {
    let context = this.contexts.get(key);
    if (!context) { context = new GraphicsContext(); build(context); this.contexts.set(key, context); }
    return context;
  }

  private clear(): void {
    for (const list of this.tall.values()) for (const item of list) item.destroy({ children: true });
    this.tall.clear();
    this.lampGlows.length = 0;
    this.tinted.length = 0;
    this.small.length = 0;
    this.hidden = [];
    this.ground.clear();
    for (const sprite of this.flat) sprite.destroy();
    for (const sprite of this.shadowSprites) sprite.destroy();
    this.flat.length = 0;
    this.shadowSprites.length = 0;
  }

  rebuild(plan: CityPlan): void {
    this.clear();
    this.items = planDecor(plan);
    const g = this.ground;
    const art = currentArt();
    for (const decor of this.items) {
      const p = iso(decor.at.x, decor.at.y);
      const baked = art ? selectDecorAsset(art.index, decor.kind, decor.variant) : null;
      const shadowTexture = baked ? art!.frame(baked.shadow) : null;
      if (shadowTexture && this.shadowLayer) {
        const shadow = new Sprite(shadowTexture);
        shadow.position.set(p.x, p.y);
        if (decor.kind !== 'lamp') shadow.scale.set(decor.size);
        this.shadowLayer.addChild(shadow);
        this.shadowSprites.push(shadow);
      }
      const flatTexture = FLAT_DECOR.has(decor.kind) && baked ? art!.frame(baked.color) : null;
      if (flatTexture) {
        const sprite = new Sprite(flatTexture);
        sprite.position.set(p.x, p.y);
        this.groundLayer.addChild(sprite);
        this.flat.push(sprite);
      } else if (decor.kind === 'flowers') {
        const colors = [[0xf2c14e, 0xf4efe2], [0xe58f7a, 0xf2c14e], [0xb9a3d6, 0xf4efe2]][decor.variant]!;
        g.ellipse(p.x, p.y, 7, 3.2).fill({ color: 0x6f9a62, alpha: 0.55 });
        for (const [dx, dy, c] of [[-3, 0, 0], [2, -1, 1], [0, 1.5, 0], [4, 1, 1], [-1, -1.6, 1]] as const) g.circle(p.x + dx, p.y + dy, 1.2).fill(colors[c]);
      } else if (decor.kind === 'stones' || decor.kind === 'grass') {
        g.ellipse(p.x, p.y, 3.2, 1.8).fill(0xb7b2a2).ellipse(p.x + 3.5, p.y + 1, 2.2, 1.3).fill(0xcbc6b6).ellipse(p.x - 0.5, p.y - 0.6, 1.4, 0.7).fill({ color: 0xffffff, alpha: 0.4 });
      }
      if (!TALL_DECOR.has(decor.kind)) continue;
      const item = new Container();
      item.label = 'decor';
      item.eventMode = 'none';
      item.position.set(p.x, p.y);
      item.zIndex = decor.at.x + decor.at.y - 0.05;
      const body = this.body(decor);
      if (decor.kind !== 'lamp') body.scale.set(decor.size);
      item.addChild(body);
      this.tinted.push(body);
      if (decor.kind === 'lamp') {
        const glow = new Graphics(this.context('lamp-glow', (c) => {
          c.ellipse(0, 1, 26, 12).fill({ color: 0xffd98a, alpha: 0.18 }).ellipse(0, 1, 14, 6.5).fill({ color: 0xffe3a6, alpha: 0.28 });
          c.circle(0, -19, 5).fill({ color: 0xfff1c4, alpha: 0.55 }).circle(0, -19, 2.2).fill({ color: 0xffffff, alpha: 0.95 });
        }));
        glow.alpha = this.glow;
        glow.visible = this.glow > 0.01;
        glow.blendMode = 'add';
        item.addChild(glow);
        this.lampGlows.push(glow);
      }
      this.scene.addChild(item);
      if (SMALL_DECOR.has(decor.kind)) { item.renderable = this.detailed; this.small.push(item); }
      const key = `${decor.tile.x},${decor.tile.y}`;
      this.tall.set(key, [...(this.tall.get(key) ?? []), item]);
    }
    this.applyLighting(this.tint, this.glow, true);
  }

  /** A sprite of the shared texture when a renderer is available; vector Graphics otherwise (tests). */
  private body(decor: Decor): Graphics | Sprite {
    const art = currentArt();
    const baked = art ? selectDecorAsset(art.index, decor.kind, decor.variant) : null;
    const bakedTexture = baked ? art!.frame(baked.color) : null;
    if (bakedTexture) return new Sprite(bakedTexture);
    const key = `${decor.kind}:${decor.variant}`;
    const context = this.context(key, (c) => this.draw(c, decor));
    if (!this.renderer) return new Graphics(context);
    let entry = this.textures.get(key);
    if (!entry) {
      const source = new Graphics(context);
      const bounds = source.getLocalBounds();
      const texture = this.renderer.generateTexture({ target: source, resolution: DECOR_TEXTURE_RESOLUTION, antialias: true });
      entry = { texture, anchor: { x: -bounds.minX / bounds.width, y: -bounds.minY / bounds.height } };
      source.destroy({ context: false });
      this.textures.set(key, entry);
    }
    const sprite = new Sprite(entry.texture);
    sprite.anchor.set(entry.anchor.x, entry.anchor.y);
    return sprite;
  }

  private draw(c: GraphicsContext, decor: Decor): void {
    // Draw through a temporary Graphics wrapper so the shared tree helper can be reused.
    const g = new Graphics(c);
    if (decor.kind === 'tree' || decor.kind === 'accent' || decor.kind === 'streetTree') tree(g, { x: 0, y: 0 }, 1, false, decor.variant);
    else if (decor.kind === 'palm') tree(g, { x: 0, y: 0 }, 1, true, decor.variant);
    else if (decor.kind === 'bush') {
      const tones = [[0x4f8d61, 0x67a273], [0x5e9459, 0x7aae6c], [0x467f63, 0x5f9a78]][decor.variant]!;
      c.ellipse(2, 1, 7, 2.6).fill({ color: 0x1f3324, alpha: 0.2 });
      c.circle(-2.5, -3, 3.8).fill(tones[0]).circle(2.5, -3.5, 4.2).fill(tones[0]).circle(0, -5.5, 3.6).fill(tones[1]);
      if (decor.variant === 1) c.circle(-1, -6, 0.9).fill(0xe58f7a).circle(2.5, -4.5, 0.9).fill(0xf2c14e);
    } else if (decor.kind === 'bench' || decor.kind === 'bin' || decor.kind === 'bikes' || decor.kind === 'planter') {
      // Vector fallback for street furniture: a small dark block on the curb.
      c.ellipse(1, 0.5, 4, 1.6).fill({ color: 0x1f3324, alpha: 0.2 });
      c.roundRect(-3.5, -4, 7, 4, 1).fill(decor.kind === 'planter' ? 0x6f9a62 : 0x6b5a48);
    } else if (decor.kind === 'lamp') {
      c.ellipse(1.5, 0.6, 3, 1.3).fill({ color: 0x1f3324, alpha: 0.25 });
      c.rect(-0.7, -19, 1.4, 19).fill(0x3c4a44);
      c.roundRect(-2.6, -21.5, 5.2, 3, 1.2).fill(0x2f3a35);
      c.circle(0, -19, 1.5).fill(0xf6e7b9);
    }
    g.destroy({ context: false });
  }

  /** Hide tall decorations on the given tiles (placement preview); pass null to restore. */
  hideUnder(tiles: ReadonlySet<string> | null): void {
    for (const item of this.hidden) item.visible = true;
    this.hidden = [];
    if (!tiles) return;
    for (const tile of tiles) for (const item of this.tall.get(tile) ?? []) { item.visible = false; this.hidden.push(item); }
  }

  /**
   * Level of detail: far out, decor shadows and small furniture are sub-pixel noise that costs fill rate, so they
   * stop rendering (renderable, so placement-preview hiding via `visible` is unaffected).
   */
  setDetail(scale: number): void {
    const detailed = scale >= LOD_SCALE;
    if (detailed === this.detailed) return;
    this.detailed = detailed;
    for (const item of this.small) item.renderable = detailed;
    if (this.shadowLayer) this.shadowLayer.renderable = detailed;
  }

  applyLighting(tint: number, glow: number, force = false): void {
    if (!force && tint === this.tint && glow === this.glow) return;
    this.tint = tint; this.glow = glow;
    for (const body of this.tinted) body.tint = tint;
    for (const light of this.lampGlows) { light.alpha = glow; light.visible = glow > 0.01; }
  }

  destroy(): void {
    this.clear();
    if (!this.ground.destroyed) this.ground.destroy();
    for (const context of this.contexts.values()) context.destroy();
    this.contexts.clear();
    for (const { texture } of this.textures.values()) texture.destroy(true);
    this.textures.clear();
  }
}
