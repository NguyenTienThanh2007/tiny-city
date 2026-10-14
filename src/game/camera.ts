import { iso, toGrid, type Point } from './mapGeometry';

/**
 * Phase 4.6 camera. One authoritative pose — the world point shown at the centre of the unobstructed viewport, and a
 * zoom — from which the Pixi world transform, pointer picking and the minimap footprint are all derived.
 *
 *   screen = focal + (world − pose) · zoom        world = pose + (screen − focal) / zoom
 *
 * `focal` is the centre of the canvas area not covered by HUD panels (`insets`), in CSS pixels, so panels never
 * hide the point the camera is looking at. Everything here is pure except `CameraController`, which only keeps
 * state and is advanced explicitly with elapsed time; it never reads clocks, the DOM or the simulation.
 */
export type Insets = { left: number; right: number; top: number; bottom: number };
export type Viewport = { width: number; height: number; insets: Insets };
export type CameraPose = { x: number; y: number; zoom: number };
export type Box = { left: number; top: number; width: number; height: number; cx: number; cy: number };

export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
/** Absolute zoom limits; the effective minimum also depends on the viewport (`zoomLimits`). */
export const ZOOM_FLOOR = 0.08;
/** Atlases are baked at 2× resolution, so close-ups stay sharp up to about 2× on standard displays. */
export const ZOOM_MAX = 2.4;
/**
 * Life View frames the character at this zoom: the figure is ~45 CSS px tall and the neighbouring houses stay in
 * view (about nine tiles across the visible area on a laptop). Phones use a slightly wider framing.
 */
export const LIFE_ZOOM = 1.85;
export const LIFE_ZOOM_COMPACT = 1.45;
/** Below this zoom characters are hard to read, so Focus zooms in to the Life View zoom. */
export const READABLE_ZOOM = 1.2;
/** Keyboard/button zoom step: exact inverses (×1.25 and ×0.8). */
export const ZOOM_STEP = 1.25;
/** Smoothing time constants (ms) for frame-rate-independent exponential approach. */
export const ZOOM_TAU_MS = 55;
export const FOLLOW_TAU_MS = 140;
/** Grid tiles the screen centre may stray beyond the map edge. */
const EDGE_MARGIN_TILES = 1.5;
/** Tall buildings and trees rise above the map's top corner. */
const SKYLINE_PX = 160;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** The part of the canvas not covered by HUD panels (never smaller than 120 px each way). */
export function visibleBox(viewport: Viewport): Box {
  const left = clamp(viewport.insets.left, 0, viewport.width), top = clamp(viewport.insets.top, 0, viewport.height);
  const width = Math.max(120, viewport.width - left - clamp(viewport.insets.right, 0, viewport.width));
  const height = Math.max(120, viewport.height - top - clamp(viewport.insets.bottom, 0, viewport.height));
  return { left, top, width, height, cx: left + width / 2, cy: top + height / 2 };
}
export function focalPoint(viewport: Viewport): Point {
  const box = visibleBox(viewport);
  return { x: box.cx, y: box.cy };
}

export function worldToScreen(pose: CameraPose, viewport: Viewport, point: Point): Point {
  const focal = focalPoint(viewport);
  return { x: focal.x + (point.x - pose.x) * pose.zoom, y: focal.y + (point.y - pose.y) * pose.zoom };
}
export function screenToWorld(pose: CameraPose, viewport: Viewport, point: Point): Point {
  const focal = focalPoint(viewport);
  return { x: pose.x + (point.x - focal.x) / pose.zoom, y: pose.y + (point.y - focal.y) / pose.zoom };
}
/** Pixi world container transform for a pose: `position + local · scale` equals `worldToScreen`. */
export function worldTransform(pose: CameraPose, viewport: Viewport): { x: number; y: number; scale: number } {
  const focal = focalPoint(viewport);
  return { x: focal.x - pose.x * pose.zoom, y: focal.y - pose.y * pose.zoom, scale: pose.zoom };
}

