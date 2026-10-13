// Procedural material detail textures (bake time only). Each texture is a near-white detail map multiplied by the
// material colour, so the palette stays in kit.js while surfaces gain tiles, courses, joints and grain.
// Everything is drawn from a seeded RNG, so bakes stay deterministic. UVs are assigned in world units by
// `applyWorldUVs`, which gives every asset the same texel density.
import * as THREE from 'three';
import { rng } from './kit.js';

const SIZE = 256;
const cache = new Map();

function canvas(size = SIZE) { const c = document.createElement('canvas'); c.width = size; c.height = size; return c; }
const shade = (v) => { const g = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${g},${g},${g})`; };
const tint = (r, g, b) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

/** Fine value noise speckle over the whole canvas. */
function speckle(ctx, size, random, amount, base = 1, cell = 2) {
  for (let y = 0; y < size; y += cell) for (let x = 0; x < size; x += cell) {
    ctx.fillStyle = shade(base - random() * amount);
    ctx.fillRect(x, y, cell, cell);
  }
}
/** Soft blotches for weathering (low contrast). */
function blotches(ctx, size, random, count, alpha) {
  for (let i = 0; i < count; i += 1) {
    const x = random() * size, y = random() * size, r = 10 + random() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = random() < 0.5;
    g.addColorStop(0, `rgba(${dark ? '0,0,0' : '255,255,255'},${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) { ctx.save(); ctx.translate(ox, oy); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore(); }
  }
}

