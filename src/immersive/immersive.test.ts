import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_CATALOG, createWorld, playerWalkCheck, Simulation } from '@tiny-city/simulation';
import type { Building, BuildingType, LifeCommand, Position, WorldState } from '@tiny-city/simulation';
import { iso, toGrid } from '../game/mapGeometry';
import { planDecor } from '../game/worldDecor';
import { buildWalkGrid, isClear, isWalkablePoint, moveCircle } from './collision';
import { createController, advanceController, inputDirection, motionState, MOVEMENT, NO_INPUT, stepController, type MoveInput } from './controller';
import { angleDelta, footprintBox, gridDirectionFromYaw, gridToWorld, placementMatrix, worldToGrid, worldToIso, yawFromGridDirection } from './coordinates';
import { cameraPosition, clampDistance, clampPitch, createOrbit, orbitBy, ORBIT, rayBox, unobstructedDistance, updateOrbit, zoomBy } from './orbitCamera';
import { doorSpawn, facingFor, resolveSpawn, roadSides } from './spawn';

const building = (id: string, type: BuildingType, x: number, y: number): Building => {
  const b = BUILDING_CATALOG[type];
  return { id, name: id, type, kind: b.kind, capacity: b.capacity, position: { x, y }, footprint: b.footprint };
};
const look = { skinTone: 2, hairStyle: 'bun', hairColor: 3, outfit: 'jacket', outfitColor: 4, accessory: 'glasses' } as const;

/** A street along y = 5 (x 2..20) with a spur north at x = 12 (y 1..4); villas south of the street and one north of it. */
function street(): WorldState {
  const roads = [...Array.from({ length: 19 }, (_, i) => ({ x: i + 2, y: 5 })), ...Array.from({ length: 4 }, (_, i) => ({ x: 12, y: i + 1 }))];
  return createWorld({ id: 'p8a', seed: 'p8a', startingFunds: 50_000, clock: { paused: true },
    plan: { id: 'p8a-plan', name: 'Third-person street', width: 24, height: 16, blockedTiles: [], roads,
      buildings: [building('villa-s', 'villa', 4, 6), building('villa-n', 'villa', 7, 3), building('villa-e', 'villa', 10, 2), building('park', 'park', 14, 6)] } });
}
function withPlayer(home = 'villa-s') {
  const sim = new Simulation(street());
  expect(sim.executeLife({ type: 'player.create', name: 'Mai', appearance: look, homeBuildingId: home }).reason).toBeNull();
  return sim;
}

