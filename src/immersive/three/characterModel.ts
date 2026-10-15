import * as THREE from 'three';
import { applyPose, createSkeleton, LAYERS, CHARACTER_HEIGHT, type Skeleton } from '../../../scripts/art/characters/rig.js';
import { characterLayers, type CharacterLook } from '../../game/art/characterLook';

/**
 * Phase 8A real-time character. Built from the same rig (`scripts/art/characters/rig.js`) and the same appearance →
 * layer mapping (`characterLayers`) that produce the City View's baked character frames, so skin, hair style and
 * colour, outfit and colour, and accessories are identical in both views. Only the scale differs: the City View
 * draws people 0.76 tiles tall so they read from above; at eye level the character is 1.75 m (0.27 tiles) against
 * 3 m storeys and 2.2 m doors.
 */

export const CHARACTER_SCALE = 0.36;
/** Height of the character in tiles at eye level. */
export const CHARACTER_TILES = CHARACTER_HEIGHT * CHARACTER_SCALE;

const tinted = new Map<number, THREE.MeshStandardMaterial>();
function tint(color: number) {
  let m = tinted.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0 }); tinted.set(color, m); }
  return m;
}

export interface CharacterModel {
  readonly root: THREE.Group;
  readonly skeleton: Skeleton;
  /** The layers composed (for tests and the debug API). */
  readonly layers: readonly string[];
  /** Poses the rig: walk/run by stride phase and run blend, or idle breathing. */
  pose(input: { readonly moving: boolean; readonly stride: number; readonly runBlend: number; readonly time: number; readonly action?: 'none' | 'wave' | 'talk' | 'sit' }): void;
  dispose(): void;
}

/** Limb layers attach to the left or right arm/leg bones, like the bake. */
const limbBone = (layer: string, side: 'L' | 'R' | '-') => side === '-' ? undefined
  : layer === 'legs' || layer === 'shoes' ? (side === 'L' ? 'legL' : 'legR') : (side === 'L' ? 'armL' : 'armR');

export function buildCharacter(look: CharacterLook): CharacterModel {
  const skeleton = createSkeleton();
  const geometries: THREE.BufferGeometry[] = [];
  const names: string[] = [];
  const refs = characterLayers(look, 'front');
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.layer}:${ref.variant}:${ref.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = LAYERS[ref.layer];
    const build = spec?.variants[ref.variant];
    if (!build) continue;
    const meshes = build(skeleton, limbBone(ref.layer, ref.side) as 'armR' | 'armL' | 'legR' | 'legL');
    for (const mesh of meshes) {
      if (ref.tint !== null) mesh.material = tint(ref.tint);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      geometries.push(mesh.geometry);
    }
    names.push(key);
  }
  const root = new THREE.Group();
  root.name = 'character';
  skeleton.root.scale.setScalar(CHARACTER_SCALE);
  root.add(skeleton.root);
  // A soft contact shadow under the feet keeps the figure grounded even where the shadow map is coarse.
  const contact = new THREE.Mesh(CONTACT_GEOMETRY, CONTACT_MATERIAL);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.003;
  contact.renderOrder = 1;
  root.add(contact);
  return {
    root, skeleton, layers: names,
    pose({ moving, stride, runBlend, time, action = 'none' }) {
      if (moving) {
        applyPose(skeleton, 'walk', (stride / (Math.PI * 2)) * 8);
        if (runBlend > 0.01) {
          // Running: longer swings, bent elbows and knees, a forward lean and more bounce.
          const k = 1 + 0.55 * runBlend;
          for (const limb of [skeleton.legR, skeleton.legL, skeleton.armR, skeleton.armL]) limb.upper.rotation.x *= k;
          skeleton.legR.lower.rotation.x *= 1 + 0.6 * runBlend; skeleton.legL.lower.rotation.x *= 1 + 0.6 * runBlend;
          skeleton.armR.lower.rotation.x += 0.9 * runBlend; skeleton.armL.lower.rotation.x += 0.9 * runBlend;
          skeleton.torso.rotation.x += 0.16 * runBlend;
          skeleton.hips.position.y += Math.abs(Math.sin(stride)) * 0.02 * runBlend;
          skeleton.root.updateMatrixWorld(true);
        }
      } else if (action !== 'none') {
        applyPose(skeleton, action, Math.floor(time / (action === 'wave' ? 0.15 : 0.28)) % (action === 'sit' ? 2 : 4));
      } else {
        applyPose(skeleton, 'idle', 0);
        // Breathing and a slow weight shift (never in sync between characters: the caller offsets `time`).
        const breath = Math.sin(time * 2.4);
        skeleton.torso.scale.set(1 + breath * 0.008, 1 + breath * 0.012, 1 + breath * 0.008);
        skeleton.head.rotation.y = Math.sin(time * 0.37) * 0.18;
        skeleton.root.updateMatrixWorld(true);
      }
    },
    dispose() { for (const g of geometries) g.dispose(); },
  };
}

const CONTACT_GEOMETRY = new THREE.CircleGeometry(0.07, 20);
const CONTACT_MATERIAL = (() => {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let map: THREE.Texture | null = null;
  const ctx = canvas?.getContext('2d');
  if (canvas && ctx) {
    canvas.width = canvas.height = 64;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    map = new THREE.CanvasTexture(canvas);
  }
  return new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: map ? 1 : 0.25, map, depthWrite: false });
})();
