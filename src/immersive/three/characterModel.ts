import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

/**
 * Phase 8B: one skinned mesh per character. Every layer mesh of the rig is merged into a single geometry, its colour
 * (tint or fixed material colour) baked into vertex colours and each vertex bound to the rig bone it hangs from, so a
 * whole character is one draw call (8A used one per layer mesh, about 30). The rig's own pose function still drives
 * the bones, so poses are identical to the bake's.
 */
const SKIN_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.74, metalness: 0 });

/** Releases the shared materials from the GPU (they stay cached and re-upload next time). */
export function releaseCharacterMaterials() {
  SKIN_MATERIAL.dispose();
  CONTACT_MATERIAL.dispose(); CONTACT_MATERIAL.map?.dispose();
}

export interface CharacterModel {
  readonly root: THREE.Group;
  readonly skeleton: Skeleton;
  /** The layers composed (for tests and the debug API). */
  readonly layers: readonly string[];
  /** Poses the rig: walk/run by stride phase and run blend, or idle breathing. */
  pose(input: { readonly moving: boolean; readonly stride: number; readonly runBlend: number; readonly time: number; readonly action?: 'none' | 'wave' | 'talk' | 'sit' | 'cheer' | 'idle' }): void;
  dispose(): void;
}

/** Limb layers attach to the left or right arm/leg bones, like the bake. */
const limbBone = (layer: string, side: 'L' | 'R' | '-') => side === '-' ? undefined
  : layer === 'legs' || layer === 'shoes' ? (side === 'L' ? 'legL' : 'legR') : (side === 'L' ? 'armL' : 'armR');

export function buildCharacter(look: CharacterLook, options: { contact?: boolean } = {}): CharacterModel {
  const skeleton = createSkeleton();
  const names: string[] = [];
  const refs = characterLayers(look, 'front');
  const seen = new Set<string>();
  const colored: { mesh: THREE.Mesh; color: THREE.Color }[] = [];
  for (const ref of refs) {
    const key = `${ref.layer}:${ref.variant}:${ref.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const build = LAYERS[ref.layer]?.variants[ref.variant];
    if (!build) continue;
    for (const mesh of build(skeleton, limbBone(ref.layer, ref.side) as 'armR' | 'armL' | 'legR' | 'legL')) {
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      colored.push({ mesh, color: ref.tint !== null ? new THREE.Color(ref.tint) : material.color.clone() });
    }
    names.push(key);
  }
  // Mirror the rig's bone groups as skinning bones, in the rest pose.
  applyPose(skeleton, 'idle', 0);
  skeleton.root.updateMatrixWorld(true);
  const groups: THREE.Object3D[] = [];
  skeleton.root.traverse((o) => { if (!(o as THREE.Mesh).isMesh) groups.push(o); });
  const bones = groups.map((g) => { const bone = new THREE.Bone(); bone.position.copy(g.position); bone.quaternion.copy(g.quaternion); bone.scale.copy(g.scale); return bone; });
  groups.forEach((g, i) => { const parent = groups.indexOf(g.parent!); if (parent >= 0) bones[parent]!.add(bones[i]!); });
  const parts: THREE.BufferGeometry[] = [];
  for (const { mesh, color } of colored) {
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const n = g.attributes.position!.count, bone = groups.indexOf(mesh.parent!);
    const colors = new Float32Array(n * 3), index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
    for (let i = 0; i < n; i += 1) { colors.set([color.r, color.g, color.b], i * 3); index[i * 4] = bone; weight[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(weight, 4));
    parts.push(g);
    mesh.geometry.dispose();
  }
  const geometry = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  const skinned = new THREE.SkinnedMesh(geometry, SKIN_MATERIAL);
  skinned.add(bones[0]!);
  skinned.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton(bones));
  skinned.castShadow = true;
  skinned.scale.setScalar(CHARACTER_SCALE);
  // Culled by a padded bind-pose sphere (poses never reach outside it), so off-screen people cost nothing.
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere!.clone();
  sphere.radius *= 1.35;
  skinned.boundingSphere = sphere;
  const root = new THREE.Group();
  root.name = 'character';
  root.add(skinned);
  // A soft contact shadow under the feet keeps the figure grounded even where the shadow map is coarse.
  if (options.contact !== false) {
    const contact = new THREE.Mesh(CONTACT_GEOMETRY, CONTACT_MATERIAL);
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.003;
    contact.renderOrder = 1;
    root.add(contact);
  }
  /** Copies the rig groups' pose onto the skinning bones. */
  const sync = () => { groups.forEach((g, i) => { const b = bones[i]!; b.position.copy(g.position); b.quaternion.copy(g.quaternion); b.scale.copy(g.scale); }); };
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
        }
      } else if (action === 'cheer') {
        // Concert audiences: both arms up, bouncing (the City View draws cheering with the wave pose).
        applyPose(skeleton, 'wave', Math.floor(time / 0.15) % 4);
        skeleton.armL.upper.rotation.z = 2.45; skeleton.armL.upper.rotation.x = -0.25;
        skeleton.hips.position.y += Math.abs(Math.sin(time * 6)) * 0.02;
      } else if (action === 'wave' || action === 'talk' || action === 'sit') {
        applyPose(skeleton, action, Math.floor(time / (action === 'wave' ? 0.15 : 0.28)) % (action === 'sit' ? 2 : 4));
      } else {
        applyPose(skeleton, 'idle', 0);
        // Breathing and a slow glance (never in sync between characters: the caller offsets `time`).
        const breath = Math.sin(time * 2.4);
        skeleton.torso.scale.set(1 + breath * 0.008, 1 + breath * 0.012, 1 + breath * 0.008);
        skeleton.head.rotation.y = Math.sin(time * 0.37) * 0.18;
      }
      sync();
    },
    dispose() { geometry.dispose(); skinned.skeleton.dispose(); },
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
