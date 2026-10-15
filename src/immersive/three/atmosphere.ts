import * as THREE from 'three';
import { worldLighting, type WorldLighting } from '../../game/lighting';

/**
 * Phase 8A sky and light from the authoritative clock. The City View's lighting keyframes (`worldLighting`: glow, sun
 * strength and phase) drive the 3D sun, sky and night lights, so golden hour and night arrive at the same minute in
 * both views. The sun rises in the east (+X), passes south (+Z) and sets in the west (−X).
 */

export interface SkyState {
  readonly lighting: WorldLighting;
  /** Unit vector from the ground toward the sun (or the moon at night). */
  readonly sunDirection: { readonly x: number; readonly y: number; readonly z: number };
  readonly sunColor: number;
  readonly sunIntensity: number;
  readonly moonIntensity: number;
  readonly skyTop: number;
  readonly skyHorizon: number;
  readonly groundColor: number;
  readonly hemisphereIntensity: number;
  readonly environmentIntensity: number;
  /** 0 … 1 strength of windows, lamps and light pools. */
  readonly glow: number;
}

type Key = { readonly hour: number; readonly top: number; readonly horizon: number; readonly sun: number; readonly hemi: number };
const KEYS: readonly Key[] = [
  { hour: 0, top: 0x0f1a33, horizon: 0x2a3556, sun: 0x9fb4ff, hemi: 0.42 },
  { hour: 4.8, top: 0x14203d, horizon: 0x34405f, sun: 0x9fb4ff, hemi: 0.42 },
  { hour: 5.8, top: 0x4a5f8f, horizon: 0xe9b6a2, sun: 0xffb98c, hemi: 0.6 },
  { hour: 7.2, top: 0x7fb4e0, horizon: 0xf3dcc4, sun: 0xffe2c2, hemi: 0.9 },
  { hour: 9, top: 0x6aaee6, horizon: 0xd6ebf5, sun: 0xfff5e6, hemi: 1 },
  { hour: 16, top: 0x6aaee6, horizon: 0xd6ebf5, sun: 0xfff5e6, hemi: 1 },
  { hour: 17.6, top: 0x77a6d6, horizon: 0xf6dcb4, sun: 0xffd3a0, hemi: 0.92 },
  { hour: 18.7, top: 0x6d86b8, horizon: 0xf6b98a, sun: 0xffa868, hemi: 0.8 },
  { hour: 19.6, top: 0x3d4a7d, horizon: 0xc98a8e, sun: 0xff9a7a, hemi: 0.6 },
  { hour: 20.6, top: 0x1b2647, horizon: 0x4c4f78, sun: 0x9fb4ff, hemi: 0.45 },
  { hour: 21.4, top: 0x0f1a33, horizon: 0x2a3556, sun: 0x9fb4ff, hemi: 0.42 },
  { hour: 24, top: 0x0f1a33, horizon: 0x2a3556, sun: 0x9fb4ff, hemi: 0.42 },
];
function mixColor(a: number, b: number, t: number): number {
  const c = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

export function skyState(minuteOfDay: number): SkyState {
  const lighting = worldLighting(minuteOfDay);
  const hour = ((((minuteOfDay % 1440) + 1440) % 1440)) / 60;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.hour <= hour) i += 1;
  const a = KEYS[i]!, b = KEYS[i + 1]!;
  const lin = (hour - a.hour) / (b.hour - a.hour), t = lin * lin * (3 - 2 * lin);
  // Sun path: up at 06:00, highest (58°) at 13:00, down at 20:00, sweeping +X (east) → +Z (south) → −X (west).
  // A grazing minimum keeps golden-hour light above the roofs; at night a cool moon hangs in the south-east.
  const day = (hour - 6) / 14;
  const up = day > 0 && day < 1;
  const elevation = up ? Math.max(0.12, Math.sin(day * Math.PI) * (58 * Math.PI / 180)) : 0.62;
  const azimuth = up ? Math.PI * day : Math.PI * 0.3;
  const sunDirection = { x: Math.cos(elevation) * Math.cos(azimuth), y: Math.sin(elevation), z: Math.cos(elevation) * Math.sin(azimuth) };
  const ground = mixColor(0x5a6b48, 0x1c2230, lighting.glow);
  return {
    lighting, sunDirection,
    sunColor: mixColor(a.sun, b.sun, t),
    sunIntensity: 3.1 * lighting.sun,
    moonIntensity: 0.45 * lighting.glow,
    skyTop: mixColor(a.top, b.top, t), skyHorizon: mixColor(a.horizon, b.horizon, t), groundColor: ground,
    // Sky fill is kept well under the sun so cast shadows read clearly (soft, never black).
    hemisphereIntensity: (a.hemi + (b.hemi - a.hemi) * t) * 0.62,
    environmentIntensity: 0.12 + 0.26 * (1 - lighting.glow),
    glow: lighting.glow,
  };
}

/** Gradient sky dome; it follows the camera so it never clips. */
export function createSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x6aaee6) }, horizon: { value: new THREE.Color(0xd6ebf5) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(0xfff5e6) }, sunGlow: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunGlow; varying vec3 vDir;',
      'void main() { float h = clamp(vDir.y, -0.2, 1.0); vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));',
      '  if (h < 0.0) c = mix(horizon, horizon * 0.82, -h * 5.0);',
      '  float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0); c += sunColor * (pow(s, 600.0) * 1.4 + pow(s, 12.0) * 0.18) * sunGlow;',
      '  gl_FragColor = vec4(c, 1.0);',
      '#include <tonemapping_fragment>',
      '#include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), material);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}
