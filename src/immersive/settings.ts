import { clampSensitivity, ORBIT } from './orbitCamera';
import type { Quality } from './three/neighbourhood';

/** Per-viewer Character View preferences (browser storage; never part of the world or the save). */
export interface ImmersiveSettings {
  readonly sensitivity: number;
  readonly invertY: boolean;
  /** 'auto' picks low on software renderers (no GPU) and high otherwise. */
  readonly quality: 'auto' | Quality;
}

const KEY = 'tiny-city-3d-settings-v1';
export const DEFAULT_SETTINGS: ImmersiveSettings = Object.freeze({ sensitivity: ORBIT.sensitivity.initial, invertY: false, quality: 'auto' });

export function readSettings(): ImmersiveSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ImmersiveSettings> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
    return {
      sensitivity: typeof raw.sensitivity === 'number' && Number.isFinite(raw.sensitivity) ? clampSensitivity(raw.sensitivity) : DEFAULT_SETTINGS.sensitivity,
      invertY: raw.invertY === true,
      quality: raw.quality === 'high' || raw.quality === 'low' ? raw.quality : 'auto',
    };
  } catch { return DEFAULT_SETTINGS; }
}
export function writeSettings(settings: ImmersiveSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable: keep for this session only */ }
}

/** Software WebGL (SwiftShader, llvmpipe) gets the light preset: no shadow maps, shorter view distance, 1× pixels. */
export function resolveQuality(setting: ImmersiveSettings['quality'], renderer: string): Quality {
  if (setting !== 'auto') return setting;
  return /swiftshader|llvmpipe|software|basic render/i.test(renderer) ? 'low' : 'high';
}
