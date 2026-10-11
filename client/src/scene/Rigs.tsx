import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Group,
} from 'three';
import { surfacePoint } from '@starforge/shared';
import { hueColor } from '../state/refs';
import { useGame } from '../state/store';
import { sparks } from './bus';
import { chunks, easeOutBack, makeGlowMaterial, mergeParts, type Part } from './fxkit';
import { roundRobin, SEP, setCss, useBundle } from './util';

const MAX_RIGS = 16;
const Y_UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const SPARK = new Color('#ffb860');
const HOT = new Color('#ff7a2a');
const WHITE = new Color(1, 1, 1);
const RIG_SCALE = 0.9;
/** Drill head rest height and how far it plunges on a tap. */
const PLUNGE = 0.045;

/* ---------------- model (Y up, feet on the ground at y = 0) ---------------- */

const at = (g: BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);

/** A square-section strut from `a` to `b`. */
function strut(a: Vector3, b: Vector3, w: number): BufferGeometry {
  const d = new Vector3().subVectors(b, a);
  const len = d.length();
  const g = new BoxGeometry(w, len, w).translate(0, len / 2, 0);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(Y_UP, d.normalize()));
  return g.translate(a.x, a.y, a.z);
}

/** The static frame: a hex pad on three splayed legs, a lattice tower, the motor housing, a tank and pipes. */
function rigFrame(): BufferGeometry {
  const parts: Part[] = [
    [at(new CylinderGeometry(0.13, 0.15, 0.035, 6), 0, 0.055, 0), '#4b525c'],
    [at(new CylinderGeometry(0.05, 0.05, 0.04, 8), 0, 0.085, 0), '#2e3239'],
  ];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const foot = new Vector3(Math.cos(a) * 0.25, 0.008, Math.sin(a) * 0.25);
    parts.push([strut(new Vector3(Math.cos(a) * 0.1, 0.06, Math.sin(a) * 0.1), foot, 0.022), '#6b737e']);
    parts.push([at(new CylinderGeometry(0.03, 0.036, 0.016, 6), foot.x, 0.008, foot.z), '#3a4048']);
  }
  // Lattice tower: four posts, X-bracing on every face, two bays.
  const h0 = 0.07;
  const h1 = 0.45;
  const r = 0.058;
  const corners = [
    [r, r],
    [-r, r],
    [-r, -r],
    [r, -r],
  ];
  for (const [x, z] of corners) parts.push([at(new BoxGeometry(0.017, h1 - h0, 0.017), x, (h0 + h1) / 2, z), '#e0a52f']);
  const bay = (h1 - h0) / 2;
  for (let f = 0; f < 4; f++) {
    const [x0, z0] = corners[f];
    const [x1, z1] = corners[(f + 1) % 4];
    for (let b = 0; b < 2; b++) {
      const y0 = h0 + b * bay;
      const flip = b % 2 === 0;
      parts.push([strut(new Vector3(x0, flip ? y0 : y0 + bay, z0), new Vector3(x1, flip ? y0 + bay : y0, z1), 0.008), '#c18a22']);
      parts.push([strut(new Vector3(x0, y0 + bay, z0), new Vector3(x1, y0 + bay, z1), 0.009), '#c18a22']);
    }
  }
  parts.push(
    [at(new BoxGeometry(0.17, 0.095, 0.14), 0, 0.5, 0), '#e8b23a'],
    [at(new BoxGeometry(0.176, 0.022, 0.146), 0, 0.47, 0), '#2a2d33'],
    [at(new BoxGeometry(0.12, 0.03, 0.1), 0, 0.562, 0), '#7c8590'],
    [at(new CylinderGeometry(0.036, 0.036, 0.11, 8).rotateZ(Math.PI / 2), 0, 0.5, 0.088), '#717a85'],
    [at(new CylinderGeometry(0.042, 0.042, 0.13, 8), 0.125, 0.135, 0.02), '#a3acb6'],
    [at(new CylinderGeometry(0.044, 0.044, 0.014, 8), 0.125, 0.16, 0.02), '#e0a52f'],
    [at(new CylinderGeometry(0.011, 0.011, 0.13, 6), -0.065, 0.62, -0.045), '#545b64'],
    [at(new CylinderGeometry(0.004, 0.004, 0.13, 4), 0.055, 0.64, 0.035), '#c4ccd6'],
  );
  return mergeParts(parts);
}

