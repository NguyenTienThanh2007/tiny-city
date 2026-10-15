import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { BuildingDesign } from '@tiny-city/ai-architect';
import { getGameTime, PLAYER_BALANCE, playerWalkCheck } from '@tiny-city/simulation';
import type { Position, RoadNavigator, WorldState } from '@tiny-city/simulation';
import { lookFromAppearance } from '../../game/art/characterLook';
import { buildWalkGrid, isWalkablePoint, type WalkGrid } from '../collision';
import { advanceController, createController, motionState, MOVEMENT, NO_INPUT, type ControllerState, type MotionState, type MoveInput } from '../controller';
import { createOrbit, orbitBy, updateOrbit, zoomBy, type OrbitState } from '../orbitCamera';
import { resolveSpawn, type Spawn } from '../spawn';
import { resolveQuality, type ImmersiveSettings } from '../settings';
import { disposeAssetCache } from './assetBuilder';
import { buildCharacter, type CharacterModel } from './characterModel';
import { Neighbourhood, VIEW_DISTANCE, type NeighbourhoodStats, type Quality } from './neighbourhood';
import { ResidentLayer } from './residents';
import { disposeVehicleTemplates, VehicleLayer } from './vehicles';

/**
 * Phase 8A Character View engine: one Three.js renderer and one requestAnimationFrame loop over the authoritative
 * world. While it runs, the City View's Pixi ticker is stopped and this loop feeds the same single simulation clock
 * (`advance`), so there is never a second simulation or a second frame driver.
 *
 * Authority: the controller proposes continuous positions; the bridge commits them as `player.walk` steps, short
 * and always validated by the simulation (the same walk check runs here first, so a step is committed before a
 * straight segment could leave walkable ground). Until the player first moves, the character stays exactly as the
 * simulation has them (inside at home, resting, or walking a click-to-move route); the first movement steps them out
 * through the door, which cancels any activity just like choosing a new destination does.
 */

export interface HudState {
  readonly motion: MotionState | 'inside' | 'travelling';
  readonly position: Position;
  readonly pointerLocked: boolean;
  readonly fps: number;
}

export interface EngineHost {
  getWorld(): WorldState;
  getNavigator(): RoadNavigator;
  /** Feeds real elapsed time to the one simulation clock (no-op while paused or hidden). */
  advance(elapsedMs: number): void;
  /** Commits one direct-control step; returns whether the simulation accepted it. */
  walk(position: Position): boolean;
  readonly designs: ReadonlyMap<string, BuildingDesign>;
  readonly initialYaw: number | null;
  readonly reducedMotion: boolean;
  onProgress(done: number, total: number, label: string): void;
  onReady(info: { spawn: Spawn; quality: Quality }): void;
  onFailure(kind: 'webgl' | 'spawn' | 'lost', message: string, spawn?: Spawn): void;
  onHud(hud: HudState): void;
  onEscape(): void;
  onTogglePause(): void;
}

export interface ImmersiveDebug {
  ready: boolean;
  quality: Quality;
  renderer: string;
  player: { x: number; y: number; yaw: number; motion: string; speed: number; controlling: boolean; blocked: boolean };
  authority: { x: number; y: number; status: string; tick: number };
  camera: { yaw: number; pitch: number; distance: number; actual: number; x: number; y: number; z: number };
  commits: number;
  rejected: number;
  pointerLocked: boolean;
  stats: NeighbourhoodStats & { drawCalls: number; frameTriangles: number; geometries: number; textures: number; fps: number; frameMs: number; p95Ms: number; initMs: number;
    /** Mean CPU time of the engine's frame callback (simulation advance, controller, camera, scene update, render submit). */
    cpuMs: number;
    /** Estimated GPU memory of the static scene: vertex buffers plus textures (mipmapped RGBA8), in bytes. */
    gpuBytes: number };
  residents: string[];
  vehicles: string[];
  /** The character's composed layers (appearance → rig layers), to prove the same character in both views. */
  character: readonly string[];
  input: MoveInput;
}

