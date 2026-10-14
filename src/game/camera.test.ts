import { describe, expect, it } from 'vitest';
import {
  approach, CameraController, clampPose, focalPoint, footprintOf, glideDuration, lifeZoomFor, mapExtent, panBy, readCameraPrefs, screenToWorld,
  wheelZoomFactor, worldToScreen, worldTransform, writeCameraPrefs, zoomAt, zoomLimits, ZOOM_MAX, ZOOM_STEP, type CameraPose, type Viewport,
} from './camera';
import { iso, toGrid } from './mapGeometry';

const SIZE = 64;
const desktop: Viewport = { width: 1440, height: 828, insets: { left: 92, right: 384, top: 72, bottom: 104 } };
const phone: Viewport = { width: 390, height: 844, insets: { left: 0, right: 0, top: 112, bottom: 150 } };
const open: Viewport = { width: 1280, height: 720, insets: { left: 0, right: 0, top: 0, bottom: 0 } };
const centre = iso(32, 24);
const home: CameraPose = { ...centre, zoom: 0.6 };
/** Seeded generator so fuzz cases are reproducible. */
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }
const near = (a: { x: number; y: number }, b: { x: number; y: number }, tolerance: number) =>
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(tolerance);
/** Runs a controller to rest at a fixed frame time. */
function settle(camera: CameraController, frameMs = 16, follow: { x: number; y: number } | null = null, frames = 400) {
  for (let i = 0; i < frames && (camera.moving || follow); i += 1) camera.update(frameMs, follow);
}

describe('camera transforms (A, M)', () => {
  it('world→screen and screen→world are inverses across viewports, zooms and points (fuzzed)', () => {
    const random = rng(7);
    for (let i = 0; i < 500; i += 1) {
      const viewport = [desktop, phone, open][i % 3]!;
      const pose = { x: random() * 3600, y: random() * 1800, zoom: 0.08 + random() * 1.5 };
      const screen = { x: random() * viewport.width, y: random() * viewport.height };
      near(worldToScreen(pose, viewport, screenToWorld(pose, viewport, screen)), screen, 1e-9);
      const world = { x: random() * 3600, y: random() * 1800 };
      near(screenToWorld(pose, viewport, worldToScreen(pose, viewport, world)), world, 1e-9);
      // The Pixi container transform draws exactly where the camera math says.
      const t = worldTransform(pose, viewport);
      near({ x: t.x + world.x * t.scale, y: t.y + world.y * t.scale }, worldToScreen(pose, viewport, world), 1e-9);
    }
  });
  it('the pose is the world point at the centre of the unobstructed area', () => {
    near(worldToScreen(home, desktop, home), focalPoint(desktop), 1e-12);
    expect(focalPoint(desktop)).toEqual({ x: 92 + (1440 - 92 - 384) / 2, y: 72 + (828 - 72 - 104) / 2 });
  });
  it('works in CSS pixels: the same pose maps identically whatever the device pixel ratio (M)', () => {
    // Pixi reports pointer positions in CSS pixels (autoDensity) and the canvas client rect is in CSS pixels, so a
    // client point maps to the same world point on a 1× and a 2× display; only the backing store differs.
    const client = { x: 700, y: 400 }, rect = { left: 0, top: 0 };
    const at1x = screenToWorld(home, desktop, { x: client.x - rect.left, y: client.y - rect.top });
    const at2x = screenToWorld(home, desktop, { x: (client.x * 2) / 2 - rect.left, y: (client.y * 2) / 2 - rect.top });
    expect(at2x).toEqual(at1x);
  });
});