/** Changes zoom while the world point under `screen` stays under it. */
export function zoomAt(pose: CameraPose, viewport: Viewport, screen: Point, zoom: number): CameraPose {
  const anchor = screenToWorld(pose, viewport, screen);
  return anchoredPose(anchor, screen, viewport, zoom);
}
function anchoredPose(anchor: Point, screen: Point, viewport: Viewport, zoom: number): CameraPose {
  const focal = focalPoint(viewport);
  return { x: anchor.x - (screen.x - focal.x) / zoom, y: anchor.y - (screen.y - focal.y) / zoom, zoom };
}
/** Drags the world by a screen-pixel delta (the content follows the pointer at every zoom). */
export function panBy(pose: CameraPose, dx: number, dy: number): CameraPose {
  return { x: pose.x - dx / pose.zoom, y: pose.y - dy / pose.zoom, zoom: pose.zoom };
}

/** World-space extent of a `size`×`size` map, including the skyline above its top corner. */
export function mapExtent(size: number) {
  return { left: iso(0, size).x, right: iso(size, 0).x, top: -SKYLINE_PX, bottom: iso(size, size).y };
}
/** Zoom range for a viewport: zooming out stops once the whole map fits (a little sea around it). */
export function zoomLimits(viewport: Viewport, size: number): { min: number; max: number } {
  const box = visibleBox(viewport), map = mapExtent(size);
  const fit = Math.min(box.width / (map.right - map.left), box.height / (map.bottom - map.top));
  return { min: clamp(fit * 0.92, ZOOM_FLOOR, 0.6), max: ZOOM_MAX };
}

/**
 * Keeps the camera on the map. The visible centre stays within the map diamond (plus a small margin), and on any
 * axis where the view is wider than the map, the map stays fully on screen, so a zoomed-out city can never slide
 * into a corner of empty sea. Inside those limits every user pan is kept.
 */
export function clampPose(pose: CameraPose, viewport: Viewport, size: number): CameraPose {
  const limits = zoomLimits(viewport, size);
  const zoom = clamp(pose.zoom, limits.min, limits.max);
  const grid = toGrid(pose);
  const inside = iso(clamp(grid.x, -EDGE_MARGIN_TILES, size + EDGE_MARGIN_TILES), clamp(grid.y, -EDGE_MARGIN_TILES, size + EDGE_MARGIN_TILES));
  let { x, y } = inside;
  const box = visibleBox(viewport), map = mapExtent(size);
  const halfW = box.width / 2 / zoom, halfH = box.height / 2 / zoom;
  if (halfW * 2 >= map.right - map.left) x = clamp(x, map.right - halfW, map.left + halfW);
  if (halfH * 2 >= map.bottom - map.top) y = clamp(y, map.bottom - halfH, map.top + halfH);
  return { x, y, zoom };
}

/**
 * Zoom factor for one wheel event. Proportional to the delta, so trackpads (many small deltas, including zeros)
 * and mouse notches zoom by the same amount for the same scroll distance, and opposite deltas cancel exactly.
 * Pinch gestures arrive as ctrl+wheel with small deltas and get a higher gain.
 */
export function wheelZoomFactor(event: { deltaY: number; deltaMode?: number; ctrlKey?: boolean }): number {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
  const pixels = clamp(event.deltaY * unit, -240, 240);
  return Math.exp(-pixels * (event.ctrlKey ? 0.01 : 0.0018));
}

/** Fraction of the remaining distance covered in `dtMs` with time constant `tauMs` (frame-rate independent). */
export function approach(dtMs: number, tauMs: number): number {
  return dtMs <= 0 ? 0 : 1 - Math.exp(-dtMs / tauMs);
}
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function lifeZoomFor(viewport: Viewport): number {
  return visibleBox(viewport).width < 520 ? LIFE_ZOOM_COMPACT : LIFE_ZOOM;
}
/** Glide duration grows with the distance travelled on screen (and the zoom change), within 260–700 ms. */
export function glideDuration(from: CameraPose, to: CameraPose): number {
  const zoom = Math.max(from.zoom, to.zoom);
  const distance = Math.hypot(to.x - from.x, to.y - from.y) * zoom;
  return clamp(260 + distance * 0.35 + Math.abs(Math.log(to.zoom / from.zoom)) * 160, 260, 700);
}