/** Vertex buffers (instance matrices included) and textures of a scene, counted once each. */
function estimateGpuBytes(scene: THREE.Scene): number {
  const geometries = new Set<THREE.BufferGeometry>(), textures = new Set<THREE.Texture>();
  let bytes = 0;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) bytes += (mesh as THREE.InstancedMesh).instanceMatrix.array.byteLength;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) textures.add(map);
    }
  });
  for (const g of geometries) for (const a of Object.values(g.attributes)) bytes += (a as THREE.BufferAttribute).array.byteLength;
  for (const t of textures) { const img = t.image as { width?: number; height?: number } | undefined; bytes += Math.round((img?.width ?? 0) * (img?.height ?? 0) * 4 * 4 / 3); }
  return bytes;
}

/** Reads the GPU/renderer name from a throwaway context (released at once), e.g. to spot software rendering. */
function probeRenderer(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return 'unavailable';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return 'unavailable'; }
}

const KEYS: Record<string, 'forward' | 'back' | 'left' | 'right' | 'run'> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',
};
/** Commit cadence: at least every half tile, or every quarter second while moving. */
const COMMIT_DISTANCE = 0.5, COMMIT_INTERVAL = 250;

export class ImmersiveEngine {
  private renderer: THREE.WebGLRenderer | null = null;
  private camera = new THREE.PerspectiveCamera(55, 1, 0.02, 60);
  private neighbourhood: Neighbourhood | null = null;
  private character: CharacterModel | null = null;
  private residents = new ResidentLayer();
  private vehicles: VehicleLayer | null = null;
  private grid: WalkGrid | null = null;
  private controller: ControllerState | null = null;
  private orbit: OrbitState | null = null;
  private spawn: Spawn | null = null;
  private raf = 0;
  private last = 0;
  private disposed = false;
  private keys = new Set<string>();
  private controlling = false;
  private lastCommitted: Position | null = null;
  private lastCommitAt = 0;
  private commits = 0;
  private rejected = 0;
  private settings: ImmersiveSettings;
  private quality: Quality = 'high';
  private rendererName = 'unknown';
  private drag: { id: number; x: number; y: number; travel: number; at: number } | null = null;
  private frameTimes: number[] = [];
  private frameCosts: number[] = [];
  private gpuBytes = 0;
  private hudAt = 0;
  private initMs = 0;
  private time = 0;
  private readonly cleanups: (() => void)[] = [];
  private environment: THREE.Texture | null = null;

  /** Each engine owns a fresh canvas (a released WebGL context can never be reused, e.g. after a StrictMode remount). */
  readonly canvas: HTMLCanvasElement;