describe('zoom (B, C)', () => {
  it('keeps the world point under the cursor fixed (fuzzed cursors and zooms)', () => {
    const random = rng(11);
    for (let i = 0; i < 300; i += 1) {
      const cursor = { x: random() * desktop.width, y: random() * desktop.height };
      const before = screenToWorld(home, desktop, cursor);
      const next = zoomAt(home, desktop, cursor, 0.1 + random() * 1.4);
      near(screenToWorld(next, desktop, cursor), before, 1e-9);
    }
  });
  it('wheel factors are proportional and exact inverses; zero and horizontal deltas never zoom', () => {
    expect(wheelZoomFactor({ deltaY: 0 })).toBe(1);
    expect(wheelZoomFactor({ deltaY: -100 }) * wheelZoomFactor({ deltaY: 100 })).toBeCloseTo(1, 14);
    expect(wheelZoomFactor({ deltaY: -3, ctrlKey: true }) * wheelZoomFactor({ deltaY: 3, ctrlKey: true })).toBeCloseTo(1, 14);
    // Twenty trackpad events of 5 px zoom as much as one 100 px mouse notch.
    expect(wheelZoomFactor({ deltaY: 5 }) ** 20).toBeCloseTo(wheelZoomFactor({ deltaY: 100 }), 12);
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(wheelZoomFactor({ deltaY: 48 }), 12);
    expect(wheelZoomFactor({ deltaY: -100 })).toBeGreaterThan(1.15);
  });
  it('100 wheel zoom-in/zoom-out cycles at any cursor return to the same pose (no drift)', () => {
    for (const cursor of [focalPoint(desktop), { x: 400, y: 650 }, { x: 1300, y: 100 }]) {
      const camera = new CameraController(desktop, SIZE, home);
      const start = { ...camera.pose };
      const anchor = camera.toWorld(cursor);
      for (let i = 0; i < 100; i += 1) {
        camera.zoomBy(wheelZoomFactor({ deltaY: -100 }), cursor); settle(camera);
        near(camera.toWorld(cursor), anchor, 1e-6);
        camera.zoomBy(wheelZoomFactor({ deltaY: 100 }), cursor); settle(camera);
      }
      expect(camera.pose.zoom).toBeCloseTo(start.zoom, 9);
      near(camera.pose, start, 1e-6);
      // A known building lands on the same screen pixel.
      near(camera.toScreen(iso(20, 20)), worldToScreen(start, desktop, iso(20, 20)), 1e-6);
    }
  });
  it('rapid button clicks (mid-animation) still return exactly; trackpad bursts with zeros do not shrink the city', () => {
    const camera = new CameraController(desktop, SIZE, home);
    const start = { ...camera.pose };
    for (let i = 0; i < 100; i += 1) { camera.zoomBy(ZOOM_STEP); camera.update(16, null); camera.zoomBy(1 / ZOOM_STEP); camera.update(7, null); }
    settle(camera);
    expect(camera.pose.zoom).toBeCloseTo(start.zoom, 9);
    near(camera.pose, start, 1e-6);
    // The baseline bug: a symmetric momentum scroll (with zero deltas) used to zoom out to the floor and slide away.
    const deltas = [-1, -2, -4, -6, -8, -6, -4, -2, -1, 0, 0, 1, 2, 4, 6, 8, 6, 4, 2, 1, 0, 0];
    for (let r = 0; r < 10; r += 1) for (const deltaY of deltas) { camera.zoomBy(wheelZoomFactor({ deltaY }), { x: 500, y: 600 }); camera.update(16, null); }
    settle(camera);
    expect(camera.pose.zoom).toBeCloseTo(start.zoom, 9);
    near(camera.pose, start, 1e-6);
  });
  it('zooming out past the point where the map fits (the bounds recentre it) and back returns exactly', () => {
    for (const cursor of [{ x: 600, y: 500 }, null]) {
      const camera = new CameraController(desktop, SIZE, { ...iso(24, 18), zoom: 0.6 });
      const start = { ...camera.pose };
      // One continuous pinch: 26 ctrl+wheel events out (to ~0.27, where the whole map height fits but above the zoom
      // limit), a few frames, then 26 back.
      for (let i = 0; i < 26; i += 1) { camera.zoomBy(wheelZoomFactor({ deltaY: 3, ctrlKey: true }), cursor); camera.update(16, null); }
      for (let i = 0; i < 10; i += 1) camera.update(16, null);
      // The bounds recentred the zoomed-out view (a centre-anchored zoom alone would never move the centre).
      if (!cursor) expect(Math.abs(camera.pose.y - start.y)).toBeGreaterThan(20);
      for (let i = 0; i < 26; i += 1) { camera.zoomBy(wheelZoomFactor({ deltaY: -3, ctrlKey: true }), cursor); camera.update(16, null); }
      settle(camera);
      expect(camera.pose.zoom).toBeCloseTo(start.zoom, 9);
      near(camera.pose, start, 1e-6);
    }
  });
  it('zoom stays inside the limits and is anchored even at the limits', () => {
    const camera = new CameraController(desktop, SIZE, home);
    const cursor = { x: 700, y: 400 };
    for (let i = 0; i < 30; i += 1) camera.zoomBy(ZOOM_STEP, cursor);
    settle(camera);
    expect(camera.pose.zoom).toBe(ZOOM_MAX);
    for (let i = 0; i < 60; i += 1) camera.zoomBy(1 / ZOOM_STEP, cursor);
    settle(camera);
    expect(camera.pose.zoom).toBeCloseTo(zoomLimits(desktop, SIZE).min, 12);
  });
});

