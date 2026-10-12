import { describe, expect, it } from 'vitest';
import { isPlayerAppearance, PLAYER_APPEARANCE_OPTIONS } from '@tiny-city/simulation';
import type { PlayerAppearance } from '@tiny-city/simulation';
import { DEFAULT_APPEARANCE, FIGURE_ORDER, FIGURE_ORDER_AWAY, HAIR_COLORS, OUTFIT_COLORS, playerFigure, SKIN_TONES } from './playerLook';

const o = PLAYER_APPEARANCE_OPTIONS;
const every: PlayerAppearance[] = o.hairStyles.flatMap((hairStyle) => o.outfits.flatMap((outfit) => o.accessories.map((accessory, i) =>
  ({ skinTone: i % o.skinTones, hairStyle, hairColor: i % o.hairColors, outfit, outfitColor: i % o.outfitColors, accessory }))));

describe('player look', () => {
  it('palettes match the bounded engine options', () => {
    expect(SKIN_TONES).toHaveLength(o.skinTones);
    expect(HAIR_COLORS).toHaveLength(o.hairColors);
    expect(OUTFIT_COLORS).toHaveLength(o.outfitColors);
    expect(isPlayerAppearance(DEFAULT_APPEARANCE)).toBe(true);
  });

  it('draws every style combination deterministically, with finite geometry, for both orientations', () => {
    for (const look of every) {
      expect(isPlayerAppearance(look)).toBe(true);
      const figure = playerFigure(look);
      expect(playerFigure(look)).toEqual(figure);
      for (const part of [...FIGURE_ORDER, ...FIGURE_ORDER_AWAY]) {
        if (part === 'legs') continue;
        for (const shape of figure[part]) {
          const numbers = Object.values(shape).flat().filter((value): value is number => typeof value === 'number');
          expect(numbers.every(Number.isFinite)).toBe(true);
        }
      }
      expect(figure.hairAway.length).toBeGreaterThan(0);
      expect(figure.colors.skin).toBe(SKIN_TONES[look.skinTone]);
    }
  });

  it('makes each choice visible in the drawing', () => {
    const base = JSON.stringify(playerFigure(DEFAULT_APPEARANCE));
    const changes: Partial<PlayerAppearance>[] = [{ skinTone: 4 }, { hairStyle: 'bun' }, { hairColor: 5 }, { outfit: 'dress' }, { outfitColor: 3 }, { accessory: 'sunhat' }];
    for (const change of changes) expect(JSON.stringify(playerFigure({ ...DEFAULT_APPEARANCE, ...change }))).not.toBe(base);
  });
});
