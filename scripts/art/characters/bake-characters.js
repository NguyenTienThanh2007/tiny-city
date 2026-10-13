// Bakes every character layer variant × facing × pose frame into atlas pages. Runs in the bake page.
// Frames: `ch:<layer>:<variant>:<side>:<facing>:<pose>:<frame>` with side L, R or '-' for whole-body layers.
import * as THREE from 'three';
import { ELEVATION, PX_PER_UNIT } from '../lib/projection.js';
import { trim, pack, SUN_DIRECTION } from '../lib/stage.js';
import { applyPose, createSkeleton, CHARACTER_BOUNDS, CHARACTER_HEIGHT, FACINGS, HEAD_OCCLUDED, LAYERS, ORDER, POSES } from './rig.js';

export const CHARACTER_RESOLUTION = 4;
const LIMB_LAYERS = new Set(['armSkin', 'sleeve', 'legs', 'shoes']);
const OCCLUDER = new THREE.MeshBasicMaterial({ colorWrite: false });

export function bakeCharacters() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  // Soft, bright light: white layers bake to a luminance range (~0.6–1.0) that keeps tinted colours rich.
  scene.add(new THREE.HemisphereLight(0xf2f6ff, 0xd8ccb6, 1.7));
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.9);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(10);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
  fill.position.set(3, 1.5, -1);
  scene.add(fill);

  // Fixed orthographic window around the feet so every frame shares one anchor.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  const view = new THREE.Vector3(Math.cos(ELEVATION) * Math.SQRT1_2, Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.SQRT1_2);
  camera.position.copy(view).multiplyScalar(20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const scale = PX_PER_UNIT * CHARACTER_RESOLUTION;
  const b = CHARACTER_BOUNDS;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) {
    const c = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  }
  const o = new THREE.Vector3().applyMatrix4(camera.matrixWorldInverse);
  const left = Math.ceil((o.x - minX) * scale), right = Math.ceil((maxX - o.x) * scale);
  const top = Math.ceil((maxY - o.y) * scale), bottom = Math.ceil((o.y - minY) * scale);
  camera.left = o.x - left / scale; camera.right = o.x + right / scale; camera.top = o.y + top / scale; camera.bottom = o.y - bottom / scale;
  camera.updateProjectionMatrix();
  const width = left + right, height = top + bottom, anchor = { x: left, y: top };
  const SS = 2;
  renderer.setSize(width * SS, height * SS, false);
  renderer.setClearColor(0x000000, 0);

  const skeleton = createSkeleton();
  scene.add(skeleton.root);
  const render = () => {
    renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(renderer.domElement, 0, 0, width, height);
    return out;
  };

  const entries = [];
  for (const [facing, angle] of Object.entries(FACINGS)) {
    skeleton.root.rotation.y = angle;
    for (const [pose, count] of Object.entries(POSES)) {
      for (let frame = 0; frame < count; frame += 1) {
        applyPose(skeleton, pose, frame);
        for (const [layer, spec] of Object.entries(LAYERS)) {
          if (spec.front && facing !== 'front') continue;
          for (const [variant, build] of Object.entries(spec.variants)) {
            for (const side of LIMB_LAYERS.has(layer) ? ['L', 'R'] : ['-']) {
              // Depth-only head: writes depth but no colour, so parts behind the head are dropped from this layer.
              const occluders = HEAD_OCCLUDED.has(layer) ? LAYERS.head.variants.base(skeleton) : [];
              for (const m of occluders) { m.material = OCCLUDER; m.renderOrder = -1; }
              const meshes = build(skeleton, side === 'L' ? (layer === 'legs' || layer === 'shoes' ? 'legL' : 'armL') : side === 'R' ? (layer === 'legs' || layer === 'shoes' ? 'legR' : 'armR') : undefined);
              skeleton.root.updateMatrixWorld(true);
              const trimmed = trim({ canvas: render(), anchor });
              for (const m of [...meshes, ...occluders]) { m.parent?.remove(m); m.geometry.dispose(); }
              if (trimmed) entries.push({ name: `ch:${layer}:${variant}:${side}:${facing}:${pose}:${frame}`, ...trimmed });
            }
          }
        }
      }
    }
  }
  renderer.dispose();
  const pages = pack(entries, { size: 2048, padding: 3 });
  const layers = Object.fromEntries(Object.entries(LAYERS).map(([name, spec]) => [name, { tint: spec.tint, front: !!spec.front, variants: Object.keys(spec.variants), limb: LIMB_LAYERS.has(name) }]));
  return { pages, meta: { resolution: CHARACTER_RESOLUTION, height: CHARACTER_HEIGHT, poses: POSES, facings: Object.keys(FACINGS), order: ORDER, layers, frames: entries.length } };
}