describe('coordinate systems', () => {
  it('maps grid ↔ 3D exactly (X = grid x, Z = grid y, Y = height) without drift', () => {
    for (const p of [{ x: 0, y: 0 }, { x: 3.25, y: 7.5 }, { x: 63.999, y: 0.001 }]) {
      const w = gridToWorld(p, 0.4);
      expect(w).toEqual({ x: p.x, y: 0.4, z: p.y });
      expect(worldToGrid(w)).toEqual(p);
    }
    let p: Position = { x: 5.5, y: 5.5 };
    for (let i = 0; i < 10_000; i += 1) p = worldToGrid(gridToWorld(p));
    expect(p).toEqual({ x: 5.5, y: 5.5 });
  });

  it('is the same layout the City View shows: the 3D world seen from the isometric camera reproduces iso()', () => {
    // An orthographic camera on the City View axis (+X, +Y, +Z) with the 2:1 dimetric elevation.
    const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
    const elevation = Math.asin(28 / 56), dir = new THREE.Vector3(Math.cos(elevation) * Math.SQRT1_2, Math.sin(elevation), Math.cos(elevation) * Math.SQRT1_2);
    camera.position.copy(dir.clone().multiplyScalar(200)); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const view = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, y).applyMatrix4(camera.matrixWorldInverse);
    const origin = view(0, 0), scale = 28 * Math.SQRT2;
    for (const [x, y, h] of [[1, 0, 0], [0, 1, 0], [4, 7, 0], [2.5, 3.25, 0.8]] as const) {
      const v = view(x, y, h), screen = { x: (v.x - origin.x) * scale, y: -(v.y - origin.y) * scale };
      const expected = worldToIso({ x, y: h, z: y }), base = iso(0, 0);
      expect(screen.x).toBeCloseTo(expected.x - base.x, 6);
      expect(screen.y).toBeCloseTo(expected.y - base.y, 6);
    }
    // And back: a City View point on the ground is the same 3D ground point.
    const g = toGrid(worldToIso({ x: 9.25, y: 0, z: 4.5 }));
    expect(g.x).toBeCloseTo(9.25, 9); expect(g.y).toBeCloseTo(4.5, 9);
  });

  it('places south-facing art on footprints for every facing without offsets, keeping the front on the road side', () => {
    const b = { position: { x: 10, y: 4 }, footprint: { width: 3, height: 2 } };
    const apply = (facing: 'S' | 'E' | 'N' | 'W', lx: number, lz: number) => {
      const m = new THREE.Matrix4().fromArray(placementMatrix(b, facing));
      const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(m);
      return { x: Math.round(v.x * 1e9) / 1e9, z: Math.round(v.z * 1e9) / 1e9 };
    };
    const box = footprintBox(b);
    // Design dimensions: S/N designs are 3 × 2; E/W designs are 2 × 3 (built south-facing, then turned).
    for (const [facing, w, d] of [['S', 3, 2], ['N', 3, 2], ['E', 2, 3], ['W', 2, 3]] as const) {
      const corners = [[0, 0], [w, 0], [0, d], [w, d]].map(([x, z]) => apply(facing, x!, z!));
      expect(Math.min(...corners.map((c) => c.x))).toBe(box.minX); expect(Math.max(...corners.map((c) => c.x))).toBe(box.maxX);
      expect(Math.min(...corners.map((c) => c.z))).toBe(box.minZ); expect(Math.max(...corners.map((c) => c.z))).toBe(box.maxZ);
      const front = apply(facing, w / 2, d);
      if (facing === 'S') expect(front.z).toBe(box.maxZ);
      if (facing === 'N') expect(front.z).toBe(box.minZ);
      if (facing === 'E') expect(front.x).toBe(box.maxX);
      if (facing === 'W') expect(front.x).toBe(box.minX);
    }
    expect(new THREE.Matrix4().fromArray(placementMatrix(b, 'S')).determinant()).toBe(1);
    expect(new THREE.Matrix4().fromArray(placementMatrix(b, 'E')).determinant()).toBe(-1);
  });

  it('converts headings to yaw and back, with shortest-angle deltas', () => {
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [0.6, -0.8]] as const) {
      const d = gridDirectionFromYaw(yawFromGridDirection(dx, dy));
      expect(d.x).toBeCloseTo(dx, 9); expect(d.y).toBeCloseTo(dy, 9);
    }
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9);
    expect(angleDelta(0, Math.PI)).toBeCloseTo(Math.PI, 9);
  });
});