type Glide = { from: CameraPose; to: CameraPose; elapsed: number; duration: number; track: boolean };
type ZoomGoal = { zoom: number; screen: Point | null; anchor: Point };
/** Read-only camera state for diagnostics and tests (`window.__tinyCityCamera`); `subject` is the followed point. */
export type CameraSnapshot = CameraPose & { following: boolean; moving: boolean; width: number; height: number; focalX: number; focalY: number;
  minZoom: number; maxZoom: number; subject?: Point | null };

/**
 * Camera state and motion. Input methods change the goal; `update(dt, followPoint)` advances motion by elapsed time
 * and reports whether the pose changed. Rules that keep motions from fighting:
 * - a pan cancels any glide and zoom animation and ends Follow;
 * - wheel/button zoom cancels a glide, except while following, where zoom is anchored on the followed point;
 * - a glide (focus, reset, view change) replaces any earlier glide; one tracking a moving target hands over to Follow;
 * - Follow is exponential smoothing toward the target, so a stationary target leaves the camera still.
 */
export class CameraController {
  pose: CameraPose;
  viewport: Viewport;
  following = false;
  private glide: Glide | null = null;
  private zoomGoal: ZoomGoal | null = null;

  constructor(viewport: Viewport, readonly size: number, pose: CameraPose, public reducedMotion = false) {
    this.viewport = viewport;
    this.pose = clampPose(pose, viewport, size);
  }

  get moving(): boolean { return this.glide !== null || this.zoomGoal !== null; }
  /** The zoom the camera is heading to (the current zoom when it is still). */
  get targetZoom(): number { return this.zoomGoal?.zoom ?? this.glide?.to.zoom ?? this.pose.zoom; }
  limits() { return zoomLimits(this.viewport, this.size); }
  toScreen(point: Point) { return worldToScreen(this.pose, this.viewport, point); }
  toWorld(point: Point) { return screenToWorld(this.pose, this.viewport, point); }
  snapshot(): CameraSnapshot {
    const focal = focalPoint(this.viewport), limits = this.limits();
    return { ...this.pose, following: this.following, moving: this.moving, width: this.viewport.width, height: this.viewport.height, focalX: focal.x, focalY: focal.y,
      minZoom: limits.min, maxZoom: limits.max };
  }

  /**
   * Resizes or re-insets the viewport. A resize keeps the looked-at point at the centre of the visible area. A panel
   * opening or closing (insets only) keeps the picture exactly where it is, so the world never shifts under the
   * pointer; framing actions (Focus, Follow, Life View, home) use the new visible area from then on.
   */
  setViewport(viewport: Viewport) {
    const previous = this.viewport;
    if (previous.width === viewport.width && previous.height === viewport.height && sameInsets(previous.insets, viewport.insets)) return;
    this.viewport = viewport;
    if (previous.width === viewport.width && previous.height === viewport.height) {
      const oldFocal = focalPoint(previous), newFocal = focalPoint(viewport);
      const shift = (pose: CameraPose): CameraPose => ({ x: pose.x + (newFocal.x - oldFocal.x) / pose.zoom, y: pose.y + (newFocal.y - oldFocal.y) / pose.zoom, zoom: pose.zoom });
      this.pose = shift(this.pose);
    }
    this.pose = clampPose(this.pose, viewport, this.size);
    if (this.glide) this.glide.to = clampPose(this.glide.to, viewport, this.size);
  }

  /** Immediately shows a pose (initial framing, renderer recreation). */
  jumpTo(pose: CameraPose) {
    this.glide = null; this.zoomGoal = null;
    this.pose = clampPose(pose, this.viewport, this.size);
  }
  /** Smoothly moves to a pose (instant with reduced motion). */
  glideTo(pose: CameraPose, duration?: number) {
    this.zoomGoal = null;
    const to = clampPose(pose, this.viewport, this.size);
    if (this.reducedMotion) { this.glide = null; this.pose = to; return; }
    this.glide = { from: { ...this.pose }, to, elapsed: 0, duration: duration ?? glideDuration(this.pose, to), track: false };
  }