/** The drill: a shaft with auger flights winding down it to a bit at the ground. Spins about Y. */
function rigDrill(): BufferGeometry {
  const parts: Part[] = [
    [at(new CylinderGeometry(0.014, 0.014, 0.44, 6), 0, 0.24, 0), '#aeb6c1'],
    [at(new ConeGeometry(0.034, 0.08, 6).rotateX(Math.PI), 0, -0.01, 0), '#d8dde5'],
  ];
  for (let k = 0; k < 14; k++) parts.push([at(new BoxGeometry(0.078, 0.007, 0.022).rotateY(k * 0.62), 0, 0.05 + k * 0.022, 0), '#c9cfd8']);
  return mergeParts(parts);
}

/** Accents lit in the owner's colour: a status strip and side lamps on the housing, lights round the pad. */
function rigGlow(): BufferGeometry {
  const parts: Part[] = [
    [at(new BoxGeometry(0.15, 0.012, 0.012), 0, 0.515, 0.071), '#ffffff'],
    [at(new BoxGeometry(0.012, 0.03, 0.06), 0.087, 0.505, 0), '#bdbdbd'],
    [at(new BoxGeometry(0.012, 0.03, 0.06), -0.087, 0.505, 0), '#bdbdbd'],
    [at(new OctahedronGeometry(0.016, 0), 0.055, 0.712, 0.035), '#ffffff'],
  ];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    parts.push([at(new BoxGeometry(0.02, 0.01, 0.02), Math.cos(a) * 0.135, 0.073, Math.sin(a) * 0.135), '#9e9e9e']);
  }
  return mergeParts(parts);
}

const BEACON = new Vector3(0.055, 0.712, 0.035);
const BORE = new Vector3(0, 0.03, 0);

