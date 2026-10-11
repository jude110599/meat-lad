import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';
import { RESOURCE_DEFS } from '@starforge/shared';
import { onFx } from '../state/fx';
import { hueColor, refs } from '../state/refs';
import { useGame } from '../state/store';
import { bus, type SparkOpts } from './bus';
import { Dust } from './Dust';
import { anyPerp, kit, makeGlowMaterial, randomDir, ribbonMatrix, type ChunkOpts, type MoteOpts } from './fxkit';
import { cssColor, isLite, useBundle } from './util';

/** Phones and narrow windows get smaller pools and thinner bursts. */
const LITE = isLite();
const MAX = LITE ? 1600 : 3600;
const COUNT_SCALE = LITE ? 0.6 : 1;
const MAX_CHUNKS = LITE ? 36 : 90;
const MAX_MOTES = LITE ? 48 : 110;
/** Where my ore motes fly: the HUD ore counter, top left (CSS px). */
const HUD_ORE = { x: 30, y: 40 };
const ORE = new Color(RESOURCE_DEFS.ore.color);
const ROCK = new Color('#8b7560');
const ROCK_DARK = new Color('#5a4a3e');
const WHITE = new Color(1, 1, 1);

/* ---------------- sparks: simulated on the GPU ---------------- */

// Each spark is a camera-facing quad stretched along its on-screen motion.
// Motion is analytic (drag only, no gravity): p = p0 + v0 (1 - e^(-k t)) / k,
// so the CPU only writes a spark once, when it is born.
const SPARK_VERT = /* glsl */ `
attribute vec3 aP0;
attribute vec3 aV0;
attribute vec3 aCol;
attribute vec4 aT;
uniform float uTime;
uniform float uStretch;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv;
  float age = uTime - aT.x;
  float life = aT.y;
  if (age < 0.0 || age >= life || life <= 0.0) {
    vCol = vec3(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = max(aT.w, 0.001);
  float decay = exp(-k * age);
  vec3 p = aP0 + aV0 * ((1.0 - decay) / k);
  vec3 v = aV0 * decay;
  float f = clamp(1.0 - age / life, 0.0, 1.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 vv = (modelViewMatrix * vec4(v, 0.0)).xyz;
  float depth = max(0.05, -mv.z);
  // On-screen direction of motion (perspective-correct), in view units at this depth.
  vec2 sd = vv.xy + mv.xy * (vv.z / depth);
  float sl = length(sd);
  vec2 ax = sl > 1e-5 ? sd / sl : vec2(0.0, 1.0);
  vec2 px = vec2(-ax.y, ax.x);
  float size = aT.z * (0.35 + 0.65 * f);
  float len = size + min(sl * uStretch, 0.6);
  mv.xy += px * (position.x * size) + ax * (position.y * len);
  vCol = aCol * (f * f * (3.0 - 2.0 * f));
  gl_Position = projectionMatrix * mv;
}
`;

