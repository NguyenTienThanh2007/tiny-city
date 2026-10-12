import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Citizen } from '@tiny-city/simulation';
import { BUILDINGS, isLandCell, type Cell, type CityState } from '../types';
import { isCitizenOutdoors } from '../game/npcMotion';

type FootprintPoint = { x: number; y: number };

const roleColors = { home: '#e7a774', park: '#cfe7a2', workplace: '#a9cfd2' } as const;

export function MiniMap({ city, citizens, cameraFootprint, selectedCitizenId, selectedFootprint = null, onNavigate }: {
  city: CityState;
  citizens: readonly Citizen[];
  cameraFootprint: FootprintPoint[] | null;
  selectedCitizenId: string | null;
  selectedFootprint?: { x: number; y: number; width: number; height: number } | null;
  onNavigate: (cell: Cell) => void;
}) {
  // Press-and-drag scrubs the camera across the map; a plain click still jumps there.
  const dragging = useRef(false);
  const cellAt = (event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>): Cell => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(city.size, (event.clientX - bounds.left) / bounds.width * city.size)),
      y: Math.max(0, Math.min(city.size, (event.clientY - bounds.top) / bounds.height * city.size)) };
  };
  const size = city.size;
  const pct = (value: number) => (value / size) * 100;
  // Coastline polygon from the land mask: the diagonal beach the terrain renderer draws.
  const coastStart = size * 2 - 8;
  const coast = `${pct(coastStart - size)},100 100,${pct(coastStart - size)} 100,100`;
  const outdoors = citizens.filter((citizen) => isCitizenOutdoors(citizen) || citizen.id === selectedCitizenId).slice(0, 600);
  return <div className="minimap" role="button" tabIndex={0} aria-label="Navigate neighborhood overview"
    title="Click to center the camera on a map location"
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNavigate({ x: size / 2, y: size / 2 }); } }}
    onClick={(event) => onNavigate(cellAt(event))}
    onPointerDown={(event) => { if (event.button === 0) dragging.current = true; }}
    onPointerMove={(event) => { if (dragging.current && event.buttons === 1) onNavigate(cellAt(event)); }}
    onPointerUp={() => { dragging.current = false; }}
    onPointerLeave={() => { dragging.current = false; }}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Neighborhood overview">
      <rect width="100" height="100" fill="#8fb98a" />
      <polygon points={coast} fill="#7cbcbc" />
      {isLandCell(size - 1, size - 1, size) ? null : <polyline points={`${pct(coastStart - size - 2)},100 100,${pct(coastStart - size - 2)}`} stroke="#e6d7a8" strokeWidth="2.4" fill="none" vectorEffect="non-scaling-stroke" />}
      <g fill="#f1e9d2">{city.roads.map(({ x, y }, index) => <circle key={`${x}-${y}-${index}`} data-testid={index === 0 ? 'minimap-road-first' : undefined}
        cx={pct(x + 0.5)} cy={pct(y + 0.5)} r="0.95" />)}</g>
      <g>{city.buildings.map((building) => {
        const spec = BUILDINGS[building.kind];
        return <g key={building.id}>
          <rect x={pct(building.x)} y={pct(building.y)} width={pct(spec.width)} height={pct(spec.height)} rx="0.6" fill={roleColors[spec.role]} opacity=".9" />
          <circle data-testid={`minimap-building-${building.id}`} cx={pct(building.x + spec.width / 2)} cy={pct(building.y + spec.height / 2)} r="0.9" fill="#24382c" opacity=".35" />
        </g>;
      })}</g>
      <g>{outdoors.map((citizen) => <circle key={citizen.id} cx={pct(citizen.position.x)} cy={pct(citizen.position.y)}
        r={citizen.id === selectedCitizenId ? 1.6 : 0.85} fill={citizen.id === selectedCitizenId ? '#ffd36e' : '#2f4a3a'}
        stroke={citizen.id === selectedCitizenId ? '#24382c' : 'none'} strokeWidth="0.5" />)}</g>
      {selectedFootprint && <rect x={pct(selectedFootprint.x) - 0.6} y={pct(selectedFootprint.y) - 0.6} width={pct(selectedFootprint.width) + 1.2}
        height={pct(selectedFootprint.height) + 1.2} rx="0.8" fill="none" stroke="#ffc94d" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
      {cameraFootprint && <polygon
        data-testid="minimap-camera"
        points={cameraFootprint.map(({ x, y }) => `${(x / size) * 100},${(y / size) * 100}`).join(' ')}
        fill="#fff6d9"
        fillOpacity="0.16"
        stroke="#fff6d9"
        strokeWidth="1.3"
        vectorEffect="non-scaling-stroke"
      />}
    </svg>
  </div>;
}
