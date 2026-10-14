import { describe, expect, it } from 'vitest';
import { computeInsets } from './cameraInsets';

const stage = { left: 0, top: 0, right: 1440, bottom: 900 };

describe('camera insets from the real HUD layout', () => {
  it('reads how far each visible panel reaches into the map', () => {
    expect(computeInsets(stage, [
      { side: 'top', rect: { left: 0, top: 0, right: 1440, bottom: 64 } },
      { side: 'right', rect: { left: 1068, top: 76, right: 1428, bottom: 888 } },
      { side: 'left', rect: { left: 12, top: 160, right: 80, bottom: 700 } },
      { side: 'bottom', rect: { left: 12, top: 830, right: 572, bottom: 888 } },
    ])).toEqual({ top: 76, right: 384, left: 92, bottom: 82 });
  });
  it('ignores panels that are collapsed off screen and caps any inset so a usable area remains', () => {
    expect(computeInsets(stage, [
      { side: 'right', rect: { left: 1450, top: 76, right: 1810, bottom: 888 } },
      { side: 'bottom', rect: { left: 0, top: 100, right: 1440, bottom: 900 } },
    ])).toEqual({ top: 0, right: 0, left: 0, bottom: 405 });
  });
});