describe('walkable ground and collision', () => {
  const world = street();
  const grid = buildWalkGrid(world.plan, planDecor(world.plan));

  it('walkable tiles are exactly the simulation road tiles', () => {
    for (let y = 0; y < world.plan.height; y += 1) for (let x = 0; x < world.plan.width; x += 1) {
      const road = world.plan.roads.some((r) => r.x === x && r.y === y);
      expect(isWalkablePoint(grid, { x: x + 0.5, y: y + 0.5 })).toBe(road);
    }
    expect(isWalkablePoint(grid, { x: -0.5, y: 5.5 })).toBe(false);
  });

  it('cannot walk into a villa: the capsule stops at the lot edge and slides along it', () => {
    // Walking straight south from the street into villa-s (lot starts at y = 6); no furniture in this check.
    const grid = buildWalkGrid(world.plan, []);
    const r = MOVEMENT.radius;
    let p = { x: 5.5, y: 5.5 };
    for (let i = 0; i < 40; i += 1) p = moveCircle(grid, p, { x: 0, y: 0.05 }, r).position;
    expect(p.y).toBeCloseTo(6 - r, 6);
    // Diagonal push: x keeps moving along the wall, y stays clamped.
    const slide = moveCircle(grid, p, { x: 0.2, y: 0.2 }, r);
    expect(slide.blocked).toBe(true);
    expect(slide.position.x).toBeCloseTo(5.7, 6);
    expect(slide.position.y).toBeCloseTo(6 - r, 6);
  });

  it('never tunnels through solid ground, whatever the step size', () => {
    for (const step of [0.01, 0.3, 2.5, 25]) {
      const out = moveCircle(grid, { x: 5.5, y: 5.5 }, { x: 0, y: step }, MOVEMENT.radius).position;
      expect(out.y).toBeLessThanOrEqual(6 - MOVEMENT.radius + 1e-9);
      expect(isWalkablePoint(grid, out)).toBe(true);
    }
  });

  it('street furniture on the curb is solid', () => {
    const lamp = planDecor(world.plan).find((d) => d.kind === 'lamp')!;
    expect(lamp).toBeDefined();
    expect(isClear(grid, lamp.at, MOVEMENT.radius)).toBe(false);
    const from = { x: lamp.at.x, y: Math.floor(lamp.at.y) + 0.5 };
    const toward = { x: 0, y: lamp.at.y - from.y };
    const moved = moveCircle(grid, from, toward, MOVEMENT.radius).position;
    expect(Math.hypot(moved.x - lamp.at.x, moved.y - lamp.at.y)).toBeGreaterThanOrEqual(MOVEMENT.radius + 0.03 - 1e-9);
  });

  it('slides around a curb post instead of snagging, even head-on', () => {
    const plan = { ...world.plan, buildings: [], roads: Array.from({ length: 20 }, (_, i) => ({ x: i + 2, y: 5 })) };
    for (const offset of [0, 0.01, 0.06]) {
      const posts = buildWalkGrid(plan, [{ kind: 'streetTree', tile: { x: 8, y: 5 }, at: { x: 8.5, y: 5.07 }, variant: 0, size: 1 }]);
      let s = createController({ x: 6.5, y: 5.07 + offset }, Math.PI / 2);
      for (let i = 0; i < 900; i += 1) s = advanceController(s, { forward: 1, right: 0, run: false }, Math.PI / 2, 1 / 60, posts);
      expect(s.position.x).toBeGreaterThan(9.5);
    }
  });

  it('every position the controller reaches is accepted by the simulation walk check', () => {
    const sim = withPlayer();
    const spawn = resolveSpawn(sim.getState(), sim.getNavigator(), grid);
    if (!spawn.ok) throw new Error(spawn.reason);
    expect(sim.executeLife({ type: 'player.walk', position: spawn.position }).reason).toBeNull();
    let state = createController(spawn.position, spawn.yaw);
    const inputs: MoveInput[] = [{ forward: 0, right: 1, run: true }, { forward: 1, right: 0.6, run: false }, { forward: -1, right: -1, run: true }];
    let committed = spawn.position;
    for (let frame = 0; frame < 900; frame += 1) {
      const input = inputs[Math.floor(frame / 150) % inputs.length]!;
      const next = advanceController(state, input, frame * 0.01, 1 / 60, grid);
      // The bridge commits before a straight segment would leave walkable ground, and at least every half tile.
      const check = playerWalkCheck(sim.getState(), sim.getNavigator(), next.position);
      if (check !== null || Math.hypot(next.position.x - committed.x, next.position.y - committed.y) > 0.5) {
        expect(sim.executeLife({ type: 'player.walk', position: state.position }).reason).toBeNull();
        committed = state.position;
      }
      state = next;
    }
    expect(sim.executeLife({ type: 'player.walk', position: state.position } satisfies LifeCommand).reason).toBeNull();
  });
});

