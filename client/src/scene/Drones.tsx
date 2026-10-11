import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { RESOURCE_DEFS, rng, surgeOn, surfaceRadius, type Vec3 } from '@starforge/shared';
import { hueColor, refs } from '../state/refs';
import { useGame } from '../state/store';
import { sparks } from './bus';
import { flash, makeBeamMaterial, makeGlowMaterial, mergeParts, ribbonMatrix, type Part } from './fxkit';
import { damp, hostNow, isLite, roundRobin, SEP, setCss, useBundle } from './util';

const LITE = isLite();
const MAX_DRONES = 64;
const MAX_HARVESTERS = 12;
const POOL = MAX_DRONES + MAX_HARVESTERS;
const HARVESTER_SCALE = 0.82;
const DRONE_SCALE = 0.8;
/** Glow sprites per unit: engine(s), nav lights, and the spot where its beam lands. */
const GLOWS_PER_UNIT = 6;
const WHITE = new Color(1, 1, 1);
const HULL = new Color('#ffffff');
const ORE = new Color(RESOURCE_DEFS.ore.color);
const Y_UP = new Vector3(0, 1, 0);

/* ---------------- models (+Z forward, +Y away from the rock) ---------------- */

const at = (g: BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
const alongZ = (g: BufferGeometry) => g.rotateX(Math.PI / 2);

/** Mining drone: a hex hull with a sensor dome, struts out to two solar panels, an engine and a mining emitter underneath. */
function droneHull(): BufferGeometry {
  const parts: Part[] = [
    [alongZ(new CylinderGeometry(0.042, 0.054, 0.19, 6)), '#c9d2dc'],
    [at(alongZ(new ConeGeometry(0.042, 0.075, 6)), 0, 0, 0.132), '#e6ebf1'],
    [at(new SphereGeometry(0.033, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.03, 0.01), '#8796aa'],
    [at(alongZ(new CylinderGeometry(0.04, 0.034, 0.05, 8)), 0, 0, -0.118), '#5a6471'],
    [at(new BoxGeometry(0.11, 0.014, 0.022), 0.1, 0, -0.01), '#7c8794'],
    [at(new BoxGeometry(0.11, 0.014, 0.022), -0.1, 0, -0.01), '#7c8794'],
    [at(new BoxGeometry(0.135, 0.008, 0.09).rotateZ(0.14), 0.205, 0.01, -0.01), '#2f58b8'],
    [at(new BoxGeometry(0.135, 0.008, 0.09).rotateZ(-0.14), -0.205, 0.01, -0.01), '#2f58b8'],
    [at(new BoxGeometry(0.004, 0.011, 0.094).rotateZ(0.14), 0.205, 0.011, -0.01), '#d4dbe4'],
    [at(new BoxGeometry(0.004, 0.011, 0.094).rotateZ(-0.14), -0.205, 0.011, -0.01), '#d4dbe4'],
    [at(new BoxGeometry(0.137, 0.011, 0.004).rotateZ(0.14), 0.205, 0.011, -0.01), '#d4dbe4'],
    [at(new BoxGeometry(0.137, 0.011, 0.004).rotateZ(-0.14), -0.205, 0.011, -0.01), '#d4dbe4'],
    [at(new ConeGeometry(0.022, 0.045, 6).rotateX(Math.PI), 0, -0.058, 0.03), '#454c56'],
    [at(new CylinderGeometry(0.003, 0.003, 0.08, 4), 0, 0.07, -0.07), '#b0bac6'],
  ];
  return mergeParts(parts);
}

/** Drone accents lit in the owner's colour: engine nozzle, visor, panel edges, emitter tip. */
function droneGlow(): BufferGeometry {
  return mergeParts([
    [at(alongZ(new CylinderGeometry(0.027, 0.027, 0.012, 10)), 0, 0, -0.146), '#ffffff'],
    [at(new BoxGeometry(0.046, 0.012, 0.03), 0, 0.03, 0.075), '#ffffff'],
    [at(new BoxGeometry(0.008, 0.012, 0.09).rotateZ(0.14), 0.272, 0.02, -0.01), '#b3b3b3'],
    [at(new BoxGeometry(0.008, 0.012, 0.09).rotateZ(-0.14), -0.272, 0.02, -0.01), '#b3b3b3'],
    [at(new OctahedronGeometry(0.013, 0), 0, -0.085, 0.03), '#ffffff'],
  ]);
}

/** Harvester: an industrial hauler, a cab up front, two rows of cargo pods along a spine, twin engines, a tractor emitter underneath. */
function harvesterHull(): BufferGeometry {
  const parts: Part[] = [
    [new BoxGeometry(0.07, 0.06, 0.52), '#7c8794'],
    [at(new BoxGeometry(0.17, 0.1, 0.13), 0, 0.02, 0.27), '#d7dde5'],
    [at(alongZ(new ConeGeometry(0.105, 0.09, 4)).rotateZ(Math.PI / 4), 0, 0.02, 0.38), '#c2cad4'],
    [at(new BoxGeometry(0.21, 0.095, 0.085), 0, 0, -0.27), '#5b6470'],
    [at(alongZ(new CylinderGeometry(0.036, 0.046, 0.055, 8)), 0.065, 0, -0.335), '#3a414b'],
    [at(alongZ(new CylinderGeometry(0.036, 0.046, 0.055, 8)), -0.065, 0, -0.335), '#3a414b'],
    [at(new CylinderGeometry(0.05, 0.066, 0.03, 10), 0, -0.046, 0.02), '#4a515b'],
  ];
  // Cargo pods, banded, three each side.
  for (const z of [0.12, -0.01, -0.14]) {
    for (const x of [-0.088, 0.088]) {
      parts.push([at(alongZ(new CylinderGeometry(0.05, 0.05, 0.115, 8)), x, 0.004, z), z === -0.01 ? '#cf7f2c' : '#e3a63a']);
      parts.push([at(alongZ(new CylinderGeometry(0.053, 0.053, 0.014, 8)), x, 0.004, z), '#343a43']);
    }
  }
  // Radiator fins on top.
  for (const x of [-0.022, 0, 0.022]) parts.push([at(new BoxGeometry(0.005, 0.05, 0.13), x, 0.055, -0.07), '#9aa4b0']);
  return mergeParts(parts);
}

function harvesterGlow(): BufferGeometry {
  const parts: Part[] = [
    [at(alongZ(new CylinderGeometry(0.031, 0.031, 0.01, 10)), 0.065, 0, -0.365), '#ffffff'],
    [at(alongZ(new CylinderGeometry(0.031, 0.031, 0.01, 10)), -0.065, 0, -0.365), '#ffffff'],
    [at(new BoxGeometry(0.13, 0.02, 0.045), 0, 0.071, 0.3), '#ffffff'],
    [at(new BoxGeometry(0.172, 0.016, 0.02), 0, 0.03, 0.336), '#d9d9d9'],
    [at(new TorusGeometry(0.044, 0.009, 6, 18).rotateX(Math.PI / 2), 0, -0.064, 0.02), '#ffffff'],
  ];
  for (const z of [-0.2, -0.07, 0.06, 0.19]) parts.push([at(new BoxGeometry(0.014, 0.006, 0.026), 0, 0.033, z), '#8c8c8c']);
  return mergeParts(parts);
}

// Glow sprite anchors in model space.
const DRONE_ENGINE = new Vector3(0, 0, -0.16);
const DRONE_NAV = [new Vector3(0.275, 0.022, 0.03), new Vector3(-0.275, 0.022, 0.03)];
const DRONE_EMITTER = new Vector3(0, -0.085, 0.03);
const HARV_ENGINES = [new Vector3(0.065, 0, -0.38), new Vector3(-0.065, 0, -0.38)];
const HARV_NAV = [new Vector3(0.088, 0.075, 0.33), new Vector3(-0.088, 0.075, 0.33)];
const HARV_EMITTER = new Vector3(0, -0.07, 0.02);

interface SpriteTmp {
  m: Matrix4;
  basis: Matrix4;
  a: Vector3;
  c: Color;
}

/** Write glow sprite `ns` at `local` in the unit's frame (`tmp.m`); returns the next free index. */
function putSprite(sprites: InstancedMesh, ns: number, tmp: SpriteTmp, local: Vector3, size: number, color: Color, k: number): number {
  tmp.a.copy(local).applyMatrix4(tmp.m);
  tmp.basis.makeScale(size, size, 1).setPosition(tmp.a);
  sprites.setMatrixAt(ns, tmp.basis);
  sprites.setColorAt(ns, tmp.c.copy(color).multiplyScalar(k));
  return ns + 1;
}

/* ---------------- tractor beam ---------------- */

const TRACTOR_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 n = normalMatrix * (mat3(instanceMatrix) * normal);
  float nl = length(n);
  vN = nl > 1e-6 ? n / nl : vec3(0.0, 0.0, 1.0);
  float vl = length(mv.xyz);
  vV = vl > 1e-6 ? -mv.xyz / vl : vec3(0.0, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;
const TRACTOR_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float d = dot(vN, vV);
  float nn = max(length(vN) * length(vV), 1e-4);
  float f = clamp(abs(d) / nn, 0.0, 1.0);
  float rim = (1.0 - f) * (1.0 - f);
  float y = clamp(vUv.y, 0.0, 1.0);
  // Bands of light rising from the surface to the hauler.
  float s = sin((y * 6.0 - uTime * 1.6) * 6.2832) * 0.5 + 0.5;
  float bands = 0.45 + 0.55 * smoothstep(0.6, 1.0, s);
  float fade = smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(0.82, 1.0, y));
  gl_FragColor = vec4(vCol * (0.14 + rim * 0.85) * bands * fade, 1.0);
}
`;

/**
 * Orbital drones and harvesters of every online player, each kind one
 * instanced hull (lit, per-part colours), one instanced set of emissive
 * accents in the owner's hue, plus shared instanced glow sprites (engines,
 * blinking nav lights, beam spots), mining beams and tractor beams.
 *
 * Drones show `min(64, Σ levels.drone)`, harvesters (bigger, slower, further
 * out) `min(12, Σ levels.harvester)`, shared round-robin between owners.
 * Each unit has its own orbit plane, radius and speed, flies nose first with
 * a little bob and bank, and periodically dips toward the surface: drones
 * fire a mining beam that throws sparks, harvesters drop a tractor beam that
 * lifts ore. New units warp in with a flash. During a resonance surge they
 * all fly faster and beam brighter and more often.
 */
export function Drones() {
  // Hue and fleet size of each online owner, in a stable order.
  const key = useGame((st) => {
    const s = st.s;
    if (!s) return '';
    const out: string[] = [];
    for (const p of Object.values(s.players)) {
      if (p.online && (p.levels.drone > 0 || p.levels.harvester > 0)) out.push(`${p.id} ${p.hue} ${p.levels.drone} ${p.levels.harvester}`);
    }
    return out.sort().join(SEP);
  });
  const seed = useGame((s) => s.s?.seed ?? 1);

  const fleet = useMemo(() => {
    const owners = key ? key.split(SEP).map((row) => row.split(' ').map(Number)) : [];
    const color = owners.map(([, hue]) => setCss(new Color(), hueColor(hue)));
    const drones = roundRobin(
      owners.map((o) => o[2]),
      MAX_DRONES,
    );
    const harvesters = roundRobin(
      owners.map((o) => o[3]),
      MAX_HARVESTERS,
    );
    return { drones: drones.map((i) => color[i]), harvesters: harvesters.map((i) => color[i]) };
  }, [key]);

  const res = useBundle(
    () => ({
      droneHull: droneHull(),
      droneGlow: droneGlow(),
      harvHull: harvesterHull(),
      harvGlow: harvesterGlow(),
      quad: new PlaneGeometry(1, 1),
      ribbon: new PlaneGeometry(1, 1).translate(0, 0.5, 0),
      cone: new CylinderGeometry(0.3, 1, 1, 18, 1, true).translate(0, 0.5, 0),
      hullMat: new MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.5, flatShading: true, emissive: '#141c2a' }),
      glowMat: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      spriteMat: makeGlowMaterial(0.35, 0.25),
      beamMat: makeBeamMaterial({ core: 0.8, flow: 24, freq: 14 }),
      tractorMat: new ShaderMaterial({
        vertexShader: TRACTOR_VERT,
        fragmentShader: TRACTOR_FRAG,
        uniforms: { uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    }),
    [],
  );

  const meshes = useMemo(() => {
    const mk = (geo: BufferGeometry, mat: MeshBasicMaterial | MeshStandardMaterial | ShaderMaterial, n: number) => {
      const m = new InstancedMesh(geo, mat, n);
      m.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3).setUsage(DynamicDrawUsage);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      return m;
    };
    const m = {
      droneHull: mk(res.droneHull, res.hullMat, MAX_DRONES),
      droneGlow: mk(res.droneGlow, res.glowMat, MAX_DRONES),
      harvHull: mk(res.harvHull, res.hullMat, MAX_HARVESTERS),
      harvGlow: mk(res.harvGlow, res.glowMat, MAX_HARVESTERS),
      sprites: mk(res.quad, res.spriteMat, POOL * GLOWS_PER_UNIT),
      beams: mk(res.ribbon, res.beamMat, MAX_DRONES),
      tractors: mk(res.cone, res.tractorMat, MAX_HARVESTERS),
    };
    for (const [k, v] of Object.entries(m)) v.name = 'drones:' + k;
    m.sprites.renderOrder = 5;
    m.beams.renderOrder = 4;
    m.tractors.renderOrder = 4;
    return m;
  }, [res]);
  const meshList = useMemo(() => Object.values(meshes), [meshes]);
  useEffect(
    () => () => {
      for (const m of Object.values(meshes)) m.dispose();
    },
    [meshes],
  );

  // Owner colours: a faint hue tint on the hull, full hue (HDR) on the accents.
  const paint = useMemo(() => ({ glow: [] as Color[], sprite: [] as Color[] }), []);
  useEffect(() => {
    const c = new Color();
    const all = fleet.drones.concat(fleet.harvesters);
    paint.glow = all.map((o) => o.clone().lerp(WHITE, 0.12).multiplyScalar(2.4));
    paint.sprite = all.map((o) => o.clone().lerp(WHITE, 0.3));
    fleet.drones.forEach((o, k) => {
      meshes.droneHull.setColorAt(k, c.copy(HULL).lerp(o, 0.16));
      meshes.droneGlow.setColorAt(k, paint.glow[k]);
    });
    const nd = fleet.drones.length;
    fleet.harvesters.forEach((o, k) => {
      meshes.harvHull.setColorAt(k, c.copy(HULL).lerp(o, 0.12));
      meshes.harvGlow.setColorAt(k, paint.glow[nd + k]);
    });
    for (const m of [meshes.droneHull, meshes.droneGlow, meshes.harvHull, meshes.harvGlow]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [fleet, meshes, paint]);

  // Drone orbits first, then harvesters: further out, slower, deeper dips.
  const orbits = useMemo(() => {
    const r = rng(1337);
    return Array.from({ length: POOL }, (_, i) => {
      const big = i >= MAX_DRONES;
      const axis = new Vector3(r() - 0.5, r() * 0.6 + 0.4, r() - 0.5).normalize();
      const ref = new Vector3(1, 0, 0).cross(axis).normalize();
      return {
        axis,
        ref,
        radius: big ? 4.5 + r() * 0.8 : 3.2 + r() * 1.25,
        speed: big ? 0.1 + r() * 0.08 : 0.25 + r() * 0.35,
        dipRate: big ? 0.45 : 0.9,
        dipDepth: big ? 1.1 : 0.5,
        phase: r() * Math.PI * 2,
        blink: r(),
      };
    });
  }, []);

  const sim = useMemo(
    () => ({
      ang: Float32Array.from(orbits, (o) => o.phase),
      dip: Float32Array.from(orbits, (o) => o.phase * 3),
      nextSpark: new Float32Array(POOL),
      mult: 1,
      surge: 0,
      /** Units shown last frame, to flash newly bought ones in (-1 = first frame). */
      shown: [-1, -1],
    }),
    [orbits],
  );

  const tmp = useMemo(
    () => ({
      m: new Matrix4(),
      basis: new Matrix4(),
      q: new Quaternion(),
      ql: new Quaternion(),
      e: new Euler(),
      inv: new Quaternion(),
      p: new Vector3(),
      n: new Vector3(),
      fwd: new Vector3(),
      right: new Vector3(),
      s: new Vector3(),
      a: new Vector3(),
      b: new Vector3(),
      local: new Vector3(),
      c: new Color(),
      d: [0, 0, 0] as Vec3,
    }),
    [],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    const t = state.clock.elapsedTime;
    const cam = state.camera;
    const st = useGame.getState().s;
    const surge = !!st && surgeOn(st, hostNow());
    sim.surge = damp(sim.surge, surge ? 1 : 0, 3, dt);
    sim.mult = damp(sim.mult, surge ? 2.2 : 1, 2.5, dt);
    res.beamMat.uniforms.uTime.value = t;
    res.tractorMat.uniforms.uTime.value = t;

    const { droneHull: dHull, droneGlow: dGlow, harvHull: hHull, harvGlow: hGlow, sprites, beams, tractors } = meshes;
    const rock = refs.rock;
    if (rock) tmp.inv.copy(rock.quaternion).invert();
    else tmp.inv.identity();

    const nd = fleet.drones.length;
    const nh = fleet.harvesters.length;
    const units = nd + nh;
    let ns = 0;
    let nb = 0;
    let nt = 0;
    let sparkBudget = LITE ? 2 : 4;

    for (let k = 0; k < units; k++) {
      const big = k >= nd;
      const i = big ? MAX_DRONES + (k - nd) : k;
      const o = orbits[i];
      sim.ang[i] += dt * o.speed * sim.mult;
      sim.dip[i] += dt * o.dipRate * (1 + sim.surge * 1.3);
      const dip = Math.pow(Math.max(0, Math.sin(sim.dip[i])), 8 - sim.surge * 4);
      const bob = Math.sin(t * (big ? 1.1 : 2.3) + o.phase * 5) * (big ? 0.03 : 0.022);
      const rad = o.radius - dip * o.dipDepth + bob;

      // Nose along the orbit, belly to the rock, with a lazy bank and a nose-down pitch while mining.
      tmp.n.copy(o.ref).applyAxisAngle(o.axis, sim.ang[i]);
      tmp.p.copy(tmp.n).multiplyScalar(rad);
      tmp.fwd.crossVectors(o.axis, tmp.n);
      tmp.right.crossVectors(tmp.n, tmp.fwd);
      tmp.basis.makeBasis(tmp.right, tmp.n, tmp.fwd);
      tmp.q.setFromRotationMatrix(tmp.basis);
      const roll = Math.sin(t * (big ? 0.5 : 0.9) + o.phase) * (big ? 0.08 : 0.24);
      tmp.e.set(dip * (big ? 0.12 : 0.32), 0, roll);
      tmp.q.multiply(tmp.ql.setFromEuler(tmp.e));
      const sc = big ? HARVESTER_SCALE : DRONE_SCALE;
      tmp.m.compose(tmp.p, tmp.q, tmp.s.set(sc, sc, sc));
      const slot = big ? k - nd : k;
      (big ? hHull : dHull).setMatrixAt(slot, tmp.m);
      (big ? hGlow : dGlow).setMatrixAt(slot, tmp.m);

      // Engines flicker; nav lights double-blink, left and right out of step.
      const col = paint.sprite[k] ?? WHITE;
      const flick = 0.85 + Math.sin(t * 37 + i * 1.7) * 0.1 + Math.sin(t * 23 + i) * 0.05;
      if (big) {
        ns = putSprite(sprites, ns, tmp, HARV_ENGINES[0], 0.22 * sc * flick, col, 1.8);
        ns = putSprite(sprites, ns, tmp, HARV_ENGINES[1], 0.22 * sc * flick, col, 1.8);
      } else ns = putSprite(sprites, ns, tmp, DRONE_ENGINE, 0.13 * sc * flick, col, 1.8);
      const navs = big ? HARV_NAV : DRONE_NAV;
      for (let j = 0; j < navs.length; j++) {
        const ph = (t * 0.85 + o.blink + j * 0.5) % 1;
        const on = ph < 0.045 || (ph > 0.11 && ph < 0.155) ? 1 : 0;
        ns = putSprite(sprites, ns, tmp, navs[j], (big ? 0.1 : 0.07) * sc * (0.7 + on * 0.6), col, 0.2 + on * 2.4);
      }

      // Where the beam would land: the actual surface under the unit.
      if (dip > 0.02) {
        tmp.local.copy(tmp.n).applyQuaternion(tmp.inv);
        tmp.d[0] = tmp.local.x;
        tmp.d[1] = tmp.local.y;
        tmp.d[2] = tmp.local.z;
        const surf = surfaceRadius(tmp.d, seed);
        const k2 = Math.min(1, dip * 1.6) * (1 + sim.surge * 0.8);
        tmp.b.copy(tmp.n).multiplyScalar(surf);
        if (big) {
          // Tractor cone from the surface up to the emitter.
          tmp.a.copy(HARV_EMITTER).applyMatrix4(tmp.m);
          const len = Math.max(0.05, tmp.a.distanceTo(tmp.b));
          const w = 0.14 * Math.min(1, dip * 1.4) * (1 + sim.surge * 0.4);
          tmp.ql.setFromUnitVectors(Y_UP, tmp.n);
          tractors.setMatrixAt(nt, tmp.basis.compose(tmp.b, tmp.ql, tmp.s.set(w, len, w)));
          tractors.setColorAt(nt, tmp.c.copy(col).multiplyScalar(0.45 * k2));
          nt++;
          // Ore lifted up the beam.
          if (t >= sim.nextSpark[i] && dip > 0.4 && sparkBudget > 0) {
            sparkBudget--;
            sim.nextSpark[i] = t + 0.18 + Math.random() * 0.2;
            const speed = 0.9;
            sparks(tmp.b, tmp.n, ORE, 2, speed, { spread: 0.12, life: len / speed, size: 0.8, drag: 0, white: 0.3 });
          }
        } else {
          tmp.a.copy(DRONE_EMITTER).applyMatrix4(tmp.m);
          ribbonMatrix(tmp.basis, tmp.a, tmp.b, 0.05 * (0.6 + 0.4 * k2) * (1 + sim.surge * 0.5), cam.position);
          beams.setMatrixAt(nb, tmp.basis);
          beams.setColorAt(nb, tmp.c.copy(col).lerp(WHITE, 0.2).multiplyScalar(1.7 * k2));
          nb++;
          if (t >= sim.nextSpark[i] && dip > 0.5 && sparkBudget > 0) {
            sparkBudget--;
            sim.nextSpark[i] = t + 0.25 + Math.random() * 0.35;
            sparks(tmp.b, tmp.n, col, 3, 1.5, { spread: 1, life: 0.35, size: 0.55, white: 0.5 });
          }
        }
        // A hot spot where it lands, pulled toward the camera so the rock doesn't clip it.
        tmp.a.copy(cam.position).sub(tmp.b);
        const l = tmp.a.length();
        if (l > 1e-4) tmp.b.addScaledVector(tmp.a, 0.12 / l);
        const size = (big ? 0.42 : 0.22) * k2 * (0.9 + 0.1 * Math.sin(t * 40 + i));
        tmp.basis.makeScale(size, size, 1).setPosition(tmp.b);
        sprites.setMatrixAt(ns, tmp.basis);
        sprites.setColorAt(ns, tmp.c.copy(big ? ORE : col).lerp(WHITE, 0.3).multiplyScalar(1.8 * k2));
        ns++;
      }
    }

    // Newly bought units warp in with a flash (not on the first frame or after a big jump).
    warpIn(0, nd, 0);
    warpIn(1, nh, nd);

    dHull.count = dGlow.count = nd;
    hHull.count = hGlow.count = nh;
    sprites.count = ns;
    beams.count = nb;
    tractors.count = nt;
    for (let j = 0; j < meshList.length; j++) {
      const m = meshList[j];
      if (m.count === 0) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m === sprites || m === beams || m === tractors) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  function warpIn(j: 0 | 1, n: number, offset: number) {
    const before = sim.shown[j];
    sim.shown[j] = n;
    if (before < 0 || n <= before || n - before > 6) return;
    const mesh = j ? meshes.harvHull : meshes.droneHull;
    for (let k = before; k < n; k++) {
      mesh.getMatrixAt(k, tmp.m);
      tmp.p.setFromMatrixPosition(tmp.m);
      const col = paint.sprite[offset + k] ?? WHITE;
      flash(tmp.p, tmp.c.copy(col).multiplyScalar(2.5), { kind: 'star', size: j ? 1.2 : 0.8, size1: 0.2, life: 0.5 });
      flash(tmp.p, tmp.c.copy(col).multiplyScalar(1.6), { kind: 'ring', size: 0.1, size1: j ? 1.1 : 0.7, life: 0.45 });
    }
  }

  return (
    <>
      <primitive object={meshes.droneHull} />
      <primitive object={meshes.harvHull} />
      <primitive object={meshes.droneGlow} />
      <primitive object={meshes.harvGlow} />
      <primitive object={meshes.tractors} />
      <primitive object={meshes.beams} />
      <primitive object={meshes.sprites} />
    </>
  );
}
