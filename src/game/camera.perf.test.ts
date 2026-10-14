import { describe, expect, it } from 'vitest';
import { CameraController, footprintOf, worldTransform, type Viewport } from './camera';
import { iso } from './mapGeometry';

// Phase 4.6: the camera's per-frame cost stays a tiny fraction of a 16.7 ms frame (budgets are ~50× the measured cost).
const viewport: Viewport = { width: 1440, height: 900, insets: { left: 0, right: 384, top: 76, bottom: 82 } };
function perFrameMicroseconds(frame: (i: number) => void, frames = 200_000) {
  for (let i = 0; i < 2000; i += 1) frame(i);
  const start = performance.now();
  for (let i = 0; i < frames; i += 1) frame(i);
  return ((performance.now() - start) * 1000) / frames;
}

describe('camera cost per frame', () => {
  it('following, zoom animation and the minimap footprint each cost microseconds', () => {
    const follow = new CameraController(viewport, 64, { ...iso(30, 30), zoom: 1.85 });
    follow.setFollowing(true);
    const followUs = perFrameMicroseconds((i) => { follow.update(16, iso(30 + (i % 20000) * 0.0015, 30)); worldTransform(follow.pose, follow.viewport); });
    const zooming = new CameraController(viewport, 64, { ...iso(30, 30), zoom: 0.6 });
    const zoomUs = perFrameMicroseconds((i) => {
      if (!zooming.moving) zooming.zoomBy(i % 2 ? 1.25 : 0.8, { x: 500, y: 600 });
      zooming.update(16, null);
      worldTransform(zooming.pose, zooming.viewport);
    });
    const footprintUs = perFrameMicroseconds(() => { footprintOf(follow.pose, follow.viewport); });
    console.info(`camera µs/frame: follow ${followUs.toFixed(3)}, zoom ${zoomUs.toFixed(3)}, footprint ${footprintUs.toFixed(3)}`);
    expect(followUs).toBeLessThan(50);
    expect(zoomUs).toBeLessThan(50);
    expect(footprintUs).toBeLessThan(50);
  });
});