const painters = {
  plaster(ctx, s, r) { speckle(ctx, s, r, 0.05, 1, 2); blotches(ctx, s, r, 26, 0.035); },
  render(ctx, s, r) { speckle(ctx, s, r, 0.03, 1, 1); blotches(ctx, s, r, 16, 0.025); },
  roofTile(ctx, s, r) {
    // Clay barrel tiles: 8 courses, 8 tiles each, staggered; each course overlaps the one below with a shadow line.
    ctx.fillStyle = shade(0.86); ctx.fillRect(0, 0, s, s);
    const rows = 8, cols = 8, h = s / rows, w = s / cols;
    for (let row = 0; row < rows; row += 1) {
      const off = row % 2 ? w / 2 : 0;
      for (let col = -1; col <= cols; col += 1) {
        const x = col * w + off, y = row * h;
        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        const k = 0.93 + r() * 0.07;
        g.addColorStop(0, shade(0.74 * k)); g.addColorStop(0.35, shade(1.0 * k)); g.addColorStop(0.65, shade(0.97 * k)); g.addColorStop(1, shade(0.72 * k));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x + w - 1, y); ctx.lineTo(x + w - 1, y + h - 3);
        ctx.quadraticCurveTo(x + w / 2, y + h + 2, x + 1, y + h - 3); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, row * h, s, 2.5);
    }
  },
  slate(ctx, s, r) {
    ctx.fillStyle = shade(0.7); ctx.fillRect(0, 0, s, s);
    const rows = 10, cols = 7, h = s / rows, w = s / cols;
    for (let row = 0; row < rows; row += 1) for (let col = -1; col <= cols; col += 1) {
      const x = col * w + (row % 2 ? w / 2 : 0), y = row * h;
      ctx.fillStyle = shade(0.86 + r() * 0.14);
      ctx.fillRect(x + 1.5, y + 1.5, w - 3, h - 2.5);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 1.5, y + 1.5, w - 3, 2);
    }
  },
  seam(ctx, s, r) { // standing-seam metal
    ctx.fillStyle = shade(0.95); ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += s / 8) { ctx.fillStyle = shade(0.72); ctx.fillRect(x, 0, 2, s); ctx.fillStyle = shade(1); ctx.fillRect(x + 2, 0, 2, s); }
    speckle(ctx, s, r, 0.02, 1, 4); ctx.globalCompositeOperation = 'multiply'; ctx.globalCompositeOperation = 'source-over';
  },
  brick(ctx, s, r) {
    ctx.fillStyle = shade(0.97); ctx.fillRect(0, 0, s, s);
    const rows = 16, cols = 6, h = s / rows, w = s / cols;
    for (let row = 0; row < rows; row += 1) for (let col = -1; col <= cols; col += 1) {
      const x = col * w + (row % 2 ? w / 2 : 0), y = row * h, k = 0.8 + r() * 0.17;
      ctx.fillStyle = tint(k, k * 0.98, k * 0.95); ctx.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
    }
  },
  stone(ctx, s, r) {
    ctx.fillStyle = shade(0.74); ctx.fillRect(0, 0, s, s);
    let y = 0;
    while (y < s) {
      const h = 20 + r() * 18; let x = -r() * 30;
      while (x < s) { const w = 30 + r() * 40; ctx.fillStyle = shade(0.86 + r() * 0.14); ctx.beginPath(); ctx.roundRect(x + 2, y + 2, w - 4, h - 4, 5); ctx.fill(); x += w; }
      y += h;
    }
    speckle(ctx, s, r, 0.0, 1, 4);
  },
  planks(ctx, s, r) {
    const rows = 8, h = s / rows;
    for (let row = 0; row < rows; row += 1) {
      let x = -r() * 60;
      while (x < s) {
        const w = 70 + r() * 90, k = 0.84 + r() * 0.16;
        ctx.fillStyle = shade(k); ctx.fillRect(x, row * h, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        for (let i = 0; i < 3; i += 1) { const gy = row * h + 3 + r() * (h - 6); ctx.beginPath(); ctx.moveTo(x, gy); ctx.bezierCurveTo(x + w / 3, gy + 2, x + w * 2 / 3, gy - 2, x + w, gy); ctx.stroke(); }
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, row * h, 1.5, h);
        x += w;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, row * h, s, 1.5);
    }
  },
  paving(ctx, s, r) {
    ctx.fillStyle = shade(0.78); ctx.fillRect(0, 0, s, s);
    const n = 4, w = s / n;
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
      ctx.fillStyle = shade(0.9 + r() * 0.1); ctx.fillRect(x * w + 2, y * w + 2, w - 4, w - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x * w + 2, y * w + 2, w - 4, 2);
    }
  },
  cobble(ctx, s, r) {
    ctx.fillStyle = shade(0.72); ctx.fillRect(0, 0, s, s);
    const n = 9, w = s / n;
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n + 1; x += 1) {
      const cx = x * w + (y % 2 ? w / 2 : 0), cy = y * w + w / 2;
      ctx.fillStyle = shade(0.86 + r() * 0.14);
      ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.46, w * 0.42, r() * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(cx - 2, cy - 3, w * 0.25, w * 0.15, 0, 0, Math.PI * 2); ctx.fill();
    }
  },
  asphalt(ctx, s, r) { speckle(ctx, s, r, 0.1, 1, 1); blotches(ctx, s, r, 14, 0.05); },
  concrete(ctx, s, r) { speckle(ctx, s, r, 0.05, 1, 2); blotches(ctx, s, r, 10, 0.03); ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, 0, s, 1.5); ctx.fillRect(0, 0, 1.5, s); },
  poolTile(ctx, s, r) {
    ctx.fillStyle = shade(0.82); ctx.fillRect(0, 0, s, s);
    const n = 16, w = s / n;
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) { ctx.fillStyle = shade(0.94 + r() * 0.06); ctx.fillRect(x * w + 1, y * w + 1, w - 2, w - 2); }
  },
  water(ctx, s, r) {
    ctx.fillStyle = shade(0.9); ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2;
    for (let i = 0; i < 40; i += 1) {
      const x = r() * s, y = r() * s, len = 12 + r() * 26;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + len / 3, y - 5, x + len * 2 / 3, y + 5, x + len, y); ctx.stroke();
    }
  },
  grass(ctx, s, r) {
    speckle(ctx, s, r, 0.07, 1, 2);
    for (let i = 0; i < 900; i += 1) {
      const x = r() * s, y = r() * s, k = r();
      ctx.strokeStyle = k < 0.5 ? 'rgba(0,30,0,0.12)' : 'rgba(255,255,220,0.14)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 3); ctx.stroke();
    }
  },
  leaves(ctx, s, r) {
    ctx.fillStyle = shade(0.86); ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1400; i += 1) {
      const x = r() * s, y = r() * s, k = r();
      ctx.fillStyle = k < 0.35 ? 'rgba(0,25,0,0.22)' : k < 0.8 ? shade(0.9 + r() * 0.1) : 'rgba(255,255,210,0.35)';
      ctx.beginPath(); ctx.ellipse(x, y, 3 + r() * 3, 2 + r() * 2, r() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
  },
  bark(ctx, s, r) {
    ctx.fillStyle = shade(0.9); ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i += 1) { ctx.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.12})`; ctx.fillRect(r() * s, 0, 1 + r() * 3, s); }
  },
  glassGrid(ctx, s, r) { // curtain wall: reflections plus a mullion grid (office towers)
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, shade(1)); g.addColorStop(0.45, shade(0.82)); g.addColorStop(0.55, shade(0.95)); g.addColorStop(1, shade(0.78));
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 6; i += 1) { const x = r() * s; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 40, 0); ctx.lineTo(x - 20, s); ctx.lineTo(x - 60, s); ctx.fill(); }
    ctx.fillStyle = shade(0.35);
    for (let i = 0; i <= 4; i += 1) { ctx.fillRect(i * s / 4 - 2, 0, 4, s); ctx.fillRect(0, i * s / 4 - 2, s, 4); }
  },
  fabric(ctx, s, r) { speckle(ctx, s, r, 0.04, 1, 2); ctx.fillStyle = 'rgba(0,0,0,0.05)'; for (let y = 0; y < s; y += 4) ctx.fillRect(0, y, s, 1); },
};

/** Texture repeat size in scene units for each detail map. */
export const TEXTURE_SCALE = {
  plaster: 1.2, render: 0.9, roofTile: 0.55, slate: 0.5, seam: 0.6, brick: 0.45, stone: 0.7, planks: 0.5, paving: 0.5, cobble: 0.4,
  asphalt: 0.8, concrete: 1.0, poolTile: 0.5, water: 0.9, grass: 0.7, leaves: 0.35, bark: 0.3, glassGrid: 0.6, fabric: 0.4,
};

export function detailTexture(kind) {
  if (!painters[kind]) throw new Error(`unknown texture ${kind}`);
  if (!cache.has(kind)) {
    const c = canvas();
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SIZE, SIZE);
    painters[kind](ctx, SIZE, rng(0x51ed + Object.keys(painters).indexOf(kind) * 977));
    const texture = new THREE.CanvasTexture(c);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    cache.set(kind, texture);
  }
  return cache.get(kind);
}

/**
 * Assigns UVs in world units to every textured mesh: box projection on the dominant normal axis, or a per-face
 * slope projection for roofs (u along the eave, v up the slope) so tile courses always run parallel to the eaves.
 */
export function applyWorldUVs(root) {
  root.updateMatrixWorld(true);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.material?.map) return;
    const scale = mesh.material.userData.texScale ?? 1;
    let geometry = mesh.geometry;
    if (mesh.userData.uvSlope && geometry.index) geometry = mesh.geometry = geometry.toNonIndexed();
    const pos = geometry.attributes.position, nor = geometry.attributes.normal;
    if (!pos || !nor) return;
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const uv = new Float32Array(pos.count * 2);
    if (mesh.userData.uvSlope) {
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), face = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, i + 2).applyMatrix4(mesh.matrixWorld);
        face.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
        if (face.y < 0) face.negate();
        const t = new THREE.Vector3(0, 1, 0).cross(face);
        if (t.lengthSq() < 1e-6) t.set(1, 0, 0); else t.normalize();
        const s = new THREE.Vector3().crossVectors(face, t).normalize();
        [a, b, c].forEach((v, k) => { uv[(i + k) * 2] = v.dot(t) / scale; uv[(i + k) * 2 + 1] = -v.dot(s) / scale; });
      }
    } else {
      for (let i = 0; i < pos.count; i += 1) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
        const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
        let u, v;
        if (ay >= ax && ay >= az) { u = p.x; v = p.z; } else if (ax >= az) { u = p.z; v = -p.y; } else { u = p.x; v = -p.y; }
        uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
      }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  });
}
