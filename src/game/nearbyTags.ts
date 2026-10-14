import { Container, Graphics, Text } from 'pixi.js';
import type { Citizen, Position } from '@tiny-city/simulation';
import { iso } from './mapGeometry';
import { isCitizenOutdoors } from './npcMotion';

/** Residents named on the map in Life View: the nearest few outdoors within `radius` tiles of the character. */
export function nearbyTagIds(citizens: readonly Citizen[], at: Position, exclude: ReadonlySet<string>, radius = 5, limit = 3): string[] {
  const found: { id: string; distance: number }[] = [];
  for (const citizen of citizens) {
    if (exclude.has(citizen.id) || !isCitizenOutdoors(citizen)) continue;
    const distance = Math.hypot(citizen.position.x - at.x, citizen.position.y - at.y);
    if (distance <= radius) found.push({ id: citizen.id, distance });
  }
  return found.sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : 1)).slice(0, limit).map((entry) => entry.id);
}

type Tag = { root: Container; bg: Graphics; text: Text; label: string };

/**
 * Small, quiet name tags over nearby residents (Phase 4.6). Membership is recomputed a few times per second; tags
 * only move per frame, and their text and background are redrawn only when the name changes. The hovered or
 * selected resident keeps the full nameplate instead.
 */
export class NearbyTags {
  private readonly root = new Container();
  private readonly tags: Tag[] = [];
  private ids: string[] = [];
  private lastPick = -Infinity;

  constructor(parent: Container, index: number) {
    this.root.label = 'nearby-tags';
    this.root.eventMode = 'none';
    this.root.visible = false;
    parent.addChildAt(this.root, index);
  }

  get shown(): readonly string[] { return this.root.visible ? this.ids : []; }

  update(opts: { active: boolean; nowMs: number; citizens: readonly Citizen[]; at: Position | null; exclude: ReadonlySet<string>;
    rendered: (id: string) => Position | null; lift: number; zoom: number; character?: Position | null }) {
    if (!opts.active || !opts.at) { this.root.visible = false; this.ids = []; return; }
    if (opts.nowMs - this.lastPick >= 300) {
      this.lastPick = opts.nowMs;
      this.ids = nearbyTagIds(opts.citizens, opts.at, opts.exclude);
    }
    this.root.visible = true;
    const inverse = 1 / Math.max(0.35, Math.min(1.4, opts.zoom));
    const names = new Map(opts.citizens.map((citizen) => [citizen.id, citizen.name]));
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    // Tags never cover the character: their figure and "you" marker are reserved first.
    if (opts.character) {
      const at = iso(opts.character.x, opts.character.y), half = 16 * inverse;
      placed.push({ left: at.x - half, right: at.x + half, top: at.y - opts.lift * 1.6, bottom: at.y + 4 });
    }
    for (let index = 0; index < Math.max(this.ids.length, this.tags.length); index += 1) {
      const id = this.ids[index];
      const position = id ? opts.rendered(id) : null;
      const tag = this.tags[index] ?? (id ? this.create() : null);
      if (!tag) continue;
      if (!id || !position || opts.exclude.has(id)) { tag.root.visible = false; continue; }
      const label = names.get(id) ?? '';
      if (label !== tag.label) this.redraw(tag, label);
      const point = iso(position.x, position.y);
      // Residents walking side by side: stack their tags instead of overlapping them.
      const width = tag.bg.width * inverse, height = tag.bg.height * inverse;
      let y = point.y - opts.lift;
      for (let tries = 0; tries < 3; tries += 1) {
        const hit = placed.find((r) => point.x - width / 2 < r.right && point.x + width / 2 > r.left && y - height < r.bottom && y > r.top);
        if (!hit) break;
        y = hit.top - 2 * inverse;
      }
      placed.push({ left: point.x - width / 2, right: point.x + width / 2, top: y - height, bottom: y });
      tag.root.position.set(point.x, y);
      tag.root.scale.set(inverse);
      tag.root.visible = true;
    }
  }

  private create(): Tag {
    const root = new Container();
    const bg = new Graphics();
    const text = new Text({ text: '', style: { fontFamily: 'Manrope, Inter, sans-serif', fontSize: 10, fontWeight: '700', fill: '#2f4a3a' } });
    text.anchor.set(0.5, 1);
    root.addChild(bg, text);
    this.root.addChild(root);
    const tag = { root, bg, text, label: '' };
    this.tags.push(tag);
    return tag;
  }

  private redraw(tag: Tag, label: string) {
    tag.label = label;
    tag.text.text = label;
    const width = tag.text.width + 10, height = tag.text.height + 4;
    tag.bg.clear().roundRect(-width / 2, -height + 1, width, height, height / 2).fill({ color: 0xfbf7ee, alpha: 0.82 });
  }
}
