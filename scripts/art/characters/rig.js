// Visual World 3.0C character rig: a stylized miniature person (about 3.3 heads tall, 0.76 tiles ≈ 26 world px)
// modelled from rounded primitives on a small skeleton, posed per animation frame, and split into tintable
// layers. Every layer is baked separately in white (tinted at runtime) or in fixed colours, so any combination of
// the Life Mode appearance schema can be composed from one atlas.
//
// Model space: feet at the origin, facing +Z, +Y up, the character's right hand towards −X.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const POSES = { walk: 8, idle: 4, wave: 4, talk: 4, sit: 2 };
/** Baked facings. 'front' looks towards screen-down-right (grid +x); 'back' towards screen-up-right (grid −y). Mirrored at runtime for the other two. */
export const FACINGS = { front: Math.PI / 2 - 0.3, back: Math.PI };  // front turned ~17° towards the camera so faces read

const WHITE = 0xf4f4f4;
const matCache = new Map();
function mat(color, rough = 0.78) {
  const key = `${color}:${rough}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }));
  return matCache.get(key);
}
const W = () => mat(WHITE);

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}
const capsule = (r, len, material, x = 0, y = 0, z = 0) => mesh(new THREE.CapsuleGeometry(r, len, 6, 14), material, x, y, z);
const sphere = (r, material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = mesh(new THREE.SphereGeometry(r, 22, 16), material, x, y, z); m.scale.set(sx, sy, sz); return m; };
const rbox = (w, h, d, r, material, x = 0, y = 0, z = 0) => mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), material, x, y, z);

// Skeleton dimensions (tiles).
const HIP_Y = 0.3, THIGH = 0.15, SHIN = 0.14, SHOULDER_Y = 0.475, SHOULDER_X = 0.118, UPPER = 0.105, FORE = 0.1, HEAD_Y = 0.635, HEAD_R = 0.112;

/** A posable skeleton. Bones are plain Groups; layers attach meshes to them. */
export function createSkeleton() {
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = HIP_Y; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const neck = new THREE.Group(); neck.position.y = 0.205; torso.add(neck);
  const head = new THREE.Group(); head.position.y = HEAD_Y - HIP_Y - 0.205; neck.add(head);
  const limb = (parent, x, y, len1, len2) => {
    const upper = new THREE.Group(); upper.position.set(x, y, 0); parent.add(upper);
    const lower = new THREE.Group(); lower.position.y = -len1; upper.add(lower);
    const end = new THREE.Group(); end.position.y = -len2; lower.add(end);
    return { upper, lower, end };
  };
  const armR = limb(torso, -SHOULDER_X, SHOULDER_Y - HIP_Y, UPPER, FORE);
  const armL = limb(torso, SHOULDER_X, SHOULDER_Y - HIP_Y, UPPER, FORE);
  const legR = limb(hips, -0.052, 0, THIGH, SHIN);
  const legL = limb(hips, 0.052, 0, THIGH, SHIN);
  return { root, hips, torso, neck, head, armR, armL, legR, legL };
}

/**
 * Poses a skeleton. Rotations are in radians; positive x rotation swings a limb forward (+Z).
 * Every pose is a pure function of (name, frame) so all layers of one frame share the exact same pose.
 */
export function applyPose(s, name, frame) {
  const reset = (g) => g.rotation.set(0, 0, 0);
  for (const g of [s.hips, s.torso, s.neck, s.head, s.armR.upper, s.armR.lower, s.armL.upper, s.armL.lower, s.legR.upper, s.legR.lower, s.legL.upper, s.legL.lower]) reset(g);
  s.hips.position.set(0, HIP_Y, 0);
  s.torso.scale.set(1, 1, 1);
  // Relaxed arms hang slightly away from the body.
  s.armR.upper.rotation.z = -0.12; s.armL.upper.rotation.z = 0.12;
  s.armR.lower.rotation.x = 0.18; s.armL.lower.rotation.x = 0.18;
  if (name === 'walk') {
    const phase = (frame / POSES.walk) * Math.PI * 2;
    const swing = Math.sin(phase);
    s.legR.upper.rotation.x = swing * 0.52;
    s.legL.upper.rotation.x = -swing * 0.52;
    // The trailing leg bends at the knee; the leading leg stays straighter.
    s.legR.lower.rotation.x = -Math.max(0, -swing) * 0.75 - 0.05;
    s.legL.lower.rotation.x = -Math.max(0, swing) * 0.75 - 0.05;
    s.armR.upper.rotation.x = -swing * 0.48;
    s.armL.upper.rotation.x = swing * 0.48;
    s.armR.lower.rotation.x = 0.25 + Math.max(0, -swing) * 0.3;
    s.armL.lower.rotation.x = 0.25 + Math.max(0, swing) * 0.3;
    s.hips.position.y = HIP_Y - 0.004 + Math.abs(Math.cos(phase)) * 0.012;
    s.torso.rotation.y = swing * 0.07;
    s.torso.rotation.x = 0.05;
    s.head.rotation.y = -swing * 0.05;
  } else if (name === 'idle') {
    // 0 rest, 1 inhale, 2 look left, 3 look right.
    if (frame === 1) { s.torso.scale.set(1.012, 1.018, 1.012); s.armR.upper.rotation.z = -0.15; s.armL.upper.rotation.z = 0.15; }
    if (frame === 2) { s.head.rotation.y = 0.38; s.head.rotation.x = -0.04; s.torso.rotation.y = 0.06; }
    if (frame === 3) { s.head.rotation.y = -0.38; s.head.rotation.x = -0.04; s.torso.rotation.y = -0.06; }
  } else if (name === 'wave') {
    // Right (camera-side) arm raised, forearm waving.
    s.armR.upper.rotation.z = -2.45; s.armR.upper.rotation.x = -0.25;
    s.armR.lower.rotation.z = [-0.55, -0.15, 0.25, -0.15][frame];
    s.head.rotation.z = [0.05, 0.08, 0.05, 0.02][frame];
    s.torso.rotation.z = 0.03;
  } else if (name === 'talk') {
    // Conversational hand gestures at chest height with small nods.
    s.armR.upper.rotation.x = -[0.55, 0.75, 0.6, 0.45][frame]; s.armR.lower.rotation.x = [1.3, 1.05, 1.35, 1.2][frame];
    s.armR.upper.rotation.z = -0.25;
    s.armL.upper.rotation.x = -[0.2, 0.3, 0.45, 0.25][frame]; s.armL.lower.rotation.x = [0.7, 0.9, 1.1, 0.8][frame];
    s.head.rotation.x = [0, 0.08, 0.02, -0.04][frame];
    s.head.rotation.y = [0.08, 0, -0.06, 0][frame];
  } else if (name === 'sit') {
    // Sitting on the lawn, legs forward, leaning back on one hand.
    s.hips.position.y = 0.075;
    s.legR.upper.rotation.x = 1.45; s.legL.upper.rotation.x = 1.3;
    s.legR.lower.rotation.x = -0.25; s.legL.lower.rotation.x = -0.65;
    s.torso.rotation.x = -0.12 + (frame === 1 ? -0.02 : 0);
    s.armL.upper.rotation.x = 0.55; s.armL.upper.rotation.z = 0.35; s.armL.lower.rotation.x = 0.1;
    s.armR.upper.rotation.x = -0.3; s.armR.lower.rotation.x = 1.0;
    s.head.rotation.y = frame === 1 ? 0.18 : 0.05;
  }
  s.root.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- layers
// Each builder attaches meshes for one layer variant to the skeleton and returns them (to remove afterwards).

function attach(bone, ...meshes) { for (const m of meshes) bone.add(m); return meshes; }

/** Upper arm piece hangs from the shoulder along −Y. */
function upperArm(s, side, r, material, len = UPPER) { return attach(s[side].upper, capsule(r, len - r, material, 0, -len / 2, 0)); }
function foreArm(s, side, r, material, len = FORE) { return attach(s[side].lower, capsule(r, len - r * 0.6, material, 0, -len / 2, 0)); }
function hand(s, side, material) { return attach(s[side].end, sphere(0.034, material, 0, 0.004, 0.004, 1, 1.08, 0.9)); }

/** Layers baked with the bare head as an invisible depth occluder. */
export const HEAD_OCCLUDED = new Set(['face', 'hair', 'hairLong', 'cap', 'glasses', 'sunhat']);

export const LAYERS = {
  // Bare forearm and hand (skin). Back = left arm (away from the camera), front = right arm.
  armSkin: { tint: 'skin', variants: { base: (s, side) => [...foreArm(s, side, 0.028, W()), ...hand(s, side, W()), ...upperArm(s, side, 0.027, W())] } },
  sleeve: { tint: 'outfit', variants: {
    short: (s, side) => upperArm(s, side, 0.04, W(), 0.07),
    long: (s, side) => [...upperArm(s, side, 0.037, W()), ...foreArm(s, side, 0.034, W(), FORE * 0.82)],
  } },
  legs: { tint: 'legs', variants: {
    pants: (s, side) => [...attach(s[side].upper, capsule(0.044, THIGH - 0.03, W(), 0, -THIGH / 2, 0)), ...attach(s[side].lower, capsule(0.04, SHIN - 0.04, W(), 0, -SHIN / 2 + 0.006, 0))],
    bare: (s, side) => [...attach(s[side].upper, capsule(0.036, THIGH - 0.03, W(), 0, -THIGH / 2, 0)), ...attach(s[side].lower, capsule(0.032, SHIN - 0.03, W(), 0, -SHIN / 2 + 0.006, 0))],
  } },
  shoes: { tint: 'shoes', variants: {
    sneaker: (s, side) => attach(s[side].end, rbox(0.07, 0.042, 0.11, 0.02, W(), 0, -0.004, 0.022)),
  } },
  torso: { tint: 'outfit', variants: {
    tee: (s) => attach(s.torso, rbox(0.215, 0.2, 0.14, 0.055, W(), 0, 0.1, 0), rbox(0.1, 0.02, 0.06, 0.01, W(), 0, 0.2, 0.03)),
    shirt: (s) => attach(s.torso, rbox(0.205, 0.2, 0.135, 0.05, W(), 0, 0.1, 0)),
    hoodie: (s) => attach(s.torso, rbox(0.228, 0.205, 0.15, 0.06, W(), 0, 0.1, 0), sphere(0.085, W(), 0, 0.2, -0.05, 1.15, 0.55, 0.9),
      rbox(0.12, 0.05, 0.02, 0.012, W(), 0, 0.045, 0.075)),
    jacket: (s) => {
      // Open jacket: two front panels and a back, leaving the shirt visible down the middle.
      const m = W();
      return attach(s.torso, rbox(0.228, 0.215, 0.07, 0.04, m, 0, 0.098, -0.045),
        rbox(0.085, 0.215, 0.08, 0.035, m, -0.072, 0.098, 0.03), rbox(0.085, 0.215, 0.08, 0.035, m, 0.072, 0.098, 0.03),
        rbox(0.05, 0.035, 0.05, 0.015, m, -0.05, 0.205, 0.05), rbox(0.05, 0.035, 0.05, 0.015, m, 0.05, 0.205, 0.05));
    },
    dress: (s) => {
      const m = W();
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.165, 0.2, 20, 1), m);
      skirt.position.set(0, -0.06, 0); skirt.scale.set(1, 1, 0.8);
      return attach(s.torso, rbox(0.19, 0.17, 0.13, 0.05, m, 0, 0.11, 0), skirt);
    },
    overalls: (s) => {
      // Bib and straps over the cream shirt, plus the shorts part over the hips.
      const m = W();
      return attach(s.torso, rbox(0.15, 0.11, 0.03, 0.012, m, 0, 0.07, 0.06), rbox(0.03, 0.12, 0.025, 0.01, m, -0.06, 0.16, 0.06),
        rbox(0.03, 0.12, 0.025, 0.01, m, 0.06, 0.16, 0.06), rbox(0.224, 0.07, 0.15, 0.03, m, 0, 0.01, 0));
    },
  } },
  head: { tint: 'skin', variants: { base: (s) => attach(s.head, sphere(HEAD_R, W(), 0, 0, 0, 1, 0.98, 0.96), sphere(0.024, W(), -HEAD_R + 0.004, -0.01, 0, 0.7, 1, 1),
    sphere(0.024, W(), HEAD_R - 0.004, -0.01, 0, 0.7, 1, 1), sphere(0.017, W(), 0, -0.02, HEAD_R - 0.004, 1, 0.8, 0.8), capsule(0.04, 0.04, W(), 0, -HEAD_R - 0.01, 0)) } },
  face: { tint: null, front: true, variants: { base: (s) => {
    const ink = mat(0x2a2420, 0.4), blush = mat(0xee9a88, 0.9), white = mat(0xffffff, 0.3);
    const z = HEAD_R * 0.9;
    return attach(s.head,
      sphere(0.019, ink, -0.04, 0.006, z, 0.8, 1.2, 0.5), sphere(0.019, ink, 0.04, 0.006, z, 0.8, 1.2, 0.5),
      sphere(0.0055, white, -0.036, 0.016, z + 0.009), sphere(0.0055, white, 0.044, 0.016, z + 0.009),
      sphere(0.017, blush, -0.064, -0.028, z - 0.022, 1.2, 0.6, 0.5), sphere(0.017, blush, 0.064, -0.028, z - 0.022, 1.2, 0.6, 0.5),
      rbox(0.026, 0.006, 0.01, 0.003, mat(0x8a4a3a, 0.6), 0, -0.04, z + 0.005));
  } } },
  // Hair shells sit back from the face; baked with the head as a depth occluder, so only the part in front of the
  // head (the hairline, crown, sides and back) is kept and the face always shows.
  hair: { tint: 'hair', variants: {
    short: (s) => attach(s.head, sphere(HEAD_R + 0.016, W(), 0, 0.03, -0.03, 1.04, 0.9, 1.0), sphere(0.05, W(), -0.03, 0.078, 0.052, 1.4, 0.5, 0.9), sphere(0.042, W(), 0.04, 0.08, 0.05, 1.2, 0.45, 0.9)),
    long: (s) => attach(s.head, sphere(HEAD_R + 0.018, W(), 0, 0.028, -0.028, 1.05, 0.92, 1.02), sphere(0.05, W(), 0.02, 0.082, 0.05, 1.6, 0.45, 0.8),
      capsule(0.032, 0.11, W(), -HEAD_R + 0.004, -0.045, 0.0), capsule(0.032, 0.11, W(), HEAD_R - 0.004, -0.045, 0.0)),
    bun: (s) => attach(s.head, sphere(HEAD_R + 0.012, W(), 0, 0.032, -0.03, 1.03, 0.88, 1.0), sphere(0.052, W(), 0, 0.125, -0.05), sphere(0.042, W(), 0.03, 0.08, 0.05, 1.3, 0.45, 0.9)),
    curly: (s) => {
      const m = W(); const out = [sphere(HEAD_R + 0.02, m, 0, 0.034, -0.035, 1.07, 0.9, 1.02)];
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2, up = i % 2 ? 0.075 : 0.035;
        out.push(sphere(0.042, m, Math.cos(a) * (HEAD_R + 0.006), up, Math.sin(a) * (HEAD_R + 0.006) - 0.03));
      }
      out.push(sphere(0.045, m, -0.03, 0.1, 0.03), sphere(0.045, m, 0.035, 0.105, 0.02), sphere(0.05, m, 0, 0.125, -0.03));
      return attach(s.head, ...out);
    },
    cap: (s) => attach(s.head, sphere(HEAD_R + 0.008, W(), 0, 0.0, -0.035, 1.02, 0.95, 0.98)),
    buzz: (s) => attach(s.head, sphere(HEAD_R + 0.006, W(), 0, 0.026, -0.022, 1.0, 0.86, 1.0)),
  } },
  hairLong: { tint: 'hair', variants: { long: (s) => attach(s.head, rbox(0.21, 0.22, 0.07, 0.035, W(), 0, -0.07, -0.075)) } },
  cap: { tint: 'cap', variants: { base: (s) => {
    const m = W();
    const crown = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R + 0.018, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
    crown.position.set(0, 0.012, 0);
    const brim = rbox(0.13, 0.012, 0.09, 0.005, m, 0, 0.012, HEAD_R + 0.02);
    return attach(s.head, crown, brim, sphere(0.012, m, 0, HEAD_R + 0.03, 0));
  } } },
  glasses: { tint: null, front: true, variants: { base: (s) => {
    const frame = mat(0x2f3437, 0.35); const z = HEAD_R * 0.98;
    const ring = (x) => { const t = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0055, 8, 20), frame); t.position.set(x, 0.008, z); return t; };
    return attach(s.head, ring(-0.04), ring(0.04), rbox(0.03, 0.006, 0.006, 0.002, frame, 0, 0.012, z + 0.002));
  } } },
  sunhat: { tint: null, variants: { base: (s) => {
    const straw = mat(0xe8cf8f, 0.9), band = mat(0xc8714f, 0.7);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.014, 28), straw); brim.position.set(0, 0.05, 0);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.08, 22), straw); crown.position.set(0, 0.095, 0);
    const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.113, 0.022, 22), band); ribbon.position.set(0, 0.068, 0);
    return attach(s.head, brim, crown, ribbon);
  } } },
  scarf: { tint: 'scarf', variants: { base: (s) => {
    const m = W(); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.028, 10, 22), m);
    ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.205, 0.005);
    return attach(s.torso, ring, rbox(0.04, 0.09, 0.022, 0.01, m, 0.035, 0.15, 0.085));
  } } },
  backpack: { tint: null, variants: { base: (s) => {
    const canvas = mat(0x8a6f52, 0.85), flap = mat(0x6f5841, 0.85);
    return attach(s.torso, rbox(0.17, 0.19, 0.08, 0.035, canvas, 0, 0.1, -0.105), rbox(0.15, 0.06, 0.085, 0.02, flap, 0, 0.17, -0.105),
      rbox(0.12, 0.06, 0.03, 0.012, flap, 0, 0.05, -0.15));
  } } },
};

/**
 * Draw order of layer slots per baked facing, back to front. Slots ending in `:L` / `:R` are the left / right
 * limbs; in both baked facings the right side is nearer the camera. Mirrored facings keep the same order.
 */
export const ORDER = {
  front: ['backpack', 'hairLong', 'armSkin:L', 'sleeve:L', 'legs:L', 'shoes:L', 'legs:R', 'shoes:R', 'torso', 'overlay', 'scarf', 'armSkin:R', 'sleeve:R', 'head', 'face', 'hair', 'cap', 'glasses', 'sunhat'],
  back: ['armSkin:L', 'sleeve:L', 'legs:L', 'shoes:L', 'legs:R', 'shoes:R', 'torso', 'overlay', 'armSkin:R', 'sleeve:R', 'head', 'hair', 'hairLong', 'cap', 'scarf', 'sunhat', 'backpack'],
  // Sitting: the legs are forward of the hips, so they draw over the torso.
  sitFront: ['backpack', 'hairLong', 'armSkin:L', 'sleeve:L', 'torso', 'overlay', 'legs:L', 'shoes:L', 'legs:R', 'shoes:R', 'scarf', 'armSkin:R', 'sleeve:R', 'head', 'face', 'hair', 'cap', 'glasses', 'sunhat'],
};

/** Feet, top of the bounding box and the fixed bake window shared by every character frame (tiles). */
export const CHARACTER_BOUNDS = { minX: -0.32, maxX: 0.32, minY: -0.02, maxY: 0.9, minZ: -0.32, maxZ: 0.32 };
export const CHARACTER_HEIGHT = 0.76;
