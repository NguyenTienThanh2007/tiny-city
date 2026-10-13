// Offline bake stage (runs in headless Chromium). Renders each asset with the game's exact 2:1 projection into
// three passes — color (lit, self-shadowed), ground shadow (cast onto the lawn/road around it) and emissive (night
// windows and lamps) — then trims and packs them into atlas pages with a manifest.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ELEVATION, PX_PER_UNIT } from './projection.js';
import { rng } from './kit.js';

const SUPERSAMPLE = 2;
/** Sun from the upper left of the screen (−X), slightly toward the viewer (+Z): south faces lit, east faces in shade. */
export const SUN_DIRECTION = new THREE.Vector3(-0.78, 1.18, 0.5).normalize();

export function createStage({ resolution }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;
  const hemi = new THREE.HemisphereLight(0xe6efff, 0xdcc6a0, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6c4, 2.85);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.012;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  // Cool bounce light from the opposite side keeps shaded faces readable (never black).
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.45);
  fill.position.set(3, 2, -1);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ color: 0x1a2436, opacity: 0.34 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const baseScale = PX_PER_UNIT * resolution; // texture px per scene unit
  const viewDir = new THREE.Vector3(Math.cos(ELEVATION) * Math.SQRT1_2, Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.SQRT1_2);

  function aimCamera(center) {
    camera.position.copy(center).addScaledVector(viewDir, 30);
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
  }
  const toCamera = (point) => point.clone().applyMatrix4(camera.matrixWorldInverse);

  /** Frustum that contains `points` and puts the scene origin on an exact texture pixel. */
  function fit(points, pad = 3, scale = baseScale) {
    const origin = toCamera(new THREE.Vector3(0, 0, 0));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      const c = toCamera(p);
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    }
    const left = Math.ceil((origin.x - minX) * scale + pad), right = Math.ceil((maxX - origin.x) * scale + pad);
    const top = Math.ceil((maxY - origin.y) * scale + pad), bottom = Math.ceil((origin.y - minY) * scale + pad);
    camera.left = origin.x - left / scale; camera.right = origin.x + right / scale;
    camera.top = origin.y + top / scale; camera.bottom = origin.y - bottom / scale;
    camera.updateProjectionMatrix();
    return { width: left + right, height: top + bottom, anchor: { x: left, y: top } };
  }

  function corners(box) {
    const out = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
    return out;
  }

  function placeSun(box) {
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2 + 0.5;
    sun.position.copy(center).addScaledVector(SUN_DIRECTION, 12);
    sun.target.position.copy(center);
    const cam = sun.shadow.camera;
    cam.left = -radius * 1.6; cam.right = radius * 1.6; cam.top = radius * 1.6; cam.bottom = -radius * 1.6;
    cam.near = 0.5; cam.far = 30;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }

  function renderTo(width, height, background = null) {
    renderer.setSize(width * SUPERSAMPLE, height * SUPERSAMPLE, false);
    renderer.setClearColor(background ?? 0x000000, background === null ? 0 : 1);
    renderer.render(scene, camera);
    // Downsample the supersampled frame for clean, stable edges.
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(renderer.domElement, 0, 0, width, height);
    return out;
  }

  /** Ambient occlusion (GTAO, denoised) from the current camera, as a grayscale canvas at the given size. */
  let composer = null, gtao = null;
  function renderAO(width, height) {
    const w = width * SUPERSAMPLE, h = height * SUPERSAMPLE;
    renderer.setSize(w, h, false);
    if (!composer) {
      composer = new EffectComposer(renderer);
      gtao = new GTAOPass(scene, camera, w, h);
      gtao.output = GTAOPass.OUTPUT.Denoise;
      gtao.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 24 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      composer.addPass(gtao);
    }
    gtao.camera = camera;
    composer.setPixelRatio(1);
    composer.setSize(w, h);
    renderer.setClearColor(0xffffff, 1);
    composer.render();
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(renderer.domElement, 0, 0, width, height);
    return out;
  }
  /** Multiplies occlusion into the colour pass (alpha untouched), darkening creases and contact points. */
  function applyAO(color, ao, strength = 0.75) {
    const c = color.getContext('2d'), a = ao.getContext('2d');
    const image = c.getImageData(0, 0, color.width, color.height), occ = a.getImageData(0, 0, ao.width, ao.height).data;
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const f = 1 - strength * (1 - Math.min(1, occ[i] / 255));
      d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
    }
    c.putImageData(image, 0, 0);
  }

  function meshes(object) { const list = []; object.traverse((o) => { if (o.isMesh) list.push(o); }); return list; }

  /** Renders one asset object (already positioned with its footprint origin at 0,0,0). */
  function bake(object, { seed = 1, shadow = true, emissive = true, litShare = 0.62, extraBounds = null, ao = 0.75 } = {}) {
    scene.add(object);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object, true);
    if (extraBounds) box.union(extraBounds);
    const center = box.getCenter(new THREE.Vector3());
    aimCamera(center);
    placeSun(box);
    const result = { top: box.max.y };

    // 1. Color pass: lit model, self-shadowed; the lawn plane itself is invisible.
    ground.visible = false;
    let frame = fit(corners(box));
    const colorCanvas = renderTo(frame.width, frame.height);
    if (ao) applyAO(colorCanvas, renderAO(frame.width, frame.height), ao);
    result.color = { canvas: colorCanvas, anchor: frame.anchor };

    // 2. Ground shadow pass: the model only casts; the plane collects the shadow plus a soft contact shade.
    if (shadow) {
      ground.visible = true;
      const originals = new Map();
      const hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
      for (const mesh of meshes(object)) { originals.set(mesh, mesh.material); mesh.material = hidden; }
      const along = SUN_DIRECTION.clone().multiplyScalar(-1 / SUN_DIRECTION.y);
      const pts = corners(box).map((p) => new THREE.Vector3(p.x + along.x * p.y, 0, p.z + along.z * p.y));
      pts.push(...corners(box).map((p) => new THREE.Vector3(p.x, 0, p.z)));
      // Shadows are soft, so they bake at half resolution into their own atlas.
      frame = fit(pts, 2, baseScale / 2);
      result.shadow = { canvas: renderTo(frame.width, frame.height), anchor: frame.anchor, half: true };
      for (const [mesh, material] of originals) mesh.material = material;
      ground.visible = false;
    }

    // 3. Emissive pass: lit windows and lamp heads on black; everything else occludes.
    if (emissive) {
      const random = rng(seed * 7919 + 13);
      const originals = new Map();
      const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const warm = [0xffd27a, 0xffc366, 0xffdf9a, 0xfff0c4];
      let any = false;
      for (const mesh of meshes(object)) {
        originals.set(mesh, mesh.material);
        if (mesh.userData.lamp) { mesh.material = new THREE.MeshBasicMaterial({ color: 0xfff2c8 }); any = true; }
        else if (mesh.userData.sign && originals.get(mesh).map) { mesh.material = new THREE.MeshBasicMaterial({ map: originals.get(mesh).map }); any = true; }
        else if (mesh.userData.window && (mesh.userData.lit ?? random() < litShare)) {
          mesh.material = new THREE.MeshBasicMaterial({ color: warm[Math.floor(random() * warm.length)] }); any = true;
        } else mesh.material = black;
      }
      const savedTone = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      const savedEnv = scene.environment; scene.environment = null;
      // Night glow is soft light, so it also bakes at half resolution (into the half-resolution atlas).
      frame = fit(corners(box), 2, baseScale / 2);
      if (any) {
        const canvas = renderTo(frame.width, frame.height, 0x000000);
        // Black → transparent: alpha = brightness, color = normalized, for additive or normal blending.
        const ctx = canvas.getContext('2d');
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = image.data;
        for (let i = 0; i < d.length; i += 4) {
          const a = Math.max(d[i], d[i + 1], d[i + 2]);
          if (a < 6) { d[i + 3] = 0; continue; }
          d[i] = Math.min(255, d[i] * 255 / a); d[i + 1] = Math.min(255, d[i + 1] * 255 / a); d[i + 2] = Math.min(255, d[i + 2] * 255 / a); d[i + 3] = a;
        }
        ctx.putImageData(image, 0, 0);
        result.emissive = { canvas, anchor: frame.anchor, half: true };
      }
      for (const [mesh, material] of originals) mesh.material = material;
      renderer.toneMapping = savedTone;
      scene.environment = savedEnv;
    }
    scene.remove(object);
    return result;
  }

  /** Fixed-frustum bake for ground tiles (roads): the tile diamond maps exactly onto its 56×28 world px cell. */
  function bakeTile(object, { margin = 6 } = {}) {
    scene.add(object);
    object.updateMatrixWorld(true);
    aimCamera(new THREE.Vector3(0.5, 0, 0.5));
    placeSun(new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(1.5, 0.3, 1.5)));
    ground.visible = false;
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.08, 0)];
    const frame = fit(pts, margin);
    const canvas = renderTo(frame.width, frame.height);
    scene.remove(object);
    return { color: { canvas, anchor: frame.anchor } };
  }

  return { bake, bakeTile, renderer, scene };
}