const SPARK_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float d = dot(c, c);
  if (d >= 1.0) discard;
  float glow = exp(-d * 3.0) * (1.0 - d);
  float core = exp(-d * 14.0);
  gl_FragColor = vec4(vCol * (glow + core * 1.5), 1.0);
}
`;

/* ---------------- motes: a soft streak behind a bright gem ---------------- */

const MOTE_TRAIL_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float x = vUv.x * 2.0 - 1.0;
  float y = clamp(vUv.y, 0.0, 1.0);
  float a = exp(-x * x * 7.0) * (1.0 - x * x) * y * y;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;
const MOTE_TRAIL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

interface Chunk {
  pos: Vector3;
  vel: Vector3;
  axis: Vector3;
  scale: Vector3;
  spin: number;
  angle: number;
  age: number;
  life: number;
}

interface Mote {
  pos: Vector3;
  vel: Vector3;
  color: Color;
  /** Live reference to the target (a ship), or null for my HUD counter. */
  target: Vector3 | null;
  hud: boolean;
  age: number;
  /** Seconds of free flight before homing starts. */
  free: number;
  speed: number;
  size: number;
  alive: boolean;
}

/** A lumpy rock: an icosahedron with each corner pushed in or out (same corner, same push, so faces stay closed). */
function makeChunkGeometry() {
  const g = new IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const k = 0.7 + (h - Math.floor(h)) * 0.55;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Every spark, chip and mote in the scene.
 *
 * - Sparks: one pooled GPU particle system (stretched glowing streaks,
 *   simulated in the vertex shader). Other components spawn through
 *   `sparks()` in bus.ts; 'burst' fx from the network land here directly.
 * - Chunks: small lumpy rocks that tumble off every strike, lit like the rock.
 * - Ore motes: gems that pop off a strike, hang for a beat, then streak to
 *   whoever mined them: my HUD ore counter, or a crewmate's ship.
 *
 * Also renders the ambient dust (Dust.tsx).
 */
export function Particles() {
  const sys = useMemo(() => {
    const quad = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const attr = (size: number) => new InstancedBufferAttribute(new Float32Array(MAX * size), size).setUsage(DynamicDrawUsage);
    const aP0 = attr(3);
    const aV0 = attr(3);
    const aCol = attr(3);
    const aT = attr(4);
    geo.setAttribute('aP0', aP0);
    geo.setAttribute('aV0', aV0);
    geo.setAttribute('aCol', aCol);
    geo.setAttribute('aT', aT);
    geo.instanceCount = MAX;
    const mat = new ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: { uTime: { value: 0 }, uStretch: { value: 0.035 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.visible = false;
    return { mesh, geo, mat, aP0, aV0, aCol, aT, head: 0, time: 0, until: 0 };
  }, []);

  const res = useBundle(
    () => ({
      chunkGeo: makeChunkGeometry(),
      chunkMat: new MeshStandardMaterial({ roughness: 0.88, metalness: 0.08, flatShading: true, emissive: '#2a1206', emissiveIntensity: 1 }),
      quad: new PlaneGeometry(1, 1),
      ribbon: new PlaneGeometry(1, 1).translate(0, 0.5, 0),
      gemMat: makeGlowMaterial(0.9, 0.9),
      trailMat: new ShaderMaterial({ vertexShader: MOTE_TRAIL_VERT, fragmentShader: MOTE_TRAIL_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    }),
    [],
  );

  const meshes = useMemo(() => {
    const chunks = new InstancedMesh(res.chunkGeo, res.chunkMat, MAX_CHUNKS);
    const gems = new InstancedMesh(res.quad, res.gemMat, MAX_MOTES);
    const trails = new InstancedMesh(res.ribbon, res.trailMat, MAX_MOTES);
    chunks.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_CHUNKS * 3).fill(1), 3);
    for (const m of [gems, trails]) m.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_MOTES * 3), 3).setUsage(DynamicDrawUsage);
    for (const m of [chunks, gems, trails]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
    }
    gems.renderOrder = 7;
    trails.renderOrder = 6;
    return { chunks, gems, trails };
  }, [res]);
  useEffect(
    () => () => {
      for (const m of Object.values(meshes)) m.dispose();
    },
    [meshes],
  );

  const pools = useMemo(
    () => ({
      chunks: Array.from<unknown, Chunk>({ length: MAX_CHUNKS }, () => ({
        pos: new Vector3(),
        vel: new Vector3(),
        axis: new Vector3(0, 1, 0),
        scale: new Vector3(1, 1, 1),
        spin: 0,
        angle: 0,
        age: 1,
        life: 0,
      })),
      motes: Array.from<unknown, Mote>({ length: MAX_MOTES }, () => ({
        pos: new Vector3(),
        vel: new Vector3(),
        color: new Color(),
        target: null,
        hud: false,
        age: 0,
        free: 0.3,
        speed: 0,
        size: 0.1,
        alive: false,
      })),
      chunkHead: 0,
      moteHead: 0,
      chunksAlive: 0,
      motesAlive: 0,
    }),
    [],
  );

  const tmp = useMemo(
    () => ({
      m: new Matrix4(),
      q: new Quaternion(),
      v: new Vector3(),
      d: new Vector3(),
      t1: new Vector3(),
      t2: new Vector3(),
      hud: new Vector3(),
      tail: new Vector3(),
      c: new Color(),
    }),
    [],
  );

  useEffect(() => {
    const { aP0, aV0, aCol, aT } = sys;
    const p0 = aP0.array as Float32Array;
    const v0 = aV0.array as Float32Array;
    const col = aCol.array as Float32Array;
    const tt = aT.array as Float32Array;

    const markDirty = (start: number, n: number) => {
      aP0.addUpdateRange(start * 3, n * 3);
      aV0.addUpdateRange(start * 3, n * 3);
      aCol.addUpdateRange(start * 3, n * 3);
      aT.addUpdateRange(start * 4, n * 4);
      aP0.needsUpdate = aV0.needsUpdate = aCol.needsUpdate = aT.needsUpdate = true;
    };

    const emit = (at: Vector3, dir: Vector3 | null, color: Color, count: number, speed: number, o?: SparkOpts) => {
      if (!Number.isFinite(at.x + at.y + at.z) || !(speed >= 0)) return;
      const spread = o?.spread ?? 0.8;
      const lifeMean = o?.life ?? 0.65;
      const sizeMul = o?.size ?? 1;
      const dragK = o?.drag ?? 2.2;
      const white = o?.white ?? 0.2;
      const n = Math.min(Math.ceil(count * COUNT_SCALE), 400, MAX);
      if (n <= 0) return;
      const start = sys.head;
      for (let k = 0; k < n; k++) {
        const i = sys.head;
        sys.head = (sys.head + 1) % MAX;
        // Random direction in a sphere, then biased along `dir`.
        randomDir(tmp.v).multiplyScalar(spread);
        if (dir) tmp.v.add(dir);
        const l = tmp.v.length();
        if (l > 1e-6) tmp.v.multiplyScalar(1 / l);
        else tmp.v.set(0, 1, 0);
        const sp = speed * (0.3 + Math.random() * 0.9);
        const j = i * 3;
        p0[j] = at.x;
        p0[j + 1] = at.y;
        p0[j + 2] = at.z;
        v0[j] = tmp.v.x * sp;
        v0[j + 1] = tmp.v.y * sp;
        v0[j + 2] = tmp.v.z * sp;
        const hot = Math.random() < white ? 0.6 + Math.random() * 0.4 : 0;
        const tint = (0.8 + Math.random() * 0.6) * 1.7;
        col[j] = (color.r + (1 - color.r) * hot) * tint;
        col[j + 1] = (color.g + (1 - color.g) * hot) * tint;
        col[j + 2] = (color.b + (1 - color.b) * hot) * tint;
        const life = lifeMean * (0.55 + Math.random() * 0.9);
        const q = i * 4;
        tt[q] = sys.time;
        tt[q + 1] = life;
        tt[q + 2] = 0.075 * sizeMul * (0.55 + Math.random() * 0.9);
        tt[q + 3] = dragK;
        if (sys.time + life > sys.until) sys.until = sys.time + life;
      }
      // The ring buffer may have wrapped: upload one or two ranges.
      if (start + n <= MAX) markDirty(start, n);
      else {
        markDirty(start, MAX - start);
        markDirty(0, start + n - MAX);
      }
      sys.mesh.visible = true;
    };

    const spawnChunks = (at: Vector3, dir: Vector3, count: number, o?: ChunkOpts) => {
      if (!Number.isFinite(at.x + at.y + at.z)) return;
      const n = Math.min(Math.ceil(count * (LITE ? 0.6 : 1)), MAX_CHUNKS);
      const speed = o?.speed ?? 2.2;
      const size = o?.size ?? 1;
      const ore = o?.ore ?? 0;
      for (let k = 0; k < n; k++) {
        const i = pools.chunkHead;
        pools.chunkHead = (pools.chunkHead + 1) % MAX_CHUNKS;
        const c = pools.chunks[i];
        c.pos.copy(at).addScaledVector(dir, 0.04);
        randomDir(tmp.v).multiplyScalar(0.75).add(dir);
        const l = tmp.v.length();
        if (l > 1e-6) tmp.v.multiplyScalar(1 / l);
        else tmp.v.copy(dir);
        c.vel.copy(tmp.v).multiplyScalar(speed * (0.45 + Math.random() * 0.8));
        randomDir(c.axis);
        c.spin = (Math.random() * 2 - 1) * 9;
        c.angle = Math.random() * 6.28;
        const s = 0.022 + Math.random() * Math.random() * 0.05 * size;
        c.scale.set(s * (0.8 + Math.random() * 0.5), s * (0.6 + Math.random() * 0.5), s * (0.8 + Math.random() * 0.5));
        c.age = 0;
        c.life = 0.9 + Math.random() * 0.9;
        const isOre = Math.random() < ore;
        const base = isOre ? (o?.tint ?? ORE) : Math.random() < 0.5 ? ROCK : ROCK_DARK;
        meshes.chunks.setColorAt(i, tmp.c.copy(base).multiplyScalar(isOre ? 1.6 : 0.85 + Math.random() * 0.4));
      }
      if (meshes.chunks.instanceColor) meshes.chunks.instanceColor.needsUpdate = true;
      pools.chunksAlive = MAX_CHUNKS;
    };

    const spawnMotes = (at: Vector3, dir: Vector3 | null, color: Color, count: number, o?: MoteOpts) => {
      if (!Number.isFinite(at.x + at.y + at.z)) return;
      const n = Math.min(Math.ceil(count * (LITE ? 0.7 : 1)), 24);
      for (let k = 0; k < n; k++) {
        const i = pools.moteHead;
        pools.moteHead = (pools.moteHead + 1) % MAX_MOTES;
        const m = pools.motes[i];
        m.pos.copy(at);
        randomDir(tmp.v);
        if (dir) tmp.v.multiplyScalar(0.8).add(dir);
        const l = tmp.v.length();
        if (l > 1e-6) tmp.v.multiplyScalar(1 / l);
        m.vel.copy(tmp.v).multiplyScalar((o?.speed ?? 2.6) * (0.5 + Math.random() * 0.7));
        m.color.copy(color);
        m.hud = o?.target === undefined;
        m.target = o?.target ?? null;
        m.age = 0;
        m.free = 0.22 + Math.random() * 0.3 + k * 0.02;
        m.speed = 0;
        m.size = (o?.size ?? 1) * (0.065 + Math.random() * 0.035);
        m.alive = true;
      }
      pools.motesAlive = MAX_MOTES;
    };

    bus.sparks = emit;
    kit.chunks = spawnChunks;
    kit.motes = spawnMotes;

    const off = onFx((e) => {
      if (e.kind === 'burst') emit(e.at, e.normal, cssColor(e.color), e.count, e.speed, { white: 0.25 });
      else if (e.kind === 'impact') {
        const st = useGame.getState();
        const mine = e.by === st.me;
        const nChunks = e.broke ? 12 : e.crit ? 7 : e.seam ? 4 : 2;
        spawnChunks(e.at, e.normal, mine ? nChunks : Math.ceil(nChunks / 2), {
          speed: e.broke ? 3.6 : e.crit ? 3 : 2.1,
          ore: e.seam || e.crit ? 0.45 : 0.08,
          size: e.broke ? 1.4 : 1,
        });
        // Ore flies to whoever mined it.
        const target = mine ? undefined : (refs.ships.get(e.by) ?? null);
        const nMotes = e.broke ? 14 : e.crit ? 8 : e.seam ? 4 : 2;
        spawnMotes(e.at, e.normal, tmp.c.copy(e.crit ? cssColor('#ffe28a') : ORE), mine ? nMotes : Math.ceil(nMotes / 2), { target });
        if (e.crit || e.broke) {
          // A ring of sparks in the striker's colour, spraying out across the surface.
          const own = cssColor(hueColor(st.s?.players[e.by]?.hue ?? 50, 66));
          anyPerp(e.normal, tmp.t1);
          tmp.t2.crossVectors(e.normal, tmp.t1);
          const N = LITE ? 14 : 24;
          for (let k = 0; k < N; k++) {
            const a = (k / N) * Math.PI * 2;
            tmp.d.copy(tmp.t1).multiplyScalar(Math.cos(a)).addScaledVector(tmp.t2, Math.sin(a)).addScaledVector(e.normal, 0.35);
            emit(e.at, tmp.d, own, 2, e.broke ? 7 : 5.5, { spread: 0.12, life: 0.55, size: 1.2, drag: 3, white: 0.3 });
          }
        }
      }
    });
    return () => {
      off();
      if (bus.sparks === emit) bus.sparks = null;
      if (kit.chunks === spawnChunks) kit.chunks = null;
      if (kit.motes === spawnMotes) kit.motes = null;
      sys.geo.dispose();
      sys.mat.dispose();
    };
  }, [sys, pools, meshes, tmp]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    const cam = state.camera;

    // Sparks: just the clock. Rebase it now and then while nothing is alive,
    // so float precision never degrades.
    sys.time += dt;
    if (sys.time > sys.until + 0.1) {
      sys.mesh.visible = false;
      if (sys.time > 900) {
        sys.time = 0;
        sys.until = 0;
        (sys.aT.array as Float32Array).fill(0);
        sys.aT.clearUpdateRanges();
        sys.aT.needsUpdate = true;
      }
    }
    sys.mat.uniforms.uTime.value = sys.time;

    stepChunks(dt);
    stepMotes(dt, cam, state.size.width, state.size.height);
  });

  function stepChunks(dt: number) {
    if (pools.chunksAlive <= 0) return;
    const { chunks } = meshes;
    let n = 0;
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const c = pools.chunks[i];
      if (c.age >= c.life) continue;
      c.age += dt;
      if (c.age >= c.life) continue;
      const k = Math.exp(-1.3 * dt);
      c.vel.multiplyScalar(k);
      c.pos.addScaledVector(c.vel, dt);
      c.angle += c.spin * dt;
      const f = c.age / c.life;
      // Pop in, shrink away at the end.
      const s = Math.min(1, c.age / 0.05) * (f > 0.7 ? 1 - (f - 0.7) / 0.3 : 1);
      tmp.q.setFromAxisAngle(c.axis, c.angle);
      tmp.m.compose(c.pos, tmp.q, tmp.v.copy(c.scale).multiplyScalar(Math.max(0.001, s)));
      chunks.setMatrixAt(i, tmp.m);
      n++;
    }
    // Dead chunks keep their slot but get a zero-size matrix.
    if (n === 0) {
      pools.chunksAlive = 0;
      chunks.count = 0;
      return;
    }
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const c = pools.chunks[i];
      if (c.age >= c.life) chunks.setMatrixAt(i, tmp.m.makeScale(0, 0, 0));
    }
    chunks.count = MAX_CHUNKS;
    chunks.instanceMatrix.needsUpdate = true;
  }

  function stepMotes(dt: number, cam: Camera, width: number, height: number) {
    const { gems, trails } = meshes;
    if (pools.motesAlive <= 0) {
      gems.count = trails.count = 0;
      return;
    }
    // The HUD ore counter, projected out to a point a little in front of the camera.
    if (width > 1 && height > 1) {
      tmp.hud.set((HUD_ORE.x / width) * 2 - 1, 1 - (HUD_ORE.y / height) * 2, 0.5).unproject(cam).sub(cam.position);
      const l = tmp.hud.length();
      if (l > 1e-6) tmp.hud.multiplyScalar(2.2 / l);
      tmp.hud.add(cam.position);
    } else tmp.hud.copy(cam.position);

    let n = 0;
    for (let i = 0; i < MAX_MOTES; i++) {
      const m = pools.motes[i];
      if (!m.alive) continue;
      m.age += dt;
      const goal = m.hud ? tmp.hud : m.target;
      if (m.age < m.free || !goal) {
        // Pop off the rock and hang for a beat (or just drift and fade when there's nowhere to go).
        m.vel.multiplyScalar(Math.exp(-3.2 * dt));
        if (!goal && m.age > 1.1) m.alive = false;
      } else {
        tmp.d.copy(goal).sub(m.pos);
        const dist = tmp.d.length();
        m.speed = Math.min(16, m.speed + dt * 30);
        if (dist < Math.max(0.12, m.speed * dt * 1.5) || m.age > 3) {
          m.alive = false;
          continue;
        }
        tmp.d.multiplyScalar(m.speed / dist);
        m.vel.lerp(tmp.d, 1 - Math.exp(-7 * dt));
      }
      if (!m.alive) continue;
      m.pos.addScaledVector(m.vel, dt);

      // Constant-ish screen size: scale with distance to the camera.
      const camDist = m.pos.distanceTo(cam.position);
      const fadeIn = Math.min(1, m.age / 0.08);
      const fadeOut = goal ? 1 : Math.max(0, 1 - (m.age - 0.7) / 0.4);
      const near = goal ? Math.min(1, m.pos.distanceTo(goal) / 0.8) : 1;
      const twinkle = 0.85 + 0.15 * Math.sin(m.age * 40 + i);
      const s = m.size * Math.min(1.5, Math.max(0.2, camDist / 7.6)) * fadeIn * (0.45 + 0.55 * near);
      const a = fadeOut * twinkle;
      tmp.m.makeScale(s, s, 1).setPosition(m.pos);
      gems.setMatrixAt(n, tmp.m);
      gems.setColorAt(n, tmp.c.copy(m.color).multiplyScalar(2.4 * a));
      // Trail: a soft streak behind it, as long as ~50 ms of travel.
      tmp.tail.copy(m.pos).addScaledVector(m.vel, -0.05);
      ribbonMatrix(tmp.m, tmp.tail, m.pos, s * 0.55, cam.position);
      trails.setMatrixAt(n, tmp.m);
      trails.setColorAt(n, tmp.c.copy(m.color).lerp(WHITE, 0.15).multiplyScalar(1.6 * a));
      n++;
    }
    if (n === 0) pools.motesAlive = 0;
    gems.count = trails.count = n;
    if (n) {
      gems.instanceMatrix.needsUpdate = trails.instanceMatrix.needsUpdate = true;
      if (gems.instanceColor) gems.instanceColor.needsUpdate = true;
      if (trails.instanceColor) trails.instanceColor.needsUpdate = true;
    }
  }

  return (
    <>
      <primitive object={sys.mesh} />
      <primitive object={meshes.chunks} />
      <primitive object={meshes.trails} />
      <primitive object={meshes.gems} />
      <Dust />
    </>
  );
}