describe('third-person controller', () => {
  const world = street();
  const grid = buildWalkGrid(world.plan, []);
  const start = { x: 8.5, y: 5.5 };

  it('maps WASD to camera-relative directions', () => {
    // Camera looking along +x (yaw π/2): forward is +x, right is screen-right = +y... (a camera looking +X sees +Z on its right).
    const f = inputDirection({ forward: 1, right: 0, run: false }, Math.PI / 2);
    expect(f.x).toBeCloseTo(1, 9); expect(f.y).toBeCloseTo(0, 9);
    const r = inputDirection({ forward: 0, right: 1, run: false }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 9); expect(r.y).toBeCloseTo(1, 9);
    const diagonal = inputDirection({ forward: 1, right: 1, run: false }, 0);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 9);
    // Right really is screen-right for a Three.js camera looking along that yaw.
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 100);
    for (const yaw of [0, 1, -2.4]) {
      const eye = cameraPosition({ x: 0, y: 0.2, z: 0 }, yaw, 0.3, 1);
      camera.position.set(eye.x, eye.y, eye.z); camera.lookAt(0, 0.2, 0); camera.updateMatrixWorld(true);
      const d = inputDirection({ forward: 0, right: 1, run: false }, yaw);
      const projected = new THREE.Vector3(d.x * 0.3, 0.2, d.y * 0.3).project(camera);
      expect(projected.x).toBeGreaterThan(0.05);
      const ahead = inputDirection({ forward: 1, right: 0, run: false }, yaw);
      const forward = new THREE.Vector3(ahead.x * 0.3, 0.2, ahead.y * 0.3).applyMatrix4(camera.matrixWorldInverse);
      const centre = new THREE.Vector3(0, 0.2, 0).applyMatrix4(camera.matrixWorldInverse);
      expect(forward.z).toBeLessThan(centre.z);
    }
  });

  it('accelerates smoothly, reaches walk and run speeds, and stops without sliding', () => {
    const along = { x: Math.PI / 2 };
    let s = createController(start, Math.PI / 2);
    s = stepController(s, { forward: 1, right: 0, run: false }, along.x, grid);
    expect(Math.hypot(s.velocity.x, s.velocity.y)).toBeLessThan(MOVEMENT.walkSpeed * 0.2);
    for (let i = 0; i < 10; i += 1) s = advanceController(s, { forward: 1, right: 0, run: false }, along.x, 0.1, grid);
    expect(Math.hypot(s.velocity.x, s.velocity.y)).toBeCloseTo(MOVEMENT.walkSpeed, 3);
    expect(motionState(s)).toBe('walking');
    for (let i = 0; i < 10; i += 1) s = advanceController(s, { forward: 1, right: 0, run: true }, along.x, 0.1, grid);
    expect(Math.hypot(s.velocity.x, s.velocity.y)).toBeCloseTo(MOVEMENT.runSpeed, 2);
    expect(motionState(s)).toBe('running');
    const before = s.position.x;
    for (let i = 0; i < 10; i += 1) s = advanceController(s, NO_INPUT, along.x, 0.1, grid);
    expect(motionState(s)).toBe('standing');
    expect(s.velocity).toEqual({ x: 0, y: 0 });
    expect(s.position.x - before).toBeLessThan(MOVEMENT.runSpeed * MOVEMENT.decelerate * 1.6);
  });

  it('is frame-rate independent: 30, 60 and 120 fps and uneven frames give the same path', () => {
    const input = { forward: 1, right: 0.4, run: true };
    const constant = (dt: number, n: number) => { let s = createController(start, 0); for (let i = 0; i < n; i += 1) s = advanceController(s, input, 1.2, dt, grid); return s; };
    const at30 = constant(1 / 30, 90), at60 = constant(1 / 60, 180), at120 = constant(1 / 120, 360);
    expect(at60.position.x).toBeCloseTo(at30.position.x, 9); expect(at60.position.y).toBeCloseTo(at30.position.y, 9);
    expect(at120.position.x).toBeCloseTo(at30.position.x, 9); expect(at120.position.y).toBeCloseTo(at30.position.y, 9);
    let s = createController(start, 0), t = 0, i = 0;
    const sizes = [0.004, 0.031, 0.017, 0.0083, 0.022];
    while (t < 3 - 1e-9) { const dt = Math.min(sizes[i++ % sizes.length]!, 3 - t); s = advanceController(s, input, 1.2, dt, grid); t += dt; }
    // Uneven frames differ by at most the one fixed step still carried over.
    expect(Math.hypot(s.position.x - at30.position.x, s.position.y - at30.position.y)).toBeLessThanOrEqual(MOVEMENT.runSpeed * MOVEMENT.step + 1e-9);
  });

  it('never moves while paused, and a long stall replays at most one capped frame', () => {
    let s = createController(start, 0);
    s = advanceController(s, { forward: 1, right: 0, run: true }, 0, 5, grid, { paused: true });
    expect(s.position).toEqual(start);
    s = advanceController(s, { forward: 1, right: 0, run: true }, Math.PI / 2, 30, grid);
    expect(s.position.x - start.x).toBeLessThanOrEqual(MOVEMENT.runSpeed * MOVEMENT.maxFrame + 1e-9);
  });

  it('turns smoothly to face the travel direction (no snaps) and advances the stride by distance', () => {
    let s = createController(start, 0);
    const yaws: number[] = [];
    for (let i = 0; i < 30; i += 1) { s = stepController(s, { forward: 0, right: -1, run: false }, Math.PI / 2, grid); yaws.push(s.yaw); }
    // A half turn takes a fraction of a second, spread over many steps, and never overshoots.
    for (let i = 1; i < yaws.length; i += 1) expect(Math.abs(angleDelta(yaws[i - 1]!, yaws[i]!))).toBeLessThan(0.4);
    expect(Math.abs(angleDelta(yaws[4]!, Math.PI))).toBeGreaterThan(0.8);
    for (const yaw of yaws) expect(Math.abs(angleDelta(0, yaw))).toBeLessThanOrEqual(Math.PI + 1e-9);
    for (let i = 0; i < 10; i += 1) s = advanceController(s, { forward: 0, right: -1, run: false }, Math.PI / 2, 0.1, grid);
    // Strafing left with the camera looking +x walks toward −y.
    expect(angleDelta(s.yaw, Math.PI)).toBeCloseTo(0, 2);
    expect(s.stride).toBeGreaterThan(0);
  });
});