  constructor(container: HTMLElement, private readonly host: EngineHost, settings: ImmersiveSettings) {
    this.settings = settings;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'immersive-canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', '3D neighbourhood. W A S D to move, Shift to run, drag or click to look around.');
    container.prepend(this.canvas);
  }

  setSettings(settings: ImmersiveSettings) { this.settings = settings; }
  /** While a menu is open the character stands still and keys reach the menu's controls. */
  setInputBlocked(blocked: boolean) { this.inputBlocked = blocked; if (blocked) { this.keys.clear(); this.drag = null; } }
  private inputBlocked = false;
  get yaw(): number | null { return this.controller?.yaw ?? null; }

  async start(): Promise<void> {
    const started = performance.now();
    // The graphics preset is chosen before the real context exists (antialiasing cannot change afterwards).
    this.rendererName = probeRenderer();
    this.quality = resolveQuality(this.settings.quality, this.rendererName);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality === 'high', powerPreference: 'high-performance' });
    } catch (error) {
      this.host.onFailure('webgl', `Your browser could not start 3D graphics (${error instanceof Error ? error.message : 'WebGL unavailable'}).`);
      return;
    }
    const r = this.renderer;
    // The light preset renders at three-quarter resolution: software renderers are bound by pixels shaded.
    r.setPixelRatio(this.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 0.75);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = this.quality === 'high';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera.far = VIEW_DISTANCE[this.quality] + 30;
    const onLost = (event: Event) => { event.preventDefault(); this.host.onFailure('lost', 'The 3D view lost its graphics context (the GPU was reset or ran out of memory). Your city is safe.'); };
    this.canvas.addEventListener('webglcontextlost', onLost);
    this.cleanups.push(() => this.canvas.removeEventListener('webglcontextlost', onLost));
    this.resize();

    const world = this.host.getWorld();
    const nav = this.host.getNavigator();
    const neighbourhood = new Neighbourhood(world, this.host.designs, this.quality);
    this.neighbourhood = neighbourhood;
    this.grid = buildWalkGrid(world.plan, neighbourhood.decor);
    const spawn = resolveSpawn(world, nav, this.grid, this.host.initialYaw);
    this.spawn = spawn;
    if (!spawn.ok) { this.host.onFailure('spawn', spawn.reason, spawn); return; }
    // Glass and metal reflect a soft studio environment (generated once, tiny).
    const pmrem = new THREE.PMREMGenerator(r);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    neighbourhood.scene.environment = this.environment;
    await neighbourhood.build((done, total, label) => this.host.onProgress(done, total, label), () => this.disposed);
    if (this.disposed) return;
    const player = world.player!;
    this.character = buildCharacter(lookFromAppearance(player.appearance));
    this.vehicles = new VehicleLayer(this.quality === 'high');
    neighbourhood.scene.add(this.character.root, this.residents.group, this.vehicles.group);
    this.controller = createController(spawn.position, spawn.yaw);
    // The camera starts behind the character, looking the way they face.
    this.orbit = createOrbit(spawn.position, spawn.yaw);
    this.lastCommitted = { ...world.player!.position };
    this.bindInput();
    this.initMs = Math.round(performance.now() - started);
    this.gpuBytes = estimateGpuBytes(neighbourhood.scene);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.host.onReady({ spawn, quality: this.quality });
  }

  private resize = () => {
    if (!this.renderer) return;
    const w = Math.max(1, this.canvas.clientWidth), h = Math.max(1, this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private input(): MoveInput {
    const k = this.keys;
    const forward = (k.has('forward') ? 1 : 0) - (k.has('back') ? 1 : 0), right = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
    return forward === 0 && right === 0 ? { ...NO_INPUT, run: k.has('run') } : { forward, right, run: k.has('run') };
  }

  private bindInput() {
    const typing = (event: Event) => { const t = event.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'Escape') { if (document.pointerLockElement !== this.canvas) this.host.onEscape(); return; }
      if (typing(event) || this.inputBlocked) return;
      const action = KEYS[event.code];
      if (action) { event.preventDefault(); event.stopPropagation(); this.keys.add(action); return; }
      if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); if (!event.repeat && (event.target as HTMLElement | null)?.tagName !== 'BUTTON') this.host.onTogglePause(); }
    };
    const up = (event: KeyboardEvent) => { const action = KEYS[event.code]; if (action) { event.preventDefault(); this.keys.delete(action); } };
    const clear = () => { this.keys.clear(); this.drag = null; };
    const visibility = () => { if (document.visibilityState === 'hidden') clear(); };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      this.canvas.focus({ preventScroll: true });
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, travel: 0, at: performance.now() };
      this.canvas.setPointerCapture?.(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!this.orbit) return;
      if (document.pointerLockElement === this.canvas) { this.orbit = orbitBy(this.orbit, event.movementX, event.movementY, this.settings.sensitivity, this.settings.invertY); return; }
      if (!this.drag || this.drag.id !== event.pointerId) return;
      const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
      this.drag = { ...this.drag, x: event.clientX, y: event.clientY, travel: this.drag.travel + Math.abs(dx) + Math.abs(dy) };
      this.orbit = orbitBy(this.orbit, dx, dy, this.settings.sensitivity, this.settings.invertY);
    };
    const pointerUp = (event: PointerEvent) => {
      if (this.drag?.id !== event.pointerId) return;
      // A click (not a drag) captures the mouse for free looking; Esc releases it. Dragging orbits without capture
      // (trackpads, or browsers that refuse pointer lock).
      const click = this.drag.travel < 4 && performance.now() - this.drag.at < 400 && event.type === 'pointerup';
      this.drag = null;
      this.canvas.releasePointerCapture?.(event.pointerId);
      if (click && document.pointerLockElement !== this.canvas) {
        try { void (this.canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined); } catch { /* pointer lock unavailable: dragging still orbits */ }
      }
    };
    const wheel = (event: WheelEvent) => { event.preventDefault(); if (this.orbit) this.orbit = zoomBy(this.orbit, event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibility);
    this.canvas.addEventListener('pointerdown', pointerDown);
    this.canvas.addEventListener('pointermove', pointerMove);
    this.canvas.addEventListener('pointerup', pointerUp);
    this.canvas.addEventListener('pointercancel', pointerUp);
    this.canvas.addEventListener('wheel', wheel, { passive: false });
    const resizeObserver = new ResizeObserver(this.resize);
    resizeObserver.observe(this.canvas);
    this.cleanups.push(() => {
      window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
      this.canvas.removeEventListener('pointerdown', pointerDown); this.canvas.removeEventListener('pointermove', pointerMove);
      this.canvas.removeEventListener('pointerup', pointerUp); this.canvas.removeEventListener('pointercancel', pointerUp);
      this.canvas.removeEventListener('wheel', wheel);
      resizeObserver.disconnect();
    });
  }

  /** Commits a position as a direct-control step. A refusal snaps the character back to the simulation's position. */
  private commit(position: Position): boolean {
    const ok = this.host.walk(position);
    const live = this.host.getWorld().player;
    if (ok) { this.commits += 1; this.lastCommitted = live ? { ...live.position } : { ...position }; this.lastCommitAt = performance.now(); return true; }
    this.rejected += 1;
    if (live && this.controller) { this.controller = { ...this.controller, position: { ...live.position }, velocity: { x: 0, y: 0 } }; this.lastCommitted = { ...live.position }; }
    return false;
  }

  /**
   * The first movement takes direct control. A character inside a building steps out through its door (the door spawn
   * on the road access tile); one stopped on a building's entrance leg walks the few short steps to that door; one
   * walking a route simply stops where they are. Each step is a validated `player.walk`.
   */
  private takeControl(world: WorldState): boolean {
    const p = world.player;
    if (!p || !this.controller || !this.grid) return false;
    if (p.movement.status !== 'inside' && !isWalkablePoint(this.grid, p.position)) {
      const door = resolveSpawn({ ...world, player: { ...p, movement: { ...p.movement, status: 'inside' } } }, this.host.getNavigator(), this.grid);
      if (!door.ok) return false;
      const from = p.position, length = Math.hypot(door.position.x - from.x, door.position.y - from.y), steps = Math.max(1, Math.ceil(length / 0.9));
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        if (!this.commit({ x: from.x + (door.position.x - from.x) * t, y: from.y + (door.position.y - from.y) * t })) return false;
      }
      this.controller = { ...this.controller, position: { ...door.position }, velocity: { x: 0, y: 0 } };
    } else if (p.movement.status !== 'standing' || p.activity.kind !== 'idle') {
      if (!this.commit(this.controller.position)) return false;
    }
    this.controlling = true;
    return true;
  }

  /** Commits the last position (called before the view closes). */
  flush() {
    if (!this.controlling || !this.controller || !this.lastCommitted) return;
    const p = this.controller.position;
    if (Math.hypot(p.x - this.lastCommitted.x, p.y - this.lastCommitted.y) > 1e-4) this.commit(p);
  }

  private frame = (now: number) => {
    if (this.disposed || !this.renderer || !this.neighbourhood || !this.controller || !this.orbit || !this.character || !this.grid) return;
    this.raf = requestAnimationFrame(this.frame);
    const frameStart = performance.now();
    const elapsedMs = Math.min(250, Math.max(0, now - this.last));
    this.last = now;
    const dt = elapsedMs / 1000;
    // One clock: the simulation advances from this loop while the Character View is open.
    this.host.advance(elapsedMs);
    let world = this.host.getWorld();
    const player = world.player;
    if (!player) { this.host.onFailure('spawn', 'no-character'); return; }
    const paused = world.clock.paused;
    if (!paused) this.time += dt;
    const input = this.input();
    const pushing = input.forward !== 0 || input.right !== 0;

    // Someone else moved the character (a city edit, a relocation, undo): the simulation wins.
    if (this.controlling && this.lastCommitted && Math.hypot(player.position.x - this.lastCommitted.x, player.position.y - this.lastCommitted.y) > 1e-3) {
      this.controlling = false;
      this.controller = { ...this.controller, position: { ...player.position }, velocity: { x: 0, y: 0 } };
      this.lastCommitted = { ...player.position };
    }
    if (!this.controlling && pushing && !paused) { this.takeControl(world); world = this.host.getWorld(); }

    let moving = false, stride = this.controller.stride, runBlend = this.controller.runBlend;
    if (this.controlling) {
      const before = this.controller;
      const next = advanceController(before, input, this.orbit.yaw, dt, this.grid, { paused, exhausted: player.needs.energy < PLAYER_BALANCE.thresholds.critical });
      const nav = this.host.getNavigator();
      // Commit before a straight step from the last committed point would leave walkable ground (or grow too long).
      if (playerWalkCheck(world, nav, next.position) !== null) {
        if (Math.hypot(before.position.x - this.lastCommitted!.x, before.position.y - this.lastCommitted!.y) > 1e-6) this.commit(before.position);
        world = this.host.getWorld();
        this.controller = playerWalkCheck(world, nav, next.position) === null ? next : { ...before, velocity: { x: 0, y: 0 } };
      } else this.controller = next;
      const c = this.controller, lc = this.lastCommitted!;
      const away = Math.hypot(c.position.x - lc.x, c.position.y - lc.y);
      const stopped = motionState(c) === 'standing';
      if (away > 1e-4 && (away >= COMMIT_DISTANCE || performance.now() - this.lastCommitAt >= COMMIT_INTERVAL || stopped)) this.commit(c.position);
      moving = motionState(this.controller) !== 'standing';
      stride = this.controller.stride; runBlend = this.controller.runBlend;
    } else {
      // Not under direct control yet: show the simulation's character (walking a route, or at the door when inside).
      const target = player.movement.status === 'inside' && this.spawn?.ok ? this.spawn.position : player.position;
      const k = 1 - Math.exp(-dt / 0.08);
      const c = this.controller;
      const nx = c.position.x + (target.x - c.position.x) * k, ny = c.position.y + (target.y - c.position.y) * k;
      const moved = Math.hypot(nx - c.position.x, ny - c.position.y);
      const yaw = moved > 1e-4 ? Math.atan2(nx - c.position.x, ny - c.position.y) : c.yaw;
      moving = dt > 0 && moved / dt > 0.03;
      stride = (c.stride + moved / MOVEMENT.walkStride * Math.PI * 2) % (Math.PI * 2);
      this.controller = { ...c, position: { x: nx, y: ny }, yaw: c.yaw + Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw)) * Math.min(1, k * 1.5), stride, velocity: { x: 0, y: 0 } };
    }

    const c = this.controller;
    this.character.root.position.set(c.position.x, 0, c.position.y);
    this.character.root.rotation.y = c.yaw;
    this.character.pose({ moving, stride, runBlend, time: this.time });
    this.residents.sync(world, c.position, paused ? 0 : dt, this.time);
    this.vehicles?.sync(world, c.position);
    const frameOrbit = updateOrbit(this.orbit, c.position, dt, this.neighbourhood.solids, { reducedMotion: this.host.reducedMotion });
    this.orbit = frameOrbit.state;
    this.camera.position.set(frameOrbit.position.x, frameOrbit.position.y, frameOrbit.position.z);
    this.camera.lookAt(frameOrbit.lookAt.x, frameOrbit.lookAt.y, frameOrbit.lookAt.z);
    // The camera never comes closer than ORBIT.nearest; this only guards against looking out through the head.
    this.character.root.visible = this.orbit.actual > 0.12;
    this.neighbourhood.update(getGameTime(world.clock).minuteOfDay, c.position, this.camera.position);
    this.renderer.render(this.neighbourhood.scene, this.camera);

    const cost = performance.now() - frameStart;
    this.frameTimes.push(elapsedMs);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    this.frameCosts.push(cost);
    if (this.frameCosts.length > 120) this.frameCosts.shift();
    if (now - this.hudAt > 160) {
      this.hudAt = now;
      const status = player.movement.status;
      const motion: HudState['motion'] = this.controlling ? motionState(c) : status === 'inside' ? 'inside' : status === 'travelling' ? 'travelling' : 'standing';
      this.host.onHud({ motion, position: c.position, pointerLocked: document.pointerLockElement === this.canvas, fps: this.fps() });
      this.publishDebug(world, input, cost);
    }
  };

  private fps() {
    const recent = this.frameTimes.slice(-60);
    const mean = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
    return mean > 0 ? Math.round(1000 / mean) : 0;
  }

  private publishDebug(world: WorldState, input: MoveInput, cost: number) {
    if (!this.renderer || !this.neighbourhood || !this.controller || !this.orbit) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const info = this.renderer.info;
    const debug: ImmersiveDebug = {
      ready: true, quality: this.quality, renderer: this.rendererName,
      player: { x: this.controller.position.x, y: this.controller.position.y, yaw: this.controller.yaw, motion: motionState(this.controller), speed: Math.hypot(this.controller.velocity.x, this.controller.velocity.y),
        controlling: this.controlling, blocked: this.controller.blocked },
      authority: { x: world.player?.position.x ?? NaN, y: world.player?.position.y ?? NaN, status: world.player?.movement.status ?? 'none', tick: world.clock.tick },
      camera: { yaw: this.orbit.yaw, pitch: this.orbit.pitch, distance: this.orbit.distanceTarget, actual: this.orbit.actual, x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      commits: this.commits, rejected: this.rejected, pointerLocked: document.pointerLockElement === this.canvas,
      stats: { ...this.neighbourhood.stats, drawCalls: info.render.calls, frameTriangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
        fps: this.fps(), frameMs: Math.round(cost * 100) / 100, p95Ms: Math.round(p95 * 10) / 10, initMs: this.initMs,
        cpuMs: Math.round(this.frameCosts.reduce((a, b) => a + b, 0) / Math.max(1, this.frameCosts.length) * 100) / 100, gpuBytes: this.gpuBytes },
      residents: this.residents.ids(), vehicles: this.vehicles?.ids() ?? [], character: this.character?.layers ?? [], input,
    };
    (window as unknown as { __tinyCityImmersive?: ImmersiveDebug }).__tinyCityImmersive = debug;
    // Development builds expose the live scene for inspection in the browser console.
    if (import.meta.env.DEV) (window as unknown as { __tinyCityImmersiveScene?: unknown }).__tinyCityImmersiveScene = { scene: this.neighbourhood.scene, renderer: this.renderer, camera: this.camera };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this.character?.dispose();
    this.residents.dispose();
    this.vehicles?.dispose();
    disposeVehicleTemplates();
    this.neighbourhood?.dispose();
    disposeAssetCache();
    this.environment?.dispose();
    if (this.renderer) {
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.renderer = null;
    this.canvas.remove();
    const w = window as unknown as { __tinyCityImmersive?: ImmersiveDebug };
    if (w.__tinyCityImmersive) w.__tinyCityImmersive = { ...w.__tinyCityImmersive, ready: false };
  }
}
