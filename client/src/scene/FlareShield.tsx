import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
} from 'three';
import { onFx } from '../state/fx';
import { useGame } from '../state/store';
import { sparks } from './bus';
import { damp, useBundle } from './util';

export const SHIELD_RADIUS = 3.3;
const HITS = 6;
const SPLASH_SLOTS = 4; // slots 0-3: flare splashes, 4-5: player top-ups
const STREAKS = 64;

const SHIELD_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying vec2 vUv;
void main() {
  vP = normalize(position);
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const SHIELD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAmt;
uniform float uLow;
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform vec4 uHits[${HITS}];
uniform vec3 uHitCol[${HITS}];
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying vec2 vUv;

float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}
float hexEdge(vec2 uv) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  return 0.5 - hexDist(g);
}
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, 2.6);
  float edge = hexEdge(vUv * vec2(38.0, 16.0));
  float lines = smoothstep(0.06, 0.0, edge);
  float scan = smoothstep(0.92, 1.0, sin(vP.y * 26.0 - uTime * 3.0));
  float sunSide = max(dot(vP, uSunDir), 0.0);
  vec3 col = uColor * (rim * 1.5 + lines * (0.1 + rim * 0.6) + scan * 0.06 + sunSide * sunSide * 0.08);
  for (int i = 0; i < ${HITS}; i++) {
    float age = uHits[i].w;
    if (age < 0.0 || age > 1.1) continue;
    float ang = acos(clamp(dot(vP, uHits[i].xyz), -1.0, 1.0));
    float front = age * 2.4;
    float ring = exp(-pow((ang - front) * 8.0, 2.0)) * (1.0 - age / 1.1);
    float spot = exp(-ang * ang * 30.0) * max(0.0, 1.0 - age * 4.0);
    col += uHitCol[i] * (ring * (0.5 + lines * 2.5) + spot * 2.0);
  }
  float stutter = step(0.3, fract(sin(floor(uTime * 22.0) * 12.9898) * 43758.5453));
  float flick = mix(1.0, 0.25 + 0.75 * stutter, uLow);
  gl_FragColor = vec4(col * uAmt * flick, 1.0);
}
`;

const STREAK_VERT = /* glsl */ `
varying float vY;
void main() {
  vY = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vY;
void main() {
  float a = vY * vY;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

const SHIELD_COLOR = new Color('#59d4ff');
const FLARE_COLOR = new Color('#ff8a2a');
const TOPUP_COLOR = new Color('#b8f4ff');
const Y_UP = new Vector3(0, 1, 0);

/**
 * Solar Flare: a hex-lined fresnel bubble around the rock whose brightness
 * follows the team shield (flickering when it runs low), with ripples on
 * every top-up, plus flare streaks raining in from the sun and splashing on
 * the bubble.
 */
export function FlareShield() {
  const res = useBundle(
    () => ({
      geo: new SphereGeometry(SHIELD_RADIUS, 64, 40),
      mat: new ShaderMaterial({
        vertexShader: SHIELD_VERT,
        fragmentShader: SHIELD_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uAmt: { value: 0 },
          uLow: { value: 0 },
          uColor: { value: SHIELD_COLOR.clone() },
          uSunDir: { value: new Vector3(0, 1, 0) },
          uHits: { value: Array.from({ length: HITS }, () => new Vector4(0, 1, 0, -1)) },
          uHitCol: { value: Array.from({ length: HITS }, () => new Color()) },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      streakGeo: new CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, -0.5, 0),
      streakMat: new ShaderMaterial({
        vertexShader: STREAK_VERT,
        fragmentShader: STREAK_FRAG,
        uniforms: { uColor: { value: FLARE_COLOR.clone().multiplyScalar(3) } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    }),
    [],
  );

  const objs = useMemo(() => {
    const bubble = new Mesh(res.geo, res.mat);
    bubble.renderOrder = 8;
    bubble.visible = false;
    const streaks = new InstancedMesh(res.streakGeo, res.streakMat, STREAKS);
    streaks.frustumCulled = false;
    streaks.instanceMatrix.setUsage(DynamicDrawUsage);
    streaks.count = 0;
    return { bubble, streaks };
  }, [res]);
  useEffect(() => () => objs.streaks.dispose(), [objs]);

  const sim = useMemo(
    () => ({
      amt: 0,
      low: 0,
      shield: 0.6,
      hitStart: new Float32Array(HITS).fill(-100),
      splash: 0,
      topup: 0,
      spawnAcc: 0,
      pos: Array.from({ length: STREAKS }, () => new Vector3()),
      vel: Array.from({ length: STREAKS }, () => new Vector3()),
      len: new Float32Array(STREAKS),
      alive: new Uint8Array(STREAKS),
      head: 0,
      time: 0,
    }),
    [],
  );
  const tmp = useMemo(
    () => ({ m: new Matrix4(), q: new Quaternion(), s: new Vector3(), d: new Vector3(), a: new Vector3(), b: new Vector3(), sun: new Vector3() }),
    [],
  );

  const addHit = (slot: number, dir: Vector3, color: Color, amp: number) => {
    const u = res.mat.uniforms;
    (u.uHits.value as Vector4[])[slot].set(dir.x, dir.y, dir.z, 0);
    (u.uHitCol.value as Color[])[slot].copy(color).multiplyScalar(amp);
    sim.hitStart[slot] = sim.time;
  };

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind !== 'shieldHit') return;
        // Ripple from a random spot on the sun-facing hemisphere.
        tmp.d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2).add(tmp.sun).normalize();
        addHit(SPLASH_SLOTS + (sim.topup++ % (HITS - SPLASH_SLOTS)), tmp.d, TOPUP_COLOR, 1.6);
        sim.amt = Math.min(1.4, sim.amt + 0.25);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    sim.time = state.clock.elapsedTime;
    const ev = useGame.getState().s?.event;
    const flare = ev?.kind === 'flare' ? ev : null;
    if (flare) {
      sim.shield = flare.shield / 100;
      tmp.sun.set(flare.sunDir[0], flare.sunDir[1], flare.sunDir[2]).normalize();
    }
    sim.amt = damp(sim.amt, flare ? 0.3 + 0.7 * sim.shield : 0, 3, dt);
    sim.low = damp(sim.low, flare && sim.shield < 0.25 ? 1 : 0, 6, dt);

    const u = res.mat.uniforms;
    u.uTime.value = sim.time;
    u.uAmt.value = sim.amt;
    u.uLow.value = sim.low;
    (u.uSunDir.value as Vector3).copy(tmp.sun).applyAxisAngle(Y_UP, -objs.bubble.rotation.y);
    const hits = u.uHits.value as Vector4[];
    for (let i = 0; i < HITS; i++) hits[i].w = sim.time - sim.hitStart[i];
    objs.bubble.visible = sim.amt > 0.004;
    objs.bubble.rotation.y += dt * 0.05;

    // Flare streaks.
    if (flare) {
      sim.spawnAcc += dt * 10;
      while (sim.spawnAcc >= 1) {
        sim.spawnAcc -= 1;
        const i = sim.head;
        sim.head = (sim.head + 1) % STREAKS;
        // Aim at a random point on the sun-facing side of the bubble.
        tmp.a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.3).add(tmp.sun).normalize().multiplyScalar(SHIELD_RADIUS);
        tmp.b.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3);
        sim.pos[i].copy(tmp.a).addScaledVector(tmp.sun, 20 + Math.random() * 8).add(tmp.b);
        sim.vel[i].copy(tmp.a).sub(sim.pos[i]).normalize().multiplyScalar(17 + Math.random() * 7);
        sim.len[i] = 1.4 + Math.random() * 1.6;
        sim.alive[i] = 1;
      }
    }
    // Bubble rotates; splash ripples are placed in its local frame.
    let n = 0;
    const st = objs.streaks;
    for (let i = 0; i < STREAKS; i++) {
      if (!sim.alive[i]) continue;
      const p = sim.pos[i];
      p.addScaledVector(sim.vel[i], dt);
      if (p.lengthSq() <= SHIELD_RADIUS * SHIELD_RADIUS) {
        sim.alive[i] = 0;
        tmp.d.copy(p).normalize();
        sparks(p, tmp.d, FLARE_COLOR, 7, 3.2, { spread: 1.2, life: 0.45, white: 0.5 });
        tmp.a.copy(tmp.d).applyAxisAngle(Y_UP, -objs.bubble.rotation.y);
        addHit(sim.splash++ % SPLASH_SLOTS, tmp.a, FLARE_COLOR, 0.9);
        continue;
      }
      tmp.d.copy(sim.vel[i]).normalize();
      tmp.q.setFromUnitVectors(Y_UP, tmp.d);
      tmp.m.compose(p, tmp.q, tmp.s.set(0.035, sim.len[i], 0.035));
      st.setMatrixAt(n++, tmp.m);
    }
    st.count = n;
    if (n) st.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={objs.bubble} />
      <primitive object={objs.streaks} />
    </>
  );
}