describe('orbit camera', () => {
  it('clamps pitch, zoom and sensitivity, and orbits only the camera', () => {
    let o = createOrbit({ x: 5, y: 5 }, 0);
    o = orbitBy(o, 0, 10_000);
    expect(o.pitchTarget).toBe(ORBIT.pitch.max);
    o = orbitBy(o, 0, -100_000);
    expect(o.pitchTarget).toBe(ORBIT.pitch.min);
    for (let i = 0; i < 100; i += 1) o = zoomBy(o, 400);
    expect(o.distanceTarget).toBe(ORBIT.distance.max);
    for (let i = 0; i < 100; i += 1) o = zoomBy(o, -400);
    expect(o.distanceTarget).toBe(ORBIT.distance.min);
    expect(zoomBy(o, 0)).toBe(o);
    expect(clampPitch(9)).toBe(ORBIT.pitch.max); expect(clampDistance(-1)).toBe(ORBIT.distance.min);
    const a = zoomBy(createOrbit({ x: 0, y: 0 }, 0), 120), b = zoomBy(a, -120);
    expect(b.distanceTarget).toBeCloseTo(ORBIT.distance.initial, 9);
    // Dragging right turns the view right (yaw decreases in this convention).
    expect(orbitBy(createOrbit({ x: 0, y: 0 }, 0), 100, 0).yawTarget).toBeLessThan(0);
  });

  it('sits behind and above the look-at point', () => {
    const p = cameraPosition({ x: 0, y: 0.2, z: 0 }, 0, 0.3, 1);
    expect(p.z).toBeLessThan(0); expect(p.y).toBeGreaterThan(0.2); expect(p.x).toBeCloseTo(0, 9);
    expect(Math.hypot(p.x, p.y - 0.2, p.z)).toBeCloseTo(1, 9);
  });

  it('pulls in front of a wall at once and eases back out when the view clears', () => {
    const wall = { min: { x: -1, y: 0, z: -0.6 }, max: { x: 1, y: 1, z: -0.5 } };
    expect(rayBox({ x: 0, y: 0.2, z: 0 }, { x: 0, y: 0, z: -1 }, wall, 5)).toBeCloseTo(0.5, 9);
    expect(rayBox({ x: 0, y: 0.2, z: 0 }, { x: 0, y: 0, z: 1 }, wall, 5)).toBeNull();
    const free = unobstructedDistance({ x: 0, y: 0.2, z: 0 }, 0, 0, 1.5, [wall]);
    expect(free).toBeCloseTo(0.5 - ORBIT.margin, 9);
    let o = createOrbit({ x: 0, y: 0 }, 0, { pitch: 0, distance: 1.5 });
    let frame = updateOrbit(o, { x: 0, y: 0 }, 1 / 60, [wall]);
    expect(frame.state.actual).toBeCloseTo(0.5 - ORBIT.margin, 9);
    expect(frame.position.z).toBeGreaterThan(wall.max.z);
    o = frame.state;
    frame = updateOrbit(o, { x: 0, y: 0 }, 1 / 60, []);
    expect(frame.state.actual).toBeGreaterThan(o.actual);
    expect(frame.state.actual).toBeLessThan(1.5);
    for (let i = 0; i < 300; i += 1) frame = updateOrbit(frame.state, { x: 0, y: 0 }, 1 / 60, []);
    expect(frame.state.actual).toBeCloseTo(1.5, 3);
  });

  it('never dips under the ground and never comes closer than the nearest limit', () => {
    const d = unobstructedDistance({ x: 0, y: ORBIT.targetHeight, z: 0 }, 0, -1, 2, []);
    expect(ORBIT.targetHeight + Math.sin(-1) * d).toBeGreaterThanOrEqual(ORBIT.floor - 1e-9);
    const boxed = unobstructedDistance({ x: 0, y: 0.2, z: 0 }, 0, 0.3, 2, [{ min: { x: -1, y: 0, z: -0.05 }, max: { x: 1, y: 2, z: -0.02 } }]);
    expect(boxed).toBe(ORBIT.nearest);
  });

  it('follows smoothly and is frame-rate independent', () => {
    const run = (dt: number, n: number) => { let s = createOrbit({ x: 0, y: 0 }, 0); for (let i = 0; i < n; i += 1) s = updateOrbit(orbitBy(s, i === 0 ? 50 : 0, 0), { x: 1, y: 0 }, dt, []).state; return s; };
    const a = run(1 / 30, 15), b = run(1 / 120, 60);
    expect(a.target.x).toBeCloseTo(b.target.x, 6);
    expect(a.yaw).toBeCloseTo(b.yaw, 6);
    const snap = updateOrbit(orbitBy(createOrbit({ x: 0, y: 0 }, 0), 50, 0), { x: 1, y: 0 }, 1 / 60, [], { reducedMotion: true });
    expect(snap.state.target.x).toBe(1);
  });
});

