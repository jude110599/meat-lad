import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { onFx } from '../state/fx';
import { refs } from '../state/refs';
import { useGame } from '../state/store';
import { buffActive, cssColor, hostNow, useBundle } from './util';

const POOL = 12;
const BEAM_LIFE = 0.13;
const FLARE_LIFE = 0.26;
/** My laser fires from a point fixed relative to the camera (bottom right). */
const MUZZLE = new Vector3(0.9, -0.7, -1.2);
const Y_UP = new Vector3(0, 1, 0);
const WHITE = new Color(1, 1, 1);

const BEAM_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vV = normalize(-mv.xyz);
  vY = uv.y;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying vec3 vCol;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  float glow = pow(f, 1.4);
  float core = pow(f, 6.0);
  float taper = smoothstep(0.0, 0.06, vY);
  vec3 c = vCol * glow * 1.3 + vec3(1.0) * core * min(1.5, length(vCol));
  gl_FragColor = vec4(c * taper, 1.0);
}
`;

const FLARE_VERT = /* glsl */ `
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
const FLARE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float glow = exp(-d * 4.0) * (1.0 - d);
  float core = exp(-d * 40.0);
  // Four-point star.
  float star = exp(-abs(c.x) * 26.0) * exp(-abs(c.y) * 2.5) + exp(-abs(c.y) * 26.0) * exp(-abs(c.x) * 2.5);
  gl_FragColor = vec4(vCol * (glow + star * 0.8) + vec3(core * 2.0) * length(vCol) * 0.4, 1.0);
}
`;

interface Beam {
  t: number;
  ft: number;
  mine: boolean;
  from: Vector3;
  to: Vector3;
  color: Color;
  width: number;
  hot: boolean;
}

/**
 * Pooled drill lasers: one instanced beam mesh and one instanced flare mesh
 * (impact + muzzle) for every laser in flight. Mine fire from the camera rig,
 * other players' from their ships; crits and Hyperdrive burn thicker and whiter.
 */
export function Lasers() {
  const res = useBundle(
    () => ({
      beamGeo: new CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0),
      flareGeo: new PlaneGeometry(1, 1),
      beamMat: new ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending }),
      flareMat: new ShaderMaterial({ vertexShader: FLARE_VERT, fragmentShader: FLARE_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    }),
    [],
  );

  const meshes = useMemo(() => {
    const beams = new InstancedMesh(res.beamGeo, res.beamMat, POOL);
    const flares = new InstancedMesh(res.flareGeo, res.flareMat, POOL * 2);
    beams.instanceColor = new InstancedBufferAttribute(new Float32Array(POOL * 3), 3).setUsage(DynamicDrawUsage);
    flares.instanceColor = new InstancedBufferAttribute(new Float32Array(POOL * 6), 3).setUsage(DynamicDrawUsage);
    for (const m of [beams, flares]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(DynamicDrawUsage);
    }
    beams.renderOrder = 6;
    flares.renderOrder = 7;
    return { beams, flares };
  }, [res]);
  useEffect(
    () => () => {
      meshes.beams.dispose();
      meshes.flares.dispose();
    },
    [meshes],
  );

  const pool = useMemo<Beam[]>(
    () =>
      Array.from({ length: POOL }, () => ({ t: 0, ft: 0, mine: false, from: new Vector3(), to: new Vector3(), color: new Color(), width: 0.03, hot: false })),
    [],
  );
  const head = useMemo(() => ({ i: 0 }), []);
  const tmp = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), s: new Vector3(), d: new Vector3(), p: new Vector3(), c: new Color() }), []);

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind !== 'laser') return;
        const st = useGame.getState();
        const mine = e.from === st.me;
        let origin: Vector3 | undefined;
        if (!mine) {
          origin = refs.ships.get(e.from);
          if (!origin) return;
        }
        const b = pool[head.i];
        head.i = (head.i + 1) % POOL;
        b.mine = mine;
        if (origin) b.from.copy(origin);
        b.to.copy(e.to);
        const hyper = !!st.s && buffActive(st.s, 'hyperdrive', hostNow());
        b.hot = e.crit || hyper;
        b.color.copy(cssColor(e.color));
        if (b.hot) b.color.lerp(WHITE, e.crit ? 0.55 : 0.35);
        b.color.multiplyScalar(e.crit ? 3.2 : hyper ? 2.6 : 2);
        b.width = (mine ? 0.028 : 0.022) * (e.crit ? 2 : 1) * (hyper ? 1.5 : 1);
        b.t = 1;
        b.ft = 1;
      }),
    [pool, head],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const cam = state.camera;
    const { beams, flares } = meshes;
    let nb = 0;
    let nf = 0;
    for (let i = 0; i < POOL; i++) {
      const b = pool[i];
      if (b.ft <= 0) continue;
      b.t = Math.max(0, b.t - dt / BEAM_LIFE);
      b.ft = Math.max(0, b.ft - dt / FLARE_LIFE);
      if (b.mine) b.from.copy(MUZZLE).applyMatrix4(cam.matrixWorld);

      if (b.t > 0) {
        tmp.d.copy(b.to).sub(b.from);
        const len = tmp.d.length();
        tmp.q.setFromUnitVectors(Y_UP, tmp.d.divideScalar(Math.max(1e-4, len)));
        const w = b.width * (0.35 + 0.65 * b.t);
        tmp.m.compose(b.from, tmp.q, tmp.s.set(w, len, w));
        beams.setMatrixAt(nb, tmp.m);
        beams.setColorAt(nb, tmp.c.copy(b.color).multiplyScalar(b.t));
        nb++;
      }

      // Impact flare (billboard), bigger on hot hits; pulled toward the camera
      // so the surface doesn't clip it.
      const k = b.ft;
      const size = (b.hot ? 0.75 : 0.5) * (0.6 + (1 - k) * 0.8);
      tmp.p.copy(cam.position).sub(b.to).setLength(0.22).add(b.to);
      tmp.m.compose(tmp.p, cam.quaternion, tmp.s.set(size, size, size));
      flares.setMatrixAt(nf, tmp.m);
      flares.setColorAt(nf, tmp.c.copy(b.color).multiplyScalar(k * k * 0.9));
      nf++;
      // Muzzle flash, shorter.
      if (b.t > 0) {
        const ms = (b.mine ? 0.16 : 0.22) * (0.6 + b.t * 0.6);
        tmp.m.compose(b.from, cam.quaternion, tmp.s.set(ms, ms, ms));
        flares.setMatrixAt(nf, tmp.m);
        flares.setColorAt(nf, tmp.c.copy(b.color).multiplyScalar(b.t * 0.7));
        nf++;
      }
    }
    beams.count = nb;
    flares.count = nf;
    if (nb) {
      beams.instanceMatrix.needsUpdate = true;
      if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
    }
    if (nf) {
      flares.instanceMatrix.needsUpdate = true;
      if (flares.instanceColor) flares.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <primitive object={meshes.beams} />
      <primitive object={meshes.flares} />
    </>
  );
}
