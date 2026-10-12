// Shared projection constants. Must match src/game/mapGeometry.ts (TILE_W 56, TILE_H 28) so baked sprites sit
// exactly on the game's 2:1 isometric grid: one tile edge projects to (28, 14) world px.
export const TILE_W = 56;
export const TILE_H = 28;
/** World px per scene unit along the camera's horizontal axis: 28 px = k / sqrt(2). */
export const PX_PER_UNIT = (TILE_W / 2) * Math.SQRT2;
/** Camera elevation for a 2:1 dimetric view (sin 30° = TILE_H / TILE_W). */
export const ELEVATION = Math.asin(TILE_H / TILE_W);
/** One scene unit of height covers this many world px on screen (matches buildingLift in px). */
export const HEIGHT_PX_PER_UNIT = PX_PER_UNIT * Math.cos(ELEVATION);
/** Converts the game's lift heights (world px) to scene units. */
export const liftToUnits = (px) => px / HEIGHT_PX_PER_UNIT;
