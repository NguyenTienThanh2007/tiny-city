// Bakes the Phase 6 vehicles and bus-stop shelters into one atlas group. Runs in the bake page (headless Chromium).
// Frames: `veh:<model>:<layer>:<direction>` (16 headings, 22.5° apart, measured on the map from east towards south)
// and `stop:<side>:<layer>` (shelter on the N, E, S or W curb of a road tile). Every frame of one kind shares a fixed
// orthographic window, so its anchor is the vehicle centre (or tile centre) on the ground.
import * as THREE from 'three';
import { ELEVATION, PX_PER_UNIT } from '../lib/projection.js';
import { trim, pack, SUN_DIRECTION } from '../lib/stage.js';
import { VEHICLE_MODELS, busStop } from './models.js';

export const VEHICLE_RESOLUTION = 4;
export const VEHICLE_DIRECTIONS = 16;
const SS = 2;
const DEPTH_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false });
const SHADOW = new THREE.MeshBasicMaterial({ color: 0x000000 });

/** A warm headlight pool on the road ahead of the vehicle (lights layer only). */
function beamTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(8, 32, 2, 24, 32, 120);
  g.addColorStop(0, 'rgba(255,240,205,0.9)'); g.addColorStop(0.45, 'rgba(255,232,190,0.35)'); g.addColorStop(1, 'rgba(255,230,190,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function bakeVehicles() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new (class extends THREE.Scene {
    constructor() { super(); const l = new THREE.HemisphereLight(0xffffff, 0x9aa4ad, 2.2); this.add(l); this.background = new THREE.Color(0xdde6ec); }
  })(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xeef3ff, 0xd8ccb6, 1.35));
  const sun = new THREE.DirectionalLight(0xffeedd, 2.3);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(10);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
  fill.position.set(3, 1.5, -1);
  scene.add(fill);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  const view = new THREE.Vector3(Math.cos(ELEVATION) * Math.SQRT1_2, Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.SQRT1_2);
  camera.position.copy(view).multiplyScalar(20);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const scale = PX_PER_UNIT * VEHICLE_RESOLUTION;
  /** A fixed window around the origin that holds the given box, with the origin on an exact pixel. */
  const windowFor = (min, max) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      const c = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    }
    const o = new THREE.Vector3().applyMatrix4(camera.matrixWorldInverse);
    const left = Math.ceil((o.x - minX) * scale) + 2, right = Math.ceil((maxX - o.x) * scale) + 2;
    const top = Math.ceil((maxY - o.y) * scale) + 2, bottom = Math.ceil((o.y - minY) * scale) + 2;
    return { o, left, right, top, bottom, width: left + right, height: top + bottom, anchor: { x: left, y: top } };
  };
  const use = (w) => {
    camera.left = w.o.x - w.left / scale; camera.right = w.o.x + w.right / scale; camera.top = w.o.y + w.top / scale; camera.bottom = w.o.y - w.bottom / scale;
    camera.updateProjectionMatrix();
    renderer.setSize(w.width * SS, w.height * SS, false);
  };
  renderer.setClearColor(0x000000, 0);
  const render = (w, blur = 0) => {
    renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = w.width; out.height = w.height;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (blur) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(renderer.domElement, 0, 0, w.width, w.height);
    return out;
  };
  /** Glow: a blurred copy under the sharp lamps (soft bloom without any runtime filter). */
  const glow = (canvas) => {
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.filter = 'blur(5px)'; ctx.drawImage(canvas, 0, 0); ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none'; ctx.drawImage(canvas, 0, 0);
    return out;
  };

  const entries = [];
  const shadowMatrix = new THREE.Matrix4().set(1, -SUN_DIRECTION.x / SUN_DIRECTION.y, 0, 0, 0, 0.001, 0, 0, 0, -SUN_DIRECTION.z / SUN_DIRECTION.y, 1, 0, 0, 0, 0, 1);
  const beams = beamTexture();
  const vehicleWindow = windowFor(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 0.48, 0.5));
  const shadowWindow = windowFor(new THREE.Vector3(-0.5, 0, -0.75), new THREE.Vector3(1.0, 0.001, 0.5));
  for (const [model, build] of Object.entries(VEHICLE_MODELS)) {
    const object = build();
    const meshes = [];
    object.traverse((m) => { if (m.isMesh) meshes.push(m); });
    for (const m of meshes) m.userData.material = m.material;
    // Headlight pools on the road ahead (lights layer only).
    const box = new THREE.Box3().setFromObject(object);
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), new THREE.MeshBasicMaterial({ map: beams, transparent: true, depthWrite: false }));
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(box.max.x + 0.2, 0.003, 0);
    beam.userData.layer = 'beam';
    object.add(beam);
    const holder = new THREE.Group();
    holder.add(object);
    scene.add(holder);
    for (let d = 0; d < VEHICLE_DIRECTIONS; d += 1) {
      object.rotation.y = -d * (Math.PI * 2 / VEHICLE_DIRECTIONS);
      for (const layer of ['body', 'detail', 'lights', 'shadow']) {
        sun.visible = fill.visible = layer !== 'lights' && layer !== 'shadow';
        holder.matrixAutoUpdate = layer !== 'shadow';
        if (layer === 'shadow') { holder.matrix.copy(shadowMatrix); holder.matrixWorldNeedsUpdate = true; }
        else { holder.matrix.identity(); holder.updateMatrix(); }
        for (const m of meshes) {
          const own = m.userData.layer;
          if (layer === 'shadow') { m.material = SHADOW; m.visible = true; }
          else if (layer === 'lights') {
            m.visible = true;
            m.material = own === 'light' ? new THREE.MeshBasicMaterial({ color: m.userData.material.color.clone().lerp(new THREE.Color(0xffffff), own === 'light' ? 0.25 : 0) }) : DEPTH_ONLY;
          } else {
            m.visible = true;
            m.material = (layer === 'body' ? own === 'body' : own !== 'body') ? m.userData.material : DEPTH_ONLY;
          }
        }
        beam.visible = layer === 'lights';
        holder.updateMatrixWorld(true);
        const w = layer === 'shadow' ? shadowWindow : vehicleWindow;
        use(w);
        let canvas = render(w, layer === 'shadow' ? 3 : 0);
        if (layer === 'lights') canvas = glow(canvas);
        const trimmed = trim({ canvas, anchor: w.anchor });
        if (trimmed) entries.push({ name: `veh:${model}:${layer}:${d}`, ...trimmed });
        for (const m of meshes) if (m.material !== m.userData.material && m.material !== DEPTH_ONLY && m.material !== SHADOW) m.material.dispose();
      }
    }
    for (const m of meshes) m.material = m.userData.material;
    scene.remove(holder);
    object.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
  }

  // Bus-stop shelters, one per curb side (N is modelled; E, S, W are rotations about the tile centre).
  const stopWindow = windowFor(new THREE.Vector3(-0.55, 0, -0.55), new THREE.Vector3(0.55, 0.6, 0.55));
  const stopShadowWindow = windowFor(new THREE.Vector3(-0.6, 0, -1.0), new THREE.Vector3(1.2, 0.001, 0.6));
  const sides = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };
  const shelter = busStop();
  const parts = [];
  shelter.traverse((m) => { if (m.isMesh) { m.userData.material = m.material; parts.push(m); } });
  const holder = new THREE.Group();
  holder.add(shelter);
  scene.add(holder);
  for (const [side, angle] of Object.entries(sides)) {
    shelter.rotation.y = angle;
    for (const layer of ['color', 'lights', 'shadow']) {
      sun.visible = fill.visible = layer === 'color';
      holder.matrixAutoUpdate = layer !== 'shadow';
      if (layer === 'shadow') { holder.matrix.copy(shadowMatrix); holder.matrixWorldNeedsUpdate = true; } else { holder.matrix.identity(); holder.updateMatrix(); }
      for (const m of parts) m.material = layer === 'shadow' ? SHADOW : layer === 'lights' ? (m.userData.layer === 'light' ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : DEPTH_ONLY) : m.userData.material;
      holder.updateMatrixWorld(true);
      const w = layer === 'shadow' ? stopShadowWindow : stopWindow;
      use(w);
      let canvas = render(w, layer === 'shadow' ? 3 : 0);
      if (layer === 'lights') canvas = glow(canvas);
      const trimmed = trim({ canvas, anchor: w.anchor });
      if (trimmed) entries.push({ name: `stop:${side}:${layer}`, ...trimmed });
    }
  }
  for (const m of parts) m.material = m.userData.material;
  scene.remove(holder);
  renderer.dispose();
  const pages = pack(entries, { size: 2048, padding: 3 });
  return { pages, meta: { resolution: VEHICLE_RESOLUTION, directions: VEHICLE_DIRECTIONS, models: Object.keys(VEHICLE_MODELS),
    layers: ['body', 'detail', 'lights', 'shadow'], stops: Object.keys(sides), frames: entries.length } };
}