describe('pan and bounds (D, F)', () => {
  it('drags the content with the pointer at every zoom', () => {
    for (const zoom of [0.3, 0.6, 1, 1.5]) {
      const pose = { ...centre, zoom };
      const grabbed = iso(30, 22);
      const at = worldToScreen(pose, desktop, grabbed);
      const moved = panBy(pose, 37, -21);
      near(worldToScreen(moved, desktop, grabbed), { x: at.x + 37, y: at.y - 21 }, 1e-9);
    }
  });
  it('a pan ends Follow and is clamped to the map', () => {
    const camera = new CameraController(desktop, SIZE, home);
    camera.setFollowing(true);
    expect(camera.pan(10, 0)).toBe(true);
    expect(camera.following).toBe(false);
    for (let i = 0; i < 200; i += 1) camera.pan(-400, -400);
    const grid = toGrid(camera.pose);
    expect(grid.x).toBeLessThanOrEqual(SIZE + 1.5 + 1e-9);
    expect(grid.y).toBeLessThanOrEqual(SIZE + 1.5 + 1e-9);
  });
  it('the visible centre never leaves the map, and a zoomed-out map never slides off screen (fuzzed)', () => {
    const random = rng(23);
    const map = mapExtent(SIZE);
    for (let i = 0; i < 400; i += 1) {
      const viewport = [desktop, phone, open][i % 3]!;
      const pose = clampPose({ x: -5000 + random() * 14000, y: -5000 + random() * 12000, zoom: random() * 2 }, viewport, SIZE);
      const grid = toGrid(pose);
      expect(grid.x).toBeGreaterThanOrEqual(-1.5 - 1e-9); expect(grid.x).toBeLessThanOrEqual(SIZE + 1.5 + 1e-9);
      expect(grid.y).toBeGreaterThanOrEqual(-1.5 - 1e-9); expect(grid.y).toBeLessThanOrEqual(SIZE + 1.5 + 1e-9);
      const limits = zoomLimits(viewport, SIZE);
      expect(pose.zoom).toBeGreaterThanOrEqual(limits.min); expect(pose.zoom).toBeLessThanOrEqual(limits.max);
      // At the widest zoom the whole map is on screen.
      if (pose.zoom === limits.min) {
        const tl = worldToScreen(pose, viewport, { x: map.left, y: map.top }), br = worldToScreen(pose, viewport, { x: map.right, y: map.bottom });
        expect(tl.x).toBeGreaterThanOrEqual(-1e-6); expect(br.x).toBeLessThanOrEqual(viewport.width + 1e-6);
      }
    }
  });
  it('limits are derived from the viewport and map, not one example city', () => {
    expect(zoomLimits(phone, SIZE).min).toBeLessThan(zoomLimits(desktop, SIZE).min);
    expect(zoomLimits(desktop, 32).min).toBeGreaterThan(zoomLimits(desktop, SIZE).min);
  });
});

describe('viewport changes (E)', () => {
  it('resizing keeps the looked-at point at the centre of the visible area', () => {
    const camera = new CameraController(desktop, SIZE, home);
    camera.setViewport({ ...desktop, width: 1100, height: 700 });
    near(camera.toScreen(home), focalPoint(camera.viewport), 1e-9);
    expect(camera.moving).toBe(false);
  });
  it('opening or closing a panel keeps the picture still; later framing uses the new visible area', () => {
    const camera = new CameraController(desktop, SIZE, home);
    const before = camera.toScreen(iso(20, 20));
    camera.setViewport({ ...desktop, insets: { ...desktop.insets, right: 0 } });
    expect(camera.moving).toBe(false);
    near(camera.toScreen(iso(20, 20)), before, 1e-9);
    camera.glideTo(home);
    settle(camera);
    near(camera.toScreen(home), focalPoint(camera.viewport), 1e-9);
  });
});