const RING_VERT = /* glsl */ `
varying float vR;
varying vec3 vCol;
void main() {
  vR = length(position.xz);
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const RING_FRAG = /* glsl */ `
varying float vR;
varying vec3 vCol;
void main() {
  // Bright leading edge at r = 1, soft glow inside it.
  float x = clamp((vR - 0.55) / 0.45, 0.0, 1.0);
  float edge = x * x * x * x * x * x * 1.6 + x * x * 0.35;
  float rim = smoothstep(1.0, 0.95, vR);
  gl_FragColor = vec4(vCol * edge * rim, 1.0);
}
`;

/**
 * Auto-Rigs: `min(16, Σ levels.rig)` over online players, drill towers
 * standing around the seams, shared round-robin between owners. Each is a
 * yellow lattice tower on a splayed tripod pad with a motor housing on top
 * and an auger spinning down through it. Every second or two it taps: the
 * drill plunges, the bore flares hot, a ring of light runs out across the
 * ground and sparks and chips fly. Its beacon and housing lights glow in its
 * owner's hue. Rigs pop in with a little overshoot when they're placed.
 */
export function Rigs() {
  const key = useGame((st) => {
    const s = st.s;
    if (!s) return '';
    const out: string[] = [];
    for (const p of Object.values(s.players)) if (p.online && p.levels.rig > 0) out.push(`${p.id} ${p.hue} ${p.levels.rig}`);
    return out.sort().join(SEP);
  });
  const seamKey = useGame((st) => (st.s ? st.s.seams.map((x) => x.id).join(SEP) : ''));
  const seed = useGame((st) => st.s?.seed ?? 1);
  const lights = useMemo(() => {
    const owners = key ? key.split(SEP).map((row) => row.split(' ').map(Number)) : [];
    const color = owners.map(([, hue]) => setCss(new Color(), hueColor(hue, 62)));
    return roundRobin(
      owners.map((o) => o[2]),
      MAX_RIGS,
    ).map((i) => color[i]);
  }, [key]);
  if (lights.length <= 0 || !seamKey) return null;
  return <RigField count={lights.length} lights={lights} seamKey={seamKey} seed={seed} />;
}

function RigField({ count, lights, seamKey, seed }: { count: number; lights: Color[]; seamKey: string; seed: number }) {
  const res = useBundle(
    () => ({
      frameGeo: rigFrame(),
      drillGeo: rigDrill(),
      glowGeo: rigGlow(),
      quad: new PlaneGeometry(1, 1),
      ringGeo: new RingGeometry(0.5, 1, 40, 1).rotateX(-Math.PI / 2),
      frameMat: new MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.5, flatShading: true, emissive: '#16100a' }),
      drillMat: new MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.3, flatShading: true, emissive: '#1a120c' }),
      glowMat: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      spriteMat: makeGlowMaterial(0.5, 0.5),
      ringMat: new ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    }),
    [],
  );

  const meshes = useMemo(() => {
    const mk = (geo: BufferGeometry, mat: MeshStandardMaterial | MeshBasicMaterial | ShaderMaterial, n: number, colors: boolean) => {
      const m = new InstancedMesh(geo, mat, n);
      if (colors) m.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3).setUsage(DynamicDrawUsage);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      return m;
    };
    const m = {
      frame: mk(res.frameGeo, res.frameMat, MAX_RIGS, false),
      drill: mk(res.drillGeo, res.drillMat, MAX_RIGS, false),
      glow: mk(res.glowGeo, res.glowMat, MAX_RIGS, true),
      sprites: mk(res.quad, res.spriteMat, MAX_RIGS * 2, true),
      rings: mk(res.ringGeo, res.ringMat, MAX_RIGS, true),
    };
    for (const [k, v] of Object.entries(m)) v.name = 'rigs:' + k;
    m.sprites.renderOrder = 5;
    m.rings.renderOrder = 3;
    return m;
  }, [res]);
  const meshList = useMemo(() => Object.values(meshes), [meshes]);
  useEffect(
    () => () => {
      for (const m of meshList) m.dispose();
    },
    [meshList],
  );

  // Where each rig stands: rig i on seam i % seams, spread around that seam.
  const targets = useMemo(() => {
    const seams = useGame.getState().s?.seams ?? [];
    const S = seams.length;
    const out: { p: Vector3; q: Quaternion }[] = [];
    const n = new Vector3();
    const t1 = new Vector3();
    const t2 = new Vector3();
    const d = new Vector3();
    for (let i = 0; i < count && S > 0; i++) {
      const j = i % S;
      const k = Math.floor(i / S);
      const m = Math.floor((count - 1 - j) / S) + 1;
      n.set(...seams[j].dir).normalize();
      t1.crossVectors(n, Math.abs(n.y) < 0.9 ? Y_UP : X_AXIS).normalize();
      t2.crossVectors(n, t1);
      const ang = (k / m) * Math.PI * 2 + j * 1.3;
      d.copy(n)
        .multiplyScalar(2.2)
        .addScaledVector(t1, Math.cos(ang) * 0.52)
        .addScaledVector(t2, Math.sin(ang) * 0.52)
        .normalize();
      const p = new Vector3(...surfacePoint([d.x, d.y, d.z], seed)).addScaledVector(d, -0.02);
      // Turn each rig about its own up axis a little so they don't all face the same way.
      const q = new Quaternion().setFromUnitVectors(Y_UP, d).multiply(new Quaternion().setFromAxisAngle(Y_UP, i * 2.39));
      out.push({ p, q });
    }
    return out;
    // seamKey changes whenever a seam is replaced
  }, [count, seamKey, seed]);

  const state = useMemo(
    () => ({
      pos: Array.from({ length: MAX_RIGS }, () => new Vector3()),
      quat: Array.from({ length: MAX_RIGS }, () => new Quaternion()),
      placed: new Uint8Array(MAX_RIGS),
      pop: new Float32Array(MAX_RIGS),
      spin: new Float32Array(MAX_RIGS),
      /** Time of the next tap, and how long since the last one. */
      nextTap: new Float32Array(MAX_RIGS),
      since: new Float32Array(MAX_RIGS).fill(9),
    }),
    [],
  );
  const tmp = useMemo(
    () => ({
      rig: new Matrix4(),
      local: new Matrix4(),
      out: new Matrix4(),
      q: new Quaternion(),
      v: new Vector3(),
      s: new Vector3(),
      up: new Vector3(),
      c: new Color(),
    }),
    [],
  );
  const group = useRef<Group>(null!);

  useFrame((frame, dtRaw) => {
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    const t = frame.clock.elapsedTime;
    const n = targets.length;
    const { frame: frameMesh, drill, glow, sprites, rings } = meshes;
    const g = group.current;
    let ns = 0;
    let nr = 0;
    for (let r = 0; r < n; r++) {
      const tg = targets[r];
      if (!state.placed[r] || state.pos[r].distanceToSquared(tg.p) > 0.0025) {
        state.pos[r].copy(tg.p);
        state.quat[r].copy(tg.q);
        state.placed[r] = 1;
        state.pop[r] = 0;
        state.nextTap[r] = t + 0.6 + Math.random();
      }
      state.pop[r] = Math.min(1, state.pop[r] + dt * 2.2);
      const sc = Math.max(0.001, easeOutBack(state.pop[r])) * RIG_SCALE;
      tmp.rig.compose(state.pos[r], state.quat[r], tmp.s.set(sc, sc, sc));
      frameMesh.setMatrixAt(r, tmp.rig);
      const owner = lights[r] ?? SPARK;
      glow.setMatrixAt(r, tmp.rig);
      glow.setColorAt(r, tmp.c.copy(owner).multiplyScalar(2.2));

      // Tap: plunge, flare, ring, sparks and chips.
      state.since[r] += dt;
      if (t >= state.nextTap[r] && state.pop[r] >= 1) {
        state.nextTap[r] = t + 1.1 + Math.random() * 1.1;
        state.since[r] = 0;
        tmp.v.set(0, 0.03, 0).applyMatrix4(tmp.rig).applyMatrix4(g.matrixWorld);
        tmp.up.copy(Y_UP).transformDirection(tmp.rig).transformDirection(g.matrixWorld);
        sparks(tmp.v, tmp.up, SPARK, 5 + ((Math.random() * 4) | 0), 2.4, { spread: 1.3, life: 0.45, size: 0.7, white: 0.45 });
        if (Math.random() < 0.6) chunks(tmp.v, tmp.up, 1 + ((Math.random() * 2) | 0), { speed: 1.4, size: 0.6 });
      }
      const s = state.since[r];
      const kick = s < 0.06 ? s / 0.06 : Math.max(0, 1 - (s - 0.06) / 0.35);
      const hum = Math.sin(t * 60 + r * 3.1) * 0.003;
      state.spin[r] += dt * (18 + kick * 30);
      tmp.q.setFromAxisAngle(Y_UP, state.spin[r]);
      tmp.local.compose(tmp.v.set(0, PLUNGE * 0.3 - kick * PLUNGE + hum, 0), tmp.q, tmp.s.set(1, 1, 1));
      drill.setMatrixAt(r, tmp.out.multiplyMatrices(tmp.rig, tmp.local));

      // Beacon: a slow blink in the owner's hue, bright on every tap.
      const ph = (t * 0.7 + r * 0.37) % 1;
      const blink = ph < 0.08 ? 1 : 0;
      const b = 0.35 + blink * 1.6 + kick * 1.4;
      tmp.v.copy(BEACON).applyMatrix4(tmp.rig);
      tmp.local.makeScale(0.13 * sc * (0.8 + b * 0.25), 0.13 * sc * (0.8 + b * 0.25), 1).setPosition(tmp.v);
      sprites.setMatrixAt(ns, tmp.local);
      sprites.setColorAt(ns, tmp.c.copy(owner).lerp(WHITE, 0.2).multiplyScalar(b));
      ns++;
      // Bore glow at the drill's foot: a steady ember that flares on the tap.
      tmp.v.copy(BORE).applyMatrix4(tmp.rig);
      const bs = (0.16 + kick * 0.22) * sc;
      tmp.local.makeScale(bs, bs, 1).setPosition(tmp.v);
      sprites.setMatrixAt(ns, tmp.local);
      sprites.setColorAt(ns, tmp.c.copy(HOT).multiplyScalar(0.9 + kick * 2.2 + Math.sin(t * 13 + r) * 0.15));
      ns++;

      // Ground ring running out from the tap.
      if (s < 0.6) {
        const e = s / 0.6;
        const rr = (0.08 + 0.5 * (1 - (1 - e) * (1 - e))) / RIG_SCALE;
        tmp.local.makeScale(rr, 1, rr).setPosition(0, 0.012, 0);
        rings.setMatrixAt(nr, tmp.out.multiplyMatrices(tmp.rig, tmp.local));
        rings.setColorAt(nr, tmp.c.copy(owner).lerp(HOT, 0.4).multiplyScalar(2.2 * (1 - e) * (1 - e)));
        nr++;
      }
    }
    frameMesh.count = drill.count = glow.count = n;
    sprites.count = ns;
    rings.count = nr;
    for (let j = 0; j < meshList.length; j++) {
      const m = meshList[j];
      if (!m.count) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group ref={group}>
      <primitive object={meshes.frame} />
      <primitive object={meshes.drill} />
      <primitive object={meshes.glow} />
      <primitive object={meshes.rings} />
      <primitive object={meshes.sprites} />
    </group>
  );
}