/** Trims transparent borders; returns the cropped canvas and the anchor shifted accordingly. */
export function trim(entry) {
  const { canvas, anchor } = entry;
  const ctx = canvas.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (data[(y * width + x) * 4 + 3] > 2) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return null;
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, -minX, -minY);
  return { canvas: out, anchor: { x: anchor.x - minX, y: anchor.y - minY } };
}

/** Skyline bottom-left packer into fixed-size pages with padding (mip-safe). */
export function pack(entries, { size = 2048, padding = 6 } = {}) {
  const sorted = [...entries].sort((a, b) => b.canvas.height - a.canvas.height || b.canvas.width - a.canvas.width);
  const pages = [];
  const newPage = () => { const page = { frames: [], skyline: [{ x: 0, y: 0, w: size }], used: 0 }; pages.push(page); return page; };
  const place = (page, w, h) => {
    let best = null;
    for (let i = 0; i < page.skyline.length; i += 1) {
      const x = page.skyline[i].x;
      if (x + w > size) break;
      let y = 0, width = 0, j = i;
      while (width < w && j < page.skyline.length) { y = Math.max(y, page.skyline[j].y); width += page.skyline[j].w; j += 1; }
      if (width < w || y + h > size) continue;
      if (!best || y + h < best.y + best.h || (y + h === best.y + best.h && x < best.x)) best = { x, y, h, i };
    }
    if (!best) return null;
    // Raise the skyline over [x, x + w).
    const { x, y } = best;
    const next = [];
    for (const seg of page.skyline) {
      const segEnd = seg.x + seg.w;
      if (segEnd <= x || seg.x >= x + w) { next.push(seg); continue; }
      if (seg.x < x) next.push({ x: seg.x, y: seg.y, w: x - seg.x });
      if (segEnd > x + w) next.push({ x: x + w, y: seg.y, w: segEnd - x - w });
    }
    next.push({ x, y: y + h, w });
    next.sort((a, b) => a.x - b.x);
    const merged = [];
    for (const seg of next) { const last = merged.at(-1); if (last && last.y === seg.y && last.x + last.w === seg.x) last.w += seg.w; else merged.push({ ...seg }); }
    page.skyline = merged;
    page.used = Math.max(page.used, y + h);
    return { x, y };
  };
  let page = newPage();
  for (const entry of sorted) {
    const w = entry.canvas.width + padding * 2, h = entry.canvas.height + padding * 2;
    if (w > size || h > size) throw new Error(`${entry.name} (${w}×${h}) exceeds atlas page ${size}`);
    let spot = place(page, w, h);
    if (!spot) { spot = pages.slice(0, -1).map((p) => ({ p, s: place(p, w, h) })).find((r) => r.s); if (spot) { spot.p.frames.push({ entry, x: spot.s.x + padding, y: spot.s.y + padding }); continue; } page = newPage(); spot = place(page, w, h); }
    page.frames.push({ entry, x: spot.x + padding, y: spot.y + padding });
  }
  return pages.map((p, index) => {
    // Exact used height (WebGL2 handles non-power-of-two textures and their mipmaps).
    const height = Math.min(size, Math.ceil(Math.max(64, p.used) / 8) * 8);
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const frames = {};
    for (const { entry, x, y } of p.frames) {
      ctx.drawImage(entry.canvas, x, y);
      const w = entry.canvas.width, h = entry.canvas.height;
      frames[entry.name] = {
        frame: { x, y, w, h }, rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h },
        anchor: { x: entry.anchor.x / w, y: entry.anchor.y / h },
      };
    }
    return { index, canvas, frames };
  });
}
