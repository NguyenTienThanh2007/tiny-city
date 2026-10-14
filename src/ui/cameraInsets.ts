import { useLayoutEffect, useState, type RefObject } from 'react';
import { NO_INSETS, type Insets } from '../game/camera';

type Side = keyof Insets;
const PANEL_GAP = 12;
type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * How far HUD panels reach into the map stage from each edge, measured from the real layout: every element marked
 * `data-camera-inset="top|right|bottom|left"` that is visible and overlaps the stage pushes that edge in. Collapsed or
 * off-screen panels (transformed away) do not overlap and count as nothing. Each inset is capped so the camera always
 * keeps a usable area.
 */
export function computeInsets(stage: Rect, panels: readonly { side: Side; rect: Rect }[]): Insets {
  const insets = { ...NO_INSETS };
  const width = stage.right - stage.left, height = stage.bottom - stage.top;
  for (const { side, rect } of panels) {
    const left = Math.max(rect.left, stage.left), right = Math.min(rect.right, stage.right);
    const top = Math.max(rect.top, stage.top), bottom = Math.min(rect.bottom, stage.bottom);
    if (right - left < 1 || bottom - top < 1) continue;
    const reach = side === 'top' ? bottom - stage.top : side === 'bottom' ? stage.bottom - top : side === 'left' ? right - stage.left : stage.right - left;
    insets[side] = Math.max(insets[side], reach);
  }
  // A covered edge also keeps a small gap, so content never butts against a panel.
  const cap = (value: number, total: number) => Math.round(Math.min(value > 0 ? value + PANEL_GAP : 0, total * 0.45));
  return { left: cap(insets.left, width), right: cap(insets.right, width), top: cap(insets.top, height), bottom: cap(insets.bottom, height) };
}

export function measureInsets(stage: HTMLElement): Insets {
  const panels: { side: Side; rect: Rect }[] = [];
  stage.ownerDocument.querySelectorAll<HTMLElement>('[data-camera-inset]').forEach((element) => {
    const side = element.dataset.cameraInset as Side;
    if (!(side in NO_INSETS)) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    panels.push({ side, rect });
  });
  return computeInsets(stage.getBoundingClientRect(), panels);
}

const same = (a: Insets, b: Insets) => a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;

/**
 * Live camera insets. Measured before paint on mount and whenever `layoutKey` changes, then again on resize, panel
 * resize and the end of any CSS transition (panels slide open and closed).
 */
export function useCameraInsets(stageRef: RefObject<HTMLElement | null>, layoutKey: string): Insets {
  const [insets, setInsets] = useState<Insets>(NO_INSETS);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => { const next = measureInsets(stage); setInsets((current) => (same(current, next) ? current : next)); };
    update();
    let frame = 0;
    const schedule = () => {
      if (typeof window.requestAnimationFrame !== 'function') { update(); return; }
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(stage);
    stage.ownerDocument.querySelectorAll('[data-camera-inset]').forEach((element) => observer?.observe(element));
    window.addEventListener('resize', schedule);
    stage.ownerDocument.addEventListener('transitionend', schedule);
    return () => {
      if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      stage.ownerDocument.removeEventListener('transitionend', schedule);
    };
  }, [stageRef, layoutKey]);
  return insets;
}
