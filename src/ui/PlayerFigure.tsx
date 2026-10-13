import { useEffect, useMemo, useState } from 'react';
import type { PlayerAppearance } from '@tiny-city/simulation';
import { currentArt, loadArt, type ArtLibrary } from '../game/art/artLibrary';
import { characterLayers, frameName, lookFromAppearance, type CharacterPose } from '../game/art/characterLook';
import { css, FIGURE_ORDER, playerFigure, type PlayerFigure as Figure, type Shape } from '../game/playerLook';

function ShapeSvg({ shape }: { shape: Shape }) {
  const opacity = 'alpha' in shape && shape.alpha !== undefined ? shape.alpha : undefined;
  switch (shape.kind) {
    case 'rect': return <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r} fill={css(shape.fill)} opacity={opacity} />;
    case 'circle': return <circle cx={shape.x} cy={shape.y} r={shape.r} fill={css(shape.fill)} opacity={opacity} />;
    case 'ellipse': return <ellipse cx={shape.x} cy={shape.y} rx={shape.rx} ry={shape.ry} fill={css(shape.fill)} opacity={opacity} />;
    case 'poly': return <polygon points={shape.points.join(' ')} fill={css(shape.fill)} opacity={opacity} />;
    case 'line': return <polyline points={shape.points.join(' ')} fill="none" stroke={css(shape.color)} strokeWidth={shape.width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />;
  }
}

function parts(figure: Figure, stride: number) {
  return FIGURE_ORDER.map((part) => {
    if (part === 'legs') {
      return <g key="legs">
        <g transform={`translate(${figure.legPivot.left.join(' ')}) rotate(${stride * 18})`}>{figure.legLeft.map((s, i) => <ShapeSvg key={i} shape={s} />)}</g>
        <g transform={`translate(${figure.legPivot.right.join(' ')}) rotate(${-stride * 18})`}>{figure.legRight.map((s, i) => <ShapeSvg key={i} shape={s} />)}</g>
      </g>;
    }
    return <g key={part}>{figure[part].map((s, i) => <ShapeSvg key={i} shape={s} />)}</g>;
  });
}

/** The baked character art once loaded (null until then, and in tests without assets). */
function useCharacterArt(): ArtLibrary | null {
  const [art, setArt] = useState<ArtLibrary | null>(() => (currentArt()?.index.manifest.characters ? currentArt() : null));
  useEffect(() => {
    let live = true;
    void loadArt().then((library) => { if (live && library?.index.manifest.characters) setArt(library); });
    return () => { live = false; };
  }, []);
  return art;
}

/**
 * Composites one frame of the baked character (the same layers and tints as the map) on a canvas.
 * `crop` keeps the head and shoulders for portraits.
 */
function drawCharacter(canvas: HTMLCanvasElement, art: ArtLibrary, appearance: PlayerAppearance, pose: CharacterPose, frame: number, crop: boolean) {
  // CPU-backed: the frame is exported with toDataURL, and a GPU-backed canvas would read it back through the GPU
  // process (SwiftShader on CI and on machines without a GPU, shared with the map's WebGL) on the main thread.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const look = lookFromAppearance(appearance);
  const height = art.index.manifest.characters!.height * 34.29; // world px of the figure
  // Figure fills the canvas height (portraits: zoom to the upper 45%).
  // Full figure: feet near the bottom with headroom for hats. Portrait: head and shoulders (the top ~55%).
  const scale = crop ? h / (height * 0.6) : h / (height * 1.4);
  const footX = w / 2, footY = crop ? h * 0.97 + height * 0.52 * scale : h * 0.94;
  const tmp = document.createElement('canvas');
  const t = tmp.getContext('2d', { willReadFrequently: true });
  if (!t) return;
  for (const ref of characterLayers(look, 'front', pose)) {
    const src = art.source(frameName(ref, 'front', pose, frame));
    if (!src) continue;
    const k = scale / src.resolution;
    const dw = Math.ceil(src.w * k), dh = Math.ceil(src.h * k);
    tmp.width = dw; tmp.height = dh;
    t.clearRect(0, 0, dw, dh);
    t.globalCompositeOperation = 'source-over';
    t.imageSmoothingQuality = 'high';
    t.drawImage(src.image, src.x, src.y, src.w, src.h, 0, 0, dw, dh);
    if (ref.tint !== null) {
      // Multiply tint (as Pixi does), then restore the layer's own alpha.
      t.globalCompositeOperation = 'multiply';
      t.fillStyle = css(ref.tint);
      t.fillRect(0, 0, dw, dh);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(src.image, src.x, src.y, src.w, src.h, 0, 0, dw, dh);
    }
    ctx.drawImage(tmp, Math.round(footX - src.ax * k), Math.round(footY - src.ay * k));
  }
}