  /** Pointer drag by a screen delta. Ends Follow; returns whether Follow was on. */
  pan(dx: number, dy: number): boolean {
    if (this.zoomGoal) { this.settleZoom(); }
    this.glide = null;
    const wasFollowing = this.following;
    this.following = false;
    this.pose = clampPose(panBy(this.pose, dx, dy), this.viewport, this.size);
    return wasFollowing;
  }

  /** Two-finger gesture: pans by the midpoint's movement and zooms about it, immediately. Returns whether Follow ended. */
  gesture(dx: number, dy: number, factor: number, screen: Point): boolean {
    const wasFollowing = this.pan(dx, dy);
    const limits = this.limits();
    this.pose = clampPose(zoomAt(this.pose, this.viewport, screen, clamp(this.pose.zoom * factor, limits.min, limits.max)), this.viewport, this.size);
    return wasFollowing;
  }

  /** Zooms by `factor` toward the goal zoom, anchored at `screen` (or the focal point while following / for buttons). */
  zoomBy(factor: number, screen: Point | null = null) {
    const limits = this.limits();
    const zoom = clamp(this.targetZoom * factor, limits.min, limits.max);
    const anchorScreen = this.following ? null : screen;
    if (this.glide) {
      // Following (or tracking toward the character): keep the glide and change only where it ends.
      if (this.glide.track || this.following) { this.glide.to = { ...this.glide.to, zoom }; return; }
      this.glide = null;
    }
    // While a zoom at the same spot is still animating, keep its original anchor: the bounds may shift the view while
    // zoomed out, but zooming back then lands exactly where the gesture began (no drift from clamping).
    const goal = this.zoomGoal;
    const sameSpot = goal !== null && (goal.screen === null ? anchorScreen === null
      : anchorScreen !== null && Math.hypot(goal.screen.x - anchorScreen.x, goal.screen.y - anchorScreen.y) < 2);
    const anchor = sameSpot ? goal.anchor : anchorScreen ? this.toWorld(anchorScreen) : { x: this.pose.x, y: this.pose.y };
    if (this.reducedMotion) { this.zoomGoal = null; this.applyZoom(zoom, anchorScreen, anchor); return; }
    this.zoomGoal = { zoom, screen: anchorScreen, anchor };
  }

  /** Turns Follow on (gliding onto the target first) or off. */
  setFollowing(on: boolean, target?: Point | null, zoom?: number) {
    if (!on) { this.following = false; if (this.glide?.track) this.glide = null; return; }
    if (this.following && !zoom) return;
    this.following = true;
    if (target) this.trackTo(target, zoom ?? this.zoomGoal?.zoom ?? this.pose.zoom);
  }
  /** Glides onto a (possibly moving) point; with Follow on, Follow takes over at the end. */
  trackTo(target: Point, zoom: number) {
    this.zoomGoal = null;
    const to = clampPose({ ...target, zoom }, this.viewport, this.size);
    if (this.reducedMotion) { this.glide = null; this.pose = to; return; }
    this.glide = { from: { ...this.pose }, to, elapsed: 0, duration: glideDuration(this.pose, to), track: true };
  }

  /** Completes any glide or zoom animation immediately. */
  finish(followPoint: Point | null = null) {
    for (let i = 0; i < 100 && this.moving; i += 1) this.update(250, followPoint);
  }

