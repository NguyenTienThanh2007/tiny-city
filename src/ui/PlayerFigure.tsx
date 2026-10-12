import type { PlayerAppearance } from '@tiny-city/simulation';
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

/** Full-body character, drawn from the same shape list as the in-world Pixi sprite. */
export function PlayerFigure({ appearance, size = 160, stride = 0, title }: { appearance: PlayerAppearance; size?: number; stride?: number; title?: string }) {
  const figure = playerFigure(appearance);
  return <svg className="player-figure" width={size * 0.72} height={size} viewBox="-10.5 -27.5 21 29" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
    {parts(figure, stride)}
  </svg>;
}

/** Head-and-shoulders crop of the same figure, for the HUD and profile. */
export function PlayerPortrait({ appearance, size = 56 }: { appearance: PlayerAppearance; size?: number }) {
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