describe('glides, focus and follow (G, H, I, J, K, L)', () => {
  it('reset glides to the framing and ends exactly there (G)', () => {
    const camera = new CameraController(desktop, SIZE, home);
    camera.pan(300, 120);
    camera.glideTo(home);
    expect(camera.moving).toBe(true);
    settle(camera);
    expect(camera.pose).toEqual(clampPose(home, desktop, SIZE));
    expect(glideDuration(home, home)).toBeGreaterThanOrEqual(260);
  });
  it('focus lands on the target at the focal point; a new glide replaces the old one (I)', () => {
    const camera = new CameraController(desktop, SIZE, home);
    const player = iso(40.5, 30.25);
    camera.glideTo({ ...iso(10, 10), zoom: 0.5 });
    camera.update(100, null);
    camera.glideTo({ ...player, zoom: 1.3 });
    settle(camera);
    near(camera.toScreen(player), focalPoint(desktop), 1e-9);
    expect(camera.pose.zoom).toBe(1.3);
  });
  it('follow converges on a moving target the same way at 20 and 60 fps (H)', () => {
    const run = (frameMs: number) => {
      const camera = new CameraController(desktop, SIZE, { ...iso(30, 30), zoom: 1.3 });
      camera.setFollowing(true);
      let t = 0;
      const target = () => iso(30 + t * 0.0015, 30); // 1.5 tiles per second
      while (t < 3000) { t += frameMs; camera.update(frameMs, target()); }
      return { camera, target: target() };
    };
    const slow = run(50), fast = run(1000 / 60);
    // Same steady-state lag (speed × time constant) whatever the frame rate; sampling at frame ends differs by under
    // one world pixel (speed × the frame-time difference).
    const lag = (r: ReturnType<typeof run>) => Math.hypot(r.target.x - r.camera.pose.x, r.target.y - r.camera.pose.y);
    expect(Math.abs(lag(slow) - lag(fast))).toBeLessThan(1);
    expect(lag(fast) * 1.3).toBeLessThan(12); // under 12 screen px behind a walking character
    expect(approach(50, 140)).toBeCloseTo(1 - (1 - approach(1000 / 60, 140)) ** 3, 12);
  });
  it('following a stationary target leaves the camera perfectly still', () => {
    const camera = new CameraController(desktop, SIZE, { ...iso(30, 30), zoom: 1.3 });
    camera.setFollowing(true, iso(31, 30));
    settle(camera, 16, null);
    for (let i = 0; i < 200; i += 1) camera.update(16, iso(31, 30));
    const still = { ...camera.pose };
    let changed = false;
    for (let i = 0; i < 100; i += 1) changed = camera.update(16, iso(31, 30)) || changed;
    expect(changed).toBe(false);
    expect(camera.pose).toEqual(still);
    expect(camera.moving).toBe(false);
  });
  it('Follow reports moving until it has re-centred the character after the visible area changes', () => {
    const target = iso(31, 30);
    const camera = new CameraController(desktop, SIZE, { ...target, zoom: 1.3 });
    camera.setFollowing(true);
    camera.update(16, target);
    expect(camera.moving).toBe(false);
    // Closing the side panel keeps the picture still, so the character is now off the new focal point.
    camera.setViewport({ ...desktop, insets: { ...desktop.insets, right: 0 } });
    expect(camera.moving).toBe(true);
    let frames = 0;
    while (camera.moving && frames < 500) { camera.update(250, target); frames += 1; }
    expect(camera.moving).toBe(false);
    near(camera.toScreen(target), focalPoint(camera.viewport), 0.05);
    // Slow frames (a software-rendered runner) never report a still camera while it is still off target.
    camera.setViewport(desktop);
    camera.update(250, target);
    const offset = Math.hypot(camera.toScreen(target).x - focalPoint(desktop).x, camera.toScreen(target).y - focalPoint(desktop).y);
    expect(offset).toBeGreaterThan(0.05);
    expect(camera.moving).toBe(true);
  });
  it('turning Follow on glides onto a moving target and hands over; zoom while following stays on the target (J)', () => {
    const camera = new CameraController(desktop, SIZE, home);
    let x = 20;
    camera.setFollowing(true, iso(x, 20), 1.3);
    for (let i = 0; i < 80; i += 1) { x += 0.02; camera.update(16, iso(x, 20)); }
    // The glide has handed over to Follow, which is still catching up with the walker (so the camera reports moving).
    expect(camera.following).toBe(true);
    expect(camera.moving).toBe(true);
    near(camera.toScreen(iso(x, 20)), focalPoint(desktop), 8); // speed × time constant behind
    camera.zoomBy(ZOOM_STEP, { x: 100, y: 100 }); // a cursor far away is ignored while following
    for (let i = 0; i < 60; i += 1) camera.update(16, iso(x, 20));
    near(camera.toScreen(iso(x, 20)), focalPoint(desktop), 0.1);
    // Cancel: off, and later frames do not pull the camera back.
    camera.setFollowing(false);
    const pose = { ...camera.pose };
    for (let i = 0; i < 30; i += 1) camera.update(16, iso(x + i, 20));
    expect(camera.pose).toEqual(pose);
  });
  it('City View and Life View: the city pose is kept and restored exactly (K)', () => {
    const camera = new CameraController(desktop, SIZE, home);
    camera.pan(-120, 40);
    const city = { ...camera.pose };
    camera.setFollowing(true, iso(40, 30), lifeZoomFor(desktop));
    for (let i = 0; i < 80; i += 1) camera.update(16, iso(40, 30));
    expect(camera.pose.zoom).toBe(lifeZoomFor(desktop));
    camera.setFollowing(false);
    camera.glideTo(city);
    settle(camera);
    expect(camera.pose).toEqual(city);
    expect(lifeZoomFor(phone)).toBeLessThan(lifeZoomFor(desktop));
  });
  it('reduced motion makes every transition immediate (L)', () => {
    const camera = new CameraController(desktop, SIZE, home, true);
    camera.glideTo({ ...iso(40, 30), zoom: 1.2 });
    expect(camera.moving).toBe(false);
    near(camera.toScreen(iso(40, 30)), focalPoint(desktop), 1e-9);
    camera.zoomBy(ZOOM_STEP, { x: 300, y: 300 });
    expect(camera.moving).toBe(false);
    expect(camera.pose.zoom).toBeCloseTo(1.5, 12);
    camera.setFollowing(true, iso(20, 20));
    near(camera.toScreen(iso(20, 20)), focalPoint(desktop), 1e-9);
  });
});

