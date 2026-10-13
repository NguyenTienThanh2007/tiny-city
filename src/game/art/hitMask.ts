/**
 * Pixel-accurate picking for baked building art. Since Visual World 3.0B buildings can rise above the legacy
 * clickable box (`buildingLift + roofCapHeight`), so clicks are also tested against the sprite's own alpha.
 * Masks are stored at world-pixel resolution (one byte per world px), built once when an atlas loads.
 */
export interface HitMask { readonly width: number; readonly height: number; readonly data: Uint8Array }

/** Opacity (0–255) above which a pixel counts as solid; soft edges and glass reflections below it do not. */
export const HIT_ALPHA = 96;

/**
 * Builds a mask for one frame from the RGBA data of its atlas page. `frame` is in texture px; `resolution` is the
 * page's texture px per world px. Each world px is solid if any covered texture px is solid.
 */
export function buildHitMask(rgba: Uint8ClampedArray | Uint8Array, pageWidth: number,
  frame: { x: number; y: number; w: number; h: number }, resolution: number, threshold = HIT_ALPHA): HitMask {
  const width = Math.max(1, Math.ceil(frame.w / resolution)), height = Math.max(1, Math.ceil(frame.h / resolution));
  const data = new Uint8Array(width * height);
  for (let ty = 0; ty < frame.h; ty += 1) {
    const row = (frame.y + ty) * pageWidth;
    const my = Math.floor(ty / resolution) * width;
    for (let tx = 0; tx < frame.w; tx += 1) {
      if (rgba[(row + frame.x + tx) * 4 + 3]! > threshold) data[my + Math.floor(tx / resolution)] = 1;
    }
  }
  return { width, height, data };
}

/** True when the world-px offset (from the frame's top-left) lands on a solid pixel. */
export function hitMask(mask: HitMask, x: number, y: number): boolean {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= mask.width || iy >= mask.height) return false;
  return mask.data[iy * mask.width + ix] === 1;
}
