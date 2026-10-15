import { isPlayerPlaced } from '@tiny-city/simulation';
import type { Building, Position, RoadNavigator, WorldState } from '@tiny-city/simulation';
import { isClear, isWalkablePoint, type WalkGrid } from './collision';
import { FACING_DIRECTION, tileOf, yawFromGridDirection, type Facing } from './coordinates';
import { MOVEMENT } from './controller';

/**
 * Phase 8A spawn and entrance rules. Where the character appears when the Character View opens, from authoritative
 * state only. Nothing here changes the world: a character inside a building is shown at its door and stays inside
 * (resting, eating, visiting) until the player first moves, when the bridge commits the step out through the door.
 */

export type SpawnFailure = 'no-character' | 'no-home' | 'stranded';
export type SpawnSource = 'street' | 'door';
export type Spawn =
  | { readonly ok: true; readonly position: Position; readonly yaw: number; readonly source: SpawnSource; readonly buildingId: string | null }
  | { readonly ok: false; readonly reason: SpawnFailure };

/** Which sides of a building touch a road (any tile along the side). */
export function roadSides(b: Pick<Building, 'position' | 'footprint'>, isRoad: (x: number, y: number) => boolean) {
  const { x, y } = b.position, w = b.footprint.width, h = b.footprint.height;
  const along = (fn: (i: number) => boolean, n: number) => Array.from({ length: n }, (_, i) => i).some(fn);
  return {
    south: along((i) => isRoad(x + i, y + h), w), north: along((i) => isRoad(x + i, y - 1), w),
    east: along((i) => isRoad(x + w, y + i), h), west: along((i) => isRoad(x - 1, y + i), h),
  };
}

/**
 * Which way a building's front faces. S and E match the City View art exactly (a road on the south wins, then the
 * east); a building whose only roads are north or west turns its front to them in 3D so the entrance meets the street.
 */
export function facingFor(sides: { south: boolean; east: boolean; north: boolean; west: boolean }): Facing {
  return sides.south ? 'S' : sides.east ? 'E' : sides.north ? 'N' : sides.west ? 'W' : 'S';
}

/** The side of the footprint an access tile touches. */
function sideOf(b: Building, p: Position): Facing {
  if (p.y >= b.position.y + b.footprint.height) return 'S';
  if (p.y < b.position.y) return 'N';
  if (p.x >= b.position.x + b.footprint.width) return 'E';
  return 'W';
}

/**
 * The door spawn of a building: on the sidewalk of a road access tile, just outside the lot, facing the street.
 * Access tiles on the building's front side come first, then the stable tile order (deterministic).
 */
export function doorSpawn(b: Building, access: readonly Position[], facing: Facing, grid: WalkGrid): { position: Position; yaw: number } | null {
  const ranked = [...access].sort((p, q) => Number(sideOf(b, q) === facing) - Number(sideOf(b, p) === facing) || p.y - q.y || p.x - q.x);
  for (const tile of ranked) {
    const side = sideOf(b, tile), out = FACING_DIRECTION[side];
    // 0.13 tiles from the lot edge (on the sidewalk), centred on the tile along the edge.
    const inset = MOVEMENT.radius + 0.06;
    const position = {
      x: out.x === 0 ? tile.x + 0.5 : out.x > 0 ? tile.x + inset : tile.x + 1 - inset,
      y: out.y === 0 ? tile.y + 0.5 : out.y > 0 ? tile.y + inset : tile.y + 1 - inset,
    };
    if (isClear(grid, position, MOVEMENT.radius)) return { position, yaw: yawFromGridDirection(out.x, out.y) };
    // Street furniture in the way: try the tile centre instead.
    const centre = { x: tile.x + 0.5, y: tile.y + 0.5 };
    if (isClear(grid, centre, MOVEMENT.radius)) return { position: centre, yaw: yawFromGridDirection(out.x, out.y) };
  }
  return null;
}

/**
 * Resolves where the character appears. Priority: exactly where they stand or walk on the street; otherwise the door
 * of the building they are in or leaving (home or venue). A missing character, one still choosing a home, or one with
 * no street beside them gets an explanation instead of an invented position.
 */
export function resolveSpawn(world: WorldState, nav: RoadNavigator, grid: WalkGrid, rememberedYaw: number | null = null): Spawn {
  const player = world.player;
  if (!player) return { ok: false, reason: 'no-character' };
  if (!isPlayerPlaced(player)) return { ok: false, reason: 'no-home' };
  const m = player.movement;
  if (m.status !== 'inside' && isWalkablePoint(grid, player.position)) {
    const heading = m.heading.x !== 0 || m.heading.y !== 0 ? yawFromGridDirection(m.heading.x, m.heading.y) : null;
    // A walker exactly against furniture is still placed where the simulation has them (they slide off on the first step).
    return { ok: true, position: player.position, yaw: rememberedYaw ?? heading ?? 0, source: 'street', buildingId: null };
  }
  const building = nav.getBuilding(m.currentBuildingId) ?? (() => {
    const cell = nav.grid.get(tileOf(player.position));
    return cell?.type === 'building' ? nav.getBuilding(cell.buildingId) : undefined;
  })();
  if (!building) return { ok: false, reason: 'stranded' };
  const isRoad = (x: number, y: number) => nav.grid.get({ x, y })?.type === 'road';
  const door = doorSpawn(building, nav.getAccessPoints(building.id), facingFor(roadSides(building, isRoad)), grid);
  return door ? { ok: true, ...door, source: 'door', buildingId: building.id } : { ok: false, reason: 'stranded' };
}

export const SPAWN_FAILURE_TEXT: Readonly<Record<SpawnFailure, { title: string; body: string; action: string }>> = {
  'no-character': { title: 'Create your character first', body: 'The 3D world is lived in by your Life Mode character. Create one, choose a home, then enter the world.', action: 'Create character' },
  'no-home': { title: 'Choose a home first', body: 'Your character is waiting for a home. Once they move in, you can walk out of the front door in 3D.', action: 'Choose a home' },
  stranded: { title: 'No street beside your character', body: 'There is no road next to where your character is, so there is nowhere to stand. Connect their building to a road, or send them home, then try again.', action: 'Back to the city' },
};