describe('persistence and recreation (N)', () => {
  it('a controller kept across renderer recreation produces the identical transform', () => {
    const camera = new CameraController(desktop, SIZE, home);
    camera.pan(80, -30); camera.zoomBy(1.25, { x: 600, y: 500 }); settle(camera);
    const before = worldTransform(camera.pose, camera.viewport);
    // A new renderer re-reads the same controller (CityViewport keeps it in a ref) and re-applies its viewport.
    camera.setViewport({ ...camera.viewport });
    expect(worldTransform(camera.pose, camera.viewport)).toEqual(before);
    expect(footprintOf(camera.pose, camera.viewport)).toHaveLength(4);
  });
  it('camera preferences are optional, validated and never throw', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(readCameraPrefs(storage)).toEqual({ lifeZoom: null });
    writeCameraPrefs({ lifeZoom: 1.6 }, storage);
    expect(readCameraPrefs(storage)).toEqual({ lifeZoom: 1.6 });
    for (const bad of ['{"lifeZoom":"x"}', '{"lifeZoom":99}', '{"lifeZoom":0.1}', 'not json', '[]']) {
      store.set('tiny-city-camera-v1', bad);
      expect(readCameraPrefs(storage)).toEqual({ lifeZoom: null });
    }
    expect(readCameraPrefs({ getItem: () => { throw new Error('blocked'); } })).toEqual({ lifeZoom: null });
  });
});