  /** Advances motion by `dtMs`; `followPoint` is the followed target's world position this frame. */
  update(dtMs: number, followPoint: Point | null): boolean {
    const before = this.pose;
    const dt = clamp(dtMs, 0, 250);
    if (this.glide) {
      const glide = this.glide;
      if (glide.track && followPoint) glide.to = clampPose({ ...followPoint, zoom: glide.to.zoom }, this.viewport, this.size);
      glide.elapsed += dt;
      const t = glide.duration <= 0 ? 1 : Math.min(1, glide.elapsed / glide.duration);
      const e = easeInOut(t);
      const zoom = Math.exp(Math.log(glide.from.zoom) + (Math.log(glide.to.zoom) - Math.log(glide.from.zoom)) * e);
      this.pose = { x: glide.from.x + (glide.to.x - glide.from.x) * e, y: glide.from.y + (glide.to.y - glide.from.y) * e, zoom };
      if (t >= 1) { this.pose = glide.to; this.glide = null; }
    } else {
      if (this.zoomGoal) {
        const goal = this.zoomGoal;
        const k = this.reducedMotion ? 1 : approach(dt, ZOOM_TAU_MS);
        const logZoom = Math.log(this.pose.zoom) + (Math.log(goal.zoom) - Math.log(this.pose.zoom)) * k;
        const done = Math.abs(Math.log(goal.zoom) - logZoom) < 1e-4;
        this.applyZoom(done ? goal.zoom : Math.exp(logZoom), goal.screen, goal.anchor);
        if (done) this.zoomGoal = null;
      }
      if (this.following && followPoint) {
        const goal = clampPose({ ...followPoint, zoom: this.pose.zoom }, this.viewport, this.size);
        const k = this.reducedMotion ? 1 : approach(dt, FOLLOW_TAU_MS);
        const dx = goal.x - this.pose.x, dy = goal.y - this.pose.y;
        // Within a twentieth of a screen pixel the camera is already there: stop instead of creeping.
        if (Math.hypot(dx, dy) * this.pose.zoom < 0.05) { if (dx || dy) this.pose = { ...this.pose, x: goal.x, y: goal.y }; }
        else this.pose = { ...this.pose, x: this.pose.x + dx * k, y: this.pose.y + dy * k };
      }
    }
    return before.x !== this.pose.x || before.y !== this.pose.y || before.zoom !== this.pose.zoom;
  }

  private settleZoom() {
    if (!this.zoomGoal) return;
    this.applyZoom(this.zoomGoal.zoom, this.zoomGoal.screen, this.zoomGoal.anchor);
    this.zoomGoal = null;
  }
  private applyZoom(zoom: number, screen: Point | null, anchor: Point) {
    // Centre-anchored zoom keeps the anchored centre (or the followed point, which Follow keeps moving).
    const centre = this.following ? this.pose : anchor;
    const pose = screen ? anchoredPose(anchor, screen, this.viewport, zoom) : { x: centre.x, y: centre.y, zoom };
    this.pose = clampPose(pose, this.viewport, this.size);
  }
}

function sameInsets(a: Insets, b: Insets) {
  return a.left === b.left && a.right === b.right && a.top === b.top && b.bottom === a.bottom;
}

/** Optional per-viewer camera preference (never part of a save). Invalid or missing values give the default. */
const PREFS_KEY = 'tiny-city-camera-v1';
export type CameraPrefs = { lifeZoom: number | null };
export function readCameraPrefs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): CameraPrefs {
  try {
    const value = JSON.parse(storage?.getItem(PREFS_KEY) ?? 'null') as unknown;
    const zoom = value && typeof value === 'object' ? (value as { lifeZoom?: unknown }).lifeZoom : null;
    return { lifeZoom: typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= READABLE_ZOOM && zoom <= ZOOM_MAX ? zoom : null };
  } catch { return { lifeZoom: null }; }
}
export function writeCameraPrefs(prefs: CameraPrefs, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { storage?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* A preference only. */ }
}
function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** The four screen corners as grid points (the minimap footprint). */
export function footprintOf(pose: CameraPose, viewport: Viewport): Point[] {
  return [{ x: 0, y: 0 }, { x: viewport.width, y: 0 }, { x: viewport.width, y: viewport.height }, { x: 0, y: viewport.height }]
    .map((corner) => toGrid(screenToWorld(pose, viewport, corner)));
}