describe('spawn and entrances', () => {
  it('spawns a character who is at home on the sidewalk in front of the door, facing the street', () => {
    const sim = withPlayer('villa-s');
    const world = sim.getState();
    const grid = buildWalkGrid(world.plan, planDecor(world.plan));
    const spawn = resolveSpawn(world, sim.getNavigator(), grid);
    expect(spawn).toMatchObject({ ok: true, source: 'door', buildingId: 'villa-s' });
    if (!spawn.ok) return;
    expect(Math.floor(spawn.position.y)).toBe(5);
    expect(spawn.position.y).toBeGreaterThan(5.5);
    expect(spawn.position.x).toBeGreaterThanOrEqual(4); expect(spawn.position.x).toBeLessThan(6);
    expect(isClear(grid, spawn.position, MOVEMENT.radius)).toBe(true);
    expect(angleDelta(spawn.yaw, Math.PI)).toBeCloseTo(0, 9); // facing −y: out of the lot onto the street
    // Nothing changed in the world just by entering.
    expect(sim.getState()).toBe(world);
    expect(playerWalkCheck(world, sim.getNavigator(), spawn.position)).toBeNull();
  });

  it('turns the front of north- and east-only buildings to their road', () => {
    const world = street();
    const isRoad = (x: number, y: number) => world.plan.roads.some((r) => r.x === x && r.y === y);
    const byId = (id: string) => world.plan.buildings.find((b) => b.id === id)!;
    // villa-s lies south of the street (road on its north side only): its front turns north to meet it.
    expect(facingFor(roadSides(byId('villa-s'), isRoad))).toBe('N');
    expect(facingFor(roadSides(byId('villa-n'), isRoad))).toBe('S');
    expect(facingFor(roadSides(byId('villa-e'), isRoad))).toBe('E');
    const north = byId('villa-s');
    expect(facingFor({ south: false, east: false, north: true, west: false })).toBe('N');
    expect(facingFor({ south: false, east: false, north: false, west: true })).toBe('W');
    const grid = buildWalkGrid(world.plan, []);
    const door = doorSpawn(north, [{ x: 4, y: 5 }, { x: 5, y: 5 }], 'N', grid)!;
    expect(door.position.y).toBeCloseTo(6 - MOVEMENT.radius - 0.06, 9);
  });

  it('keeps a walking character exactly where the simulation has them', () => {
    const sim = withPlayer();
    sim.executeLife({ type: 'player.walk', position: { x: 5.5, y: 5.3 } });
    sim.executeLife({ type: 'player.walk', position: { x: 6.2, y: 5.4 } });
    const world = sim.getState();
    const spawn = resolveSpawn(world, sim.getNavigator(), buildWalkGrid(world.plan, []), 1.25);
    expect(spawn).toEqual({ ok: true, position: { x: 6.2, y: 5.4 }, yaw: 1.25, source: 'street', buildingId: null });
  });

  it('explains instead of inventing a position: no character, no home yet, or no street', () => {
    const empty = new Simulation(street());
    const grid = buildWalkGrid(empty.getState().plan, []);
    expect(resolveSpawn(empty.getState(), empty.getNavigator(), grid)).toEqual({ ok: false, reason: 'no-character' });
    empty.executeLife({ type: 'player.create', name: 'Mai', appearance: look });
    expect(resolveSpawn(empty.getState(), empty.getNavigator(), grid)).toEqual({ ok: false, reason: 'no-home' });
    // A home whose road was removed: nowhere to stand.
    const base = street();
    const cut = new Simulation({ ...base, plan: { ...base.plan, roads: base.plan.roads.filter((r) => !(r.y === 5 && r.x >= 3 && r.x <= 7)) } });
    cut.executeLife({ type: 'player.create', name: 'Mai', appearance: look, homeBuildingId: 'villa-s' });
    expect(resolveSpawn(cut.getState(), cut.getNavigator(), buildWalkGrid(cut.getState().plan, []))).toEqual({ ok: false, reason: 'stranded' });
  });
});