/** Encoded frames by appearance, size and pose: the creator's walk cycle is drawn once, then only swaps images. */
const frameCache = new Map<string, string>();
const FRAME_CACHE_LIMIT = 240;
let scratch: HTMLCanvasElement | null = null;

function characterFrame(art: ArtLibrary, appearance: PlayerAppearance, appearanceKey: string, width: number, height: number, dpr: number,
  crop: boolean, pose: CharacterPose, frame: number): string {
  const key = `${appearanceKey}|${width}x${height}@${dpr}|${crop ? 'crop' : 'full'}|${pose}:${frame}`;
  const cached = frameCache.get(key);
  if (cached !== undefined) return cached;
  scratch ??= document.createElement('canvas');
  scratch.width = Math.round(width * dpr); scratch.height = Math.round(height * dpr);
  drawCharacter(scratch, art, appearance, pose, frame, crop);
  let url = '';
  try { url = scratch.toDataURL('image/png'); } catch { url = ''; }
  if (frameCache.size >= FRAME_CACHE_LIMIT) frameCache.delete(frameCache.keys().next().value!);
  frameCache.set(key, url);
  return url;
}

/**
 * Draws offscreen and shows the result as an <img>, so the map stays the page's only <canvas> (tests and tools
 * address it as `canvas`). Frames are cached, so animation and HUD refreshes cost an image swap, not a redraw.
 */
function CharacterCanvas({ art, appearance, width, height, crop, animate, className, title }: {
  art: ArtLibrary; appearance: PlayerAppearance; width: number; height: number; crop: boolean; animate: boolean; className: string; title?: string;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 115);
    return () => window.clearInterval(timer);
  }, [animate]);
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  // Keyed by value: the HUD hands over a fresh appearance object with every world snapshot.
  const appearanceKey = JSON.stringify(appearance);
  // The creator preview walks in place; portraits stay still.
  const pose: CharacterPose = animate && tick > 0 ? 'walk' : 'idle';
  const frame = pose === 'walk' ? tick % 8 : 0;
  // `appearance` itself is covered by its value key.
  const src = useMemo(() => characterFrame(art, appearance, appearanceKey, width, height, dpr, crop, pose, frame),
    [art, appearanceKey, width, height, dpr, crop, pose, frame]);
  return <img className={className} src={src || undefined} width={width} height={height} alt={title ?? ''} role={title ? 'img' : 'presentation'}
    aria-label={title} aria-hidden={title ? undefined : true} data-art="baked" draggable={false} />;
}

/** Full-body character: the baked 3.0C figure when its art is loaded, else the vector figure (same appearance). */
export function PlayerFigure({ appearance, size = 160, stride = 0, title, animate = false }: { appearance: PlayerAppearance; size?: number; stride?: number; title?: string; animate?: boolean }) {
  const art = useCharacterArt();
  if (art) return <CharacterCanvas art={art} appearance={appearance} width={size * 0.72} height={size} crop={false} animate={animate} className="player-figure" title={title} />;
  const figure = playerFigure(appearance);
  return <svg className="player-figure" width={size * 0.72} height={size} viewBox="-10.5 -27.5 21 29" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
    {parts(figure, stride)}
  </svg>;
}

/** Head-and-shoulders crop of the same figure, for the HUD and profile. */
export function PlayerPortrait({ appearance, size = 56 }: { appearance: PlayerAppearance; size?: number }) {
  const art = useCharacterArt();
  if (art) return <CharacterCanvas art={art} appearance={appearance} width={size} height={size} crop animate={false} className="player-portrait baked" />;
  const figure = playerFigure(appearance);
  return <svg className="player-portrait" width={size} height={size} viewBox="-8.5 -27 17 17" aria-hidden="true">
    <defs>
      <linearGradient id="player-portrait-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f6e2d7" /><stop offset="1" stopColor="#e8efe1" /></linearGradient>
      <clipPath id="player-portrait-clip"><rect x="-8.5" y="-27" width="17" height="17" rx="5" /></clipPath>
    </defs>
    <rect x="-8.5" y="-27" width="17" height="17" rx="5" fill="url(#player-portrait-sky)" />
    <g clipPath="url(#player-portrait-clip)">{parts(figure, 0)}</g>
  </svg>;
}
